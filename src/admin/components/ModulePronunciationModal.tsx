import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Eye, EyeOff, Loader2, Mic, RotateCcw, Trash2, Undo2, Volume2, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AiCreditsNotice } from '@/components/ui/AiCreditsNotice'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { GenerationProgress, ASSIST_STEPS } from '@/admin/components/GenerationProgress'
import { buildPronunciationBlock } from '@/lib/pronunciationBlock'
import { PronunciationBlockRenderer } from '@/components/modules/blocks/PronunciationBlock'
import { moduleAiAssist, type ModulePronunciationPlan } from '@/services/ai.service'
import { consumeAiOperation, isQuotaExceeded, refundAiOperation } from '@/services/aiQuota.service'
import { getModuleWithSectionsRaw, setSectionBlocks, type DbSectionRow } from '@/services/modules.service'
import type { ContentBlock, PronunciationBlock } from '@/types/blocks'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'
import { blockPlainText } from '@/lib/blockPlainText'
import { initialContentLang, rowText } from '@/lib/contentLang'
import { PRONUNCIATION_LANGS, speak } from '@/lib/speech'
import { cn } from '@/lib/cn'
import { Tooltip } from '@/components/ui/Tooltip'

type Lang = 'es' | 'en' | 'pt'
type Suggestion = ModulePronunciationPlan['suggestions'][number]

const GAME_BLOCK_TYPES = new Set(['game-sort', 'game-classify'])

/**
 * La sección tal como se le mandó a la IA. Los índices de la propuesta apuntan
 * a ESTOS bloques: si la sección cambia antes de insertar, esa sección se salta
 * en vez de meter la práctica en un sitio que ya no es el que se eligió.
 */
interface SectionSnap {
  id: string
  heading: string
  /** En secciones de juego, el bloque del juego va aparte y primero (igual que el editor). */
  gameBlocks: ContentBlock[]
  contentBlocks: ContentBlock[]
  raw: string
}

/** Lo que se escribió, para poder deshacerlo. */
interface Applied {
  sectionId: string
  before: ContentBlock[]
  after: ContentBlock[]
}

function snapSection(s: DbSectionRow): SectionSnap {
  const all = Array.isArray(s.blocks_data) ? (s.blocks_data as ContentBlock[]) : []
  const isGame = s.section_style === 'game-sort' || s.section_style === 'game-classify'
  return {
    id: s.id,
    heading: rowText(s, 'heading'),
    gameBlocks: isGame ? all.filter((b) => GAME_BLOCK_TYPES.has(b.type)) : [],
    contentBlocks: isGame ? all.filter((b) => !GAME_BLOCK_TYPES.has(b.type)) : all,
    raw: JSON.stringify(s.blocks_data ?? null),
  }
}

function sectionBody(s: DbSectionRow, lang: Lang): string {
  const r = s as unknown as Record<string, string[] | null>
  return (r[`body_${lang}`]?.length ? r[`body_${lang}`] : s.body_es ?? [])!.join('\n')
}

/**
 * Práctica de pronunciación sobre el MÓDULO ENTERO (cursos de idiomas).
 *
 * La versión por sección obliga a entrar a cada una y adivinar dónde rinde; aquí
 * la IA ve todas las secciones a la vez, elige en cuáles vale la pena practicar
 * en voz alta (y dónde dentro de cada una) y no repite frases entre prácticas.
 * El capacitador marca cuáles entran y se guardan directo, sección por sección.
 */
