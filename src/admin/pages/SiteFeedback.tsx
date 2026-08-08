import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import i18n from '@/i18n'
import {
  ArrowLeft, Check, Copy, Image as ImageIcon, Inbox, Loader2, Mail,
  MessageSquare, Monitor, MousePointerClick, Phone, RefreshCw, Search, Trash2,
  Users, X,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  computeStats, deleteSiteFeedback, fetchSiteFeedback, updateSiteFeedback,
  type FeedbackKind, type FeedbackStatus, type SiteFeedbackRow,
} from '@/services/siteFeedback.service'
import {
  fetchThreadSummaries, subscribeFeedbackEvents, EMPTY_SUMMARY,
  type FeedbackEvent, type ThreadSummary,
} from '@/services/feedbackThread.service'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { KINDS, MOODS, kindMeta, questionsFor } from '@/components/feedback/config'
import { STATUSES, StatusPill, STATUS_COLOR } from '@/components/feedback/StatusPill'
import { ShotGallery } from '@/components/feedback/ShotGallery'
import { FeedbackThread } from '@/components/feedback/FeedbackThread'
import { FadeIn } from '@/components/ui/motion'
import { toast } from '@/stores/toastStore'
import { useNotificationsStore } from '@/stores/notificationsStore'
import { cn } from '@/lib/cn'

type StatusFilter = FeedbackStatus | 'all' | 'open'

