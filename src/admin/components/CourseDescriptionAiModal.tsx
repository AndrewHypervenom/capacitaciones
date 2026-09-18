import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, BookOpenCheck, Check, FileText, Loader2, RefreshCw, SlidersHorizontal, Sparkles,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { Tooltip } from '@/components/ui/Tooltip'
import { RichText } from '@/components/ui/RichText'
import { AiCreditsNotice } from '@/components/ui/AiCreditsNotice'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { consumeAiOperation, isQuotaExceeded, refundAiOperation } from '@/services/aiQuota.service'
import {
  loadCourseSources, generateCourseDescription, hasEnoughSource,
  type CourseSourceModule, type CourseDescriptionResult, type DescriptionInclude, type DescriptionLength,
} from '@/services/courseDescription.service'
import { cn } from '@/lib/cn'

type Lang = 'es' | 'en' | 'pt'

const LENGTHS: DescriptionLength[] = ['short', 'medium', 'long']
const INCLUDES: DescriptionInclude[] = ['outcomes', 'audience', 'structure']

/**
 * Descripción del curso con IA, a la manera de un cuaderno de fuentes: las
 * fuentes son los módulos del curso (y nada más). El capacitador elige cuáles
 * usar, el largo y qué cubrir; la IA redacta, y cada idea viene con el módulo
 * de donde salió para poder verificarla. No se guarda nada aquí: «Usar» pasa
 * el texto al formulario y se guarda con el resto del curso.
 */
