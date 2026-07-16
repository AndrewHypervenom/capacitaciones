import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useAnimation } from 'framer-motion'
import { Bell, BellRing, RotateCcw, Check, CheckCheck, MessageSquare, Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { useNotificationsStore } from '@/stores/notificationsStore'
import { notificationText } from '@/lib/notificationText'
import type { AppNotification } from '@/services/notifications.service'

type Filter = 'all' | 'unread'
type GroupKey = 'today' | 'week' | 'earlier'

const EASE = [0.16, 1, 0.3, 1] as const

/** Clasifica una notificación en un grupo temporal según su antigüedad. */
function groupOf(iso: string): GroupKey {
  const now = new Date()
  const d = new Date(iso)
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return 'today'
  const diffDays = (now.getTime() - d.getTime()) / 86_400_000
  return diffDays <= 7 ? 'week' : 'earlier'
}

/**
 * Campana de notificaciones del aprendiz: contador de no leídas + dropdown con la
 * lista. Los restablecimientos ya se aplican a la caché local desde
 * useResetNotifications (montado en AppShell); aquí solo se muestran y se marcan
 * como leídos. Se coloca en el sidebar del panel aprendiz y en el Navbar global.
 *
 * UX: la campana "suena" (se sacude) cuando llega una notificación nueva, el badge
 * hace un pop elástico, y la lista entra escalonada, agrupada por antigüedad, con
 * acción de marcar como leído por elemento.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const items = useNotificationsStore((s) => s.items)
  const markRead = useNotificationsStore((s) => s.markRead)
  const markAllRead = useNotificationsStore((s) => s.markAllRead)

  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const unread = items.filter((n) => !n.read_at).length

  // ── Campana que "suena" cuando aumenta el número de no leídas ──────────────
  const bellControls = useAnimation()
  const prevUnread = useRef(unread)
  useEffect(() => {
    if (unread > prevUnread.current) {
      void bellControls.start({
        rotate: [0, -14, 12, -10, 8, -5, 0],
        transition: { duration: 0.7, ease: 'easeInOut' },
      })
    }
    prevUnread.current = unread
  }, [unread, bellControls])

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const margin = 8
    const width = Math.min(380, window.innerWidth - 16)
    // Por defecto alineamos el borde derecho del panel con el del botón (se abre
    // hacia la izquierda). Si no cabe por ese lado (botón cerca del borde
    // izquierdo, p. ej. en el sidebar del aprendiz), lo alineamos por la izquierda.
    let left = r.right - width
    if (left < margin) left = Math.min(r.left, window.innerWidth - width - margin)
    left = Math.max(margin, left)
    setPos({ top: r.bottom + 8, left })
  }, [open])

  // Cerrar al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' }) +
    ' · ' +
    new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })

  // Lista filtrada + agrupada por antigüedad, preservando el orden (desc).
  const groups = useMemo(() => {
    const visible = filter === 'unread' ? items.filter((n) => !n.read_at) : items
    const order: GroupKey[] = ['today', 'week', 'earlier']
    const buckets: Record<GroupKey, AppNotification[]> = { today: [], week: [], earlier: [] }
    for (const n of visible) buckets[groupOf(n.created_at)].push(n)
    return order
      .filter((k) => buckets[k].length > 0)
      .map((k) => ({ key: k, items: buckets[k] }))
  }, [items, filter])

  const isEmpty = groups.length === 0
  let flatIndex = -1 // para escalonar la entrada de los items entre grupos

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        aria-label={t('notifications.title')}
        className={cn(
          'group relative inline-flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-subtle hover:text-text',
          open && 'bg-subtle text-text',
          className,
        )}
      >
        {/* Halo pulsante cuando hay pendientes por leer */}
        {unread > 0 && !open && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full bg-primary/15"
            initial={{ scale: 0.6, opacity: 0.7 }}
            animate={{ scale: 1.4, opacity: 0 }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <motion.span animate={bellControls} style={{ transformOrigin: '50% 12%' }}>
          {unread > 0 ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        </motion.span>
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key={unread}
              initial={{ scale: 0, y: -2 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 600, damping: 18 }}
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-surface"
            >
              {unread > 9 ? '9+' : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.2, ease: EASE }}
              style={{ top: pos.top, left: pos.left, transformOrigin: 'top center' }}
              className="fixed z-[130] w-[min(380px,calc(100vw-16px))] overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg"
            >
              {/* Encabezado */}
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 pb-2 pt-3">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-text">
                    {t('notifications.title')}
                  </span>
                  <AnimatePresence>
                    {unread > 0 && (
                      <motion.span
                        key={unread}
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                        className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-semibold text-primary"
                      >
                        {t('notifications.unread_count', { count: unread })}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <AnimatePresence>
                  {unread > 0 && (
                    <motion.button
                      initial={{ opacity: 0, x: 6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 6 }}
                      onClick={() => void markAllRead()}
                      className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <CheckCheck className="h-3.5 w-3.5" /> {t('notifications.mark_all_read')}
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>

              {/* Filtros con indicador deslizante */}
              <div className="flex items-center gap-1 border-b border-line px-3 py-2">
                {(['all', 'unread'] as Filter[]).map((f) => {
                  const active = filter === f
                  return (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        'relative rounded-lg px-3 py-1 text-[12px] font-medium transition-colors',
                        active ? 'text-text' : 'text-text-muted hover:text-text',
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="notif-filter-pill"
                          className="absolute inset-0 rounded-lg bg-subtle"
                          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                        />
                      )}
                      <span className="relative">
                        {t(f === 'all' ? 'notifications.filter_all' : 'notifications.filter_unread')}
                        {f === 'unread' && unread > 0 && (
                          <span className="ml-1 text-primary">{unread}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Lista */}
              <div className="max-h-[min(60vh,440px)] overflow-y-auto overscroll-contain">
                {isEmpty ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center gap-2 px-4 py-10 text-center"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-text-subtle">
                      <Inbox className="h-6 w-6" />
                    </span>
                    <p className="text-[13px] text-text-muted">
                      {filter === 'unread' ? t('notifications.none_unread') : t('notifications.empty')}
                    </p>
                  </motion.div>
                ) : (
                  <AnimatePresence initial={false} mode="popLayout">
                    {groups.map((group) => (
                      <motion.div key={group.key} layout>
                        <div className="sticky top-0 z-10 bg-surface/85 px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle backdrop-blur">
                          {t(`notifications.group_${group.key}`)}
                        </div>
                        {group.items.map((n) => {
                          flatIndex += 1
                          const { title, body } = notificationText(n)
                          const isFeedback = n.kind === 'feedback'
                          return (
                            <motion.div
                              key={n.id}
                              layout
                              initial={{ opacity: 0, x: -12 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: 16, height: 0 }}
                              transition={{
                                duration: 0.28,
                                ease: EASE,
                                delay: Math.min(flatIndex, 8) * 0.035,
                              }}
                              className="group/item relative"
                            >
                              <button
                                onClick={() => {
                                  void markRead(n.id)
                                  if (isFeedback) {
                                    setOpen(false)
                                    navigate('/feedback')
                                  }
                                }}
                                className={cn(
                                  'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle',
                                  !n.read_at && 'bg-primary/[0.06]',
                                )}
                              >
                                {/* Barra de acento para no leídas */}
                                {!n.read_at && (
                                  <motion.span
                                    layoutId={`unread-bar-${n.id}`}
                                    className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary"
                                  />
                                )}
                                <span
                                  className={cn(
                                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                                    isFeedback
                                      ? 'bg-violet-500/12 text-violet-500'
                                      : 'bg-amber-500/12 text-amber-500',
                                  )}
                                >
                                  {isFeedback ? (
                                    <MessageSquare className="h-4 w-4" />
                                  ) : (
                                    <RotateCcw className="h-4 w-4" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-2">
                                    <span className="text-[13px] font-medium text-text">{title}</span>
                                    {!n.read_at && (
                                      <motion.span
                                        className="h-2 w-2 shrink-0 rounded-full bg-primary"
                                        animate={{ scale: [1, 1.35, 1], opacity: [1, 0.55, 1] }}
                                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                                      />
                                    )}
                                  </span>
                                  <span className="mt-0.5 block text-[12px] text-text-muted">{body}</span>
                                  <span className="mt-1 block text-[11px] text-text-subtle">
                                    {fmt(n.created_at)}
                                  </span>
                                </span>
                              </button>
                              {/* Acción rápida: marcar como leído (aparece al pasar el cursor) */}
                              {!n.read_at && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void markRead(n.id)
                                  }}
                                  aria-label={t('notifications.mark_read')}
                                  title={t('notifications.mark_read')}
                                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-surface/90 text-text-muted opacity-0 shadow-sm ring-1 ring-line transition-all hover:bg-primary/10 hover:text-primary focus:opacity-100 group-hover/item:opacity-100"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                              )}
                            </motion.div>
                          )
                        })}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
