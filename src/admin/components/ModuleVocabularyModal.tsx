import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BookA, CheckCircle2, Loader2, RotateCcw, Search, Trash2, Volume2, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { AiCreditsNotice } from '@/components/ui/AiCreditsNotice'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { GenerationProgress, ASSIST_STEPS } from '@/admin/components/GenerationProgress'
import { consumeAiOperation, isQuotaExceeded, refundAiOperation } from '@/services/aiQuota.service'
import { parseVocabulary, saveModuleVocabulary, type DbSectionRow } from '@/services/modules.service'
import type { ModuleVocabulary, VocabTerm } from '@/types/blocks'
import { generateModuleVocabulary } from '@/lib/moduleVocabulary'
import { initialContentLang } from '@/lib/contentLang'
import { PRONUNCIATION_LANGS, normalizePronLang, speak } from '@/lib/speech'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'

type Lang = 'es' | 'en' | 'pt'

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

/**
 * Vocabulario del módulo (cursos de idiomas). La IA lee el módulo entero y
 * saca las palabras y expresiones del idioma que se estudia, con AFI,
 * significado y clase de palabra. Con eso, quien aprende puede pasar el ratón
 * por encima de cualquiera de ellas —en el bloque que sea— y oírla.
 *
 * El capacitador revisa la lista (corrige un significado, quita lo que sobra)
 * antes de guardar. Se guarda directo en `modules.vocabulary`, sin SaveDock:
 * no toca las secciones, así que no choca con lo que haya sin guardar.
 */
