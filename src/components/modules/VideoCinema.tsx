/**
 * Modo cine: la vista de un módulo que es solo video.
 *
 * La vista normal apila las secciones una debajo de otra, y con puro video eso
 * es una fila de reproductores sueltos: el aprendiz no sabe cuántos faltan, ni
 * cuánto duran, ni por dónde iba. Aquí hay UN escenario y una lista al lado —
 * un video suena a la vez, el siguiente empieza solo cuando el anterior TERMINA
 * (nunca antes; ver `lib/videoBus`), y la lista lleva la cuenta de lo visto.
 *
 * Lo que no está aquí: la compuerta de los quizzes de video, que sigue viviendo
 * dentro del reproductor. Esta pantalla la refleja en la lista (candados y
 * capítulos), pero no la decide.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Film,
  ListVideo,
  Lock,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { RichTextInline } from '@/components/ui/RichText'
import { InteractiveVideoModule, type VideoPlayerState } from './InteractiveVideoModule'
import { buildVideoPlaylist, type PlaylistItem } from '@/lib/videoPlaylist'
import { getAutoplayNext, setAutoplayNext, subscribeAutoplayNext } from '@/lib/videoBus'
import { isVideoQuizPassed } from '@/types/blocks'
import type { LearningModule } from '@/data/modules'
import type { Language } from '@/stores/userStore'

interface Props {
  module: LearningModule
  language: Language
  userId?: string
  campaignId?: string
  moduleId: string
  /** Intentos guardados por unidad (`sección__VIDEO_QUIZ__marcador`). */
  attemptByUnit: Map<string, any>
  /** Pie de página del módulo (pendientes, completar, siguiente): lo pone la página. */
  children?: React.ReactNode
}

const EASE = [0.16, 1, 0.3, 1] as const

function formatTime(s: number): string {
  if (!s || !isFinite(s)) return '--:--'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* incógnito o cuota llena: se pierde al cerrar, no es crítico */ }
}

