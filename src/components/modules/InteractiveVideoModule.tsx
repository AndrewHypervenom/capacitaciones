import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  BookOpen,
  ClipboardList,
  ChevronDown,
  RotateCcw,
  LayoutList,
  Lock,
  SkipForward,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { VideoQuizOverlay, type QuizAnswerDetail } from './VideoQuizOverlay'
import { ConnectionBadge } from './ConnectionBadge'
import { useConnectionQuality } from '@/hooks/useConnectionQuality'
import { useVideoSeekGate } from '@/hooks/useVideoSeekGate'
import { buildVideoWatchId } from '@/lib/videoWatch'
import { YouTubePlayer } from './YouTubePlayer'
import { VimeoPlayer } from './VimeoPlayer'
import type { PlayerLike } from '@/lib/youtube'
import { saveActivityAttempt } from '@/services/activity.service'
import {
  announcePlaying,
  focusVideo,
  getAutoplayNext,
  nextVideoAfter,
  ownsKeyboard,
  registerVideo,
  setAutoplayNext,
  subscribeAutoplayNext,
} from '@/lib/videoBus'
import { isVideoQuizPassed } from '@/types/blocks'
import type { ModuleSection, VideoMarker, VideoQuizMarker } from '@/data/modules'
import type { Language } from '@/stores/userStore'

/** Lo que el reproductor le cuenta al contenedor en modo cine. */
export interface VideoPlayerState {
  currentTime: number
  duration: number
  playing: boolean
  /** Tiempo del primer quiz pendiente: todo lo que venga después está bloqueado. */
  gateTime: number | null
  /** Candado de la primera pasada: hasta dónde se puede saltar (null = sin candado). */
  watchLimit: number | null
  activeChapterIdx: number
  completedQuizzes: Record<string, QuizResult>
}

interface InteractiveVideoModuleProps {
  section: ModuleSection
  language: Language
  /** IDs necesarios para registrar el intento del quiz de video en user_progress. */
  userId?: string
  campaignId?: string
  moduleId?: string
  /** Resultados guardados en la base (markerId → {score,total}) para restaurar
   *  los quizzes ya hechos y no obligar a repetirlos para avanzar el video. */
  savedQuizResults?: Record<string, QuizResult>
  /** Título del video: se muestra al pasar el mouse y en la tarjeta de "a continuación". */
  title?: string
  /** Modo cine: la lista de capítulos vive afuera, en el panel lateral. */
  hideChapters?: boolean
  /** Arrancar apenas esté listo. Solo se usa al encadenar desde el video anterior. */
  autoPlayOnReady?: boolean
  /**
   * Qué reproducir cuando ESTE video termine.
   * `undefined` → lo resuelve el registro de la página (varios reproductores montados).
   * `null`      → no hay siguiente: es el último de la lista.
   */
  nextUp?: { title: string; start: () => void } | null
  /** Se llama cuando el video TERMINA (no cuando se pausa). */
  onEnded?: () => void
  /**
   * Resultado de una verificación, apenas se responde. El contenedor lo necesita
   * para que un quiz hecho HOY siga contando cuando el reproductor se remonta
   * (modo cine: cambiar de video destruye este componente y su estado local, y
   * los intentos de la base se cargaron antes de responder).
   */
  onQuizGraded?: (markerId: string, result: QuizResult) => void
  /** Estado hacia el contenedor (modo cine). Solo se emite cuando cambia algo visible. */
  onState?: (state: VideoPlayerState) => void
  /** El contenedor puede pedir un salto de tiempo (capítulos del panel lateral). */
  seekRef?: React.MutableRefObject<((seconds: number) => void) | null>
  /** El contenedor puede pedir repetir una verificación (panel lateral del cine). */
  retryRef?: React.MutableRefObject<((markerId: string) => void) | null>
}

/** Segundos de la cuenta regresiva antes de encadenar el siguiente video. */
const NEXT_UP_SECONDS = 6

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const SAVE_INTERVAL = 5

// Animación de entrada escalonada de la lista de capítulos.
const listContainerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } },
}
const listItemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] as const } },
}
// Sacudida horizontal cuando se intenta abrir un ítem bloqueado.
const SHAKE_KEYFRAMES = [0, -6, 6, -5, 5, -3, 3, 0]

function getProgressKey(sectionId?: string) {
  return `video_progress_${sectionId ?? 'default'}`
}

/** Una posición de scroll guardada para devolverla tal cual. */
type ScrollMark = { el: Element | null; top: number; left: number }

/**
 * Foto del scroll de la ventana y de todos los contenedores desplazables por
 * encima del reproductor. Hay que recorrer los ancestros porque según la vista
 * el que scrollea es la ventana (página de módulo) o un `div` con overflow
 * (modo cine, vista previa en modal, panel del capacitador).
 */
function captureScroll(from: Element | null): ScrollMark[] {
  const marks: ScrollMark[] = [{ el: null, top: window.scrollY, left: window.scrollX }]
  let node = from?.parentElement ?? null
  while (node) {
    const { overflowY, overflowX } = getComputedStyle(node)
    const scrolls =
      (/(auto|scroll|overlay)/.test(overflowY) && node.scrollHeight > node.clientHeight) ||
      (/(auto|scroll|overlay)/.test(overflowX) && node.scrollWidth > node.clientWidth)
    if (scrolls) marks.push({ el: node, top: node.scrollTop, left: node.scrollLeft })
    node = node.parentElement
  }
  return marks
}

/** Devuelve el scroll SIN animar: `html` tiene `scroll-behavior: smooth` y
 *  restaurar con desplazamiento suave se ve como un salto raro. */
function restoreScroll(marks: ScrollMark[]) {
  for (const m of marks) {
    const target: Element | Window = m.el ?? window
    target.scrollTo({ top: m.top, left: m.left, behavior: 'instant' as ScrollBehavior })
  }
}

/** Posición actual de un marcador, para saber si la restauración ya "prendió". */
function currentTop(m: ScrollMark) {
  return m.el ? m.el.scrollTop : window.scrollY
}

/**
 * Restaura y REPITE cuadro a cuadro hasta que la posición se sostenga, con un
 * tope de tiempo. Salir de pantalla completa no devuelve la altura de golpe:
 * el navegador recompone y React repinta el contenedor con su tamaño normal en
 * momentos distintos, y hasta que la página no vuelve a ser alta, el scroll que
 * pedimos se recorta solo. Devuelve una función para cancelar al desmontar.
 */
function settleScroll(marks: ScrollMark[], maxMs = 700): () => void {
  const start = performance.now()
  let raf = 0
  const tick = () => {
    restoreScroll(marks)
    // Se acepta 1px de holgura: los navegadores redondean el scroll con zoom
    // o pantallas HiDPI y si no, esto no pararía nunca.
    const done = marks.every((m) => Math.abs(currentTop(m) - m.top) <= 1)
    if (!done && performance.now() - start < maxMs) raf = requestAnimationFrame(tick)
    else raf = 0
  }
  tick()
  return () => { if (raf) cancelAnimationFrame(raf) }
}

interface QuizResult {
  score: number
  total: number
}

