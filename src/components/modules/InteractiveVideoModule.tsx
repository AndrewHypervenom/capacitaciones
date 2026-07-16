import { useCallback, useEffect, useRef, useState } from 'react'
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
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { VideoQuizOverlay } from './VideoQuizOverlay'
import { YouTubePlayer } from './YouTubePlayer'
import { VimeoPlayer } from './VimeoPlayer'
import type { PlayerLike } from '@/lib/youtube'
import { saveActivityAttempt } from '@/services/activity.service'
import type { ModuleSection, VideoMarker, VideoQuizMarker } from '@/data/modules'
import type { Language } from '@/stores/userStore'

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
}

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

interface QuizResult {
  score: number
  total: number
}

export function InteractiveVideoModule({ section, language, userId, campaignId, moduleId, savedQuizResults }: InteractiveVideoModuleProps) {
  const { t } = useTranslation()
  const videoRef = useRef<PlayerLike | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const chapterListRef = useRef<HTMLDivElement>(null)
  const triggeredRef = useRef<Set<string>>(new Set())
  const lastSaveRef = useRef(0)
  const lastTimeRef = useRef(0)

  const [playing, setPlaying] = useState(false)
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

  const markers = section.videoMarkers ?? []
  const videoUrl = section.media?.url ?? null
  const isYouTube = section.media?.type === 'youtube'
  const isVimeo = section.media?.type === 'vimeo'
  // Embeds por iframe (YouTube/Vimeo): sin PiP y con el mismo patrón de sondeo de tiempo.
  const isEmbed = isYouTube || isVimeo
  const sortedMarkers = [...markers].sort((a, b) => a.timeSeconds - b.timeSeconds)

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
          triggeredRef.current.add(id)
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

  // Ocultar controles automáticamente
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true)
    clearTimeout(controlsTimeout.current)
    if (playing) {
      controlsTimeout.current = setTimeout(() => setShowControls(false), 3000)
    }
  }, [playing])

  useEffect(() => {
    return () => clearTimeout(controlsTimeout.current)
  }, [])

  // Listener de cambio de pantalla completa
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // Atajos de teclado
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!containerRef.current) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (showOverlay) return

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
  }, [showOverlay, playing])

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const cur = v.currentTime
    const prev = lastTimeRef.current
    lastTimeRef.current = cur
    setCurrentTime(cur)
    // Mantener la duración fresca (YouTube la expone tarde y sin evento propio).
    if (v.duration) setDuration((d) => (Math.abs(v.duration - d) > 0.5 ? v.duration : d))

    // Guardar posición cada SAVE_INTERVAL segundos
    if (cur - lastSaveRef.current >= SAVE_INTERVAL) {
      lastSaveRef.current = cur
      try {
        localStorage.setItem(getProgressKey(section.heading?.es), String(cur))
      } catch { /* ignore */ }
    }

    // Verificar marcadores de quiz por CRUCE (prev < marcador ≤ actual). Esto funciona
    // igual con el evento denso de <video> nativo que con el sondeo de YouTube (~250ms),
    // donde el tiempo salta y una ventana fija se saltaría el marcador.
    for (const m of sortedMarkers) {
      if (m.type !== 'quiz') continue
      if (triggeredRef.current.has(m.id)) continue
      if (prev < m.timeSeconds && cur >= m.timeSeconds) {
        triggeredRef.current.add(m.id)
        v.pause()
        setPlaying(false)
        setActiveMarker(m as VideoQuizMarker)
        setShowOverlay(true)
        break
      }
    }
  }, [sortedMarkers, section.heading?.es])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (playing) {
      v.pause()
    } else {
      v.play()
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

  const seekTo = (secs: number) => {
    const v = videoRef.current
    if (!v) return
    let target = Math.max(0, Math.min(secs, duration))
    // Compuerta de avance: si hay un quiz pendiente por delante, no se puede saltar
    // hasta él ni más allá. Usamos `>=` a propósito: aterrizar EXACTAMENTE sobre el
    // marcador rompería la detección por cruce (prev < t && cur >= t) y el quiz se
    // saltaría; por eso lo dejamos justo antes para que la reproducción lo dispare.
    const gate = firstPendingQuizTime()
    if (gate != null && target >= gate) {
      target = Math.max(0, gate - 0.4)
    }
    v.currentTime = target
    // Sincronizar la referencia de cruce: un salto manual no debe disparar quizzes
    // intermedios; solo el avance natural de la reproducción los cruza.
    lastTimeRef.current = target
  }

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
  const handleQuizGraded = (score: number, total: number) => {
    if (!activeMarker) return
    setCompletedQuizzes((prev) => ({ ...prev, [activeMarker.id]: { score, total } }))

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
        },
      })
    }
  }

  const handleOverlayComplete = () => {
    setShowOverlay(false)
    setActiveMarker(null)
    videoRef.current?.play()
    setPlaying(true)
  }

  // "Repasar el video": cierra el quiz sin responderlo y regresa al inicio del
  // segmento (marcador anterior) para volver a ver la información. Como el quiz
  // sigue pendiente, la compuerta de avance se mantiene y el overlay reaparece
  // al cruzar de nuevo el marcador.
  const handleReviewQuiz = () => {
    if (!activeMarker) return
    const markerTime = activeMarker.timeSeconds
    triggeredRef.current.delete(activeMarker.id)
    setShowOverlay(false)
    setActiveMarker(null)
    const prev = sortedMarkers.filter((m) => m.timeSeconds < markerTime).pop()
    seekTo(prev ? prev.timeSeconds : Math.max(0, markerTime - 20))
    videoRef.current?.play()
    setPlaying(true)
  }

  const handleRetryQuiz = (markerId: string) => {
    triggeredRef.current.delete(markerId)
    const marker = sortedMarkers.find((m) => m.id === markerId) as VideoQuizMarker | undefined
    if (!marker) return
    seekTo(marker.timeSeconds - 1)
    videoRef.current?.play()
    setPlaying(true)
  }

  const handleLoadedMetadata = () => {
    const dur = videoRef.current?.duration ?? 0
    setDuration(dur)
    triggeredRef.current.clear()
    // Re-sembrar los quizzes ya hechos para que no vuelvan a interrumpir el video.
    for (const id of Object.keys(completedQuizzes)) triggeredRef.current.add(id)
    lastTimeRef.current = videoRef.current?.currentTime ?? 0

    try {
      const saved = parseFloat(localStorage.getItem(getProgressKey(section.heading?.es)) ?? '0')
      if (saved > 10 && saved < dur - 5) {
        setSavedTime(saved)
        setShowResumeToast(true)
      }
    } catch { /* ignore */ }
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
    setPulseGate(true)
    window.setTimeout(() => setShakeMarkerId((c) => (c === markerId ? null : c)), 550)
    window.setTimeout(() => setPulseGate(false), 1300)
    const gate = firstPendingQuizTime()
    if (gate != null && chapterListRef.current) {
      const idx = sortedMarkers.findIndex((mm) => mm.type === 'quiz' && mm.timeSeconds === gate)
      const el = idx >= 0 ? (chapterListRef.current.children[idx] as HTMLElement | undefined) : undefined
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0
  // Tope actual: tiempo del primer quiz pendiente. Todo marcador posterior está
  // bloqueado hasta que se realice esa verificación.
  const gateTime = firstPendingQuizTime()

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
        const isPassing = quizResult && quizResult.score / quizResult.total >= 0.75
        // Bloqueado: hay un quiz pendiente antes de este marcador en la línea de tiempo.
        const isLocked = gateTime != null && m.timeSeconds > gateTime
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
                  videoRef.current?.play()
                  setPlaying(true)
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
    >
      {/* ── Área de video ── */}
      <div className={cn('relative bg-black', fullscreen ? 'flex-1 flex flex-col' : 'aspect-video w-full')}>
        {isYouTube && videoUrl ? (
          <YouTubePlayer
            videoId={videoUrl}
            playerRef={videoRef}
            className="absolute inset-0 w-full h-full [&_iframe]:pointer-events-auto"
            onReady={handleLoadedMetadata}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={handleTimeUpdate}
          />
        ) : isVimeo && videoUrl ? (
          <VimeoPlayer
            videoId={videoUrl}
            playerRef={videoRef}
            className="absolute inset-0 w-full h-full [&_iframe]:pointer-events-auto"
            onReady={handleLoadedMetadata}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={handleTimeUpdate}
          />
        ) : (
          <video
            ref={(el) => { videoRef.current = el }}
            src={videoUrl ?? undefined}
            className="absolute inset-0 w-full h-full object-contain cursor-pointer"
            preload="metadata"
            onClick={togglePlay}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setPlaying(false)}
          />
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

        {/* Botón grande de play cuando está pausado */}
        <AnimatePresence>
          {!playing && !showOverlay && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              key="big-play"
            >
              <div className="h-16 w-16 rounded-full bg-white/15 backdrop-blur-sm flex items-center justify-center border border-white/20">
                <Play className="h-7 w-7 text-white ml-1" />
              </div>
            </div>
          )}
        </AnimatePresence>

        {/* Superposición de quiz */}
        <AnimatePresence>
          {showOverlay && activeMarker && (
            <VideoQuizOverlay
              key={activeMarker.id}
              marker={activeMarker}
              language={language}
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
              className="absolute right-0 top-0 h-full w-72 bg-zinc-900/97 border-l border-white/10 z-30 flex flex-col"
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
              </div>
              <div className="flex-1 overflow-y-auto">
                {sortedMarkers.map((m, i) => {
                  const isActive = i === activeChapterIdx
                  const quizResult = m.type === 'quiz' ? completedQuizzes[m.id] : undefined
                  const isLocked = gateTime != null && m.timeSeconds > gateTime
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
                        seekTo(m.timeSeconds); videoRef.current?.play(); setPlaying(true); setShowFsChapters(false)
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

        {/* Controles */}
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 transition-opacity duration-300',
            showControls || !playing || seeking ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
        >
          {/* Degradado */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />

          <div className="relative px-4 pb-4 pt-8 space-y-2">
            {/* Barra de progreso */}
            <div
              ref={progressBarRef}
              className="relative h-1.5 rounded-full bg-white/20 cursor-pointer group"
              onClick={handleProgressClick}
              onMouseDown={handleProgressMouseDown}
            >
              {/* Relleno */}
              <div
                className="absolute h-full rounded-full bg-neon-green transition-[width] duration-100"
                style={{ width: `${progressPct}%` }}
              />
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

            {/* Fila de controles */}
            <div className="flex items-center gap-3">
              {/* Play/Pausa */}
              <button
                type="button"
                onClick={togglePlay}
                className="text-white/90 hover:text-white transition-colors shrink-0"
              >
                {playing
                  ? <Pause className="h-5 w-5" />
                  : <Play className="h-5 w-5 ml-0.5" />
                }
              </button>

              {/* Volumen */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="text-white/70 hover:text-white transition-colors"
                >
                  {muted || volume === 0
                    ? <VolumeX className="h-4 w-4" />
                    : <Volume2 className="h-4 w-4" />
                  }
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 h-1 accent-neon-green cursor-pointer"
                />
              </div>

              {/* Tiempo */}
              <span className="text-[11px] text-white/60 font-mono shrink-0">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>

              <div className="flex-1" />

              {/* Alternar capítulos (solo en pantalla completa) */}
              {fullscreen && sortedMarkers.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFsChapters(!showFsChapters)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                >
                  <LayoutList className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('video.chapters')}</span>
                </button>
              )}

              {/* Velocidad de reproducción */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowRates(!showRates)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {playbackRate}x
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showRates && (
                  <div className="absolute bottom-full right-0 mb-2 rounded-xl border border-white/15 bg-zinc-900/95 backdrop-blur-sm overflow-hidden shadow-xl">
                    {PLAYBACK_RATES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => handleRateChange(r)}
                        className={cn(
                          'block w-full px-4 py-2 text-[12px] font-medium text-left transition-colors hover:bg-white/10',
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
                  className="text-white/70 hover:text-white transition-colors shrink-0"
                >
                  <PictureInPicture2 className="h-4 w-4" />
                </button>
              )}

              {/* Pantalla completa */}
              <button
                type="button"
                onClick={handleFullscreen}
                className="text-white/70 hover:text-white transition-colors shrink-0"
              >
                {fullscreen
                  ? <Minimize className="h-4 w-4" />
                  : <Maximize className="h-4 w-4" />
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Panel de capítulos (sin pantalla completa) ── */}
      {sortedMarkers.length > 0 && !fullscreen && (
        <div className="flex flex-col bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800">
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800 shrink-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              {t('video.content_header', { count: sortedMarkers.length })}
            </p>
            <AnimatePresence>
              {gateTime != null && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 overflow-hidden"
                >
                  <Lock className="h-3 w-3 shrink-0" /> {t('video.locked_hint')}
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