export function VideoCinema({ module, language, userId, campaignId, moduleId, attemptByUnit, children }: Props) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const items = useMemo(() => buildVideoPlaylist(module, language), [module, language])

  const [activeIndex, setActiveIndex] = useState(0)
  const [focusMode, setFocusMode] = useState(false)
  const [playerState, setPlayerState] = useState<VideoPlayerState | null>(null)
  const [autoNext, setAutoNext] = useState(getAutoplayNext)
  // Verificaciones respondidas EN ESTA SESIÓN. Cambiar de video destruye el
  // reproductor y con él su memoria, y los intentos de la base se cargaron al
  // abrir el módulo: sin esto, un quiz recién hecho volvía a salir al regresar al
  // video y otro ya hecho parecía perdido. Se indexa con la MISMA clave que la
  // base (`sección__VIDEO_QUIZ__marcador`) porque los ids de marcador solo son
  // únicos dentro de su video: dos videos clonados pueden repetirlos.
  const [sessionQuizResults, setSessionQuizResults] = useState<Record<string, { score: number; total: number }>>({})
  const seekRef = useRef<((seconds: number) => void) | null>(null)
  const retryRef = useRef<((markerId: string) => void) | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  // Solo se enciende al encadenar: montar la pantalla nunca arranca un video.
  const chainRef = useRef(false)

  const active = items[activeIndex]

  // ── Lo ya visto y lo que dura cada video ──
  // Vive en el navegador a propósito: es comodidad de reproducción (marcar la
  // lista, saber cuánto falta), no progreso académico. Lo que cuenta para el
  // módulo son los intentos de los quizzes, que sí van a la base.
  const watchedKey = `cinema_watched_${moduleId}`
  const durationsKey = `cinema_durations_${moduleId}`
  const [watched, setWatched] = useState<string[]>(() => readJson<string[]>(watchedKey, []))
  const [durations, setDurations] = useState<Record<string, number>>(() => readJson(durationsKey, {}))

  const markWatched = useCallback((key: string) => {
    setWatched((prev) => {
      if (prev.includes(key)) return prev
      const next = [...prev, key]
      writeJson(watchedKey, next)
      return next
    })
  }, [watchedKey])

  useEffect(() => subscribeAutoplayNext(setAutoNext), [])

  // La duración solo se conoce cuando el video se abre; se recuerda para que la
  // lista pueda mostrarla la próxima vez sin cargar nada.
  useEffect(() => {
    const dur = playerState?.duration ?? 0
    if (!active || dur <= 0) return
    setDurations((prev) => {
      if (Math.abs((prev[active.key] ?? 0) - dur) < 1) return prev
      const next = { ...prev, [active.key]: dur }
      writeJson(durationsKey, next)
      return next
    })
  }, [playerState?.duration, active, durationsKey])

  // ── Subtítulos del video activo: alimentan la pestaña de transcripción ──
  // Se respeta el idioma que la persona eligió en el reproductor; si este video
  // no lo tiene, el del sitio, y si tampoco, el español.

  // ── Navegación entre videos ──
  const goTo = useCallback((index: number, chain = false) => {
    if (index < 0 || index >= items.length) return
    chainRef.current = chain
    setPlayerState(null)
    setActiveIndex(index)
    // Al saltar a otro video, el escenario vuelve a quedar a la vista: en un
    // módulo largo la lista lateral puede estar muy por debajo del reproductor.
    if (!chain) {
      requestAnimationFrame(() => {
        stageRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      })
    }
  }, [items.length])

  // Enlaces `#section-N`: los usa la lista de actividades pendientes y la vista
  // previa del panel. En la vista normal el navegador encuentra la sección solita;
  // aquí no existe como elemento, así que el salto se traduce a "abrí ese video".
  useEffect(() => {
    const jump = () => {
      const m = /^#section-(\d+)$/.exec(window.location.hash)
      if (!m) return
      const idx = items.findIndex((it) => it.sectionIndex === Number(m[1]))
      if (idx >= 0) goTo(idx)
    }
    jump()
    window.addEventListener('hashchange', jump)
    return () => window.removeEventListener('hashchange', jump)
  }, [items, goTo])

  const handleEnded = useCallback(() => {
    if (active) markWatched(active.key)
  }, [active, markWatched])

  const nextItem = items[activeIndex + 1]
  const nextUp = useMemo(
    () => (nextItem ? { title: nextItem.title, start: () => goTo(activeIndex + 1, true) } : null),
    [nextItem, activeIndex, goTo],
  )

  // Resultados guardados de los quizzes del video activo, con la misma clave que
  // usa el registro de intentos.
  const savedQuizResults = useMemo(() => {
    if (!active?.sectionId) return undefined
    const out: Record<string, { score: number; total: number }> = {}
    for (const m of active.markers) {
      if (m.type !== 'quiz') continue
      const at = attemptByUnit.get(`${active.sectionId}__VIDEO_QUIZ__${m.id}`)
      const sa = at?.submitted_answers
      if (sa) {
        out[m.id] = {
          score: typeof sa.aciertos === 'number' ? sa.aciertos : 0,
          total: typeof sa.total === 'number' ? sa.total : (m.questions?.length ?? 0),
        }
      }
      // Lo respondido en esta sesión manda: es más nuevo que lo que trajo la base.
      const fresh = sessionQuizResults[`${active.sectionId}__VIDEO_QUIZ__${m.id}`]
      if (fresh) out[m.id] = fresh
    }
    return out
  }, [active, attemptByUnit, sessionQuizResults])

  /** Notas de TODOS los videos, para que la lista lateral las muestre sin
   *  depender de que ese video sea el que se está viendo. */
  const quizResultsByMarker = useMemo(() => {
    const out: Record<string, { score: number; total: number }> = {}
    for (const it of items) {
      for (const m of it.markers) {
        if (m.type !== 'quiz' || !it.sectionId) continue
        const sa = attemptByUnit.get(`${it.sectionId}__VIDEO_QUIZ__${m.id}`)?.submitted_answers
        if (sa) {
          out[m.id] = {
            score: typeof sa.aciertos === 'number' ? sa.aciertos : 0,
            total: typeof sa.total === 'number' ? sa.total : (m.questions?.length ?? 0),
          }
        }
        const fresh = sessionQuizResults[`${it.sectionId}__VIDEO_QUIZ__${m.id}`]
        if (fresh) out[m.id] = fresh
      }
    }
    return out
  }, [items, attemptByUnit, sessionQuizResults])

  // ── Cifras de cabecera ──
  const knownDuration = items.reduce((acc, it) => acc + (durations[it.key] ?? 0), 0)
  const allKnown = items.every((it) => durations[it.key])
  const watchedCount = items.filter((it) => watched.includes(it.key)).length
  const donePct = items.length > 0 ? Math.round((watchedCount / items.length) * 100) : 0
  const totalChecks = items.reduce((acc, it) => acc + it.quizCount, 0)

  if (items.length === 0 || !active) return null

  return (
    <div className="space-y-6">
      {/* ── Barra de estado del módulo ── */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="rounded-2xl border border-line bg-subtle/60 px-5 py-3.5"
      >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-text">
          <Film className="h-4 w-4 text-neon-green" />
          {t('cinema.videos_count', { count: items.length })}
        </span>
        {(knownDuration > 0) && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-text-muted">
            <Clock className="h-3.5 w-3.5" />
            {allKnown ? formatTime(knownDuration) : t('cinema.duration_partial', { time: formatTime(knownDuration) })}
          </span>
        )}
        {totalChecks > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-text-muted">
            <ClipboardList className="h-3.5 w-3.5" />
            {t('cinema.checks_count', { count: totalChecks })}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:block h-1.5 w-28 overflow-hidden rounded-full bg-glass-border/20">
            <motion.div
              className="h-full rounded-full bg-neon-green"
              initial={false}
              animate={{ width: `${donePct}%` }}
              transition={{ duration: 0.6, ease: EASE }}
            />
          </div>
          <span className="text-[12px] font-semibold tabular-nums text-text-muted">
            {t('cinema.watched_of', { done: watchedCount, total: items.length })}
          </span>
        </div>
      </div>

      {/* Por qué este módulo se ve así. Antes cada video era una sección aparte y
          el cambio desconcierta si nadie lo explica. */}
      <p className="mt-3 border-t border-line/70 pt-3 text-[12px] leading-relaxed text-text-subtle">
        {totalChecks > 0 ? t('cinema.how_it_works_checks') : t('cinema.how_it_works')}
      </p>
      </motion.div>

      {/* ── Escenario + lista ── */}
      <div
        ref={stageRef}
        className={cn(
          'grid gap-6 scroll-mt-24',
          focusMode ? 'grid-cols-1' : 'lg:grid-cols-[minmax(0,1fr)_360px]',
        )}
      >
        {/* Escenario */}
        <div className="min-w-0">
          {/* Resplandor ambiental detrás del reproductor: da profundidad sin
              robar atención (y desaparece con "reducir movimiento"). */}
          <div className="relative">
            {!reduce && (
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-x-6 -top-4 bottom-6 -z-10 rounded-[2rem] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(16,212,81,0.16),transparent_70%)] blur-2xl"
              />
            )}

            <AnimatePresence initial={false}>
              <motion.div
                key={active.key}
                initial={reduce ? false : { opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                <InteractiveVideoModule
                  section={active.section}
                  language={language}
                  userId={userId}
                  campaignId={campaignId}
                  moduleId={moduleId}
                  savedQuizResults={savedQuizResults}
                  title={active.title}
                  hideChapters
                  autoPlayOnReady={chainRef.current}
                  nextUp={nextUp}
                  onEnded={handleEnded}
                  onQuizGraded={(markerId, result) =>
                    setSessionQuizResults((prev) => ({
                      ...prev,
                      [`${active.sectionId}__VIDEO_QUIZ__${markerId}`]: result,
                    }))}
                  onState={setPlayerState}
                  seekRef={seekRef}
                  retryRef={retryRef}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Ficha del video activo */}
          <div className="mt-5">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-subtle">
                  {t('cinema.video_n_of_m', { n: activeIndex + 1, total: items.length })}
                </p>
                <h2 className="mt-1.5 text-[clamp(1.25rem,1.6vw+0.7rem,1.7rem)] font-bold leading-tight tracking-[-0.02em] text-text text-balance">
                  {active.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setFocusMode((f) => !f)}
                title={focusMode ? t('cinema.show_list') : t('cinema.focus_mode')}
                className="hidden lg:inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-[12px] font-medium text-text-muted transition-colors hover:border-neon-green/40 hover:text-text"
              >
                {focusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                {focusMode ? t('cinema.show_list') : t('cinema.focus_mode')}
              </button>
            </div>

            <div className="pt-5">
              {active.description.length > 0 ? (
                <div className="space-y-4 max-w-[68ch]">
                  {active.description.map((p, i) => (
                    <p key={i} className="whitespace-pre-line text-[15.5px] leading-[1.8] text-text/90">
                      <RichTextInline text={p} />
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-text-subtle">{t('cinema.no_description')}</p>
              )}
            </div>

            {/* Anterior / siguiente, para quien no quiere ir a la lista */}
            <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-4">
              <button
                type="button"
                disabled={activeIndex === 0}
                onClick={() => goTo(activeIndex - 1)}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:text-text disabled:pointer-events-none disabled:opacity-35"
              >
                <ChevronLeft className="h-4 w-4" /> {t('cinema.previous')}
              </button>
              <button
                type="button"
                disabled={activeIndex >= items.length - 1}
                onClick={() => goTo(activeIndex + 1)}
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-medium text-text-muted transition-colors hover:text-text disabled:pointer-events-none disabled:opacity-35"
              >
                {t('cinema.next')} <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Lista lateral ── */}
        <AnimatePresence initial={false}>
          {!focusMode && (
            <motion.aside
              key="rail"
              initial={reduce ? false : { opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? undefined : { opacity: 0, x: 18 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="lg:sticky lg:top-24 lg:self-start"
            >
              {/* En pantalla ancha la lista se queda pegada y scrollea por
                  dentro; en celular fluye con la página — un panel con scroll
                  propio dentro de una página que también scrollea es una trampa
                  con el dedo. */}
              <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-subtle/40 lg:max-h-[calc(100vh-8rem)]">
                <div className="shrink-0 border-b border-line px-4 py-3.5">
                  <div className="flex items-center gap-2">
                    <ListVideo className="h-4 w-4 text-text-muted" />
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      {t('cinema.playlist')}
                    </p>
                    <span className="ml-auto text-[11px] tabular-nums text-text-subtle">{donePct}%</span>
                  </div>
                  <label className="mt-3 flex cursor-pointer items-center gap-2.5">
                    <span className={cn(
                      'relative h-4 w-7 shrink-0 rounded-full transition-colors duration-300',
                      autoNext ? 'bg-neon-green/80' : 'bg-glass-border/30',
                    )}>
                      <motion.span
                        className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow"
                        animate={{ left: autoNext ? 14 : 2 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                      />
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={autoNext}
                      onChange={(e) => setAutoplayNext(e.target.checked)}
                    />
                    <span className="text-[12px] text-text-muted">{t('cinema.autoplay_label')}</span>
                  </label>
                </div>

                <div className="custom-scrollbar min-h-0 flex-1 py-1.5 lg:overflow-y-auto">
                  {items.map((item, i) => (
                    <PlaylistRow
                      key={item.key}
                      item={item}
                      index={i}
                      active={i === activeIndex}
                      watched={watched.includes(item.key)}
                      duration={durations[item.key]}
                      state={i === activeIndex ? playerState : null}
                      language={language}
                      quizResults={quizResultsByMarker}
                      onSelect={() => goTo(i)}
                      onSeek={(secs) => seekRef.current?.(secs)}
                      onRetryQuiz={i === activeIndex ? (markerId) => retryRef.current?.(markerId) : undefined}
                    />
                  ))}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {children}
    </div>
  )
}

/* ── Fila de la lista: el video, y sus capítulos cuando es el que se ve ── */

function PlaylistRow({
  item, index, active, watched, duration, state, language, quizResults, onSelect, onSeek, onRetryQuiz,
}: {
  item: PlaylistItem
  index: number
  active: boolean
  watched: boolean
  duration?: number
  state: VideoPlayerState | null
  language: Language
  /** Notas de las verificaciones de todos los videos (markerId → nota). */
  quizResults: Record<string, { score: number; total: number }>
  onSelect: () => void
  onSeek: (seconds: number) => void
  /** Solo el video que se está viendo puede repetir una verificación. */
  onRetryQuiz?: (markerId: string) => void
}) {
  const { t } = useTranslation()
  const lang = language as 'es' | 'en' | 'pt'
  const chapters = [...item.markers].sort((a, b) => a.timeSeconds - b.timeSeconds)
  const quizzes = chapters.filter((c) => c.type === 'quiz')
  const quizzesDone = quizzes.filter((c) => isVideoQuizPassed(quizResults[c.id])).length
  const pct = active && state && state.duration > 0
    ? Math.min(100, (state.currentTime / state.duration) * 100)
    : watched ? 100 : 0

  return (
    <div>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'group relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
          active ? 'bg-neon-green/[0.07]' : 'hover:bg-glass/10',
        )}
      >
        {/* Marca del que se está viendo: se desliza de una fila a otra. */}
        {active && (
          <motion.span
            layoutId="cinema-active-bar"
            className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-neon-green"
            transition={{ duration: 0.32, ease: EASE }}
          />
        )}

        <span className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10.5px] font-bold transition-colors',
          watched
            ? 'bg-neon-green/15 text-neon-green'
            : active
              ? 'bg-neon-green text-black'
              : 'bg-glass-border/12 text-text-subtle',
        )}>
          {watched ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : active ? <Play className="h-3 w-3 ml-px" /> : index + 1}
        </span>

        <span className="min-w-0 flex-1">
          <span className={cn(
            'block text-[13px] font-medium leading-snug line-clamp-2',
            active ? 'text-text' : 'text-text-muted group-hover:text-text',
          )}>
            {item.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-mono text-[11px] tabular-nums text-text-subtle">
              {duration ? formatTime(duration) : '--:--'}
            </span>
            {/* Verificaciones: cuántas hay y cuántas van aprobadas. Sin el "de N"
                el número solo se leía como un adorno. */}
            {item.quizCount > 0 && (
              <span className={cn(
                'inline-flex items-center gap-1 text-[10.5px] font-medium',
                quizzesDone >= item.quizCount ? 'text-neon-green' : 'text-amber-500',
              )}>
                <ClipboardList className="h-2.5 w-2.5" />
                {t('cinema.checks_done', { done: quizzesDone, total: item.quizCount })}
              </span>
            )}
            {chapters.filter((c) => c.type === 'chapter').length > 0 && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-text-subtle">
                <BookOpen className="h-2.5 w-2.5" />
                {chapters.filter((c) => c.type === 'chapter').length}
              </span>
            )}
          </span>
          {/* Barra de avance del video (o llena si ya se vio entero) */}
          {(pct > 0) && (
            <span className="mt-2 block h-0.5 w-full overflow-hidden rounded-full bg-glass-border/20">
              <span
                className={cn('block h-full rounded-full', watched ? 'bg-neon-green/50' : 'bg-neon-green')}
                style={{ width: `${pct}%` }}
              />
            </span>
          )}
        </span>
      </button>

      {/* Capítulos del video que se está viendo. Se despliegan aquí para que la
          lista lateral sea una sola cosa: los videos y lo que hay dentro. */}
      <AnimatePresence initial={false}>
        {active && chapters.length > 0 && (
          <motion.div
            key="chapters"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 border-l border-line/70 ml-[30px] mr-3 pl-2 py-1">
              {chapters.map((m, ci) => {
                const gate = state?.gateTime ?? null
                const locked = gate != null && m.timeSeconds > gate
                const isQuiz = m.type === 'quiz'
                // La nota sale del reproductor si este es el video activo, y si no
                // de lo acumulado (base + sesión), para que la lista nunca mienta.
                const result = isQuiz ? (state?.completedQuizzes?.[m.id] ?? quizResults[m.id]) : undefined
                const passed = isVideoQuizPassed(result)
                const isActive = state ? ci === state.activeChapterIdx : false
                return (
                  <div key={m.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => onSeek(m.timeSeconds)}
                      title={locked ? t('video.locked_hint') : undefined}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors',
                        locked
                          ? 'cursor-not-allowed opacity-45'
                          : isActive
                            ? 'bg-glass/15 text-text'
                            : 'text-text-muted hover:bg-glass/10 hover:text-text',
                      )}
                    >
                      {locked
                        ? <Lock className="h-3 w-3 shrink-0 text-text-subtle" />
                        : isQuiz
                          ? <ClipboardList className={cn('h-3 w-3 shrink-0', passed ? 'text-neon-green' : 'text-amber-500')} />
                          : <BookOpen className="h-3 w-3 shrink-0 text-text-subtle" />}
                      <span className="min-w-0 flex-1 truncate text-[12px] leading-snug">
                        {m.title[lang] || m.title.es}
                      </span>
                      {/* La nota, a la vista: el aprendiz sabe cuál le falta. */}
                      {result && (
                        <span className={cn(
                          'shrink-0 font-mono text-[10.5px] tabular-nums',
                          passed ? 'text-neon-green' : 'text-amber-500',
                        )}>
                          {result.score}/{result.total}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-text-subtle">
                        {formatTime(m.timeSeconds)}
                      </span>
                    </button>

                    {/* Repetir la verificación sin rebobinar. En modo cine la lista
                        interna del reproductor no se pinta, así que este es el
                        único camino que tiene el aprendiz. */}
                    {isQuiz && !locked && onRetryQuiz && (
                      <button
                        type="button"
                        onClick={() => onRetryQuiz(m.id)}
                        title={t('cinema.retry_check')}
                        aria-label={t('cinema.retry_check')}
                        className="shrink-0 rounded-lg p-1.5 text-text-subtle transition-colors hover:bg-glass/15 hover:text-neon-green"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
