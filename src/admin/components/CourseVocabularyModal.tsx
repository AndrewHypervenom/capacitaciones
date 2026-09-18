import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, BookA, CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { AiCreditsNotice } from '@/components/ui/AiCreditsNotice'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { supabase } from '@/lib/supabase'
import { consumeAiOperation, isQuotaExceeded, refundAiOperation } from '@/services/aiQuota.service'
import { getModuleWithSectionsRaw, parseVocabulary, saveModuleVocabulary } from '@/services/modules.service'
import { invalidateModulesCache } from '@/hooks/useModules'
import { generateModuleVocabulary } from '@/lib/moduleVocabulary'
import { initialContentLang, rowText } from '@/lib/contentLang'
import { PRONUNCIATION_LANGS, normalizePronLang } from '@/lib/speech'
import { cn } from '@/lib/cn'

type Lang = 'es' | 'en' | 'pt'

type Status =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; count: number }
  | { kind: 'empty' }
  | { kind: 'skipped' }
  | { kind: 'error'; message: string }

interface Row {
  id: string
  title: string
  /** Palabras que ya tiene guardadas (0 = ninguna). */
  existing: number
  status: Status
}

/**
 * Vocabulario de TODOS los módulos de un curso de idiomas, de una sola vez.
 *
 * Va módulo por módulo (cada uno es una llamada a la IA y cobra una ayuda del
 * cupo), leyendo todas sus secciones, y guarda directo sin revisión: para
 * revisar o corregir la lista de un módulo está el botón «Vocabulario» en su
 * editor. Por defecto salta los módulos que ya tienen vocabulario, para no
 * pisar lo que alguien corrigió a mano.
 */
