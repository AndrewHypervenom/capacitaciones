import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import i18n from '@/i18n'
import {
  ArrowLeft, Check, ChevronDown, Copy, Image as ImageIcon, Inbox, ListFilter,
  Loader2, Mail, MessageSquare, Monitor, MousePointerClick, Phone, RefreshCw,
  Search, SlidersHorizontal, Trash2, Users, X,
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

  /** Filtros puestos a mano, para poder enseñarlos —y quitarlos— de uno en uno. */
  const activeFilters = useMemo(() => {
    const out: { key: string; label: string; color?: string; clear: () => void }[] = []
    if (status !== 'open') {
      out.push({
        key: 'status',
        label: statusChips.find((c) => c.key === status)?.label ?? String(status),
        color: status === 'all' ? undefined : STATUS_COLOR[status as FeedbackStatus],
        clear: () => setStatus('open'),
      })
    }
    if (kind !== 'all') {
      const k = KINDS.find((x) => x.key === kind)
      out.push({
        key: 'kind',
        label: `${k?.emoji ?? ''} ${t(`site_feedback.kind.${kind}.label`)}`.trim(),
        color: k?.color,
        clear: () => setKind('all'),
      })
    }
    if (awaitingOnly) {
      out.push({
        key: 'awaiting',
        label: t('admin.site_feedback.only_awaiting', 'Esperan respuesta'),
        color: '#38bdf8',
        clear: () => setAwaitingOnly(false),
      })
    }
    if (contactOnly) {
      out.push({
        key: 'contact',
        label: t('admin.site_feedback.only_contact', 'Piden contacto'),
        color: '#ef4444',
        clear: () => setContactOnly(false),
      })
    }
    if (search) {
      out.push({
        key: 'search',
        label: `“${search}”`,
        clear: () => { setSearch(''); setSearchInput('') },
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, kind, awaitingOnly, contactOnly, search, t])

  /** Vuelve a la bandeja de trabajo: lo que queda por resolver, sin más filtros. */
  const resetFilters = useCallback(() => {
    setStatus('open'); setKind('all'); setAwaitingOnly(false)
    setContactOnly(false); setSearch(''); setSearchInput('')
  }, [])

  /** Todas, resueltas incluidas: el histórico completo sin nada puesto encima. */
  const showAll = useCallback(() => {
    setStatus('all'); setKind('all'); setAwaitingOnly(false)
    setContactOnly(false); setSearch(''); setSearchInput('')
  }, [])

  return (
    // Altura completa en escritorio: el contenedor del panel ya scrollea, así que
    // aquí NO se scrollea la página entera — scrollean la lista y la ficha, cada
    // una por su lado. Es lo que le devuelve al chat la altura que le faltaba (y
    // lo que quita la segunda barra de scroll).
    <div className="flex flex-col gap-3 p-4 sm:p-5 lg:h-full lg:min-h-0 lg:gap-3.5 lg:p-6 lg:pb-5">
      {/* ── Cabecera: título y pulso de la bandeja en una sola línea. Cada píxel
             que se lleva el cromo se lo quita a la conversación, que es el
             trabajo de verdad de esta pantalla. ── */}
      <FadeIn
        as="header"
        y={10}
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
      >
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold leading-tight text-text sm:text-[23px]">
            {t('admin.site_feedback.title', 'Opiniones del sitio')}
          </h1>
          <p className="hidden text-[12.5px] text-text-muted sm:block">
            {t('admin.site_feedback.subtitle2', 'Lo que reportan, proponen y celebran de la plataforma — y toda la conversación que sigue después.')}
          </p>
        </div>

        {/* Los números NO son adorno: cada uno es el filtro que le corresponde,
            así que mirar la bandeja y ponerse a trabajar es el mismo gesto. */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-surface p-1">
          <StatPill
            label={t('admin.site_feedback.kpi_total', 'Opiniones')}
            value={stats.total}
            active={status === 'all' && activeFilters.length === 1}
            onClick={showAll}
          />
          <StatPill
            label={t('admin.site_feedback.kpi_open', 'Sin resolver')}
            value={stats.open}
            color="#f59e0b"
            active={status === 'open'}
            onClick={() => setStatus(status === 'open' ? 'all' : 'open')}
          />
          <StatPill
            label={t('admin.site_feedback.kpi_awaiting', 'Esperan respuesta')}
            value={awaitingCount}
            color="#38bdf8"
            active={awaitingOnly}
            onClick={() => setAwaitingOnly((v) => !v)}
          />
          <StatPill
            label={t('admin.site_feedback.kpi_contact', 'Piden contacto')}
            value={stats.contactPending}
            color="#ef4444"
            active={contactOnly}
            onClick={() => setContactOnly((v) => !v)}
          />
          <div className="mx-0.5 hidden h-6 w-px bg-line sm:block" />
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] uppercase tracking-wider text-text-muted"
            title={t('admin.site_feedback.kpi_mood', 'Ánimo promedio')}
          >
            {stats.avgMood !== null && (
              <span className="text-[15px] leading-none">
                {MOODS[Math.round(stats.avgMood) - 1]?.emoji}
              </span>
            )}
            <span
              className="text-[14px] font-bold leading-none tabular-nums"
              // Un 2/5 promedio no puede pintarse de verde: el color es la alarma.
              style={stats.avgMood !== null ? { color: scoreColor(Math.round(stats.avgMood)) } : undefined}
            >
              {stats.avgMood !== null ? `${stats.avgMood}/5` : '—'}
            </span>
          </span>
        </div>
      </FadeIn>

      {/* ── Una sola barra: buscar, un botón de filtros y lo que esté puesto.
             Antes eran catorce chips siempre encendidos comiéndose la mitad de
             la altura del chat; ahora el detalle está a un clic y se ve solo
             cuando se usa. ── */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative min-w-[12rem] flex-1 sm:max-w-xs"
          onSubmit={(e) => { e.preventDefault(); setSearch(searchInput) }}
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted/70" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('admin.site_feedback.search_ph', 'Buscar en los comentarios…')}
            className="w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-8 text-[13px] text-text outline-none transition-colors placeholder:text-text-muted/60 focus:border-[rgb(var(--brand-green))]/40"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearch('') }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-text-muted transition-colors hover:bg-subtle hover:text-text"
              aria-label={t('common.clear', 'Limpiar')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        <FiltersMenu
          count={activeFilters.length}
          status={status}
          statusChips={statusChips}
          kind={kind}
          byKind={stats.byKind}
          awaitingOnly={awaitingOnly}
          awaitingCount={awaitingCount}
          contactOnly={contactOnly}
          onStatus={setStatus}
          onKind={setKind}
          onAwaiting={setAwaitingOnly}
          onContact={setContactOnly}
          onReset={resetFilters}
        />

        {/* Lo que está filtrando, a la vista y quitable de uno en uno: nadie se
            queda mirando una bandeja vacía sin saber por qué. */}
        <AnimatePresence initial={false} mode="popLayout">
          {activeFilters.map((f) => (
            <motion.button
              key={f.key}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.24, ease: EASE }}
              onClick={f.clear}
              className="group inline-flex max-w-[14rem] items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                borderColor: `${f.color ?? 'rgb(var(--brand-green))'}59`,
                background: `${f.color ?? 'rgb(var(--brand-green))'}14`,
                color: f.color ?? 'rgb(var(--brand-green))',
              }}
            >
              <span className="truncate">{f.label}</span>
              <X className="h-3 w-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
            </motion.button>
          ))}
        </AnimatePresence>

        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-text-subtle">
          {t('admin.site_feedback.count', {
            n: visible.length,
            defaultValue: '{{n}} en la lista',
          })}
        </span>

        {/* Novedades que no caben en lo que hay en pantalla. Se ofrecen, no se
            imponen: recargar solo se dispara si alguien lo pide, para que la
            lista no se reordene mientras se está leyendo una ficha. */}
        <AnimatePresence initial={false}>
          {pendingNews > 0 && (
            <motion.button
              key="news"
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3, ease: EASE }}
              onClick={() => void load()}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1.5 text-[12px] font-medium text-sky-400 transition-colors hover:bg-sky-500/15"
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

      {/* ── Lista + ficha: se comen TODA la altura que sobra ── */}
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
        // `min-h-0` en toda la cadena: sin él, un hijo con scroll dentro de un
        // flex/grid crece con su contenido en vez de scrollear (la razón de que
        // antes hiciera falta un max-h a ojo).
        <div className="grid gap-3.5 lg:min-h-0 lg:flex-1 lg:grid-cols-[19.5rem_1fr] xl:grid-cols-[22rem_1fr]">
          {/* Lista */}
          <div className="space-y-2 lg:min-h-0 lg:overflow-y-auto lg:pr-1.5">
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

          {/* Ficha: columna en escritorio, capa a pantalla completa en móvil.
              SIN AnimatePresence: la ficha lleva dentro sus propios (el hilo, el
              detalle, la caja de escribir). Un `mode="wait"` aquí fuera espera a
              que salga la ficha vieja, y cuando dentro había otra salida a medias
              esa espera no termina nunca: al cambiar de opinión no entraba la
              ficha nueva y la columna se quedaba en blanco. `key` remonta y anima
              la entrada, que es lo único que se ve de verdad. */}
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
          <p className="line-clamp-2 text-[13px] leading-snug text-text">
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

  // Se abre por la conversación: es a lo que se viene. El expediente —lo que
  // respondió, cómo se sintió, lo técnico— está a un clic, pero no le quita
  // altura al chat mientras se atiende a la persona.
  // Arranca en el chat en cada opinión: la ficha se remonta al cambiar de fila
  // (lleva `key`), así que no hay que reponerla a mano.
  const [tab, setTab] = useState<'chat' | 'info'>('chat')

  return (
    <motion.div
      // En escritorio entra solo con opacidad: desplazar la ficha mientras sus
      // hijos animan `layout` (las burbujas del hilo) es lo que hacía que la
      // caja de escribir y los mensajes se acomodaran a la vista al abrir. En
      // móvil sí sube, porque ahí la ficha es una capa que llega de abajo.
      initial={reduce || wide ? { opacity: 0 } : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
      className={cn(
        'flex flex-col bg-bg',
        // Móvil: capa a pantalla completa. Escritorio: columna de la rejilla, a
        // toda la altura disponible — la conversación es lo que se viene a hacer
        // aquí, y merece la pantalla entera, no el hueco que sobre.
        'fixed inset-0 z-50',
        'lg:static lg:z-auto lg:h-full lg:min-h-0 lg:rounded-2xl lg:border lg:border-line lg:bg-surface',
      )}
    >
      {/* ── Cabecera: quién, qué y el estado. Fija; lo que scrollea es el
             contenido de la pestaña, nunca la ficha entera. ── */}
      <div className="shrink-0 border-b border-line px-3 py-2.5 sm:px-4 lg:rounded-t-2xl lg:px-5">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-subtle hover:text-text lg:hidden"
            aria-label={t('common.back', 'Volver')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[17px] lg:flex"
            style={{ background: `${meta.color}1f` }}
          >
            {meta.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold leading-tight text-text">
              {r.display_name ?? t('admin.site_feedback.user_fallback', 'Usuario')}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] leading-tight text-text-muted">
              <span>{t(`site_feedback.kind.${r.kind}.label`)}</span>
              <span>·</span>
              <span className="truncate">{fmtFullDate(r.created_at)}</span>
              {isSuperAdmin && r.campaign_name && (
                <>
                  <span>·</span>
                  <span className="truncate">{r.campaign_name}</span>
                </>
              )}
            </p>
          </div>

          {/* El estado se cambia desde aquí, valga la pestaña en la que se esté:
              mover el estado es la otra mitad del trabajo, junto con responder. */}
          <StatusMenu
            status={r.status}
            onPick={(s) => onPatch(r.id, { status: s })}
          />

          <button
            onClick={onClose}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-subtle hover:text-text lg:inline-flex"
            aria-label={t('site_feedback.close', 'Cerrar')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-1">
          <Tab active={tab === 'chat'} onClick={() => setTab('chat')} badge={summary.replies || undefined}>
            <MessageSquare className="h-3.5 w-3.5" />
            {t('admin.site_feedback.sec_thread', 'Conversación')}
          </Tab>
          <Tab
            active={tab === 'info'}
            onClick={() => setTab('info')}
            badge={r.shots?.length || undefined}
          >
            <ListFilter className="h-3.5 w-3.5" />
            {t('admin.site_feedback.tab_info', 'Detalle')}
          </Tab>
          {r.contact_ok && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-1 text-[10.5px] font-semibold text-red-400">
              <Phone className="h-3 w-3" />
              {t('admin.site_feedback.wants_contact', 'Contactar')}
            </span>
          )}
        </div>
      </div>

      {/* ── Cuerpo: una sola zona con scroll, la de la pestaña abierta ── */}
      <div className="relative min-h-0 flex-1">
        {/* El chat NO se desmonta al mirar el detalle: así no se vuelve a pedir
            el hilo ni se pierde lo que se estaba escribiendo. Oculto de verdad
            (display:none), que es lo que impide que cuente como "visto". */}
        {/* En móvil la ficha va sobre el fondo de la app, y los aros que separan
            avatares e hitos son del color de la superficie: el hilo necesita una
            debajo. En escritorio la ficha ya es una tarjeta. */}
        <div className={cn(
          'h-full bg-surface p-3 sm:p-4 lg:bg-transparent lg:p-5',
          tab !== 'chat' && 'hidden',
        )}>
          <FeedbackThread
            row={r}
            variant="staff"
            fill
            showOrigin
            reloadKey={threadKey}
            onPosted={(e) => onThreadPosted(r.id, e.author_id === user?.id, e.type === 'note')}
            onRead={() => onThreadRead(r.id)}
          />
        </div>

        {/* Solo entrada, sin AnimatePresence: una salida a medias aquí dentro es
            justo lo que dejaba la columna en blanco al saltar a otra opinión.
            Volver a la conversación es instantáneo, que es lo que uno quiere. */}
        {tab === 'info' && (
          <motion.div
            key="info"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="absolute inset-0 space-y-4 overflow-y-auto bg-surface p-3 pb-10 sm:p-4 lg:rounded-b-2xl lg:p-5"
          >
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
                'whitespace-pre-wrap rounded-xl border border-line bg-subtle/40 px-4 py-3.5 text-[14.5px] leading-[1.65]',
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

            <p className="text-[11.5px] text-text-subtle">
              {t('admin.site_feedback.status_hint', 'Cada cambio queda escrito en la conversación, con tu nombre y la hora.')}
              {r.handled_by_name
                ? ` · ${t('admin.site_feedback.handled_by', 'Última gestión: {{name}}', { name: r.handled_by_name })}`
                : ''}
            </p>

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
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}

/* ═══════════════════════ Piezas sueltas ═══════════════════════ */

/**
 * Número y etiqueta en una línea, y además el filtro que le corresponde. Lo que
 * antes eran cinco tarjetas de solo mirar ahora es la barra desde la que se
 * trabaja —y ocupa una cuarta parte de la altura.
 */
function StatPill({ label, value, color, active, onClick }: {
  label: string
  value: number
  color?: string
  active: boolean
  onClick: () => void
}) {
  const reduce = useReducedMotion()
  const tone = color ?? 'rgb(var(--brand-green))'
  return (
    <motion.button
      onClick={onClick}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      className={cn(
        'relative inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition-colors',
        active ? '' : 'hover:bg-subtle/70',
      )}
      style={active ? { background: `${tone}14` } : undefined}
      aria-pressed={active}
    >
      {/* Varias píldoras pueden estar puestas a la vez (sin resolver + piden
          contacto, p. ej.), así que el aro es de cada una y no uno que viaja. */}
      <motion.span
        aria-hidden
        className="absolute inset-0 rounded-xl border"
        initial={false}
        animate={{ opacity: active ? 1 : 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        style={{ borderColor: `${tone}59` }}
      />
      <span
        className="relative text-[15px] font-bold leading-none tabular-nums"
        // Los tokens son tripletes RGB: sin `rgb(...)` alrededor no pintan nada.
        style={{ color: value > 0 || active ? tone : 'rgb(var(--text-muted))' }}
      >
        {value}
      </span>
      <span className={cn(
        'relative whitespace-nowrap text-[11px] uppercase tracking-wider transition-colors',
        active ? 'text-text' : 'text-text-muted',
      )}>
        {label}
      </span>
    </motion.button>
  )
}

/**
 * Todos los filtros finos detrás de un botón. Se abren cuando hacen falta y se
 * van cuando no: la bandeja no puede gastar tres renglones en catorce chips que
 * casi nadie toca, con la conversación esperando debajo.
 */
function FiltersMenu({
  count, status, statusChips, kind, byKind, awaitingOnly, awaitingCount, contactOnly,
  onStatus, onKind, onAwaiting, onContact, onReset,
}: {
  count: number
  status: StatusFilter
  statusChips: { key: StatusFilter; label: string; color?: string }[]
  kind: FeedbackKind | 'all'
  byKind: Record<string, number>
  awaitingOnly: boolean
  awaitingCount: number
  contactOnly: boolean
  onStatus: (s: StatusFilter) => void
  onKind: (k: FeedbackKind | 'all') => void
  onAwaiting: (v: boolean) => void
  onContact: (v: boolean) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Se cierra al elegir fuera o con Escape, como cualquier menú del sistema.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12.5px] font-medium transition-colors',
          open || count > 0
            ? 'border-[rgb(var(--brand-green))]/40 bg-[rgb(var(--brand-green))]/[0.08] text-[rgb(var(--brand-green))]'
            : 'border-line text-text-muted hover:bg-subtle hover:text-text',
        )}
        aria-expanded={open}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {t('admin.site_feedback.filters', 'Filtros')}
        {count > 0 && (
          <span className="rounded-full bg-[rgb(var(--brand-green))]/20 px-1.5 text-[11px] font-bold tabular-nums">
            {count}
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-300', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="absolute left-0 top-full z-30 mt-2 w-[min(24rem,calc(100vw-2.5rem))] origin-top-left rounded-2xl border border-line bg-surface p-3.5 shadow-2xl shadow-black/25"
          >
            <FilterGroup title={t('admin.site_feedback.f_status', 'Estado')}>
              {statusChips.map((c) => (
                <FilterChip key={c.key} active={status === c.key} color={c.color} onClick={() => onStatus(c.key)}>
                  {c.label}
                </FilterChip>
              ))}
            </FilterGroup>

            <FilterGroup title={t('admin.site_feedback.f_kind', 'Tipo')}>
              <FilterChip active={kind === 'all'} onClick={() => onKind('all')}>
                {t('admin.site_feedback.kind_all', 'Todo tipo')}
              </FilterChip>
              {KINDS.map((k) => (
                <FilterChip
                  key={k.key}
                  active={kind === k.key}
                  color={k.color}
                  onClick={() => onKind(kind === k.key ? 'all' : k.key)}
                >
                  <span className="mr-1">{k.emoji}</span>
                  {t(`site_feedback.kind.${k.key}.label`)}
                  <span className="ml-1 tabular-nums opacity-70">{byKind[k.key] || 0}</span>
                </FilterChip>
              ))}
            </FilterGroup>

            <FilterGroup title={t('admin.site_feedback.f_more', 'Además')}>
              <FilterChip active={awaitingOnly} color="#38bdf8" onClick={() => onAwaiting(!awaitingOnly)}>
                <MessageSquare className="mr-1 inline h-3 w-3" />
                {t('admin.site_feedback.only_awaiting', 'Esperan respuesta')}
                <span className="ml-1 tabular-nums opacity-70">{awaitingCount}</span>
              </FilterChip>
              <FilterChip active={contactOnly} color="#ef4444" onClick={() => onContact(!contactOnly)}>
                <Phone className="mr-1 inline h-3 w-3" />
                {t('admin.site_feedback.only_contact', 'Piden contacto')}
              </FilterChip>
            </FilterGroup>

            <div className="mt-3 flex items-center justify-between border-t border-line/70 pt-2.5">
              <button
                onClick={onReset}
                disabled={count === 0}
                className="text-[12px] font-medium text-text-muted transition-colors hover:text-text disabled:opacity-40"
              >
                {t('admin.site_feedback.f_clear', 'Quitar todos')}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg px-2.5 py-1 text-[12px] font-semibold text-[rgb(var(--brand-green))] transition-colors hover:bg-[rgb(var(--brand-green))]/10"
              >
                {t('common.done', 'Listo')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">{title}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

/** Pestañas de la ficha: la conversación primero, el expediente al lado. */
function Tab({ active, badge, onClick, children }: {
  active: boolean
  badge?: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors',
        active ? 'text-text' : 'text-text-muted hover:text-text',
      )}
    >
      {active && (
        <motion.span
          layoutId="feedback-tab"
          className="absolute inset-0 rounded-lg bg-subtle"
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      <span className="relative inline-flex items-center gap-1.5">
        {children}
        {badge ? (
          <span className="rounded-full bg-line/70 px-1.5 text-[10.5px] tabular-nums text-text-muted">
            {badge}
          </span>
        ) : null}
      </span>
    </button>
  )
}

/**
 * El estado, donde se necesita: en la cabecera de la ficha. Antes vivía al final
 * de un scroll largo, así que cambiarlo costaba encontrarlo primero.
 */
function StatusMenu({ status, onPick }: {
  status: FeedbackStatus
  onPick: (s: FeedbackStatus) => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full transition-opacity hover:opacity-80"
        aria-expanded={open}
        title={t('admin.site_feedback.manage', 'Gestión')}
      >
        <StatusPill status={status} />
        <ChevronDown className={cn('h-3.5 w-3.5 text-text-muted transition-transform duration-300', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="absolute right-0 top-full z-30 mt-2 w-56 origin-top-right rounded-2xl border border-line bg-surface p-1.5 shadow-2xl shadow-black/25"
          >
            <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
              {t('admin.site_feedback.manage', 'Gestión')}
            </p>
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => { setOpen(false); onPick(s) }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors hover:bg-subtle',
                  status === s ? 'font-semibold text-text' : 'text-text-muted',
                )}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                {t(`site_feedback.status.${s}`)}
                {status === s && <Check className="ml-auto h-3.5 w-3.5 text-[rgb(var(--brand-green))]" />}
              </button>
            ))}
            <p className="border-t border-line/70 px-2 pb-1 pt-2 text-[11px] leading-snug text-text-subtle">
              {t('admin.site_feedback.status_hint', 'Cada cambio queda escrito en la conversación, con tu nombre y la hora.')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
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