export function ModulePronunciationModal({
  moduleId, moduleTitle, campaignId, targetLang, sections, onClose, onApplied,
}: {
  moduleId: string
  moduleTitle: string
  campaignId: string | null
  /** BCP-47 del idioma que se estudia, fijado en la ficha del curso. */
  targetLang: string
  sections: DbSectionRow[]
  onClose: () => void
  /** Se escribió en la base: el editor tiene que releer las secciones. */
  onApplied: () => void
}) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const lang = initialContentLang() as Lang
  // Prácticas que ya están puestas y que se quitaron desde aquí (id de sección
  // + posición). Se ocultan al momento; el editor relee al cerrar.
  const [removedExisting, setRemovedExisting] = useState<Set<string>>(new Set())
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [phase, setPhase] = useState<'intro' | 'loading' | 'plan' | 'saving' | 'done'>('intro')
  const [error, setError] = useState<string | null>(null)
  const [snaps, setSnaps] = useState<SectionSnap[]>([])
  const [plan, setPlan] = useState<ModulePronunciationPlan | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [previewing, setPreviewing] = useState<Set<number>>(new Set())
  // Frases que el capacitador quitó de una práctica ("índice:frase"). Se ven
  // tachadas y se pueden devolver; no entran ni en la vista previa ni al insertar.
  const [dropped, setDropped] = useState<Set<string>>(new Set())
  const [applied, setApplied] = useState<Applied[]>([])
  const [skipped, setSkipped] = useState(0)
  const [undone, setUndone] = useState(false)

  const langLabel = PRONUNCIATION_LANGS.find((l) => l.value === targetLang)?.label ?? targetLang
  const busy = phase === 'loading' || phase === 'saving'

  const flip = <T,>(set: React.Dispatch<React.SetStateAction<Set<T>>>, i: T) => set((prev) => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  })

  /** La práctica con solo las frases que siguen puestas. */
  const kept = (s: Suggestion, i: number): Suggestion => ({
    ...s,
    phrases: s.phrases.filter((_, k) => !dropped.has(`${i}:${k}`)),
  })
  /** Entra al insertar: marcada y con al menos una frase. */
  const willInsert = (s: Suggestion, i: number) => chosen.has(i) && kept(s, i).phrases.length > 0

  const analyze = async () => {
    setPhase('loading')
    setError(null)
    setPlan(null)
    const snap = sections.map(snapSection)
    setSnaps(snap)
    let charged = false
    try {
      // Mira el módulo entero: cuesta como una ayuda puntual de IA.
      await consumeAiOperation('assist', t('admin.modules.pron_module.quota_label', { module: moduleTitle }), campaignId)
      charged = true
      const res = await moduleAiAssist({
        action: 'pronunciation_module_plan',
        contentType: 'section',
        sourceLang: lang,
        fields: {},
        moduleTitle,
        language: lang,
        pronunciationModule: {
          targetLang,
          sections: sections.map((s, index) => ({
            index,
            heading: snap[index].heading || undefined,
            body: sectionBody(s, lang) || undefined,
            blocks: snap[index].contentBlocks.map((b, bi) => ({
              index: bi,
              type: b.type,
              text: blockPlainText(b, lang) || blockPlainText(b, 'es'),
            })),
          })),
        },
      })
      const d = res.data as unknown as ModulePronunciationPlan
      // Una función sin desplegar no conoce la acción y responde como «mejorar»:
      // sin la lista no es un "no hay dónde practicar", es que falta el redeploy.
      if (!Array.isArray(d?.suggestions)) {
        throw new Error(t('admin.modules.ai_panel.pron_outdated_function'))
      }

      // Se limpia lo que la IA pueda devolver fuera de rango. Una sección densa
      // puede llevar varias prácticas (hasta 3), pero nunca dos tras el mismo
      // bloque: antes se dejaba solo una por sección y todo salía con el mismo molde.
      const seen = new Set<string>()
      const perSection = new Map<number, number>()
      const suggestions = d.suggestions
        .map((s) => {
          const si = Math.round(Number(s.section_index))
          if (!Number.isFinite(si) || !snap[si]) return null
          const max = snap[si].contentBlocks.length - 1
          const ai = Math.max(-1, Math.min(max, Math.round(Number(s.after_index))))
          const phrases = (s.phrases ?? []).filter((p) => p?.text?.trim())
          return phrases.length ? { ...s, section_index: si, after_index: Number.isFinite(ai) ? ai : max, phrases } : null
        })
        .filter((s): s is Suggestion => !!s)
        .sort((a, b) => a.section_index - b.section_index || a.after_index - b.after_index)
        .filter((s) => {
          const key = `${s.section_index}:${s.after_index}`
          const n = perSection.get(s.section_index) ?? 0
          if (seen.has(key) || n >= 3) return false
          seen.add(key)
          perSection.set(s.section_index, n + 1)
          return true
        })
        .slice(0, 12)

      setPlan({ ...d, target_lang: targetLang, suggestions })
      setChosen(new Set(suggestions.map((_, i) => i)))
      setPreviewing(new Set())
      setDropped(new Set())
      setPhase('plan')
    } catch (e) {
      if (charged) await refundAiOperation('assist').catch(() => {})
      setError(isQuotaExceeded(e) ? t('admin.modules.pron_module.quota_exceeded') : (e as Error).message)
      setPhase('intro')
    }
  }

  const where = (s: Suggestion) => {
    const blocks = snaps[s.section_index]?.contentBlocks ?? []
    const b = blocks[s.after_index]
    if (s.after_index < 0 || !b) return t('admin.modules.ai_panel.pron_at_start')
    const label = t(`admin.modules.be.block_labels.${b.type}`, b.type)
    const text = blockPlainText(b, lang) || blockPlainText(b, 'es')
    const snippet = text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text
    return t('admin.modules.ai_panel.pron_after_block', { n: s.after_index + 1, label, snippet })
  }

  const insert = async () => {
    if (!plan) return
    setPhase('saving')
    setError(null)
    try {
      // Se relee justo antes de escribir: si alguien tocó una sección desde el
      // análisis, sus índices ya no valen y esa sección se salta.
      const fresh = await getModuleWithSectionsRaw(moduleId)
      const byId = new Map(fresh.module_sections.map((s) => [s.id, s]))
      const bySection = new Map<number, Suggestion[]>()
      plan.suggestions.forEach((s, i) => {
        if (!willInsert(s, i)) return
        bySection.set(s.section_index, [...(bySection.get(s.section_index) ?? []), kept(s, i)])
      })

      const done: Applied[] = []
      let skip = 0
      for (const [si, items] of bySection) {
        const snap = snaps[si]
        const row = snap && byId.get(snap.id)
        if (!snap || !row || JSON.stringify(row.blocks_data ?? null) !== snap.raw) {
          skip += items.length
          continue
        }
        const content = [...snap.contentBlocks]
        // De atrás hacia adelante, para que cada índice siga apuntando al bloque elegido.
        ;[...items]
          .sort((a, b) => b.after_index - a.after_index)
          .forEach((s) => content.splice(s.after_index + 1, 0, buildPronunciationBlock(s, targetLang, lang)))
        const after = [...snap.gameBlocks, ...content]
        const before = Array.isArray(row.blocks_data) ? (row.blocks_data as ContentBlock[]) : []
        await setSectionBlocks(snap.id, after)
        done.push({ sectionId: snap.id, before, after })
      }

      setApplied(done)
      setSkipped(skip)
      setUndone(false)
      setPhase('done')
      if (done.length) onApplied()
    } catch (e) {
      setError((e as Error).message === 'NO_ROWS_UPDATED' ? t('admin.modules.pron_module.no_permission') : (e as Error).message)
      setPhase('plan')
    }
  }

  const undo = async () => {
    setPhase('saving')
    setError(null)
    try {
      const fresh = await getModuleWithSectionsRaw(moduleId)
      const byId = new Map(fresh.module_sections.map((s) => [s.id, s]))
      for (const a of applied) {
        const row = byId.get(a.sectionId)
        // Solo se devuelve lo que sigue exactamente como se dejó: si ya se editó
        // encima, deshacer borraría ese trabajo.
        if (!row || JSON.stringify(row.blocks_data ?? null) !== JSON.stringify(a.after)) continue
        await setSectionBlocks(a.sectionId, a.before)
      }
      setUndone(true)
      onApplied()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPhase('done')
    }
  }

  /** Las prácticas de pronunciación que el módulo YA tiene, sección por sección. */
  const existing = useMemo(() => sections.flatMap((sec, si) => {
    const all = Array.isArray(sec.blocks_data) ? (sec.blocks_data as ContentBlock[]) : []
    return all
      .map((b, bi) => ({ b, bi }))
      .filter(({ b }) => b.type === 'pronunciation')
      .map(({ b, bi }) => ({
        key: `${sec.id}:${bi}`,
        // Al quitar una, las siguientes de la sección corren de posición cuando
        // el editor relee: lo quitado se recuerda por contenido, no por índice.
        gone: `${sec.id}:${JSON.stringify(b)}`,
        sectionId: sec.id,
        sectionIndex: si,
        sectionName: rowText(sec, 'heading'),
        blockIndex: bi,
        block: b as PronunciationBlock,
        raw: JSON.stringify(sec.blocks_data ?? null),
      }))
  }).filter((x) => !removedExisting.has(x.gone)), [sections, removedExisting])

  /**
   * Quita una práctica ya puesta. Se relee la sección justo antes: si alguien la
   * cambió mientras tanto, la posición ya no es fiable y no se toca nada.
   */
  const removeExisting = async (x: (typeof existing)[number]) => {
    const title = x.block.title?.[lang] || x.block.title?.es || x.block.phrases[0]?.text || ''
    const ok = await confirm({
      title: t('admin.modules.pron_module.existing_remove_title'),
      description: t('admin.modules.pron_module.existing_remove_desc', { title, count: x.block.phrases.length }),
      confirmLabel: t('admin.modules.pron_module.existing_remove_cta'),
    })
    if (!ok) return
    setRemovingKey(x.key)
    setError(null)
    try {
      const fresh = await getModuleWithSectionsRaw(moduleId)
      const row = fresh.module_sections.find((r) => r.id === x.sectionId)
      if (!row || JSON.stringify(row.blocks_data ?? null) !== x.raw) {
        setError(t('admin.modules.pron_module.existing_changed'))
        return
      }
      const all = Array.isArray(row.blocks_data) ? (row.blocks_data as ContentBlock[]) : []
      await setSectionBlocks(x.sectionId, all.filter((_, k) => k !== x.blockIndex))
      setRemovedExisting((prev) => new Set(prev).add(x.gone))
      toast.success(t('admin.modules.pron_module.existing_removed'))
      onApplied()
    } catch (e) {
      setError((e as Error).message === 'NO_ROWS_UPDATED' ? t('admin.modules.pron_module.no_permission') : (e as Error).message)
    } finally {
      setRemovingKey(null)
    }
  }

  const suggestions = plan?.suggestions ?? []
  const insertCount = suggestions.filter((s, i) => willInsert(s, i)).length
  const insertedCount = useMemo(
    () => applied.reduce((n, a) => n + a.after.length - a.before.length, 0),
    [applied],
  )

  const footer = (() => {
    if (phase === 'intro') {
      return (
        <>
          <Button variant="glass" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={analyze} disabled={!sections.length}>
            <Mic className="h-3.5 w-3.5" /> {t('admin.modules.pron_module.analyze')}
          </Button>
        </>
      )
    }
    if (phase === 'plan' || (phase === 'saving' && !applied.length)) {
      return (
        <>
          <Button variant="glass" size="sm" onClick={analyze} disabled={busy}>
            <RotateCcw className="h-3.5 w-3.5" /> {t('admin.modules.ai_panel.regenerate')}
          </Button>
          <Button size="sm" onClick={insert} disabled={busy || insertCount === 0}>
            {phase === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {t('admin.modules.ai_panel.pron_insert', { count: insertCount })}
          </Button>
        </>
      )
    }
    if (phase === 'done' || phase === 'saving') {
      return (
        <>
          {applied.length > 0 && !undone && (
            <Button variant="glass" size="sm" onClick={undo} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {t('admin.modules.ai_panel.pron_undo_insert')}
            </Button>
          )}
          <Button size="sm" onClick={onClose} disabled={busy}>{t('common.close')}</Button>
        </>
      )
    }
    return null
  })()

  return (
    <Modal
      onClose={onClose}
      dismissible={!busy}
      size="2xl"
      accent="violet"
      icon={<Mic className="h-4 w-4" />}
      title={t('admin.modules.pron_module.title')}
      subtitle={t('admin.modules.pron_module.subtitle', { lang: langLabel, count: sections.length })}
      footer={footer}
      footerLeft={<AiReviewNotice variant="inline" />}
    >
      <div className="space-y-3">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/8 p-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {phase === 'intro' && (
          <>
            <AiCreditsNotice />
            <p className="text-[13px] leading-relaxed text-text-muted">
              {t('admin.modules.pron_module.intro', { lang: langLabel })}
            </p>
            <ul className="space-y-1.5">
              {(['how_1', 'how_2', 'how_3'] as const).map((k, i) => (
                <li key={k} className="flex items-start gap-2 text-[12px] leading-snug text-text-muted">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neon-magenta/12 text-[10px] font-bold text-neon-magenta">
                    {i + 1}
                  </span>
                  {t(`admin.modules.pron_module.${k}`)}
                </li>
              ))}
            </ul>

            {existing.length > 0 && (
              <section className="space-y-1.5 pt-1">
                <p className="text-[12px] font-semibold text-text">
                  {t('admin.modules.pron_module.existing_title', { count: existing.length })}
                </p>
                <p className="text-[11.5px] text-text-subtle">{t('admin.modules.pron_module.existing_hint')}</p>
                <ul className="max-h-[36vh] divide-y divide-line/60 overflow-y-auto rounded-xl border border-line custom-scrollbar">
                  {existing.map((x) => {
                    const title = x.block.title?.[lang] || x.block.title?.es || t('admin.modules.pron_module.existing_untitled')
                    const removing = removingKey === x.key
                    return (
                      <li key={x.key} className="flex items-center gap-2.5 px-3 py-2">
                        <Mic className="h-3.5 w-3.5 shrink-0 text-neon-magenta" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium text-text">{title}</p>
                          <p className="truncate text-[11px] text-text-subtle">
                            {t('admin.modules.pron_module.section_n', { n: x.sectionIndex + 1, name: x.sectionName || t('common.untitled') })}
                            {' · '}
                            <span lang={x.block.lang}>{x.block.phrases.map((p) => p.text).join(' · ')}</span>
                          </p>
                        </div>
                        <Tooltip label={t('admin.modules.pron_module.existing_remove_title')} anchor="element">
                          <button
                            type="button"
                            onClick={() => void removeExisting(x)}
                            disabled={!!removingKey}
                            aria-label={t('admin.modules.pron_module.existing_remove_title')}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-danger/8 hover:text-danger disabled:pointer-events-none disabled:opacity-40"
                          >
                            {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        </Tooltip>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </>
        )}

        <GenerationProgress steps={ASSIST_STEPS} active={phase === 'loading'} title={t('admin.modules.pron_module.analyzing')} />

        {plan && (phase === 'plan' || (phase === 'saving' && !applied.length)) && (
          <>
            {plan.reason && <p className="text-[12px] leading-relaxed text-text-muted">{plan.reason}</p>}
            {suggestions.length === 0 && (
              <p className="rounded-xl border border-glass-border/15 p-3 text-[12px] text-text-muted">
                {t('admin.modules.pron_module.nothing')}
              </p>
            )}
            {suggestions.length > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-glass-border/15 px-3 py-2">
                <p className="text-[11.5px] text-text-muted">
                  {t('admin.modules.pron_module.pick_hint', { count: insertCount, total: suggestions.length })}
                </p>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setChosen(new Set(suggestions.map((_, i) => i)))}
                    className="rounded-lg px-2 py-1 text-[11px] font-semibold text-text-muted hover:bg-glass/8 hover:text-text"
                  >
                    {t('admin.modules.pron_module.pick_all')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChosen(new Set())}
                    className="rounded-lg px-2 py-1 text-[11px] font-semibold text-text-muted hover:bg-glass/8 hover:text-text"
                  >
                    {t('admin.modules.pron_module.pick_none')}
                  </button>
                </div>
              </div>
            )}
            {suggestions.map((s, i) => {
              const keptPhrases = kept(s, i).phrases.length
              const on = chosen.has(i) && keptPhrases > 0
              const open = previewing.has(i)
              const snap = snaps[s.section_index]
              return (
                <div
                  key={i}
                  className={cn(
                    'space-y-2 rounded-xl border p-3 transition-colors',
                    on ? 'border-neon-magenta/30 bg-surface' : 'border-glass-border/15',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <input
                      id={`pron-mod-${i}`}
                      type="checkbox"
                      checked={on}
                      disabled={keptPhrases === 0}
                      onChange={() => flip(setChosen, i)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-neon-green"
                    />
                    <label htmlFor={`pron-mod-${i}`} className={cn('min-w-0 flex-1 cursor-pointer', !on && 'opacity-60')}>
                      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neon-magenta">
                        {t('admin.modules.pron_module.section_n', {
                          n: s.section_index + 1,
                          name: snap?.heading || t('common.untitled'),
                        })}
                      </p>
                      <p className="text-[13px] font-semibold text-text">{s.title}</p>
                      <p className="text-[11px] text-text-subtle">{where(s)}</p>
                      {s.why && <p className="mt-0.5 text-[11px] text-text-muted">{s.why}</p>}
                      {keptPhrases === 0 && (
                        <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">{t('admin.modules.pron_module.all_removed')}</p>
                      )}
                    </label>
                    <button
                      type="button"
                      onClick={() => flip(setPreviewing, i)}
                      aria-expanded={open}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-semibold transition-colors',
                        open
                          ? 'border-neon-green/30 bg-neon-green/10 text-neon-green'
                          : 'border-glass-border/20 text-text-muted hover:border-glass-border/40 hover:text-text',
                      )}
                    >
                      {open ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {open ? t('admin.modules.ai_panel.pron_hide_preview') : t('admin.modules.ai_panel.pron_preview')}
                    </button>
                  </div>

                  {open ? (
                    <div className={cn('rounded-xl border border-dashed border-glass-border/25 bg-bg/40 p-3 sm:p-4', !on && 'opacity-60')}>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                        {t('admin.modules.ai_panel.pron_preview_label')}
                      </p>
                      <PronunciationBlockRenderer block={buildPronunciationBlock(kept(s, i), targetLang, lang)} language={lang} />
                    </div>
                  ) : (
                    <ul className={cn('space-y-0.5 pl-5', !on && 'opacity-60')}>
                      {s.phrases.map((p, k) => {
                        const key = `${i}:${k}`
                        const gone = dropped.has(key)
                        return (
                        <li key={k} className={cn('group flex min-w-0 items-center gap-1.5 text-[11.5px] text-text-muted', gone && 'opacity-50')}>
                          <button
                            type="button"
                            onClick={() => void speak(p.text, targetLang)}
                            aria-label={t('admin.modules.be.pron_preview')}
                            className="shrink-0 text-text-subtle hover:text-neon-green"
                          >
                            <Volume2 className="h-3 w-3" />
                          </button>
                          <span className={cn('font-medium text-text', gone && 'line-through')} lang={targetLang}>{p.text}</span>
                          {p.translation && <span className={cn('min-w-0 flex-1 truncate', gone && 'line-through')}>— {p.translation}</span>}
                          <Tooltip label={gone ? t('admin.modules.pron_module.phrase_restore') : t('admin.modules.pron_module.phrase_remove')} anchor="element">
                            <button
                              type="button"
                              onClick={() => flip(setDropped, key)}
                              aria-label={gone ? t('admin.modules.pron_module.phrase_restore') : t('admin.modules.pron_module.phrase_remove')}
                              className={cn(
                                'ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors',
                                gone
                                  ? 'text-neon-green hover:bg-neon-green/10'
                                  : 'text-text-subtle hover:bg-danger/10 hover:text-danger',
                              )}
                            >
                              {gone ? <Undo2 className="h-3 w-3" /> : <X className="h-3 w-3" />}
                            </button>
                          </Tooltip>
                        </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </>
        )}

        {(phase === 'done' || (phase === 'saving' && applied.length > 0)) && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-xl border border-neon-green/25 bg-neon-green/8 px-3 py-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-neon-green" />
              <p className="text-[12.5px] leading-relaxed text-text">
                {undone
                  ? t('admin.modules.pron_module.undone')
                  : t('admin.modules.pron_module.inserted', { count: insertedCount, sections: applied.length })}
              </p>
            </div>
            {skipped > 0 && (
              <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('admin.modules.pron_module.skipped', { count: skipped })}
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