export function CourseDescriptionAiModal({
  courseId, courseTitle, campaignId, lang, level, languageTarget, current, onApply, onClose,
}: {
  courseId: string
  courseTitle: string
  campaignId: string | null
  /** Idioma de la pestaña del editor: en ese idioma se escribe. */
  lang: Lang
  level: string | null
  languageTarget: string | null
  /** Descripción que hay ahora en esa pestaña (puede estar vacía). */
  current: string
  onApply: (text: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [modules, setModules] = useState<CourseSourceModule[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [length, setLength] = useState<DescriptionLength>('medium')
  const [include, setInclude] = useState<Set<DescriptionInclude>>(new Set(['outcomes', 'audience']))
  const [rewrite, setRewrite] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [phase, setPhase] = useState<'setup' | 'running' | 'result'>('setup')
  const [result, setResult] = useState<CourseDescriptionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hasCurrent = !!current.trim()

  useEffect(() => {
    let alive = true
    loadCourseSources(courseId, lang)
      .then((mods) => {
        if (!alive) return
        setModules(mods)
        // Por defecto, todos los módulos que tienen texto. Los que solo tienen
        // título no aportan nada verificable.
        setPicked(new Set(mods.filter((m) => m.chars > 0).map((m) => m.id)))
      })
      .catch((e) => { if (alive) setLoadError((e as Error).message) })
    return () => { alive = false }
  }, [courseId, lang])

  const selected = useMemo(
    () => (modules ?? []).filter((m) => picked.has(m.id)),
    [modules, picked],
  )
  const enough = hasEnoughSource(selected)
  const langLabel = t(`admin.courses.desc_ai.lang_${lang}`)

  const toggleModule = (id: string) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const toggleInclude = (k: DescriptionInclude) => setInclude((prev) => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return next
  })

  const run = async () => {
    if (!enough) return
    setPhase('running')
    setError(null)
    let charged = false
    try {
      await consumeAiOperation('assist', t('admin.courses.desc_ai.quota_label', { course: courseTitle }), campaignId)
      charged = true
      const out = await generateCourseDescription({
        courseTitle,
        lang,
        level,
        languageTarget,
        modules: selected,
        length,
        include: INCLUDES.filter((k) => include.has(k)),
        instruction,
        current: rewrite ? current : undefined,
      })
      if (!out.insufficient && !out.description) throw new Error(t('admin.courses.desc_ai.empty_answer'))
      setResult(out)
      setPhase('result')
    } catch (e) {
      if (charged) await refundAiOperation('assist').catch(() => {})
      setError(isQuotaExceeded(e) ? t('admin.ai_limits.blocked_task') : (e as Error).message || t('admin.courses.desc_ai.error'))
      setPhase(result ? 'result' : 'setup')
    }
  }

  const busy = phase === 'running'
  const canUse = phase === 'result' && result && !result.insufficient && !!result.description

  const footer = phase === 'result' ? (
    <>
      <Button variant="glass" size="sm" onClick={() => setPhase('setup')}>
        <SlidersHorizontal className="h-3.5 w-3.5" /> {t('admin.courses.desc_ai.adjust')}
      </Button>
      <Button variant="glass" size="sm" onClick={() => { void run() }}>
        <RefreshCw className="h-3.5 w-3.5" /> {t('admin.courses.desc_ai.again')}
      </Button>
      <Button size="sm" disabled={!canUse} onClick={() => { if (result) { onApply(result.description); onClose() } }}>
        <Check className="h-3.5 w-3.5" /> {t('admin.courses.desc_ai.use')}
      </Button>
    </>
  ) : (
    <>
      <Button variant="glass" size="sm" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
      <Tooltip
        label={t('admin.courses.desc_ai.not_enough')}
        disabled={enough || !modules}
        maxWidth={240}
        anchor="element"
      >
        <Button
          size="sm"
          onClick={() => { void run() }}
          disabled={busy || !modules || !enough}
          className="disabled:pointer-events-none"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? t('admin.courses.desc_ai.running') : t('admin.courses.desc_ai.generate')}
        </Button>
      </Tooltip>
    </>
  )

  return (
    <Modal
      onClose={onClose}
      dismissible={!busy}
      size="xl"
      accent="violet"
      icon={<BookOpenCheck className="h-4 w-4" />}
      title={t('admin.courses.desc_ai.title')}
      subtitle={t('admin.courses.desc_ai.subtitle', { lang: langLabel })}
      footer={footer}
      footerLeft={<AiReviewNotice variant="inline" />}
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/8 p-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loadError && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/8 p-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('admin.courses.desc_ai.load_error', { message: loadError })}</span>
          </div>
        )}

        {!modules && !loadError && (
          <div className="flex items-center justify-center py-10 text-text-subtle">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {modules && phase !== 'result' && (
          <>
            <AiCreditsNotice />
            <p className="text-[12.5px] leading-relaxed text-text-muted">{t('admin.courses.desc_ai.intro')}</p>

            {/* ── Fuentes: los módulos del curso ─────────────────────────── */}
            <section>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-text">{t('admin.courses.desc_ai.sources_title')}</p>
                <p className="text-[11px] tabular-nums text-text-subtle">
                  {t('admin.courses.desc_ai.sources_count', { count: selected.length, total: modules.length })}
                </p>
              </div>
              {modules.length === 0 ? (
                <p className="rounded-xl border border-line px-3 py-4 text-center text-[12.5px] text-text-subtle">
                  {t('admin.courses.desc_ai.no_modules')}
                </p>
              ) : (
                <ul className="max-h-[32vh] divide-y divide-line/60 overflow-y-auto rounded-xl border border-line custom-scrollbar">
                  {modules.map((m, i) => {
                    const empty = m.chars === 0
                    return (
                      <li key={m.id} className={cn('flex items-center gap-2.5 px-3 py-2', empty && 'opacity-55')}>
                        <FileText className="h-4 w-4 shrink-0 text-text-subtle" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-medium text-text">
                            <span className="mr-1.5 font-mono text-[10.5px] text-text-subtle">{String(i + 1).padStart(2, '0')}</span>
                            {m.title || t('admin.courses.desc_ai.untitled')}
                          </p>
                          <p className="truncate text-[11px] text-text-subtle">
                            {empty
                              ? t('admin.courses.desc_ai.module_empty')
                              : t('admin.courses.desc_ai.module_meta', { count: m.sections.length, words: Math.round(m.chars / 6) })}
                          </p>
                        </div>
                        <Toggle
                          on={picked.has(m.id)}
                          onClick={() => toggleModule(m.id)}
                          label={m.title}
                          disabled={busy || empty}
                        />
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* ── Largo ─────────────────────────────────────────────────── */}
            <section>
              <p className="mb-1.5 text-[12px] font-semibold text-text">{t('admin.courses.desc_ai.length_title')}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {LENGTHS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    disabled={busy}
                    onClick={() => setLength(l)}
                    className={cn(
                      'rounded-xl border px-2.5 py-2 text-left transition-colors',
                      length === l ? 'border-primary/40 bg-primary/10' : 'border-line hover:bg-glass/8',
                    )}
                  >
                    <p className={cn('text-[12.5px] font-medium', length === l ? 'text-primary' : 'text-text')}>
                      {t(`admin.courses.desc_ai.length_${l}`)}
                    </p>
                    <p className="text-[11px] leading-snug text-text-subtle">{t(`admin.courses.desc_ai.length_${l}_hint`)}</p>
                  </button>
                ))}
              </div>
            </section>

            {/* ── Qué cubrir ────────────────────────────────────────────── */}
            <section>
              <p className="mb-1.5 text-[12px] font-semibold text-text">{t('admin.courses.desc_ai.include_title')}</p>
              <div className="flex flex-wrap gap-1.5">
                {INCLUDES.map((k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleInclude(k)}
                    aria-pressed={include.has(k)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors',
                      include.has(k) ? 'border-primary/40 bg-primary/10 text-primary' : 'border-line text-text-muted hover:bg-glass/8',
                    )}
                  >
                    {include.has(k) && <Check className="h-3 w-3" />}
                    {t(`admin.courses.desc_ai.include_${k}`)}
                  </button>
                ))}
              </div>
            </section>

            {hasCurrent && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-text">{t('admin.courses.desc_ai.rewrite')}</p>
                  <p className="text-[11.5px] text-text-subtle">{t('admin.courses.desc_ai.rewrite_hint')}</p>
                </div>
                <Toggle on={rewrite} onClick={() => setRewrite((v) => !v)} label={t('admin.courses.desc_ai.rewrite')} disabled={busy} />
              </div>
            )}

            <section>
              <label className="mb-1.5 block text-[12px] font-semibold text-text">{t('admin.courses.desc_ai.instruction_title')}</label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value.slice(0, 400))}
                disabled={busy}
                rows={2}
                placeholder={t('admin.courses.desc_ai.instruction_placeholder')}
                className="w-full resize-none rounded-xl border border-line bg-transparent px-3 py-2 text-[13px] text-text outline-none focus:border-primary/50"
              />
            </section>
          </>
        )}

        {/* ── Resultado ─────────────────────────────────────────────────── */}
        {phase === 'result' && result && modules && (
          result.insufficient ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <div className="text-[12.5px] leading-relaxed text-text">
                <p className="font-medium">{t('admin.courses.desc_ai.insufficient')}</p>
                {result.reason && <p className="text-text-muted">{result.reason}</p>}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-line bg-glass/[0.03] px-4 py-3 text-[13.5px] leading-relaxed text-text">
                <RichText text={result.description} />
              </div>

              {result.sources.length > 0 && (
                <section>
                  <p className="mb-1.5 text-[12px] font-semibold text-text">{t('admin.courses.desc_ai.grounding_title')}</p>
                  <ul className="space-y-1.5">
                    {result.sources.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12px]">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neon-green" />
                        <div className="min-w-0 flex-1">
                          <span className="text-text">{s.point}</span>
                          {s.modules.length > 0 && (
                            <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
                              {s.modules.map((n) => (
                                <Tooltip key={n} label={selected[n - 1]?.title ?? ''} anchor="element" maxWidth={260}>
                                  <span className="rounded-md bg-glass/10 px-1.5 py-px font-mono text-[10.5px] text-text-muted">
                                    {t('admin.courses.desc_ai.module_ref', { n })}
                                  </span>
                                </Tooltip>
                              ))}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-text-subtle">{t('admin.courses.desc_ai.grounding_hint')}</p>
                </section>
              )}

              {result.removed.length > 0 && (
                <section className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5">
                  <p className="mb-1 text-[12px] font-semibold text-text">{t('admin.courses.desc_ai.removed_title')}</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-text-muted">
                    {result.removed.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </section>
              )}

              {hasCurrent && !rewrite && (
                <p className="text-[11.5px] text-text-subtle">{t('admin.courses.desc_ai.will_replace')}</p>
              )}
            </>
          )
        )}
      </div>
    </Modal>
  )
}