export function InteractiveVideoModule({
  section,
  language,
  userId,
  campaignId,
  moduleId,
  savedQuizResults,
  title,
  hideChapters,
  autoPlayOnReady,
  nextUp,
  onEnded,
  onQuizGraded,
  onState,
  seekRef,
  retryRef,
}: InteractiveVideoModuleProps) {
  const { t } = useTranslation()
  const playerId = useId()
  const videoRef = useRef<PlayerLike | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const chapterListRef = useRef<HTMLDivElement>(null)
  const triggeredRef = useRef<Set<string>>(new Set())
  const lastSaveRef = useRef(0)
  const lastTimeRef = useRef(0)
  /** Espejo síncrono de `showOverlay`: el reproductor sondea más rápido de lo que
   *  React repinta y el estado llegaría tarde para evitar una segunda apertura. */
  const overlayOpenRef = useRef(false)

  const [playing, setPlaying] = useState(false)
  // "Se pidió reproducir pero el reproductor aún no confirma". Mientras dure, ocultamos
  // el botón grande de play para no tapar la ruedita de carga de YouTube/Vimeo.
  const [pending, setPending] = useState(false)
  const pendingTimeout = useRef<ReturnType<typeof setTimeout>>()
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showRates, setShowRates] = useState(false)
  const [activeMarker, setActiveMarker] = useState<VideoQuizMarker | null>(null)
  const [showOverlay, setShowOverlay] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [seeking, setSeeking] = useState(false)
  // Se inicializa con los intentos ya guardados en la base para no obligar a
  // rehacer quizzes de video ya aprobados al volver al módulo.
  const [completedQuizzes, setCompletedQuizzes] = useState<Record<string, QuizResult>>(() => ({ ...(savedQuizResults ?? {}) }))
  // Nota del intento anterior cuando se reabre un quiz ya respondido pero NO
  // aprobado: el overlay la muestra y pregunta si quiere volver a intentarlo.
  const [retryResult, setRetryResult] = useState<QuizResult | null>(null)
  const [showResumeToast, setShowResumeToast] = useState(false)
  const [savedTime, setSavedTime] = useState(0)
  const [showFsChapters, setShowFsChapters] = useState(false)
  const [hoveredMarker, setHoveredMarker] = useState<string | null>(null)
  // Ítem que "tiembla" al intentar abrirlo estando bloqueado, y pulso reforzado
  // sobre la verificación requerida para dirigir la atención a lo que falta.
  const [shakeMarkerId, setShakeMarkerId] = useState<string | null>(null)
  const [pulseGate, setPulseGate] = useState(false)
  const controlsTimeout = useRef<ReturnType<typeof setTimeout>>()
  const lang = language as 'es' | 'en' | 'pt'

  const videoAreaRef = useRef<HTMLDivElement>(null)

  /** Scroll de la página guardado al entrar en pantalla completa (ver más abajo). */
  const scrollSnapshot = useRef<ScrollMark[] | null>(null)
  /** Cancela la restauración en curso si el módulo se desmonta a media faena. */
  const cancelSettle = useRef<(() => void) | null>(null)
  useEffect(() => () => cancelSettle.current?.(), [])

  // ── Calidad de conexión ──
  // El `<video>` nativo va en estado (no en el ref) porque el hook necesita
  // enterarse de que ya existe para engancharle los oyentes de buffering.
  // Con YouTube/Vimeo queda en null: el video vive en un iframe ajeno y solo
  // podemos diagnosticar la red.
  const [nativeVideoEl, setNativeVideoEl] = useState<HTMLVideoElement | null>(null)
  const connection = useConnectionQuality(nativeVideoEl, playing)

  /**
   * El `ref` del <video> TIENE que ser estable (`useCallback` sin dependencias).
   * Con una flecha en línea, React vuelve a llamar al ref en cada pintado —una
   * vez con null para soltar el anterior y otra con el elemento—, así que cada
   * pintado hacía dos `setState` y provocaba otro pintado: bucle infinito y la
   * vista del aprendiz sin cargar.
   */
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el
    setNativeVideoEl(el)
  }, [])

  // ── Encadenado al terminar ──
  // Solo cuenta el final REAL del video. Se guarda en un ref porque YouTube emite
  // "pausado" pegado a "terminado" y no queremos contarlo dos veces.
  const endedRef = useRef(false)
  const [autoNext, setAutoNext] = useState(getAutoplayNext)
  const [nextCountdown, setNextCountdown] = useState<number | null>(null)
  const [finished, setFinished] = useState(false)
  const nextTargetRef = useRef<{ title: string; start: () => void } | null>(null)
  const [nextTitle, setNextTitle] = useState<string | null>(null)
  const autoPlayArmed = useRef(!!autoPlayOnReady)

  const markers = section.videoMarkers ?? []
  const videoUrl = section.media?.url ?? null
  const isYouTube = section.media?.type === 'youtube'
  const isVimeo = section.media?.type === 'vimeo'
  // Embeds por iframe (YouTube/Vimeo): sin PiP y con el mismo patrón de sondeo de tiempo.
  const isEmbed = isYouTube || isVimeo
  const sortedMarkers = [...markers].sort((a, b) => a.timeSeconds - b.timeSeconds)
  const quizCount = sortedMarkers.filter((m) => m.type === 'quiz').length

  // ── Candado de la primera pasada ──
  // Mientras no se haya terminado el video una vez, no se puede adelantar.
  // La identidad lleva dónde está (la sección y su encabezado —un bloque de
  // video comparte id con los demás de la sección, y por eso el encabezado es el
  // sintético `vb:<seccion>:<indice>`) y qué es (la fuente): así, reemplazar el
  // archivo no hereda el "ya lo vi" del video anterior.
  const watchId = buildVideoWatchId(section.id, section.heading?.es, videoUrl)
  const seekGate = useVideoSeekGate(watchId)
  // Tope de los saltos por el candado: lo ya visto, con una pizca de holgura.
  const watchLimit = seekGate.active ? seekGate.maxWatched + 1 : null

  const activeChapterIdx = sortedMarkers.reduce((acc, m, i) => {
    if (m.timeSeconds <= currentTime) return i
    return acc
  }, -1)

  // Los intentos de la base pueden llegar async (fetch en ModulePage). Fusionamos
  // los quizzes ya hechos que aún no estén en el estado y los marcamos como
  // "ya cruzados" para que el overlay no vuelva a interrumpir la reproducción.
  useEffect(() => {
    if (!savedQuizResults) return
    setCompletedQuizzes((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [id, res] of Object.entries(savedQuizResults)) {
        if (!(id in next)) {
          next[id] = res
          // Solo el quiz APROBADO se da por visto y no vuelve a interrumpir. Uno
          // reprobado se vuelve a ofrecer al cruzarlo (con su nota anterior a la
          // vista), que es justo lo que el aprendiz necesita para recuperarlo.
          if (isVideoQuizPassed(res)) triggeredRef.current.add(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [savedQuizResults])

  // Desplazar la lista de capítulos al ítem activo — solo dentro de la lista, nunca la página
  useEffect(() => {
    if (activeChapterIdx < 0 || !chapterListRef.current) return
    const container = chapterListRef.current
    const el = container.children[activeChapterIdx] as HTMLElement
    if (!el) return
    const elTop = el.offsetTop
    const elBottom = elTop + el.offsetHeight
    const cTop = container.scrollTop
    const cBottom = cTop + container.clientHeight
    if (elTop < cTop) {
      container.scrollTop = elTop
    } else if (elBottom > cBottom) {
      container.scrollTop = elBottom - container.clientHeight
    }
  }, [activeChapterIdx])

  // Ocultar controles automáticamente. Con el menú de velocidad abierto los
  // controles se quedan: quien está leyendo el panel no está moviendo el ratón,
  // y verlo desaparecer a mitad es exasperante.
  const menuOpen = showRates
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true)
    clearTimeout(controlsTimeout.current)
    if (playing && !menuOpen) {
      controlsTimeout.current = setTimeout(() => setShowControls(false), 3000)
    }
  }, [playing, menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    clearTimeout(controlsTimeout.current)
    setShowControls(true)
  }, [menuOpen])

  useEffect(() => {
    return () => {
      clearTimeout(controlsTimeout.current)
      clearTimeout(pendingTimeout.current)
    }
  }, [])

  /**
   * ¿Queda alguna verificación por hacer a esta altura del video? Devuelve la
   * primera (en orden de tiempo) que el aprendiz aún no ha APROBADO.
   *
   * `limit` acota hasta dónde mirar: durante la reproducción es el segundo actual
   * (solo lo ya visto); al terminar el video es `Infinity`, porque un marcador
   * puesto más allá de la duración real —video reemplazado, tiempo calculado por
   * la IA a ojo— jamás se alcanzaría y el quiz se perdería para siempre.
   */
  const findPendingQuiz = useCallback((limit: number): VideoQuizMarker | null => {
    for (const m of sortedMarkers) {
      if (m.type !== 'quiz') continue
      if (m.timeSeconds > limit) break
      if (triggeredRef.current.has(m.id)) continue
      if (isVideoQuizPassed(completedQuizzes[m.id])) continue
      return m as VideoQuizMarker
    }
    return null
    // sortedMarkers se rearma en cada render; su contenido solo cambia con la sección.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, completedQuizzes])

  /** Pausa el video y abre la verificación pendiente, si hay alguna. */
  const openPendingQuiz = useCallback((limit: number): boolean => {
    // Guarda SÍNCRONA: entre abrir el overlay y que React repinte pueden entrar
    // otros tics del reproductor, y con dos quiz pendientes el segundo se montaba
    // encima del primero.
    if (overlayOpenRef.current) return false
    const m = findPendingQuiz(limit)
    if (!m) return false
    overlayOpenRef.current = true
    triggeredRef.current.add(m.id)
    const previous = completedQuizzes[m.id]
    // Ya respondida y no aprobada: el overlay lo dice y ofrece reintentarla en
    // vez de lanzar las preguntas de golpe como si fuera la primera vez.
    setRetryResult(previous && !isVideoQuizPassed(previous) ? previous : null)
    videoRef.current?.pause()
    setPlaying(false)
    setActiveMarker(m)
    setShowOverlay(true)
    return true
  }, [findPendingQuiz, completedQuizzes])

  // Pide reproducir y marca el estado "arrancando". Con YouTube/Vimeo el arranque no es
  // inmediato (buffer + handshake del iframe), así que esperamos al evento `play` real;
  // el temporizador devuelve el botón si nunca arranca (autoplay bloqueado, red caída).
  const requestPlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    setPending(true)
    clearTimeout(pendingTimeout.current)
    pendingTimeout.current = setTimeout(() => setPending(false), 8000)
    v.play()
  }, [])

  // Confirmaciones del reproductor: cierran el estado "arrancando".
  const handlePlayEvent = useCallback(() => {
    clearTimeout(pendingTimeout.current)
    setPending(false)
    setPlaying(true)
    endedRef.current = false
    setFinished(false)
    setNextCountdown(null)
    // Este es el video que suena: los demás de la página se callan y los atajos
    // de teclado pasan a ser suyos.
    announcePlaying(playerId)
  }, [playerId])

  const handlePauseEvent = useCallback(() => {
    clearTimeout(pendingTimeout.current)
    setPending(false)
    setPlaying(false)
  }, [])

  /**
   * El video llegó al final. Es el ÚNICO momento en que otro video puede arrancar
   * solo: una pausa, un salto o un clic en otra parte nunca encadenan nada.
   *
   * De dónde sale "el siguiente": si el contenedor lo dice (modo cine, donde la
   * lista está afuera y solo hay un reproductor montado) se usa eso; si no, se
   * busca el siguiente reproductor de la página en orden de arriba abajo.
   */
  const handleEndedEvent = useCallback(() => {
    if (endedRef.current) return // YouTube emite "pausado" pegado a "terminado"
    endedRef.current = true
    // Se vio entero: se levanta el candado de la primera pasada aunque todavía
    // quede una verificación por responder (el video ya se vio; el quiz es otra
    // compuerta y sigue en pie por su cuenta).
    seekGate.markDone(videoRef.current?.duration || duration)
    clearTimeout(pendingTimeout.current)
    setPending(false)
    setPlaying(false)

    // Última oportunidad para las verificaciones que quedaron sin salir: un
    // marcador puesto más allá de la duración real (video reemplazado, tiempo
    // calculado por la IA) o en los últimos segundos que el reproductor nunca
    // llega a reportar. El video no se da por terminado ni encadena el siguiente
    // hasta que se responda: si tiene quiz, el quiz se hace.
    if (openPendingQuiz(Infinity)) {
      endedRef.current = false
      return
    }

    setFinished(true)
    onEnded?.()

    const target = nextUp !== undefined ? nextUp : (() => {
      const n = nextVideoAfter(playerId)
      if (!n) return null
      return {
        title: n.title,
        // El siguiente puede estar muy por debajo del pliegue: se trae a la vista
        // antes de arrancarlo. Un video sonando fuera de pantalla desconcierta.
        start: () => {
          n.getElement()?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          n.play()
        },
      }
    })()
    nextTargetRef.current = target
    setNextTitle(target?.title ?? null)
    if (target && getAutoplayNext()) setNextCountdown(NEXT_UP_SECONDS)
  }, [nextUp, onEnded, playerId, openPendingQuiz, seekGate, duration])

  // Cuenta regresiva de "a continuación". Vive aparte para que cancelarla sea
  // simplemente poner el contador en null.
  useEffect(() => {
    if (nextCountdown == null) return
    if (nextCountdown <= 0) {
      const target = nextTargetRef.current
      setNextCountdown(null)
      target?.start()
      return
    }
    const id = setTimeout(() => setNextCountdown((c) => (c == null ? null : c - 1)), 1000)
    return () => clearTimeout(id)
  }, [nextCountdown])

  // Alta en el registro de la página: quién soy, dónde estoy y cómo se me maneja.
  useEffect(() => {
    return registerVideo({
      id: playerId,
      title: title || section.heading?.[lang] || section.heading?.es || '',
      getElement: () => containerRef.current,
      play: () => { videoRef.current?.play() },
      pause: () => { videoRef.current?.pause() },
    })
  }, [playerId, title, section.heading, lang])

  // La preferencia de encadenado es del usuario, no del módulo: si la cambia en
  // un reproductor, los demás de la página se enteran.
  useEffect(() => subscribeAutoplayNext(setAutoNext), [])

  // Listener de cambio de pantalla completa.
  //
  // Además de anotar el estado, guarda y devuelve el scroll de la página. Al
  // entrar en pantalla completa el reproductor pasa a la capa superior y su
  // hueco se colapsa: el módulo se acorta de golpe y el navegador recorta el
  // scroll al nuevo máximo. Al salir, la altura vuelve pero el scroll ya se
  // perdió, y el aprendiz aparecía arriba del módulo como si acabara de entrar
  // —perdiendo el punto donde iba leyendo.
  useEffect(() => {
    const handler = () => {
      const isFs = !!document.fullscreenElement
      setFullscreen(isFs)

      // Al entrar no hay nada que hacer: la foto ya se tomó en `handleFullscreen`,
      // antes de que el layout se moviera.
      if (isFs) return

      // Solo restaura quien había guardado foto. En un módulo con varios videos
      // el evento llega a todos los reproductores, y solo uno estuvo en pantalla
      // completa.
      const snap = scrollSnapshot.current
      if (!snap) return
      scrollSnapshot.current = null
      // Insistir cuadro a cuadro hasta que cuadre. El navegador rehace el layout
      // DESPUÉS de emitir el evento, y React todavía tiene que devolverle al
      // contenedor su altura normal: una sola restauración se aplicaría sobre la
      // altura colapsada y el navegador la volvería a recortar.
      cancelSettle.current?.()
      cancelSettle.current = settleScroll(snap)
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Atajos de teclado.
  //
  // El listener vive en `document` (así funciona sin tener que hacer clic dentro
  // del video), pero SOLO obedece el reproductor con el que el usuario está
  // interactuando. Sin ese filtro, en un módulo con varios videos la barra
  // espaciadora le hablaba a todos: el que sonaba se pausaba y el de abajo
  // arrancaba solo. Ver `lib/videoBus`.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!containerRef.current) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (showOverlay) return
      if (!ownsKeyboard(playerId)) return

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          seekTo((videoRef.current?.currentTime ?? 0) - 10)
          break
        case 'ArrowRight':
          e.preventDefault()
          seekTo((videoRef.current?.currentTime ?? 0) + 10)
          break
        case 'm':
        case 'M':
          e.preventDefault()
          toggleMute()
          break
        case 'f':
        case 'F':
          e.preventDefault()
          handleFullscreen()
          break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showOverlay, playing, pending])

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const cur = v.currentTime
    lastTimeRef.current = cur
    setCurrentTime(cur)
    // Anotar lo visto: es lo único que abre el video hacia adelante. Y si ya
    // está a un suspiro del final, se levanta el candado sin esperar al evento
    // de "terminado": hay videos cuyo último segundo el reproductor nunca
    // reporta, y el aprendiz se quedaría con el candado puesto para siempre.
    seekGate.note(cur, v.duration)
    if (v.duration > 0 && cur >= v.duration - 1.5) seekGate.markDone(v.duration)
    // Mantener la duración fresca (YouTube la expone tarde y sin evento propio).
    if (v.duration) setDuration((d) => (Math.abs(v.duration - d) > 0.5 ? v.duration : d))

    // Guardar posición cada SAVE_INTERVAL segundos
    if (cur - lastSaveRef.current >= SAVE_INTERVAL) {
      lastSaveRef.current = cur
      try {
        localStorage.setItem(getProgressKey(section.heading?.es), String(cur))
      } catch { /* ignore */ }
    }

    // Disparo de los quiz: el PRIMERO pendiente cuyo tiempo ya quedó atrás.
    //
    // Antes se exigía cruzarlo justo (prev < t && cur >= t) y eso dejaba quizzes
    // sin salir en cuanto la reproducción no pasaba exactamente por ahí: un salto,
    // una reanudación, el sondeo ralo de YouTube a velocidad 2x, o un marcador
    // colocado en un segundo que el video nunca reporta. Con "ya lo pasaste" el
    // quiz sale siempre; `triggeredRef` evita que se repita en la misma pasada.
    if (!showOverlay) openPendingQuiz(cur)
  }, [openPendingQuiz, showOverlay, section.heading?.es, seekGate])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    // Tocar el video cierra el menú de velocidad, como cualquier reproductor.
    setShowRates(false)
    // `pending` cuenta como "va a reproducir": un segundo clic cancela el arranque.
    if (playing || pending) {
      clearTimeout(pendingTimeout.current)
      setPending(false)
      v.pause()
    } else {
      requestPlay()
    }
  }

  // Tiempo del primer quiz de video AÚN no realizado. Actúa como tope: el aprendiz
  // no puede adelantar el video más allá de un quiz que no ha hecho.
  const firstPendingQuizTime = (): number | null => {
    for (const m of sortedMarkers) {
      if (m.type === 'quiz' && !completedQuizzes[m.id]) return m.timeSeconds
    }
    return null
  }

  /**
   * El ÚNICO lugar donde se decide hasta dónde se puede saltar. Lo usan tanto
   * nuestros controles como el guardia de `seeking` del <video> nativo, para que
   * ningún camino se salte las compuertas.
   */
  const clampSeekTarget = (secs: number): number => {
    let target = Math.max(0, duration > 0 ? Math.min(secs, duration) : secs)
    // Compuerta de avance: si hay un quiz pendiente por delante, no se puede saltar
    // hasta él ni más allá. Usamos `>=` a propósito: aterrizar EXACTAMENTE sobre el
    // marcador rompería la detección por cruce (prev < t && cur >= t) y el quiz se
    // saltaría; por eso lo dejamos justo antes para que la reproducción lo dispare.
    const gate = firstPendingQuizTime()
    if (gate != null && target >= gate) {
      target = Math.max(0, gate - 0.4)
    }
    // Candado de la primera pasada: no se salta más allá de lo ya visto. Recortar
    // no basta —un salto que "no hace nada" parece una falla del sitio—, así que
    // `clamp` levanta el aviso cuando corta.
    return Math.max(0, seekGate.clamp(target))
  }

  const seekTo = (secs: number) => {
    const v = videoRef.current
    if (!v) return
    const target = clampSeekTarget(secs)
    v.currentTime = target
    // Sincronizar la referencia de cruce: un salto manual no debe disparar quizzes
    // intermedios; solo el avance natural de la reproducción los cruza.
    lastTimeRef.current = target
  }

  /**
   * Guardia de último recurso sobre el <video> nativo: hay caminos que mueven el
   * tiempo sin pasar por nuestros controles —la ventana flotante (PiP), las
   * teclas de medios del teclado, un gesto del navegador—. Si el salto se pasa
   * de la raya, se devuelve el video a donde puede estar.
   */
  const handleNativeSeeking = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget
    const allowed = clampSeekTarget(v.currentTime)
    // Con holgura: reponerlo por unas milésimas encadenaría `seeking` sin fin.
    if (v.currentTime - allowed > 0.25) {
      v.currentTime = allowed
      lastTimeRef.current = allowed
    }
  }

  // El contenedor (modo cine) maneja los capítulos desde el panel lateral.
  useEffect(() => {
    if (!seekRef) return
    seekRef.current = (secs: number) => { focusVideo(playerId); seekTo(secs); requestPlay() }
    return () => { seekRef.current = null }
  })

  // …y desde ahí también puede pedir repetir una verificación, porque con
  // `hideChapters` la lista interna (donde vive el botón) no se pinta.
  useEffect(() => {
    if (!retryRef) return
    retryRef.current = (markerId: string) => { focusVideo(playerId); handleRetryQuiz(markerId) }
    return () => { retryRef.current = null }
  })

  // Estado hacia el contenedor. Se emite solo cuando cambia algo que se ve
  // (medio segundo de reloj, capítulo, compuerta): esto se calcula 4 veces por
  // segundo y avisar en cada tic haría re-pintar la lista lateral sin motivo.
  const lastSignature = useRef('')
  const gateForState = firstPendingQuizTime()
  useEffect(() => {
    if (!onState) return
    const sig = [
      Math.round(currentTime * 2),
      Math.round(duration),
      playing,
      gateForState,
      Math.round(watchLimit ?? -1),
      activeChapterIdx,
      Object.keys(completedQuizzes).length,
    ].join('|')
    if (sig === lastSignature.current) return
    lastSignature.current = sig
    onState({
      currentTime,
      duration,
      playing,
      gateTime: gateForState,
      watchLimit,
      activeChapterIdx,
      completedQuizzes,
    })
  }, [onState, currentTime, duration, playing, gateForState, watchLimit, activeChapterIdx, completedQuizzes])

  // ── "Continuar desde…" ──
  //
  // Espera a que llegue la marca que manda (la de la base). Con el candado
  // puesto, el punto de reanudación NO es la última posición guardada por el
  // navegador —esa no prueba nada— sino lo que el servidor acredita como visto.
  // Si alguien vio 3 minutos y el navegador guardó 20, se ofrece continuar en 3.
  const resumeOfferedRef = useRef(false)
  useEffect(() => {
    if (resumeOfferedRef.current || !seekGate.ready || duration <= 0) return
    resumeOfferedRef.current = true
    let saved = 0
    try {
      saved = parseFloat(localStorage.getItem(getProgressKey(section.heading?.es)) ?? '0') || 0
    } catch { /* ignore */ }
    const target = seekGate.active ? Math.min(saved, seekGate.maxWatched) : saved
    if (target > 10 && target < duration - 5) {
      setSavedTime(target)
      setShowResumeToast(true)
    }
  }, [seekGate, duration, section.heading?.es])

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !duration) return
    const rect = progressBarRef.current.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    seekTo(pct * duration)
  }

  const handleProgressMouseDown = (e: React.MouseEvent) => {
    setSeeking(true)
    handleProgressClick(e as React.MouseEvent<HTMLDivElement>)
    const handleMove = (ev: MouseEvent) => {
      if (!progressBarRef.current || !duration) return
      const rect = progressBarRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min((ev.clientX - rect.left) / rect.width, 1))
      seekTo(pct * duration)
    }
    const handleUp = () => {
      setSeeking(false)
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    setVolume(v)
    if (videoRef.current) videoRef.current.volume = v
    setMuted(v === 0)
  }

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    const next = !muted
    setMuted(next)
    v.muted = next
  }

  const handleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      // La foto del scroll se toma AQUÍ, antes de pedir pantalla completa.
      // Dentro de `fullscreenchange` ya es tarde: para cuando ese evento llega,
      // el reproductor ya pasó a la capa superior, el módulo se acortó y el
      // navegador ya recortó el scroll — se guardaría el valor ya arruinado.
      scrollSnapshot.current = captureScroll(containerRef.current)
      containerRef.current.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  const handlePiP = async () => {
    // PiP solo aplica al <video> nativo; YouTube va por iframe y no lo soporta aquí.
    const v = videoRef.current as HTMLVideoElement | null
    if (!v || typeof v.requestPictureInPicture !== 'function' || !document.pictureInPictureEnabled) return
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture()
    } else {
      await v.requestPictureInPicture()
    }
  }

  const handleRateChange = (rate: number) => {
    setPlaybackRate(rate)
    if (videoRef.current) videoRef.current.playbackRate = rate
    setShowRates(false)
  }

  // Se dispara al terminar de responder (pantalla de resultados del overlay).
  // Marca el quiz como hecho y persiste el intento aunque el aprendiz cierre sin
  // pulsar "Continuar". Con el quiz ya hecho, se libera el avance del video.
  const handleQuizGraded = (score: number, total: number, detail: QuizAnswerDetail[]) => {
    if (!activeMarker) return
    setCompletedQuizzes((prev) => ({ ...prev, [activeMarker.id]: { score, total } }))
    // El contenedor guarda el resultado por su cuenta: en modo cine este
    // componente se destruye al cambiar de video y volvería sin memoria.
    onQuizGraded?.(activeMarker.id, { score, total })

    // Registrar el intento para que aparezca en el panel de evaluaciones y cuente
    // en la compuerta del módulo. Solo si tenemos los ids reales (el preview de
    // admin no los pasa → no ensucia datos).
    if (userId && campaignId) {
      const pct = total > 0 ? Math.round((score / total) * 100) : 0
      void saveActivityAttempt({
        user_id: userId,
        campaign_id: campaignId,
        module_id: moduleId || '',
        section_id: section.id || '',
        game_type: 'VIDEO_QUIZ',
        score: pct,
        status: pct >= 75 ? 'completed' : 'failed',
        time_spent_seconds: 0,
        submitted_answers: {
          marker_id: activeMarker.id,
          aciertos: score,
          total,
          errores: total - score,
          tema: activeMarker.title[lang],
          // Pregunta por pregunta: qué eligió y qué era lo correcto.
          detalle: detail,
        },
      })
    }
  }

  const handleOverlayComplete = () => {
    overlayOpenRef.current = false
    setShowOverlay(false)
    setActiveMarker(null)
    setRetryResult(null)
    // El video terminó y el quiz salió como red de seguridad: al cerrarlo no hay
    // nada que reanudar, se da por terminado (y encadena, si toca).
    const v = videoRef.current
    const atEnd = duration > 0 && (v?.currentTime ?? 0) >= duration - 0.5
    if (atEnd) { handleEndedEvent(); return }
    requestPlay()
  }

  // "Repasar el video": cierra el quiz sin responderlo y regresa al inicio del
  // segmento (marcador anterior) para volver a ver la información. Como el quiz
  // sigue pendiente, la compuerta de avance se mantiene y el overlay reaparece
  // al cruzar de nuevo el marcador.
  const handleReviewQuiz = () => {
    if (!activeMarker) return
    const markerTime = activeMarker.timeSeconds
    triggeredRef.current.delete(activeMarker.id)
    overlayOpenRef.current = false
    setShowOverlay(false)
    setActiveMarker(null)
    setRetryResult(null)
    const prev = sortedMarkers.filter((m) => m.timeSeconds < markerTime).pop()
    seekTo(prev ? prev.timeSeconds : Math.max(0, markerTime - 20))
    requestPlay()
  }

  // Reintento pedido a mano desde la lista de capítulos. Abre la verificación tal
  // cual, sin pasar por `openPendingQuiz`: una ya aprobada se puede repetir si el
  // aprendiz quiere, y no tiene sentido rebobinar el video para conseguirlo.
  const handleRetryQuiz = (markerId: string) => {
    const marker = sortedMarkers.find((m) => m.id === markerId) as VideoQuizMarker | undefined
    if (!marker || marker.type !== 'quiz') return
    overlayOpenRef.current = true
    triggeredRef.current.add(markerId)
    setRetryResult(completedQuizzes[markerId] ?? null)
    videoRef.current?.pause()
    setPlaying(false)
    setActiveMarker(marker)
    setShowOverlay(true)
  }

  const handleLoadedMetadata = () => {
    const dur = videoRef.current?.duration ?? 0
    setDuration(dur)
    triggeredRef.current.clear()
    // Re-sembrar SOLO los quizzes ya aprobados: son los únicos que no vuelven a
    // interrumpir. Los reprobados se ofrecen de nuevo al llegar a su marcador.
    for (const [id, res] of Object.entries(completedQuizzes)) {
      if (isVideoQuizPassed(res)) triggeredRef.current.add(id)
    }
    lastTimeRef.current = videoRef.current?.currentTime ?? 0

    // Encadenado: este reproductor se montó porque el anterior TERMINÓ. Arranca
    // una sola vez; si el navegador bloquea el arranque, el temporizador de
    // `requestPlay` devuelve el botón grande y el aprendiz decide.
    if (autoPlayArmed.current) {
      autoPlayArmed.current = false
      focusVideo(playerId)
      requestPlay()
    }
  }

  const handleResumeFromSaved = () => {
    seekTo(savedTime)
    setShowResumeToast(false)
  }

  const handleStartFromBeginning = () => {
    setShowResumeToast(false)
  }

  // Se intentó abrir un ítem bloqueado (posterior a un quiz no realizado). No se
  // navega —igual que la barra de progreso—: se sacude el ítem, se refuerza el
  // pulso de la verificación requerida y se la trae a la vista dentro de la lista.
  const handleLockedClick = (markerId: string) => {
    setShakeMarkerId(markerId)
    window.setTimeout(() => setShakeMarkerId((c) => (c === markerId ? null : c)), 550)

    // Si lo que cierra el paso es el candado de la primera pasada, el aviso lo
    // dice con todas las letras: señalar una verificación que ni siquiera es el
    // motivo dejaría al aprendiz buscando lo que no falla.
    const marker = sortedMarkers.find((mm) => mm.id === markerId)
    if (watchLimit != null && marker && marker.timeSeconds > watchLimit) {
      seekGate.warn()
      return
    }

    setPulseGate(true)
    window.setTimeout(() => setPulseGate(false), 1300)
    const gate = firstPendingQuizTime()
    if (gate != null && chapterListRef.current) {
      const idx = sortedMarkers.findIndex((mm) => mm.type === 'quiz' && mm.timeSeconds === gate)
      const el = idx >= 0 ? (chapterListRef.current.children[idx] as HTMLElement | undefined) : undefined
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }

  const cancelNextUp = () => {
    setNextCountdown(null)
    nextTargetRef.current = null
  }

  const playNextNow = () => {
    const target = nextTargetRef.current
    setNextCountdown(null)
    target?.start()
  }

  const replay = () => {
    setFinished(false)
    endedRef.current = false
    setNextCountdown(null)
    seekTo(0)
    requestPlay()
  }

  // Medidas de los controles. En pantalla completa todo crece: el reproductor
  // pasa de 400px de alto a 1080 y los mismos iconos se vuelven inservibles.
  // El `p-2` no es decoración: es el blanco mínimo para un dedo.
  const ctrlBtn = cn('shrink-0 rounded-lg transition-colors', fullscreen ? 'p-2' : 'p-1.5')
  const ctrlIcon = fullscreen ? 'h-7 w-7' : 'h-5 w-5'
  const ctrlIconSm = fullscreen ? 'h-5 w-5' : 'h-4 w-4'

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
  // Tope actual: tiempo del primer quiz pendiente. Todo marcador posterior está
  // bloqueado hasta que se realice esa verificación.
  const gateTime = firstPendingQuizTime()
  /** Un marcador está fuera de alcance por el quiz pendiente o por el candado. */
  const isMarkerLocked = (seconds: number) =>
    (gateTime != null && seconds > gateTime) || (watchLimit != null && seconds > watchLimit)
  /** Porcentaje de la barra ya desbloqueado: hasta ahí se puede saltar. */
  const unlockedPct = watchLimit != null && duration > 0
    ? Math.min(100, (seekGate.maxWatched / duration) * 100)
    : 100

  if (!videoUrl) {
    return (
      <div className="flex items-center justify-center h-64 rounded-3xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <p className="text-zinc-500 dark:text-zinc-400 text-[14px]">{t('module.blocks.video_unavailable')}</p>
      </div>
    )
  }

  const chapterList = (
    <motion.div
      ref={chapterListRef}
      variants={listContainerVariants}
      initial="hidden"
      animate="show"
      className={cn('overflow-y-auto py-1', !fullscreen && 'grid sm:grid-cols-2')}
      style={{ maxHeight: fullscreen ? undefined : '224px' }}
    >
      {sortedMarkers.map((m, i) => {
        const isActive = i === activeChapterIdx
        const markerLang = m.title[lang] || m.title.es
        const quizResult = m.type === 'quiz' ? completedQuizzes[m.id] : undefined
        const isPassing = isVideoQuizPassed(quizResult)
        // Bloqueado: hay un quiz pendiente antes de este marcador en la línea de
        // tiempo, o todavía no se ha llegado ahí viendo el video.
        const isLocked = isMarkerLocked(m.timeSeconds)
        // Requerido: es justamente el quiz pendiente que abre la compuerta.
        const isRequired = gateTime != null && m.type === 'quiz' && !quizResult && m.timeSeconds === gateTime

        return (
          <motion.div key={m.id} variants={listItemVariants} className="group relative">
            <motion.div
              animate={{ x: shakeMarkerId === m.id ? SHAKE_KEYFRAMES : 0 }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
            >
              <button
                type="button"
                aria-disabled={isLocked}
                onClick={() => {
                  if (isLocked) { handleLockedClick(m.id); return }
                  seekTo(m.timeSeconds)
                  requestPlay()
                  if (fullscreen) setShowFsChapters(false)
                }}
                className={cn(
                  'relative w-full flex items-start gap-3 px-4 py-3 text-left transition-all duration-200',
                  isLocked
                    ? 'cursor-not-allowed opacity-55'
                    : isActive
                      ? 'bg-zinc-100 dark:bg-zinc-800'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                  isRequired && 'rounded-xl bg-amber-50/70 dark:bg-amber-900/10',
                )}
              >
                {/* Ícono */}
                <div className={cn(
                  'mt-0.5 h-6 w-6 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                  isLocked
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500'
                    : m.type === 'chapter'
                      ? isActive
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                      : quizResult
                        ? isPassing
                          ? 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                        : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400',
                )}>
                  {isLocked
                    ? <Lock className="h-3.5 w-3.5" />
                    : m.type === 'chapter'
                      ? <BookOpen className="h-3.5 w-3.5" />
                      : <ClipboardList className="h-3.5 w-3.5" />
                  }
                </div>

                {/* Contenido */}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    'text-[13px] font-medium leading-snug',
                    isLocked
                      ? 'text-zinc-500 dark:text-zinc-500'
                      : isActive
                        ? 'text-zinc-900 dark:text-zinc-50'
                        : 'text-zinc-700 dark:text-zinc-300',
                  )}>
                    {markerLang || t('video.section_n', { n: i + 1 })}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-mono">
                      {formatTime(m.timeSeconds)}
                    </span>
                    {isRequired && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500 text-white font-semibold">
                        {t('video.required_badge')}
                      </span>
                    )}
                    {m.type === 'quiz' && !quizResult && !isRequired && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 font-medium">
                        Quiz · {(m as VideoQuizMarker).questions.length}P
                      </span>
                    )}
                    {quizResult && (
                      <span className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded-md font-semibold',
                        isPassing
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
                      )}>
                        {quizResult.score}/{quizResult.total} {isPassing ? '✓' : '·'}
                      </span>
                    )}
                    {isLocked && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500">
                        <Lock className="h-2.5 w-2.5" /> {t('video.locked_badge')}
                      </span>
                    )}
                  </div>
                </div>

                {isActive && !quizResult && !isLocked && (
                  <div className="mt-2 h-2 w-2 rounded-full bg-neon-green shrink-0 animate-pulse" />
                )}
              </button>
            </motion.div>

            {/* Anillo pulsante sobre la verificación requerida (dirige la atención). */}
            {isRequired && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-amber-400/60"
                animate={{ opacity: pulseGate ? [0.25, 0.95, 0.25] : [0.15, 0.55, 0.15] }}
                transition={{ duration: pulseGate ? 0.6 : 2.2, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}

            {/* Botón de reintentar para quizzes completados */}
            {m.type === 'quiz' && quizResult && !isLocked && (
              <button
                type="button"
                title={t('video.retry_quiz')}
                onClick={() => handleRetryQuiz(m.id)}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            )}
          </motion.div>
        )
      })}
    </motion.div>
  )

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full rounded-3xl overflow-hidden border',
        'border-zinc-200 dark:border-zinc-800',
        'bg-zinc-950',
        fullscreen ? 'flex flex-col h-screen rounded-none border-0' : 'flex flex-col',
      )}
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => playing && setShowControls(false)}
      // Tocar el reproductor lo vuelve el dueño de los atajos de teclado: en un
      // módulo con varios videos, la barra espaciadora solo mueve este.
      onPointerDownCapture={() => focusVideo(playerId)}
    >
      {/* ── Área de video ── */}
      <div ref={videoAreaRef} className={cn('relative bg-black', fullscreen ? 'flex-1 flex flex-col' : 'aspect-video w-full')}>
        {isYouTube && videoUrl ? (
          <YouTubePlayer
            videoId={videoUrl}
            playerRef={videoRef}
            className="absolute inset-0 w-full h-full"
            onReady={handleLoadedMetadata}
            onPlay={handlePlayEvent}
            onPause={handlePauseEvent}
            onEnded={handleEndedEvent}
            onTimeUpdate={handleTimeUpdate}
          />
        ) : isVimeo && videoUrl ? (
          <VimeoPlayer
            videoId={videoUrl}
            playerRef={videoRef}
            className="absolute inset-0 w-full h-full"
            onReady={handleLoadedMetadata}
            onPlay={handlePlayEvent}
            onPause={handlePauseEvent}
            onEnded={handleEndedEvent}
            onTimeUpdate={handleTimeUpdate}
          />
        ) : (
          <video
            ref={attachVideo}
            src={videoUrl ?? undefined}
            className="absolute inset-0 w-full h-full object-contain cursor-pointer"
            preload="metadata"
            onClick={togglePlay}
            onPlay={handlePlayEvent}
            onPause={handlePauseEvent}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onSeeking={handleNativeSeeking}
            onEnded={handleEndedEvent}
          />
        )}

        {/* Capa de clic para los embeds. El iframe de Vimeo no reacciona al clic central
            (y el de YouTube lo hace con su propia lógica), así que interceptamos toda el
            área del video y usamos SIEMPRE nuestro play/pausa. Va por debajo de los
            controles (z-20) para no robarles los clics. */}
        {isEmbed && !showOverlay && (
          <button
            type="button"
            aria-label={playing ? 'Pausar' : 'Reproducir'}
            onClick={togglePlay}
            className="absolute inset-0 z-10 w-full h-full cursor-pointer bg-transparent"
          />
        )}

        {/* Título sobre el video: aparece con los controles y se va con ellos,
            igual que en un reproductor de cine. */}
        {title && (
          <div
            className={cn(
              'absolute top-0 left-0 right-0 z-20 px-5 pt-4 pb-10 pointer-events-none',
              'bg-gradient-to-b from-black/65 to-transparent transition-opacity duration-300',
              showControls || !playing ? 'opacity-100' : 'opacity-0',
            )}
          >
            <p className="text-[13.5px] font-semibold text-white/90 leading-snug line-clamp-2">{title}</p>
          </div>
        )}

        {/* Toast de reanudar */}
        <AnimatePresence>
          {showResumeToast && (
            <motion.div
              className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-zinc-900/95 border border-white/10 backdrop-blur-sm shadow-xl"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <span className="text-[12px] text-white/80">{t('video.resume_from', { time: formatTime(savedTime) })}</span>
              <button
                type="button"
                onClick={handleResumeFromSaved}
                className="text-[11px] font-semibold text-neon-green hover:text-neon-green/80 transition-colors"
              >
                {t('video.resume')}
              </button>
              <span className="text-white/30 text-[10px]">·</span>
              <button
                type="button"
                onClick={handleStartFromBeginning}
                className="text-[11px] text-white/50 hover:text-white/80 transition-colors"
              >
                {t('video.from_beginning')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Aviso de conexión. Solo sale cuando la cosa está mal de verdad: el
            objetivo es que nadie se quede mirando una ruedita sin saber qué pasa.
            Con el quiz abierto no se pinta para no competir con la pregunta. */}
        <AnimatePresence>
          {(connection.level === 'poor' || connection.level === 'offline') && !showOverlay && (
            <motion.div
              key="conn-warning"
              className="absolute top-4 right-4 z-30 flex items-center gap-2 rounded-xl border border-amber-400/25 bg-zinc-900/90 px-3 py-2 backdrop-blur-sm pointer-events-none max-w-[min(85%,20rem)]"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <span className="text-[11.5px] leading-snug text-amber-200/90">
                {connection.level === 'offline' ? t('video.conn.offline_hint') : t('video.conn.warning')}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Aviso de "no se puede adelantar todavía". Sale cuando el aprendiz lo
            intenta —arrastrando la barra, con la flecha derecha o tocando un
            capítulo que aún no toca— porque el silencio se lee como una falla
            del sitio y termina en "no me deja adelantar el video". */}
        <AnimatePresence>
          {seekGate.notice && (
            <motion.div
              key="no-skip"
              className="absolute inset-x-0 bottom-24 z-40 flex justify-center px-6 pointer-events-none"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2 }}
            >
              <span className="flex max-w-[min(92%,26rem)] items-start gap-2 rounded-2xl border border-amber-400/25 bg-zinc-900/95 px-4 py-2.5 text-[12px] leading-snug text-amber-100/90 shadow-xl backdrop-blur-sm">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                {t('video.no_skip_notice')}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Botón grande de play cuando está pausado. Desaparece en cuanto se pide
            reproducir (`pending`) para dejar ver la ruedita de carga del reproductor. */}
        <AnimatePresence>
          {!playing && !pending && !showOverlay && (
            <motion.div
              className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
              key="big-play"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex flex-col items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
                  <Play className="h-7 w-7 text-white ml-1" />
                </div>
                {/* Contrato con el aprendiz ANTES de darle play: este video se va a
                    detener para preguntarle. Verlo venir evita el sobresalto de
                    "¿por qué se paró y qué es esto?". */}
                {quizCount > 0 && currentTime < 1 && (
                  <span className="max-w-[min(90%,22rem)] text-center rounded-full bg-black/55 backdrop-blur-sm px-4 py-2 text-[11.5px] leading-snug text-white/85 border border-white/10">
                    {t('video.has_checks', { count: quizCount })}
                  </span>
                )}
                {/* La regla se anuncia ANTES, no cuando choca contra ella. Nadie
                    reporta como falla algo que le avisaron de entrada.
                    El mensaje es el mismo para todos: aquí solo se explica que
                    esto es normal por ser la primera vez. La llave del staff no
                    se menciona —vive en la barra de controles, donde estorba a
                    nadie. */}
                {seekGate.active && (
                  <span className="flex max-w-[min(90%,24rem)] items-center gap-2 rounded-full border border-amber-300/25 bg-black/55 px-4 py-2 text-center text-[11.5px] leading-snug text-amber-100/90 backdrop-blur-sm">
                    <Lock className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                    {t('video.no_skip_intro')}
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Ruedita propia solo para el <video> nativo: YouTube y Vimeo muestran la suya
            y no queremos dos indicadores encima del mismo punto. */}
        <AnimatePresence>
          {pending && !isEmbed && !showOverlay && (
            <motion.div
              key="loading"
              className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <span className="h-10 w-10 rounded-full border-2 border-white/25 border-t-white/90 animate-spin" />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Superposición de quiz */}
        <AnimatePresence>
          {showOverlay && activeMarker && (
            <VideoQuizOverlay
              key={activeMarker.id}
              marker={activeMarker}
              language={language}
              previousResult={retryResult}
              onGraded={handleQuizGraded}
              onComplete={handleOverlayComplete}
              onReview={handleReviewQuiz}
            />
          )}
        </AnimatePresence>

        {/* Panel de capítulos en pantalla completa */}
        <AnimatePresence>
          {fullscreen && showFsChapters && (
            <motion.div
              // Se corta antes de la barra de controles: tapándola, en pantalla
              // completa quedaban inalcanzables salir, velocidad y subtítulos.
              className="absolute right-0 top-0 bottom-24 w-72 max-w-[85vw] bg-zinc-900/97 border-l border-white/10 z-30 flex flex-col"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="px-4 py-3 border-b border-white/10 shrink-0">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    {t('video.content_header', { count: sortedMarkers.length })}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowFsChapters(false)}
                    className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {gateTime != null && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-400">
                    <Lock className="h-3 w-3 shrink-0" /> {t('video.locked_hint')}
                  </p>
                )}
                {seekGate.active && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-400">
                    <Lock className="h-3 w-3 shrink-0" /> {t('video.no_skip_hint')}
                  </p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {sortedMarkers.map((m, i) => {
                  const isActive = i === activeChapterIdx
                  const quizResult = m.type === 'quiz' ? completedQuizzes[m.id] : undefined
                  const isLocked = isMarkerLocked(m.timeSeconds)
                  const isRequired = gateTime != null && m.type === 'quiz' && !quizResult && m.timeSeconds === gateTime
                  return (
                    <motion.button
                      key={m.id}
                      type="button"
                      aria-disabled={isLocked}
                      animate={{ x: shakeMarkerId === m.id ? SHAKE_KEYFRAMES : 0 }}
                      transition={{ duration: 0.5, ease: 'easeInOut' }}
                      onClick={() => {
                        if (isLocked) { handleLockedClick(m.id); return }
                        seekTo(m.timeSeconds); requestPlay(); setShowFsChapters(false)
                      }}
                      className={cn(
                        'w-full flex items-start gap-3 px-4 py-3 text-left transition-colors',
                        isLocked ? 'cursor-not-allowed opacity-55' : isActive ? 'bg-white/10' : 'hover:bg-white/5',
                        isRequired && 'bg-amber-500/10 ring-1 ring-inset ring-amber-400/40',
                      )}
                    >
                      <div className={cn(
                        'mt-0.5 h-6 w-6 rounded-lg flex items-center justify-center shrink-0 text-zinc-400',
                        isActive && !isLocked && 'text-white',
                        isLocked ? 'text-zinc-500' : m.type === 'chapter' ? 'text-blue-400' : 'text-amber-400',
                      )}>
                        {isLocked ? <Lock className="h-3.5 w-3.5" /> : m.type === 'chapter' ? <BookOpen className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-[12px] font-medium leading-snug', isLocked ? 'text-zinc-500' : isActive ? 'text-white' : 'text-zinc-300')}>
                          {m.title[lang] || m.title.es}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-[10px] text-zinc-500 font-mono">{formatTime(m.timeSeconds)}</span>
                          {isRequired && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500 text-white font-semibold">{t('video.required_badge')}</span>
                          )}
                          {quizResult && (
                            <span className="text-[10px] text-green-400 font-semibold">{quizResult.score}/{quizResult.total} ✓</span>
                          )}
                          {isLocked && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500 font-medium">
                              <Lock className="h-2.5 w-2.5" /> {t('video.locked_badge')}
                            </span>
                          )}
                        </div>
                      </div>
                    </motion.button>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Final del video: "a continuación" con cuenta regresiva cancelable, o
            simplemente volver a verlo si no hay siguiente. Nada arranca sin que
            este cartel lo anuncie primero. */}
        <AnimatePresence>
          {finished && !showOverlay && (
            <motion.div
              key="end-card"
              // Deja libre la barra de controles: con el cartel encima no se podía
              // ni salir de pantalla completa ni mover el video.
              className="absolute inset-x-0 top-0 bottom-20 z-30 flex items-center justify-center bg-gradient-to-b from-black/70 via-black/80 to-black/90 px-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <motion.div
                className="w-full max-w-md text-center"
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                {nextTitle ? (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                      {t('video.up_next')}
                    </p>
                    <p className="mt-2 text-[19px] font-semibold leading-snug text-white text-balance">
                      {nextTitle}
                    </p>

                    <div className="mt-6 flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={playNextNow}
                        className="relative inline-flex items-center gap-2 rounded-full bg-neon-green px-5 py-2.5 text-[13px] font-semibold text-black transition-transform duration-200 hover:scale-[1.03]"
                      >
                        {/* El anillo cuenta el tiempo que falta: se ve cuánto queda
                            sin tener que leer un número. */}
                        {nextCountdown != null && (
                          <motion.span
                            aria-hidden
                            className="absolute inset-0 rounded-full ring-2 ring-white/70"
                            initial={{ opacity: 0.9, scale: 1 }}
                            animate={{ opacity: 0, scale: 1.35 }}
                            transition={{ duration: 1, repeat: Infinity, ease: 'easeOut' }}
                          />
                        )}
                        <SkipForward className="h-4 w-4" />
                        {nextCountdown != null
                          ? t('video.next_in', { s: nextCountdown })
                          : t('video.play_next')}
                      </button>
                      {nextCountdown != null && (
                        <button
                          type="button"
                          onClick={cancelNextUp}
                          className="rounded-full border border-white/20 px-4 py-2.5 text-[13px] font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          {t('video.cancel')}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-[15px] font-medium text-white/80">{t('video.finished')}</p>
                )}

                <button
                  type="button"
                  onClick={replay}
                  className="mt-5 inline-flex items-center gap-1.5 text-[12.5px] text-white/55 transition-colors hover:text-white"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {t('video.watch_again')}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controles */}
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-300',
            showControls || !playing || seeking ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
          // Con el puntero encima, la barra no se esconde. Antes desaparecía a
          // los 3 segundos aunque estuvieras apuntando a un botón — y en pantalla
          // completa, donde hay que recorrer media pantalla para llegar, eso
          // hacía que los botones "no funcionaran".
          onMouseEnter={() => clearTimeout(controlsTimeout.current)}
          onMouseLeave={showControlsTemporarily}
        >
          {/* Degradado */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

          <div className={cn('relative space-y-2', fullscreen ? 'px-6 pb-6 pt-10' : 'px-3 sm:px-4 pb-3 sm:pb-4 pt-8')}>
            {/* Barra de progreso. En pantalla completa y en táctil es más gruesa:
                una línea de 6px es imposible de agarrar con el dedo. */}
            <div
              ref={progressBarRef}
              className={cn(
                'relative rounded-full bg-white/20 cursor-pointer group',
                fullscreen ? 'h-2' : 'h-1.5',
              )}
              onClick={handleProgressClick}
              onMouseDown={handleProgressMouseDown}
            >
              {/* Relleno */}
              <div
                className="absolute h-full rounded-full bg-neon-green transition-[width] duration-100"
                style={{ width: `${progressPct}%` }}
              />
              {/* Tramo aún no desbloqueado (primera pasada). Rayado y con un
                  candado en la frontera: el aprendiz VE por qué la barra no le
                  responde ahí, en vez de pensar que el reproductor está roto. */}
              {watchLimit != null && duration > 0 && unlockedPct < 100 && (
                <>
                  <div
                    aria-hidden
                    className="absolute inset-y-0 right-0 rounded-r-full bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.28)_0_4px,transparent_4px_8px)]"
                    style={{ left: `${unlockedPct}%` }}
                  />
                  <div
                    aria-hidden
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-900/90 ring-1 ring-white/40"
                    style={{ left: `${unlockedPct}%` }}
                  >
                    <Lock className="h-2.5 w-2.5 text-white/85" />
                  </div>
                </>
              )}

              {/* Indicador de posición */}
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${progressPct}%` }}
              />
              {/* Puntos de marcadores */}
              {duration > 0 && sortedMarkers.map((m) => {
                const pct = (m.timeSeconds / duration) * 100
                const quizResult = m.type === 'quiz' ? completedQuizzes[m.id] : undefined
                const isHovered = hoveredMarker === m.id
                return (
                  <div
                    key={m.id}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
                    style={{ left: `${pct}%` }}
                  >
                    <div
                      title=""
                      onClick={(e) => { e.stopPropagation(); seekTo(m.timeSeconds) }}
                      onMouseEnter={() => setHoveredMarker(m.id)}
                      onMouseLeave={() => setHoveredMarker(null)}
                      className={cn(
                        'rounded-full border border-black/20 shadow-sm cursor-pointer transition-transform hover:scale-150',
                        m.type === 'chapter'
                          ? 'h-2.5 w-2.5 bg-blue-400'
                          : quizResult
                            ? 'h-3 w-3 bg-neon-green'
                            : 'h-3 w-3 bg-amber-400',
                      )}
                    />
                    {/* Información emergente */}
                    {isHovered && (
                      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-zinc-900/95 border border-white/10 text-white text-[11px] px-2.5 py-1.5 rounded-lg pointer-events-none shadow-lg">
                        <p className="font-medium">{m.title[lang] || m.title.es}</p>
                        <p className="text-zinc-400 text-[10px] font-mono">{formatTime(m.timeSeconds)}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Fila de controles.

                Se adapta a tres tamaños muy distintos: el reproductor embebido
                en la página, el celular (donde no cabe todo y los dedos piden
                blancos grandes) y la pantalla completa (donde unos iconos de
                16px se ven ridículos y cuestan de acertar). */}
            <div className={cn('flex items-center', fullscreen ? 'gap-4' : 'gap-1.5 sm:gap-3')}>
              {/* Play/Pausa */}
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? 'Pausar' : 'Reproducir'}
                className={cn(ctrlBtn, 'text-white/90 hover:text-white')}
              >
                {playing
                  ? <Pause className={ctrlIcon} />
                  : <Play className={cn(ctrlIcon, 'ml-0.5')} />
                }
              </button>

              {/* Volumen. La corredera se esconde en pantallas chicas: ahí el
                  volumen se maneja con los botones del aparato. */}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={muted || volume === 0 ? 'Activar sonido' : 'Silenciar'}
                  className={cn(ctrlBtn, 'text-white/70 hover:text-white')}
                >
                  {muted || volume === 0
                    ? <VolumeX className={ctrlIconSm} />
                    : <Volume2 className={ctrlIconSm} />
                  }
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  aria-label="Volumen"
                  value={muted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className={cn(
                    'hidden sm:block h-1 accent-neon-green cursor-pointer',
                    fullscreen ? 'w-24' : 'w-16',
                  )}
                />
              </div>

              {/* Tiempo */}
              <span className={cn(
                'shrink-0 font-mono tabular-nums text-white/60',
                fullscreen ? 'text-[13px]' : 'text-[10.5px] sm:text-[11px]',
              )}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              <div className="flex-1" />

              {/* Alternar capítulos (solo en pantalla completa) */}
              {fullscreen && sortedMarkers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFsChapters(!showFsChapters)}
                  className={cn(ctrlBtn, 'flex items-center gap-1.5 text-[12px] font-semibold text-white/70 hover:text-white hover:bg-white/10')}
                >
                  <LayoutList className={ctrlIconSm} />
                  <span className="hidden sm:inline">{t('video.chapters')}</span>
                </button>
              )}

              {/* Llave de mantenimiento del staff. El candado se ve igual que
                  para el aprendiz —así se comprueba que funciona— pero quien
                  sube el contenido necesita poder ir al minuto 15 de un video de
                  veinte sin verlo entero. Es un clic explícito, no una exención
                  silenciosa, y dura solo lo que dure este video en pantalla. */}
              {seekGate.canOverride && seekGate.active && (
                <button
                  type="button"
                  onClick={seekGate.override}
                  title={t('video.staff_unlock_hint')}
                  className={cn(
                    ctrlBtn,
                    'flex items-center gap-1.5 text-[11px] font-semibold text-amber-300/90 hover:bg-white/10 hover:text-amber-200',
                  )}
                >
                  <Lock className={ctrlIconSm} />
                  <span className="hidden md:inline">{t('video.staff_unlock')}</span>
                </button>
              )}

              {/* Semáforo de conexión. Cuando el video se traba, la respuesta a
                  "¿es mi internet?" tiene que estar a la vista y no obligar a
                  salir a probar otra página. */}
              <ConnectionBadge
                quality={connection}
                size={fullscreen ? 'md' : 'sm'}
                className={cn(ctrlBtn, 'shrink-0')}
              />

              {/* Encadenar al terminar. Es una preferencia del aprendiz y se
                  recuerda en su navegador para todos los videos del sitio. */}
              <button
                type="button"
                onClick={() => setAutoplayNext(!autoNext)}
                title={t('video.autoplay_hint')}
                aria-pressed={autoNext}
                className={cn(ctrlBtn, 'hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-white/70 hover:text-white hover:bg-white/10')}
              >
                <span className={cn(
                  'relative h-3.5 w-6 rounded-full transition-colors duration-300',
                  autoNext ? 'bg-neon-green/80' : 'bg-white/25',
                )}>
                  <motion.span
                    className="absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white shadow"
                    animate={{ left: autoNext ? 12 : 2 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                  />
                </span>
                <span className="hidden md:inline">{t('video.autoplay')}</span>
              </button>

              {/* Velocidad de reproducción */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowRates(!showRates)}
                  className={cn(
                    ctrlBtn,
                    'flex items-center gap-1 font-semibold text-white/70 hover:text-white hover:bg-white/10',
                    fullscreen ? 'text-[13px]' : 'text-[11px]',
                  )}
                >
                  {playbackRate}x
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showRates && (
                  <div className="absolute bottom-full right-0 mb-2 overflow-hidden rounded-xl border border-white/10 bg-zinc-950 shadow-xl">
                    {PLAYBACK_RATES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => handleRateChange(r)}
                        className={cn(
                          'block w-full px-5 py-2.5 text-left text-[12.5px] font-medium transition-colors hover:bg-white/10',
                          playbackRate === r ? 'text-neon-green' : 'text-white/80',
                        )}
                      >
                        {r}x
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Imagen en imagen (no disponible con YouTube/Vimeo) */}
              {!isEmbed && typeof document !== 'undefined' && document.pictureInPictureEnabled && (
                <button
                  type="button"
                  onClick={handlePiP}
                  title="Picture in Picture"
                  className={cn(ctrlBtn, 'hidden sm:block text-white/70 hover:text-white')}
                >
                  <PictureInPicture2 className={ctrlIconSm} />
                </button>
              )}

              {/* Pantalla completa */}
              <button
                type="button"
                onClick={handleFullscreen}
                aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
                className={cn(ctrlBtn, 'text-white/70 hover:text-white')}
              >
                {fullscreen
                  ? <Minimize className={ctrlIconSm} />
                  : <Maximize className={ctrlIconSm} />
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Panel de capítulos (sin pantalla completa) ──
          En modo cine no se pinta: la lista vive en el panel lateral, junto a
          los demás videos del módulo. */}
      {sortedMarkers.length > 0 && !fullscreen && !hideChapters && (
        <div className="flex flex-col bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('video.content_header', { count: sortedMarkers.length })}
            </p>
            <AnimatePresence>
              {gateTime != null && (
                <motion.p
                  key="quiz-gate"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 overflow-hidden"
                >
                  <Lock className="h-3 w-3 shrink-0" /> {t('video.locked_hint')}
                </motion.p>
              )}
              {seekGate.active && (
                <motion.p
                  key="seek-gate"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 overflow-hidden"
                >
                  <Lock className="h-3 w-3 shrink-0" /> {t('video.no_skip_hint')}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          {chapterList}
        </div>
      )}
    </div>
  )
}
