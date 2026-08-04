import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft, ImagePlus, Inbox, Loader2, MessageSquarePlus, Phone, Sparkles } from 'lucide-react'
import {
  addShotsToFeedback, getMySiteFeedback, removeShotFromFeedback,
  MAX_SHOTS, type FeedbackShot, type SiteFeedbackRow,
} from '@/services/siteFeedback.service'
import { useSiteFeedbackStore } from '@/stores/siteFeedbackStore'
import { kindMeta } from '@/components/feedback/config'
import { StatusPill } from '@/components/feedback/StatusPill'
import { ShotUploader } from '@/components/feedback/ShotUploader'
import { ShotGallery } from '@/components/feedback/ShotGallery'
import { FadeIn } from '@/components/ui/motion'

export default function MySuggestions() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const openFeedback = useSiteFeedbackStore((s) => s.open)
  const panelOpen = useSiteFeedbackStore((s) => s.isOpen)

  const [rows, setRows] = useState<SiteFeedbackRow[]>([])
  const [loading, setLoading] = useState(true)

  // Al cerrar el panel recargamos: lo que el usuario acaba de enviar aparece
  // aquí sin que tenga que refrescar la página.
  useEffect(() => {
    if (panelOpen) return
    let alive = true
    getMySiteFeedback()
      .then((r) => { if (alive) setRows(r) })
      .catch((e) => console.error('site feedback error:', e))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [panelOpen])

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })

  const answered = useMemo(
    () => rows.filter((r) => r.status === 'planned' || r.status === 'done').length,
    [rows],
  )

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/dashboard'))}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('common.back', 'Volver')}
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/10">
            <MessageSquarePlus className="h-5 w-5 text-fuchsia-400" />
          </div>
          <div>
            <h1 className="text-[20px] sm:text-[24px] font-bold text-text">
              {t('my_suggestions.title', 'Mis sugerencias')}
            </h1>
            <p className="text-[13px] text-text-muted">
              {t('my_suggestions.subtitle', 'Lo que has propuesto o reportado sobre la plataforma.')}
            </p>
          </div>
        </div>
      </header>

      {/* Llamado a opinar: siempre disponible, no solo mientras dure el piloto */}
      <FadeIn y={12}>
        <div className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-20 blur-3xl"
            style={{ background: 'radial-gradient(circle, #B33D9E, transparent 70%)' }}
            aria-hidden
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[15px] font-bold text-text">
                <Sparkles className="h-4 w-4 text-fuchsia-400" />
                {t('my_suggestions.cta_title', 'Tu opinión cambia el sitio')}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
                {t('my_suggestions.cta_desc', 'Cuéntanos qué mejorarías o repórtanos un error. Toma menos de un minuto y lo lee el equipo.')}
              </p>
            </div>
            <button
              onClick={openFeedback}
              className="shrink-0 rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-500 px-5 py-3 text-[13.5px] font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition-transform hover:-translate-y-0.5"
            >
              {t('my_suggestions.cta_button', 'Dar mi opinión')}
            </button>
          </div>
        </div>
      </FadeIn>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-text-subtle" />
          <div className="mb-1 text-[15px] font-medium text-text">
            {t('my_suggestions.empty_title', 'Todavía no has enviado nada')}
          </div>
          <div className="text-[13px] text-text-muted">
            {t('my_suggestions.empty_desc', 'Cuando compartas una idea o reportes un error, lo verás aquí con su estado.')}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">
                {t('my_suggestions.kpi_total', 'Enviadas')}
              </div>
              <div className="text-2xl font-bold tabular-nums text-text">{rows.length}</div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">
                {t('my_suggestions.kpi_answered', 'Tomadas en cuenta')}
              </div>
              <div className="text-2xl font-bold tabular-nums text-neon-green">{answered}</div>
            </div>
          </div>

          <FadeIn className="space-y-3" y={14}>
            {rows.map((r) => (
              <SuggestionCard key={r.id} row={r} fmtDate={fmtDate} />
            ))}
          </FadeIn>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
/**
 * Una opinión enviada. Las capturas se pueden seguir agregando después: casi
 * nadie tiene la captura a mano en el momento de reportar, y volver a escribir
 * todo el formulario solo para adjuntar una imagen no tiene sentido.
 */
function SuggestionCard({ row, fmtDate }: { row: SiteFeedbackRow; fmtDate: (iso: string) => string }) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const meta = kindMeta(row.kind)
  const [shots, setShots] = useState<FeedbackShot[]>(row.shots ?? [])
  const [adding, setAdding] = useState(false)

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[17px]"
            style={{ background: `${meta.color}1f` }}
          >
            {meta.emoji}
          </span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-text">
              {t(`site_feedback.kind.${row.kind}.label`)}
            </div>
            <div className="text-[11.5px] text-text-muted">
              {fmtDate(row.created_at)}
              {row.page_label ? ` · ${row.page_label}` : ''}
            </div>
          </div>
        </div>
        <StatusPill status={row.status} />
      </div>

      {row.message && (
        <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-text-muted">
          {row.message}
        </p>
      )}

      {row.contact_ok && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-subtle px-2 py-1 text-[11.5px] text-text-muted">
          <Phone className="h-3 w-3" />
          {t('my_suggestions.contact_requested', 'Pediste que te contactaran')}
        </p>
      )}

      {/* Miniaturas de lo ya adjunto: se ven aunque el añadidor esté cerrado. */}
      {!adding && shots.length > 0 && <ShotGallery shots={shots} className="mt-3" />}

      <div className="mt-3 border-t border-line/60 pt-3">
        <AnimatePresence initial={false} mode="wait">
          {adding ? (
            <motion.div
              key="uploader"
              initial={reduce ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <ShotUploader
                folder={row.id}
                shots={shots}
                onChange={setShots}
                accent={meta.color}
                compact
                onPersist={(added) => addShotsToFeedback(row.id, added)}
                onPersistRemove={(path) => removeShotFromFeedback(row.id, path)}
              />
              <button
                onClick={() => setAdding(false)}
                className="mt-2.5 w-full rounded-xl px-3 py-2 text-[12px] font-medium text-text-muted transition-colors hover:bg-subtle hover:text-text"
              >
                {t('my_suggestions.shots_done', 'Listo')}
              </button>
            </motion.div>
          ) : (
            <motion.button
              key="cta"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAdding(true)}
              className="group inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:bg-subtle hover:text-text"
            >
              <ImagePlus className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />
              {shots.length === 0
                ? t('my_suggestions.shots_add', 'Agregar una captura')
                : t('my_suggestions.shots_manage', 'Agregar o quitar capturas ({{n}}/{{max}})', { n: shots.length, max: MAX_SHOTS })}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