const EASE = [0.16, 1, 0.3, 1] as const

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** Fecha completa para el detalle: ahí sí importa el año y el minuto exacto. */
function fmtFullDate(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** ¿Hay sitio para lista y detalle a la vez? Debajo de eso, el detalle se abre encima. */
function useWideScreen() {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

/** La opinión espera al equipo: nadie ha respondido, o la última palabra es suya. */
function isAwaiting(row: SiteFeedbackRow, s: ThreadSummary): boolean {
  if (row.status === 'done' || row.status === 'archived') return false
  return s.awaitingStaff || !s.answered
}

export default function SiteFeedback() {
  const { t } = useTranslation()
  // El capacitador viene a atender personas; el superadmin, además, a depurar.
  // Esa es la única diferencia entre lo que ve uno y otro en esta pantalla.
  const { isSuperAdmin, user } = useAuth()
  const confirm = useConfirm()
  const wide = useWideScreen()
  const [params, setParams] = useSearchParams()

  const [rows, setRows] = useState<SiteFeedbackRow[]>([])
  const [summaries, setSummaries] = useState<Map<string, ThreadSummary>>(new Map())
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<StatusFilter>('open')
  const [kind, setKind] = useState<FeedbackKind | 'all'>('all')
  const [contactOnly, setContactOnly] = useState(false)
  const [awaitingOnly, setAwaitingOnly] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'))
  /** Se sube al cambiar el estado para que el hilo relea sus hitos. */
  const [threadKey, setThreadKey] = useState(0)
  /** Novedades que llegaron en vivo y no caben en el filtro actual. */
  const [pendingNews, setPendingNews] = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    return fetchSiteFeedback({ status, kind, contactOnly, search })
      .then((r) => { setRows(r); setPendingNews(0) })
      .catch((e) => {
        console.error('site feedback error:', e)
        toast.error(t('admin.site_feedback.load_error', 'No pudimos cargar las opiniones'))
      })
      .finally(() => setLoading(false))
  }, [status, kind, contactOnly, search, t])

  useEffect(() => { void load() }, [load])

  /** Trae los contadores de todos los hilos visibles en una sola consulta. */
  const loadSummaries = useCallback((list: SiteFeedbackRow[]) => {
    if (list.length === 0) { setSummaries(new Map()); return }
    const owners = new Map(list.map((r) => [r.id, r.user_id]))
    fetchThreadSummaries(owners, user?.id ?? null)
      .then(setSummaries)
      // Que falle el hilo no puede tumbar la bandeja: sin contadores se sigue
      // atendiendo igual, solo se pierden las insignias.
      .catch((e) => console.error('thread summaries error:', e))
  }, [user?.id])

  useEffect(() => { loadSummaries(rows) }, [rows, loadSummaries])

  /**
   * Da por leídos los avisos DE ESA opinión, y solo de esa. Antes se marcaban
   * todos al entrar a la bandeja: bastaba con asomarse para que la campana
   * dejara de avisar de conversaciones que nadie había abierto.
   */
  const clearPingsFor = useCallback((feedbackId: string) => {
    const { items, markRead } = useNotificationsStore.getState()
    for (const n of items) {
      if (n.read_at) continue
      if (n.kind !== 'site_feedback' && n.kind !== 'site_feedback_reply') continue
      if (n.payload?.feedback_id === feedbackId) void markRead(n.id)
    }
  }, [])

  const summaryOf = useCallback(
    (id: string) => summaries.get(id) ?? EMPTY_SUMMARY,
    [summaries],
  )

  // "Esperan respuesta" se filtra aquí y no en la consulta: depende del hilo, que
  // vive en otra tabla, y filtrarlo en el servidor costaría una vista más.
  const visible = useMemo(
    () => (awaitingOnly ? rows.filter((r) => isAwaiting(r, summaryOf(r.id))) : rows),
    [rows, awaitingOnly, summaryOf],
  )

  const stats = useMemo(() => computeStats(rows), [rows])
  const awaitingCount = useMemo(
    () => rows.filter((r) => isAwaiting(r, summaryOf(r.id))).length,
    [rows, summaryOf],
  )

  const selected = useMemo(
    () => visible.find((r) => r.id === selectedId) ?? null,
    [visible, selectedId],
  )

  // Nada se abre solo. Abrir una ficha es leerla —y del otro lado se ve el
  // "visto"—, así que la bandeja espera a que alguien elija; solo el enlace de un
  // aviso (?id=…) abre una, porque ahí sí hubo una decisión.
  //
  // Si esa opinión no entra en el filtro actual (p. ej. ya resuelta), se abre
  // igual quitando el filtro de estado.
  useEffect(() => {
    const id = params.get('id')
    if (!id || loading) return
    if (rows.some((r) => r.id === id)) { setSelectedId(id); return }
    if (status !== 'all') setStatus('all')
  }, [params, rows, loading, status])

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    // El id viaja en la URL: recargar o compartir el enlace abre la misma ficha.
    setParams(id ? { id } : {}, { replace: true })
    if (id) clearPingsFor(id)
  }, [setParams, clearPingsFor])

  // ── En vivo: una respuesta nueva no espera a que alguien recargue ──────────
  // La ficha abierta se actualiza sola (lo hace el propio hilo); aquí solo se
  // mueven los contadores de la lista, y lo que no cabe en el filtro se ofrece
  // como "novedades" en vez de reordenar la pantalla debajo del cursor.
  const rowsRef = useRef(rows)
  const selectedRef = useRef(selectedId)
  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { selectedRef.current = selectedId }, [selectedId])

  useEffect(() => subscribeFeedbackEvents((ev: FeedbackEvent) => {
    if (ev.type === 'status') return
    const row = rowsRef.current.find((r) => r.id === ev.feedback_id)
    if (!row) { setPendingNews((n) => n + 1); return }

    const fromOwner = ev.author_id === row.user_id
    // Lo propio no es novedad, y lo que ya está abierto lo marca leído el hilo.
    if (ev.author_id === user?.id) return
    const isOpen = selectedRef.current === row.id

    setSummaries((cur) => {
      const next = new Map(cur)
      const s = { ...(next.get(row.id) ?? EMPTY_SUMMARY) }
      if (ev.type === 'note') s.notes++
      else {
        s.replies++
        s.awaitingStaff = fromOwner
        if (!fromOwner) s.answered = true
        if (fromOwner && !isOpen) s.unread++
      }
      s.lastAt = ev.created_at
      s.lastType = ev.type
      next.set(row.id, s)
      return next
    })
  }), [user?.id])

  /** Cambia el estado en la fila ya cargada (sin recargar toda la lista). */
  async function patch(id: string, p: { status?: FeedbackStatus; staff_note?: string | null }) {
    try {
      await updateSiteFeedback(id, p)
      setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...p } as SiteFeedbackRow : r)))
      // El hito del cambio lo escribe la BD: hay que volver a pedirlo.
      if (p.status) setThreadKey((k) => k + 1)
      toast.success(t('admin.site_feedback.saved', 'Actualizado'))
    } catch (e) {
      console.error(e)
      toast.error(t('admin.site_feedback.save_error', 'No se pudo guardar'))
    }
  }

  /** Borrado definitivo (solo superadmin): pruebas y basura que nadie debe leer. */
  async function remove(r: SiteFeedbackRow) {
    const ok = await confirm({
      title: t('admin.site_feedback.delete_title', 'Borrar esta opinión'),
      description: t(
        'admin.site_feedback.delete_desc2',
        'Se elimina para siempre, junto con toda su conversación y sus notas internas. Si solo quieres sacarla de la bandeja, márcala como Archivada.',
      ),
      confirmLabel: t('admin.site_feedback.delete_confirm', 'Borrar'),
    })
    if (!ok) return
    try {
      await deleteSiteFeedback(r.id, r.shots)
      setRows((cur) => cur.filter((x) => x.id !== r.id))
      if (selectedId === r.id) select(null)
      toast.success(t('admin.site_feedback.deleted', 'Opinión borrada'))
    } catch (e) {
      console.error(e)
      toast.error(t('admin.site_feedback.delete_error', 'No se pudo borrar la opinión'))
    }
  }

  /** El hilo abierto se dio por leído: se apaga su punto y sus avisos. */
  const onThreadRead = useCallback((id: string) => {
    setSummaries((cur) => {
      const s = cur.get(id)
      if (!s || s.unread === 0) return cur
      const next = new Map(cur)
      next.set(id, { ...s, unread: 0 })
      return next
    })
    clearPingsFor(id)
  }, [clearPingsFor])

  /** Tras escribir en un hilo, su resumen cambia: se refresca solo ese. */
  const bumpSummary = useCallback((id: string, mine: boolean, isNote: boolean) => {
    setSummaries((cur) => {
      const next = new Map(cur)
      const s = { ...(next.get(id) ?? EMPTY_SUMMARY) }
      if (isNote) s.notes++
      else {
        s.replies++
        s.answered = s.answered || mine
        s.awaitingStaff = false
      }
      s.lastAt = new Date().toISOString()
      s.lastType = isNote ? 'note' : 'reply'
      next.set(id, s)
      return next
    })
  }, [])

  const statusChips: { key: StatusFilter; label: string; color?: string }[] = [
    { key: 'open', label: t('admin.site_feedback.filter_open', 'Sin resolver') },
    { key: 'all', label: t('admin.site_feedback.filter_all', 'Todas') },
    ...STATUSES.map((s) => ({
      key: s as StatusFilter,
      label: t(`site_feedback.status.${s}`),
      color: STATUS_COLOR[s],
    })),
  ]

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="mb-1 text-[20px] font-bold text-text sm:text-[24px]">
          {t('admin.site_feedback.title', 'Opiniones del sitio')}
        </h1>
        <p className="text-[13px] text-text-muted">
          {t('admin.site_feedback.subtitle2', 'Lo que reportan, proponen y celebran de la plataforma — y toda la conversación que sigue después.')}
        </p>
      </div>

      {/* ── KPIs ── */}
      <FadeIn as="section" className="mb-4 grid grid-cols-2 gap-3 sm:mb-5 sm:gap-4 lg:grid-cols-5" y={12}>
        <Kpi label={t('admin.site_feedback.kpi_total', 'Opiniones')} value={String(stats.total)} />
        <Kpi label={t('admin.site_feedback.kpi_open', 'Sin resolver')} value={String(stats.open)} color="#f59e0b" />
        <Kpi
          label={t('admin.site_feedback.kpi_awaiting', 'Esperan respuesta')}
          value={String(awaitingCount)}
          color={awaitingCount > 0 ? '#38bdf8' : undefined}
        />
        <Kpi
          label={t('admin.site_feedback.kpi_contact', 'Piden contacto')}
          value={String(stats.contactPending)}
          color={stats.contactPending > 0 ? '#ef4444' : undefined}
        />
        <Kpi
          label={t('admin.site_feedback.kpi_mood', 'Ánimo promedio')}
          value={stats.avgMood !== null ? `${stats.avgMood}/5` : '—'}
          sub={stats.avgMood !== null ? MOODS[Math.round(stats.avgMood) - 1]?.emoji : undefined}
          // Un 2/5 promedio no puede pintarse de verde: el color es la alarma.
          color={stats.avgMood !== null ? scoreColor(Math.round(stats.avgMood)) : undefined}
        />
      </FadeIn>

      {/* ── Toolbar ── */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <form
            className="relative w-full sm:max-w-xs"
            onSubmit={(e) => { e.preventDefault(); setSearch(searchInput) }}
          >
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted/70" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('admin.site_feedback.search_ph', 'Buscar en los comentarios…')}
              className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-muted/60 focus:border-[rgb(var(--brand-green))]/40"
            />
          </form>

          <div className="flex flex-wrap gap-2">
            <FilterChip active={kind === 'all'} onClick={() => setKind('all')}>
              {t('admin.site_feedback.kind_all', 'Todo tipo')}
            </FilterChip>
            {KINDS.map((k) => (
              <FilterChip
                key={k.key}
                active={kind === k.key}
                color={k.color}
                onClick={() => setKind(kind === k.key ? 'all' : k.key)}
              >
                <span className="mr-1">{k.emoji}</span>
                {t(`site_feedback.kind.${k.key}.label`)}
                <span className="ml-1 tabular-nums opacity-70">{stats.byKind[k.key] || 0}</span>
              </FilterChip>
            ))}
            <FilterChip active={awaitingOnly} color="#38bdf8" onClick={() => setAwaitingOnly((v) => !v)}>
              <MessageSquare className="mr-1 inline h-3 w-3" />
              {t('admin.site_feedback.only_awaiting', 'Esperan respuesta')}
              <span className="ml-1 tabular-nums opacity-70">{awaitingCount}</span>
            </FilterChip>
            <FilterChip active={contactOnly} color="#ef4444" onClick={() => setContactOnly((v) => !v)}>
              <Phone className="mr-1 inline h-3 w-3" />
              {t('admin.site_feedback.only_contact', 'Piden contacto')}
            </FilterChip>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {statusChips.map((c) => (
            <FilterChip key={c.key} active={status === c.key} color={c.color} onClick={() => setStatus(c.key)}>
              {c.label}
            </FilterChip>
          ))}
        </div>

        {/* Novedades que no caben en lo que hay en pantalla. Se ofrecen, no se
            imponen: recargar solo se dispara si alguien lo pide, para que la
            lista no se reordene mientras se está leyendo una ficha. */}
        <AnimatePresence initial={false}>
          {pendingNews > 0 && (
            <motion.button
              key="news"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: EASE }}
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-full border border-sky-400/40 bg-sky-500/10 px-3.5 py-1.5 text-[12px] font-medium text-sky-400 transition-colors hover:bg-sky-500/15"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('admin.site_feedback.live_news', {
                n: pendingNews,
                defaultValue: 'Novedades fuera de esta vista ({{n}}) · Actualizar',
              })}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── Lista + ficha ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-text-subtle" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-6 text-center sm:p-12">
          <Inbox className="mx-auto mb-3 h-7 w-7 text-text-subtle" />
          <div className="mb-1 text-[15px] font-medium text-text">
            {t('admin.site_feedback.empty_title', 'Nada por aquí todavía')}
          </div>
          <div className="text-[13px] text-text-muted">
            {t('admin.site_feedback.empty_desc', 'Cuando alguien opine desde el botón flotante, su mensaje aparecerá en esta bandeja.')}
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(19rem,24rem)_1fr]">
          {/* Lista */}
          <div className="space-y-2 lg:max-h-[calc(100vh-19rem)] lg:overflow-y-auto lg:pr-1">
            {visible.map((r, i) => (
              <ListItem
                key={r.id}
                row={r}
                index={i}
                summary={summaryOf(r.id)}
                selected={selectedId === r.id}
                isSuperAdmin={isSuperAdmin}
                onSelect={() => select(r.id)}
              />
            ))}
          </div>

          {/* Ficha: columna en escritorio, capa a pantalla completa en móvil */}
          <AnimatePresence mode="wait">
            {selected ? (
              <Detail
                key={selected.id}
                row={selected}
                summary={summaryOf(selected.id)}
                isSuperAdmin={isSuperAdmin}
                wide={wide}
                threadKey={threadKey}
                onClose={() => select(null)}
                onPatch={patch}
                onDelete={remove}
                onThreadPosted={bumpSummary}
                onThreadRead={onThreadRead}
              />
            ) : wide ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="hidden h-full min-h-[24rem] flex-col items-center justify-center rounded-2xl border border-dashed border-line p-10 text-center lg:flex"
              >
                <MousePointerClick className="mb-3 h-7 w-7 text-text-subtle" />
                <p className="text-[14px] font-medium text-text">
                  {t('admin.site_feedback.pick_title', 'Elige una opinión')}
                </p>
                <p className="mt-1 max-w-xs text-[12.5px] text-text-muted">
                  {t('admin.site_feedback.pick_desc', 'Aquí verás la ficha completa: lo que dijo, lo que respondió y toda la conversación.')}
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════ Lista ═══════════════════════ */

function ListItem({ row: r, index, summary, selected, isSuperAdmin, onSelect }: {
  row: SiteFeedbackRow
  index: number
  summary: ThreadSummary
  selected: boolean
  isSuperAdmin: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const meta = kindMeta(r.kind)
  const mood = r.mood ? MOODS.find((m) => m.value === r.mood) : null
  const awaiting = isAwaiting(r, summary)

  return (
    <motion.button
      onClick={onSelect}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE, delay: Math.min(index, 10) * 0.03 }}
      whileTap={reduce ? undefined : { scale: 0.995 }}
      className={cn(
        'relative w-full overflow-hidden rounded-2xl border p-3 text-left transition-colors duration-300',
        selected
          ? 'border-[rgb(var(--brand-green))]/35 bg-[rgb(var(--brand-green))]/[0.05]'
          : 'border-line bg-surface hover:bg-subtle/50',
      )}
    >
      {/* Filo de selección: dice cuál está abierta sin gritarlo */}
      {selected && (
        <motion.span
          layoutId="feedback-selected"
          className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[rgb(var(--brand-green))]"
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        />
      )}

      <div className="flex items-start gap-2.5">
        <span
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[17px]"
          style={{ background: `${meta.color}1f` }}
        >
          {meta.emoji}
          {/* Punto vivo: hay algo escrito que este equipo no ha leído */}
          {summary.unread > 0 && (
            <motion.span
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-sky-400 ring-2 ring-surface"
              animate={reduce ? undefined : { scale: [1, 1.35, 1], opacity: [1, 0.6, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[12.5px] leading-snug text-text">
            {r.message || (
              <span className="italic text-text-muted">
                {t('admin.site_feedback.no_message', 'Sin comentario escrito')}
              </span>
            )}
          </p>
          <p className="mt-1 truncate text-[11px] text-text-muted">
            {r.display_name ?? t('admin.site_feedback.user_fallback', 'Usuario')}
            {isSuperAdmin && r.campaign_name ? ` · ${r.campaign_name}` : ''}
            {' · '}{fmtDate(r.created_at)}
            {mood ? ` · ${mood.emoji}` : ''}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusPill status={r.status} />
            {awaiting && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/12 px-2 py-1 text-[10.5px] font-medium text-sky-400">
                {t('admin.site_feedback.awaiting', 'Esperando respuesta')}
              </span>
            )}
            {summary.replies > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-1 text-[10.5px] font-medium text-text-muted"
                title={t('admin.site_feedback.thread_count', '{{n}} mensaje(s) en la conversación', { n: summary.replies })}
              >
                <MessageSquare className="h-3 w-3" />
                {summary.replies}
              </span>
            )}
            {r.shots && r.shots.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-1 text-[10.5px] font-medium text-text-muted">
                <ImageIcon className="h-3 w-3" />
                {r.shots.length}
              </span>
            )}
            {r.contact_ok && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-1 text-[10.5px] font-medium text-red-400">
                <Phone className="h-3 w-3" />
                {t('admin.site_feedback.wants_contact', 'Contactar')}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.button>
  )
}

/* ═══════════════════════ Ficha ═══════════════════════ */

function Detail({
  row: r, summary, isSuperAdmin, wide, threadKey, onClose, onPatch, onDelete,
  onThreadPosted, onThreadRead,
}: {
  row: SiteFeedbackRow
  summary: ThreadSummary
  isSuperAdmin: boolean
  wide: boolean
  threadKey: number
  onClose: () => void
  onPatch: (id: string, p: { status?: FeedbackStatus; staff_note?: string | null }) => Promise<void>
  onDelete: (row: SiteFeedbackRow) => Promise<void>
  onThreadPosted: (id: string, mine: boolean, isNote: boolean) => void
  onThreadRead: (id: string) => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const reduce = useReducedMotion()
  const meta = kindMeta(r.kind)
  const mood = r.mood ? MOODS.find((m) => m.value === r.mood) : null

  // En móvil la ficha tapa la pantalla: se cierra con Escape, como un modal.
  useEffect(() => {
    if (wide) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [wide, onClose])

  // Todas las preguntas del formulario: las propias de este tipo (aunque las
  // haya dejado en blanco) más cualquier respuesta guardada que ya no figure
  // entre ellas, para que nunca se pierda de vista algo que la persona contestó.
  const answerEntries = useMemo(() => {
    const own = questionsFor(r.kind).map((q) => q.key)
    const extra = Object.keys(r.answers ?? {}).filter((k) => !own.includes(k))
    return [...own, ...extra].map((key) => ({ key, value: r.answers?.[key] ?? '' }))
  }, [r.kind, r.answers])

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: wide ? 10 : 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: wide ? -8 : 24 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={cn(
        'overflow-y-auto bg-bg',
        // Móvil: capa a pantalla completa. Escritorio: columna de la rejilla.
        'fixed inset-0 z-50 p-4',
        'lg:static lg:z-auto lg:max-h-[calc(100vh-19rem)] lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:p-0',
      )}
    >
      {/* Cabecera pegajosa: quién y qué, siempre a la vista mientras se lee */}
      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur lg:mx-0 lg:mb-0 lg:rounded-t-2xl lg:bg-surface/85 lg:px-5">
        <div className="flex items-start gap-3">
          <button
            onClick={onClose}
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-subtle hover:text-text lg:hidden"
            aria-label={t('common.back', 'Volver')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span
            className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[19px] lg:flex"
            style={{ background: `${meta.color}1f` }}
          >
            {meta.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-text">
              {r.display_name ?? t('admin.site_feedback.user_fallback', 'Usuario')}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-text-muted">
              <span>{t(`site_feedback.kind.${r.kind}.label`)}</span>
              <span>·</span>
              <span>{fmtFullDate(r.created_at)}</span>
              {isSuperAdmin && r.campaign_name && (
                <>
                  <span>·</span>
                  <span>{r.campaign_name}</span>
                </>
              )}
            </p>
          </div>
          <StatusPill status={r.status} className="mt-0.5" />
          <button
            onClick={onClose}
            className="mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-subtle hover:text-text lg:inline-flex"
            aria-label={t('site_feedback.close', 'Cerrar')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-5 pb-24 lg:px-5 lg:pb-6 lg:pt-4">
        {/* Contexto de una línea: desde dónde se escribió */}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-muted">
          {r.role && r.role !== 'learner' && (
            <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide">
              {t(`roles.${r.role}`, r.role)}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Monitor className="h-3 w-3" />
            {r.page_label || t('admin.site_feedback.page_unknown', 'Pantalla no identificada')}
          </span>
        </p>

        {/* ── Lo que dijo ── */}
        <Section title={t('admin.site_feedback.sec_said', 'Lo que dijo')}>
          <p className={cn(
            'whitespace-pre-wrap rounded-xl border border-line bg-subtle/40 px-3.5 py-3 text-[13.5px] leading-relaxed',
            r.message ? 'text-text' : 'italic text-text-muted',
          )}>
            {r.message || t('admin.site_feedback.no_message', 'Sin comentario escrito')}
          </p>
        </Section>

        {/* Las capturas van pegadas al comentario: son la misma explicación,
            y en un error valen más que cualquier campo del formulario. */}
        {r.shots && r.shots.length > 0 && (
          <Section title={t('admin.site_feedback.sec_shots', 'Lo que nos mostró')}>
            <ShotGallery shots={r.shots} size="md" />
          </Section>
        )}

        {/* ── Conversación: el corazón de la ficha ── */}
        <Section
          title={t('admin.site_feedback.sec_thread', 'Conversación')}
          badge={summary.replies > 0 ? String(summary.replies) : undefined}
        >
          {/* Fondo propio: los aros que separan avatares y hitos de la línea de
              tiempo son del color de la superficie, así que el hilo necesita
              estar sobre una — en móvil la ficha va sobre el fondo de la app. */}
          <div className="rounded-2xl border border-line bg-surface p-3 sm:p-4">
            <FeedbackThread
              row={r}
              variant="staff"
              showOrigin
              reloadKey={threadKey}
              onPosted={(e) => onThreadPosted(r.id, e.author_id === user?.id, e.type === 'note')}
              onRead={() => onThreadRead(r.id)}
            />
          </div>
        </Section>

        {/* ── Gestión: el estado es el que mueve el hilo ── */}
        <Section title={t('admin.site_feedback.manage', 'Gestión')}>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => onPatch(r.id, { status: s })}
                className={cn(
                  'relative rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                  r.status === s ? '' : 'border-line text-text-muted hover:bg-subtle',
                )}
                style={r.status === s
                  ? { borderColor: STATUS_COLOR[s], background: `${STATUS_COLOR[s]}1a`, color: STATUS_COLOR[s] }
                  : undefined}
              >
                {t(`site_feedback.status.${s}`)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-text-subtle">
            {t('admin.site_feedback.status_hint', 'Cada cambio queda escrito en la conversación, con tu nombre y la hora.')}
          </p>
          {r.handled_by_name && (
            <p className="mt-1 text-[11px] text-text-subtle">
              {t('admin.site_feedback.handled_by', 'Última gestión: {{name}}', { name: r.handled_by_name })}
            </p>
          )}
        </Section>

        {/* Contacto: lo más accionable de la ficha, por eso destaca en color */}
        {r.contact_ok && (
          <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3.5 py-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-400">
              <Phone className="h-3 w-3" />
              {t('admin.site_feedback.contact_title', 'Pidió que lo contactaran')}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {r.contact_email && (
                <ContactLink href={`mailto:${r.contact_email}`} icon={Mail} value={r.contact_email} />
              )}
              {r.contact_phone && (
                <ContactLink href={`tel:${r.contact_phone.replace(/\s/g, '')}`} icon={Phone} value={r.contact_phone} />
              )}
              {/* Teams se abre por la cuenta corporativa, no por el teléfono:
                  el chat se busca por correo, así que sin correo no hay enlace. */}
              {r.contact_email && (
                <ContactLink
                  href={`https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(r.contact_email)}`}
                  icon={Users}
                  value="Teams"
                />
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-text-muted">
              <span>
                {t('admin.site_feedback.contact_pref', 'Prefiere')}:{' '}
                {r.contact_pref ? t(`site_feedback.contact_pref_${r.contact_pref}`) : '—'}
              </span>
              <span>
                {t('admin.site_feedback.contact_when', 'Momento')}: {r.contact_note || '—'}
              </span>
            </div>
          </div>
        )}

        {/* ── Cómo se sintió: las tres medidas, en lenguaje de persona ── */}
        <Section title={t('admin.site_feedback.sec_felt', 'Cómo se sintió')}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Metric
              label={t('admin.site_feedback.d_kind', 'Tipo de opinión')}
              value={t(`site_feedback.kind.${r.kind}.label`)}
              emoji={meta.emoji}
              color={meta.color}
            />
            <Metric
              label={t('admin.site_feedback.d_mood', 'Ánimo general')}
              value={mood ? t(`site_feedback.mood.${mood.value}`) : '—'}
              emoji={mood?.emoji}
              score={r.mood}
            />
            <Metric
              label={t('admin.site_feedback.d_ease', 'Facilidad')}
              value={r.ease ? t(`site_feedback.ease_level.${r.ease}`) : '—'}
              score={r.ease}
            />
          </div>
        </Section>

        {/* ── Respuestas del formulario ── */}
        <Section title={t('admin.site_feedback.sec_answers', 'Lo que respondió')}>
          <div className="space-y-2.5">
            <QaRow label={t('admin.site_feedback.d_areas', 'Zonas del sitio')}>
              {r.areas?.length
                ? (
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {r.areas.map((a) => (
                      <span key={a} className="rounded-full bg-subtle px-2 py-0.5 text-[11.5px] text-text">
                        {t(`site_feedback.areas.${a}`, a)}
                      </span>
                    ))}
                  </span>
                )
                : '—'}
            </QaRow>

            {/* Primero las preguntas propias de este tipo de opinión y luego
                cualquier otra respuesta guardada: si mañana cambian las
                preguntas, lo viejo se sigue viendo en vez de desaparecer. */}
            {answerEntries.map(({ key, value }) => (
              <QaRow key={key} label={t(`site_feedback.q.${key}.title`, key)}>
                {value ? t(`site_feedback.q.${key}.opt.${value}`, value) : '—'}
              </QaRow>
            ))}
          </div>
        </Section>

        {/* Lo técnico es ruido para el capacitador —que necesita atender a la
            persona, no depurar— y materia prima para el superadmin, que sí
            tiene que reproducir el error. Por eso solo él lo ve. */}
        {isSuperAdmin && (
          <details className="rounded-xl border border-line bg-subtle/40 px-3 py-2 text-[11.5px] text-text-subtle">
            <summary className="cursor-pointer select-none font-medium hover:text-text-muted">
              {t('admin.site_feedback.tech', 'Detalles técnicos')}
            </summary>
            <div className="mt-2.5 space-y-1.5">
              <TechRow label={t('admin.site_feedback.d_path', 'Ruta')} value={r.page ?? '—'} mono />
              <TechRow label={t('admin.site_feedback.d_lang', 'Idioma')} value={r.lang?.toUpperCase() ?? '—'} />
              <TechRow label={t('admin.site_feedback.d_campaign', 'Campaña')} value={r.campaign_name ?? '—'} />
              <TechRow label={t('admin.site_feedback.d_id', 'ID')} value={r.id} mono />
            </div>
            {r.meta && Object.keys(r.meta).length > 0 && (
              <pre className="mt-2.5 overflow-x-auto rounded-lg bg-subtle p-2.5 text-[10.5px] leading-relaxed">
                {JSON.stringify(r.meta, null, 2)}
              </pre>
            )}
          </details>
        )}

        {/* Borrar es del superadmin: el capacitador archiva, no destruye. */}
        {isSuperAdmin && (
          <div className="flex justify-end border-t border-line/60 pt-4">
            <button
              onClick={() => void onDelete(r)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('admin.site_feedback.delete', 'Borrar')}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/* ═══════════════════════ Piezas sueltas ═══════════════════════ */

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface p-4 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover sm:p-5">
      <span className="truncate text-[10px] uppercase tracking-wider text-text-muted sm:text-[11px]">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums sm:text-3xl" style={color ? { color } : { color: 'var(--text)' }}>
          {value}
        </span>
        {sub && <span className="text-[18px] leading-none">{sub}</span>}
      </div>
    </div>
  )
}

function FilterChip({ active, color, onClick, children }: {
  active: boolean
  color?: string
  onClick: () => void
  children: React.ReactNode
}) {
  const accent = color ?? 'rgb(var(--brand-green))'
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
        active ? '' : 'border-line text-text-muted hover:bg-subtle',
      )}
      style={active ? { borderColor: accent, background: `${accent}1a`, color: accent } : undefined}
    >
      {children}
    </button>
  )
}

/** Bloque con título fino: separa el detalle en lo que cada quien va a leer. */
function Section({ title, badge, children }: {
  title: string
  badge?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {title}
        {badge && (
          <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[10px] tabular-nums text-text-muted">
            {badge}
          </span>
        )}
      </h4>
      {children}
    </section>
  )
}

/** Rojo abajo, ámbar en el medio, verde arriba: el color dice el estado. */
function scoreColor(score: number): string {
  if (score <= 2) return '#ef4444'
  if (score === 3) return '#f59e0b'
  return '#10D451'
}

/**
 * Medida con cara y palabra, no solo un número: "2/5" no dice nada de un
 * vistazo, "Difícil" en rojo sí. La barrita permite comparar fichas de un
 * barrido, sin leer.
 */
function Metric({ label, value, emoji, score, color }: {
  label: string
  value: string
  emoji?: string
  score?: number | null
  color?: string
}) {
  const tone = color ?? (typeof score === 'number' && score > 0 ? scoreColor(score) : undefined)
  return (
    <div className="rounded-xl border border-line bg-subtle/40 px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        {emoji && <span className="text-[16px] leading-none">{emoji}</span>}
        <span className="text-[13.5px] font-semibold" style={tone ? { color: tone } : undefined}>{value}</span>
      </div>
      {typeof score === 'number' && score > 0 && (
        <div className="mt-2 flex gap-1" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={cn('h-1 flex-1 rounded-full', n <= score ? '' : 'bg-line')}
              style={n <= score ? { background: tone } : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Pregunta a la izquierda, respuesta a la derecha: se lee como una entrevista. */
function QaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line/60 pb-2.5 last:border-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="text-[12.5px] text-text-muted">{label}</span>
      <span className="text-right text-[13px] font-medium text-text">{children}</span>
    </div>
  )
}

function TechRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0">{label}</span>
      <span className={cn('truncate text-right text-text-muted', mono && 'font-mono text-[10.5px]')}>{value}</span>
    </div>
  )
}

function ContactLink({ href, icon: Icon, value }: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  value: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center overflow-hidden rounded-lg border border-line bg-surface">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-text transition-colors hover:bg-subtle"
      >
        <Icon className="h-3.5 w-3.5 text-text-muted" />
        {value}
      </a>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        }}
        className="border-l border-line px-2 py-1.5 text-text-muted transition-colors hover:bg-subtle hover:text-text"
        aria-label="Copiar"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-neon-green" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  )
}