export function ModuleVocabularyModal({
  moduleId, moduleTitle, campaignId, targetLang, sections, current, onClose, onSaved,
}: {
  moduleId: string
  moduleTitle: string
  campaignId: string | null
  targetLang: string
  sections: DbSectionRow[]
  /** Lo que ya tiene guardado el módulo (crudo de la base). */
  current: unknown
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const lang = initialContentLang() as Lang
  const saved = useMemo(() => parseVocabulary(current), [current])
  const [terms, setTerms] = useState<VocabTerm[] | null>(saved?.terms ?? null)
  const [dirty, setDirty] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'saving'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const voiceLang = normalizePronLang(targetLang)
  const langLabel = PRONUNCIATION_LANGS.find((l) => l.value === voiceLang)?.label ?? voiceLang
  const busy = phase !== 'idle'

  const analyze = async () => {
    if (saved && !dirty && terms?.length) {
      const ok = await confirm({
        title: t('admin.modules.vocab.regen_title'),
        description: t('admin.modules.vocab.regen_body'),
        confirmLabel: t('admin.modules.vocab.regen_confirm'),
        tone: 'default',
      })
      if (!ok) return
    }
    setPhase('loading')
    setError(null)
    let charged = false
    try {
      await consumeAiOperation('assist', t('admin.modules.vocab.quota_label', { module: moduleTitle }), campaignId)
      charged = true
      const next = await generateModuleVocabulary({ moduleTitle, sections, targetLang: voiceLang, lang })
      setTerms(next)
      setDirty(true)
    } catch (e) {
      if (charged) await refundAiOperation('assist').catch(() => {})
      setError(isQuotaExceeded(e) ? t('admin.modules.pron_module.quota_exceeded') : (e as Error).message)
    } finally {
      setPhase('idle')
    }
  }

  const persist = async (value: ModuleVocabulary | null) => {
    setPhase('saving')
    setError(null)
    try {
      await saveModuleVocabulary(moduleId, value)
      toast.success(value ? t('admin.modules.vocab.saved', { count: value.terms.length }) : t('admin.modules.vocab.removed'))
      onSaved()
      onClose()
    } catch (e) {
      const msg = (e as Error).message
      setError(
        msg === 'NO_ROWS_UPDATED'
          ? t('admin.modules.pron_module.no_permission')
          : /vocabulary/.test(msg) ? t('admin.modules.vocab.missing_column') : msg,
      )
      setPhase('idle')
    }
  }

  const save = () => {
    const clean = (terms ?? []).filter((x) => x.text.trim())
    void persist(clean.length ? { lang: voiceLang, terms: clean } : null)
  }

  const removeAll = async () => {
    const ok = await confirm({
      title: t('admin.modules.vocab.remove_title'),
      description: t('admin.modules.vocab.remove_body'),
    })
    if (ok) void persist(null)
  }

  const patch = (i: number, p: Partial<VocabTerm>) => {
    setTerms((prev) => prev && prev.map((x, k) => (k === i ? { ...x, ...p } : x)))
    setDirty(true)
  }
  const drop = (i: number) => {
    setTerms((prev) => prev && prev.filter((_, k) => k !== i))
    setDirty(true)
  }

  const shown = useMemo(() => {
    const list = (terms ?? []).map((term, i) => ({ term, i }))
    const q = fold(query.trim())
    if (!q) return list
    return list.filter(({ term }) =>
      fold(term.text).includes(q) || fold(term.meaning?.[lang] ?? term.meaning?.es ?? '').includes(q))
  }, [terms, query, lang])

  const footer = (
    <>
      {terms && (
        <Button variant="glass" size="sm" onClick={() => { void analyze() }} disabled={busy || !sections.length}>
          <RotateCcw className="h-3.5 w-3.5" /> {t('admin.modules.ai_panel.regenerate')}
        </Button>
      )}
      {terms ? (
        <Button size="sm" onClick={save} disabled={busy || (!dirty && !!saved)}>
          {phase === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          {t('admin.modules.vocab.save', { count: terms.length })}
        </Button>
      ) : (
        <>
          <Button variant="glass" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={() => { void analyze() }} disabled={busy || !sections.length}>
            <BookA className="h-3.5 w-3.5" /> {t('admin.modules.vocab.analyze')}
          </Button>
        </>
      )}
    </>
  )

  return (
    <Modal
      onClose={onClose}
      dismissible={!busy}
      size="2xl"
      accent="violet"
      icon={<BookA className="h-4 w-4" />}
      title={t('admin.modules.vocab.title')}
      subtitle={t('admin.modules.vocab.subtitle', { lang: langLabel, count: sections.length })}
      footer={footer}
      footerLeft={
        saved && !busy ? (
          <button
            type="button"
            onClick={() => { void removeAll() }}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-text-muted transition-colors hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t('admin.modules.vocab.remove')}
          </button>
        ) : (
          <AiReviewNotice variant="inline" />
        )
      }
    >
      <div className="space-y-3">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/8 p-2.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!terms && phase !== 'loading' && (
          <>
            <AiCreditsNotice />
            <p className="text-[13px] leading-relaxed text-text-muted">
              {t('admin.modules.vocab.intro', { lang: langLabel })}
            </p>
            {/* Cómo lo verá quien aprende: una palabra subrayada y su tarjeta. */}
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-glass-border/25 bg-bg/40 px-4 py-5 sm:flex-row sm:justify-center sm:gap-6">
              <p className="text-[15px] text-text-muted">
                {t('admin.modules.vocab.sample_before')}{' '}
                <span className="rounded-[4px] bg-neon-green/12 px-0.5 font-medium text-neon-green underline decoration-dotted underline-offset-4">
                  Obrigado
                </span>
              </p>
              <div className="w-[210px] overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-lg shadow-black/15">
                <div className="px-3.5 pb-2.5 pt-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[16px] font-semibold leading-tight text-text">Obrigado</p>
                    <span className="rounded-full bg-neon-magenta/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-neon-magenta">
                      {t('admin.modules.vocab.sample_kind')}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-text-subtle">/obɾiˈɡadu/</p>
                  <p className="mt-2 border-t border-line/70 pt-2 text-[12px] text-text-muted">{t('admin.modules.vocab.sample_meaning')}</p>
                </div>
                <div className="flex gap-1.5 border-t border-line/70 bg-subtle/40 px-2.5 py-1.5">
                  <span className="inline-flex h-6 items-center gap-1 rounded-full bg-neon-green/10 px-2 text-[10.5px] font-semibold text-neon-green">
                    <Volume2 className="h-3 w-3" /> {t('module.blocks.pronunciation.listen')}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        <GenerationProgress steps={ASSIST_STEPS} active={phase === 'loading'} title={t('admin.modules.vocab.analyzing')} />

        {terms && phase !== 'loading' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-text-muted">
                {terms.length
                  ? t('admin.modules.vocab.count', { count: terms.length })
                  : t('admin.modules.vocab.empty')}
                {dirty && saved && <span className="ml-1.5 text-amber-500">· {t('admin.modules.vocab.unsaved')}</span>}
              </p>
              {terms.length > 8 && (
                <label className="flex h-8 w-full items-center gap-1.5 rounded-lg border border-glass-border/20 px-2.5 sm:w-56">
                  <Search className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('admin.modules.vocab.search')}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-subtle"
                  />
                </label>
              )}
            </div>

            <ul className="max-h-[52vh] divide-y divide-line/60 overflow-y-auto rounded-xl border border-line custom-scrollbar">
              {shown.map(({ term, i }) => (
                <li key={`${term.text}-${i}`} className="group flex items-center gap-2 px-3 py-2">
                  <Tooltip label={t('admin.modules.be.pron_preview')} anchor="element">
                    <button
                      type="button"
                      onClick={() => void speak(term.text, voiceLang)}
                      aria-label={t('admin.modules.be.pron_preview')}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-neon-green/10 hover:text-neon-green"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                  <div className="w-[34%] min-w-0">
                    <p className="truncate text-[13px] font-semibold text-text" lang={voiceLang}>{term.text}</p>
                    <input
                      value={term.ipa ?? ''}
                      onChange={(e) => patch(i, { ipa: e.target.value })}
                      placeholder={t('admin.modules.vocab.ipa_ph')}
                      className="w-full bg-transparent font-mono text-[11px] text-text-subtle outline-none placeholder:text-text-subtle/50"
                    />
                    <input
                      value={term.sounds?.[lang] ?? ''}
                      onChange={(e) => patch(i, { sounds: { ...(term.sounds ?? { es: '', en: '', pt: '' }), [lang]: e.target.value } })}
                      placeholder={t('admin.modules.vocab.sounds_ph')}
                      className="w-full bg-transparent text-[11px] font-semibold text-text-subtle outline-none placeholder:font-normal placeholder:text-text-subtle/50"
                    />
                  </div>
                  <input
                    value={term.meaning?.[lang] ?? ''}
                    onChange={(e) => patch(i, { meaning: { ...(term.meaning ?? { es: '', en: '', pt: '' }), [lang]: e.target.value } })}
                    placeholder={t('admin.modules.vocab.meaning_ph')}
                    className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-[12.5px] text-text-muted outline-none transition-colors hover:bg-subtle/60 focus:bg-subtle"
                  />
                  {term.kind?.[lang] && (
                    <span className={cn('hidden shrink-0 rounded-full bg-neon-magenta/10 px-2 py-0.5 text-[10px] font-semibold text-neon-magenta sm:inline')}>
                      {term.kind[lang]}
                    </span>
                  )}
                  <Tooltip label={t('admin.modules.vocab.drop')} anchor="element">
                    <button
                      type="button"
                      onClick={() => drop(i)}
                      aria-label={t('admin.modules.vocab.drop')}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle opacity-60 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                </li>
              ))}
              {!shown.length && (
                <li className="px-3 py-6 text-center text-[12px] text-text-subtle">{t('admin.modules.vocab.no_match')}</li>
              )}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}