export function CourseVocabularyModal({
  courseTitle, campaignId, targetLang, modules, onClose,
}: {
  courseTitle: string
  campaignId: string | null
  targetLang: string
  /** Módulos vivos del curso, en su orden. */
  modules: Array<{ id: string; title: string }>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const lang = initialContentLang() as Lang
  const voiceLang = normalizePronLang(targetLang)
  const langLabel = PRONUNCIATION_LANGS.find((l) => l.value === voiceLang)?.label ?? voiceLang
  const [rows, setRows] = useState<Row[] | null>(null)
  const [redo, setRedo] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'running' | 'done'>('loading')
  const [error, setError] = useState<string | null>(null)
  const stopRef = useRef(false)
  const [stopping, setStopping] = useState(false)

  // Qué módulos ya tienen vocabulario. Consulta ligera: solo esa columna.
  useEffect(() => {
    let alive = true
    const ids = modules.map((m) => m.id)
    supabase.from('modules').select('id, vocabulary').in('id', ids)
      .then(({ data, error: err }) => {
        if (!alive) return
        if (err) {
          setError(/vocabulary/.test(err.message) ? t('admin.modules.vocab.missing_column') : err.message)
          setRows(modules.map((m) => ({ ...m, existing: 0, status: { kind: 'idle' } })))
          setPhase('ready')
          return
        }
        const byId = new Map((data ?? []).map((r) => [r.id, parseVocabulary(r.vocabulary)?.terms.length ?? 0]))
        setRows(modules.map((m) => ({ ...m, existing: byId.get(m.id) ?? 0, status: { kind: 'idle' } })))
        setPhase('ready')
      })
    return () => { alive = false }
  }, [modules, t])

  const targets = (rows ?? []).filter((r) => redo || r.existing === 0)
  const withVocab = (rows ?? []).filter((r) => r.existing > 0).length

  const setStatus = (id: string, status: Status) =>
    setRows((prev) => prev && prev.map((r) => (r.id === id ? { ...r, status } : r)))

  const run = async () => {
    if (!rows) return
    setPhase('running')
    setError(null)
    stopRef.current = false
    setStopping(false)
    const queue = targets.map((r) => r.id)
    // Los que no entran en esta vuelta se ven como saltados, no como pendientes.
    setRows((prev) => prev && prev.map((r) => (queue.includes(r.id) ? { ...r, status: { kind: 'idle' } } : { ...r, status: { kind: 'skipped' } })))

    for (const id of queue) {
      if (stopRef.current) break
      setStatus(id, { kind: 'running' })
      let charged = false
      try {
        const mod = await getModuleWithSectionsRaw(id)
        const sections = mod.module_sections ?? []
        await consumeAiOperation('assist', t('admin.modules.vocab.quota_label', { module: rowText(mod) }), campaignId)
        charged = true
        const terms = await generateModuleVocabulary({ moduleTitle: rowText(mod), sections, targetLang: voiceLang, lang })
        if (!terms.length) {
          setStatus(id, { kind: 'empty' })
          continue
        }
        await saveModuleVocabulary(id, { lang: voiceLang, terms })
        setRows((prev) => prev && prev.map((r) => (r.id === id ? { ...r, existing: terms.length, status: { kind: 'done', count: terms.length } } : r)))
      } catch (e) {
        if (charged) await refundAiOperation('assist').catch(() => {})
        if (isQuotaExceeded(e)) {
          // Sin cupo no tiene sentido seguir: los demás fallarían igual.
          setStatus(id, { kind: 'error', message: t('admin.modules.pron_module.quota_exceeded') })
          setError(t('admin.modules.pron_module.quota_exceeded'))
          break
        }
        const msg = (e as Error).message
        setStatus(id, {
          kind: 'error',
          message: msg === 'NO_ROWS_UPDATED'
            ? t('admin.modules.pron_module.no_permission')
            : /vocabulary/.test(msg) ? t('admin.modules.vocab.missing_column') : msg,
        })
      }
    }
    invalidateModulesCache()
    setPhase('done')
  }

  const done = (rows ?? []).filter((r) => r.status.kind === 'done').length
  const busy = phase === 'running' || phase === 'loading'

  const footer = phase === 'running' ? (
    <Button variant="glass" size="sm" onClick={() => { stopRef.current = true; setStopping(true) }} disabled={stopping}>
      {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
      {t('admin.courses.vocab.stop')}
    </Button>
  ) : phase === 'done' ? (
    <Button size="sm" onClick={onClose}>{t('common.close')}</Button>
  ) : (
    <>
      <Button variant="glass" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
      <Button size="sm" onClick={() => { void run() }} disabled={busy || !targets.length}>
        <BookA className="h-3.5 w-3.5" /> {t('admin.courses.vocab.run', { count: targets.length })}
      </Button>
    </>
  )

  return (
    <Modal
      onClose={onClose}
      dismissible={phase !== 'running'}
      size="xl"
      accent="violet"
      icon={<BookA className="h-4 w-4" />}
      title={t('admin.courses.vocab.title')}
      subtitle={t('admin.courses.vocab.subtitle', { lang: langLabel, course: courseTitle })}
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

        {phase === 'ready' && (
          <>
            <AiCreditsNotice />
            <p className="text-[13px] leading-relaxed text-text-muted">
              {t('admin.courses.vocab.intro', { lang: langLabel })}
            </p>
            {withVocab > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-text">{t('admin.courses.vocab.redo')}</p>
                  <p className="text-[11.5px] text-text-subtle">{t('admin.courses.vocab.redo_hint', { count: withVocab })}</p>
                </div>
                <Toggle on={redo} onClick={() => setRedo((v) => !v)} label={t('admin.courses.vocab.redo')} />
              </div>
            )}
          </>
        )}

        {phase === 'loading' && (
          <div className="flex items-center justify-center py-8 text-text-subtle">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {phase === 'done' && (
          <div className="flex items-start gap-2 rounded-xl border border-neon-green/25 bg-neon-green/8 px-3 py-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-neon-green" />
            <p className="text-[12.5px] leading-relaxed text-text">
              {t('admin.courses.vocab.finished', { count: done })}
            </p>
          </div>
        )}

        {rows && rows.length > 0 && phase !== 'loading' && (
          <ul className="max-h-[48vh] divide-y divide-line/60 overflow-y-auto rounded-xl border border-line custom-scrollbar">
            {rows.map((r, i) => {
              const willRun = redo || r.existing === 0
              const s = r.status
              return (
                <li key={r.id} className={cn('flex items-center gap-2.5 px-3 py-2', phase === 'ready' && !willRun && 'opacity-55')}>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                    {s.kind === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-neon-magenta" />
                      : s.kind === 'done' ? <CheckCircle2 className="h-4 w-4 text-neon-green" />
                      : s.kind === 'error' ? <AlertTriangle className="h-4 w-4 text-danger" />
                      : s.kind === 'skipped' || s.kind === 'empty' ? <MinusCircle className="h-4 w-4 text-text-subtle" />
                      : <Circle className="h-4 w-4 text-text-subtle/50" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-text">
                      <span className="mr-1.5 font-mono text-[10.5px] text-text-subtle">{String(i + 1).padStart(2, '0')}</span>
                      {r.title}
                    </p>
                    {s.kind === 'error' && <p className="truncate text-[11px] text-danger">{s.message}</p>}
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-text-subtle">
                    {s.kind === 'done' ? t('admin.courses.vocab.row_done', { count: s.count })
                      : s.kind === 'empty' ? t('admin.courses.vocab.row_empty')
                      : s.kind === 'skipped' ? t('admin.courses.vocab.row_skipped')
                      : s.kind === 'running' ? t('admin.courses.vocab.row_running')
                      : r.existing > 0 ? t('admin.courses.vocab.row_has', { count: r.existing })
                      : t('admin.courses.vocab.row_none')}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        {rows && rows.length === 0 && (
          <p className="py-6 text-center text-[12.5px] text-text-subtle">{t('admin.courses.vocab.no_modules')}</p>
        )}
      </div>
    </Modal>
  )
}
