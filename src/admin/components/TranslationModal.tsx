import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Globe, Languages, Loader2, Sparkles, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import {
  getCourseTranslationState,
  getModuleTranslationState,
  translateCourse,
  translateModule,
  type ModuleTranslationState,
  type TranslateProgress,
} from '@/services/translation.service'
import { consumeAiOperation, getAiQuota, isQuotaExceeded, refundAiOperation, type AiQuota } from '@/services/aiQuota.service'

type Phase = 'review' | 'running' | 'done' | 'error'

interface TranslationModalProps {
  /** Curso completo (todos sus módulos) o un módulo suelto. */
  scope: 'course' | 'module'
  id: string
  title: string
  campaignId?: string | null
  onClose: () => void
  /** Recargar la pantalla de atrás cuando algo cambió. */
  onDone?: () => void | Promise<void>
}

/**
 * Traducir a inglés y portugués, a pedido.
 *
 * El contenido se genera solo en español (ahorro) y el sitio muestra el español
 * en los tres idiomas mientras tanto. Este modal es el momento en que el
 * capacitador dice "ya está listo, ahora sí tradúcelo": muestra qué falta, qué
 * cuesta en cupo, y traduce con una barra real de avance.
 */
export function TranslationModal({ scope, id, title, campaignId, onClose, onDone }: TranslationModalProps) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('review')
  const [loading, setLoading] = useState(true)
  const [modules, setModules] = useState<ModuleTranslationState[]>([])
  const [courseTranslated, setCourseTranslated] = useState(true)
  const [onlyPending, setOnlyPending] = useState(true)
  const [progress, setProgress] = useState<TranslateProgress | null>(null)
  const [quota, setQuota] = useState<AiQuota | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const running = phase === 'running'

  // ── Estado inicial: qué falta por traducir ──
  useEffect(() => {
    let alive = true
    setLoading(true)
    const load = scope === 'course'
      ? getCourseTranslationState(id).then((s) => {
          if (!alive) return
          setModules(s.modules)
          setCourseTranslated(s.courseTranslated)
        })
      : getModuleTranslationState(id).then((s) => {
          if (!alive) return
          setModules([s])
          setCourseTranslated(true)
        })

    load
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false))

    getAiQuota().then((q) => alive && setQuota(q)).catch(() => {})
    return () => { alive = false }
  }, [scope, id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, running])

  const pending = useMemo(() => modules.filter((m) => !m.translated), [modules])
  const targets = onlyPending ? pending : modules
  // La ficha del curso también es trabajo: puede faltar aunque los módulos estén listos.
  const canRun = targets.length > 0 || (scope === 'course' && (!courseTranslated || !onlyPending))
  const noQuota = !!quota && !quota.unlimited && (quota.remaining ?? 0) <= 0

  const start = useCallback(async () => {
    setError(null)
    setPhase('running')
    setProgress({ done: 0, total: 1, detail: t('admin.translate.preparing') })

    const controller = new AbortController()
    abortRef.current = controller

    let consumed = false
    try {
      // El cupo se descuenta ANTES de gastar tokens: si no queda, no se llama a la IA.
      await consumeAiOperation(
        'translation',
        scope === 'course' ? `Traducción de curso: ${title}` : `Traducción de módulo: ${title}`,
        campaignId ?? null,
      )
      consumed = true

      if (scope === 'course') {
        await translateCourse(id, { onProgress: setProgress, signal: controller.signal, onlyPending })
      } else {
        await translateModule(id, { onProgress: setProgress, signal: controller.signal })
      }

      setPhase('done')
      setQuota(await getAiQuota().catch(() => quota))
      await onDone?.()
    } catch (e) {
      if (isQuotaExceeded(e)) {
        setQuota(e.quota ?? quota)
        setError(t('admin.translate.quota_blocked'))
        setPhase('error')
        return
      }
      // Cancelado por el usuario: lo ya traducido queda guardado.
      if (controller.signal.aborted || (e as Error)?.name === 'AbortError') {
        setPhase('review')
        await onDone?.()
        return
      }
      if (consumed) await refundAiOperation('translation')
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setPhase('error')
      toast.error(t('admin.translate.error'), msg)
    } finally {
      abortRef.current = null
    }
  }, [campaignId, id, onDone, onlyPending, quota, scope, t, title])

  const cancel = () => abortRef.current?.abort()

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[130] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={t('admin.translate.title')}
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          {...backdropDismiss(() => !running && onClose())}
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-lg"
        >
          <div className="relative flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            {/* Filo de color: da el acento de "idiomas" sin ensuciar el header. */}
            <div className="h-[3px] w-full bg-gradient-to-r from-brand-green via-brand-magenta to-brand-green" />

            {/* ── Header ── */}
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                  <Languages className="h-4 w-4 text-text-muted" />
                  {t('admin.translate.title')}
                </h3>
                <p className="mt-0.5 truncate text-[12px] text-text-muted">{title}</p>
              </div>
              <button
                onClick={onClose}
                disabled={running}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-glass/6 hover:text-text disabled:opacity-30"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* ── Por qué existe este botón ── */}
              {phase === 'review' && (
                <div className="mb-4 flex gap-3 rounded-xl border border-line bg-glass/4 p-3.5">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
                  <p className="text-[12.5px] leading-relaxed text-text-muted">
                    {t('admin.translate.why')}
                  </p>
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('admin.translate.checking')}
                </div>
              ) : phase === 'running' ? (
                <RunningPanel pct={pct} progress={progress} onCancel={cancel} t={t} />
              ) : phase === 'done' ? (
                <DonePanel count={targets.length} scope={scope} t={t} />
              ) : (
                <>
                  {/* ── Qué falta ── */}
                  <ul className="space-y-1.5">
                    {scope === 'course' && (
                      <StatusRow
                        label={t('admin.translate.course_meta')}
                        translated={courseTranslated}
                        t={t}
                      />
                    )}
                    {modules.map((m) => (
                      <StatusRow key={m.moduleId} label={m.title} translated={m.translated} t={t} />
                    ))}
                    {modules.length === 0 && scope === 'course' && (
                      <li className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-text-subtle">
                        {t('admin.translate.no_modules')}
                      </li>
                    )}
                  </ul>

                  {/* ── Alcance ── */}
                  {scope === 'course' && modules.length > 0 && (
                    <div className="mt-4 flex gap-1.5 rounded-xl border border-line bg-bg p-1">
                      {([true, false] as const).map((v) => (
                        <button
                          key={String(v)}
                          onClick={() => setOnlyPending(v)}
                          className={cn(
                            'relative flex-1 rounded-lg px-3 py-2 text-[12px] font-medium transition-colors',
                            onlyPending === v ? 'text-text' : 'text-text-muted hover:text-text',
                          )}
                        >
                          {onlyPending === v && (
                            <motion.span
                              layoutId="translate-scope-pill"
                              className="absolute inset-0 rounded-lg border border-brand-green/30 bg-brand-green/10"
                              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                            />
                          )}
                          <span className="relative">
                            {v ? t('admin.translate.only_pending') : t('admin.translate.everything')}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {error && (
                    <div className="mt-4 flex gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <p className="text-[12.5px] leading-relaxed text-text">{error}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Pie: cupo + acción ── */}
            {!running && phase !== 'done' && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
                <QuotaHint quota={quota} t={t} />
                <button
                  onClick={start}
                  disabled={loading || !canRun || noQuota}
                  className={cn(
                    'inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold transition-all',
                    'bg-brand-green text-black hover:brightness-110 active:scale-[0.98]',
                    'disabled:pointer-events-none disabled:opacity-40',
                  )}
                >
                  <Globe className="h-4 w-4" />
                  {!canRun && !loading
                    ? t('admin.translate.nothing_pending')
                    : t('admin.translate.start', { count: targets.length })}
                </button>
              </div>
            )}

            {phase === 'done' && (
              <div className="flex justify-end border-t border-line px-5 py-3.5">
                <button
                  onClick={onClose}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-[13px] font-semibold text-text transition-colors hover:bg-glass/6"
                >
                  {t('common.close', 'Cerrar')}
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFn = (key: string, opts?: any) => string

/** Fila de "esto está traducido / esto no". */
function StatusRow({ label, translated, t }: { label: string; translated: boolean; t: TFn }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3 py-2.5">
      <span className="min-w-0 truncate text-[13px] text-text">{label}</span>
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
          translated
            ? 'border border-brand-green/30 bg-brand-green/10 text-brand-green'
            : 'border border-amber-400/30 bg-amber-400/10 text-amber-500',
        )}
      >
        {translated ? <Check className="h-3 w-3" /> : <Languages className="h-3 w-3" />}
        {translated ? t('admin.translate.status_done') : t('admin.translate.status_pending')}
      </span>
    </li>
  )
}

/** Barra de avance real: dice qué se está traduciendo ahora mismo. */
function RunningPanel({
  pct, progress, onCancel, t,
}: { pct: number; progress: TranslateProgress | null; onCancel: () => void; t: TFn }) {
  return (
    <div className="py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-text">{t('admin.translate.working')}</span>
        <span className="text-[20px] font-semibold tabular-nums text-brand-green">{pct}%</span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-glass/8">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-brand-green to-brand-magenta"
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
        />
      </div>

      <div className="mt-3 flex min-h-[20px] items-center gap-2 text-[12.5px] text-text-muted">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span className="truncate">{progress?.detail}</span>
      </div>
      {progress && progress.total > 1 && (
        <p className="mt-1 text-[11.5px] text-text-subtle">
          {t('admin.translate.step_of', { done: progress.done, total: progress.total })}
        </p>
      )}

      <button
        onClick={onCancel}
        className="mt-5 h-9 w-full rounded-xl border border-line text-[12.5px] font-medium text-text-muted transition-colors hover:bg-glass/6 hover:text-text"
      >
        {t('admin.translate.cancel_keep')}
      </button>
    </div>
  )
}

function DonePanel({ count, scope, t }: { count: number; scope: 'course' | 'module'; t: TFn }) {
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className="flex h-14 w-14 items-center justify-center rounded-full border border-brand-green/30 bg-brand-green/10"
      >
        <Check className="h-7 w-7 text-brand-green" />
      </motion.div>
      <h4 className="mt-4 text-[15px] font-semibold text-text">{t('admin.translate.done_title')}</h4>
      <p className="mt-1 max-w-xs text-[12.5px] leading-relaxed text-text-muted">
        {scope === 'course'
          ? t('admin.translate.done_course', { count })
          : t('admin.translate.done_module')}
      </p>
    </div>
  )
}

/** "Te quedan 7 de 10 operaciones de IA hoy." */
function QuotaHint({ quota, t }: { quota: AiQuota | null; t: TFn }) {
  if (!quota || quota.unlimited) return <span />
  const left = quota.remaining ?? 0
  return (
    <span
      className={cn(
        'text-[11.5px]',
        left === 0 ? 'font-semibold text-amber-500' : left <= 2 ? 'text-amber-500' : 'text-text-subtle',
      )}
    >
      {left === 0
        ? t('admin.ai_limits.none_left')
        : t('admin.ai_limits.left', { left, limit: quota.limit })}
    </span>
  )
}
