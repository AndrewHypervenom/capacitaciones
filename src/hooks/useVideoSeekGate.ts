import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { EMPTY_MARK, readWatchMark, videoWatchKey, writeWatchMark, type WatchMark } from '@/lib/videoWatch'
import { beatVideoWatch, getVideoWatch } from '@/services/videoWatch.service'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'

/**
 * La compuerta de "no se adelanta la primera vez".
 *
 * Reglas, para QUIEN SEA. Antes el staff quedaba exento y el resultado fue el
 * peor posible: quien sube el video lo prueba con su propia cuenta, ve que puede
 * adelantar y concluye —con razón— que el candado no sirve. Ahora el candado se
 * ve igual para todos, y el staff tiene un botón explícito para quitárselo
 * cuando de verdad necesita revisar el minuto 15 de un video de veinte.
 *   · Retroceder SIEMPRE se puede. Repasar no es hacer trampa.
 *   · Adelantar más allá de lo ya visto, no — y cuando se intenta hay que
 *     DECIRLO, no quedarse mudo: un salto que no pasa nada se lee como "el sitio
 *     está fallando".
 *   · Cuando el video se termina una vez, el candado desaparece del todo.
 *
 * QUIÉN MANDA
 * La base. `localStorage` queda como caché para pintar sin parpadeo mientras la
 * consulta viaja, y como último recurso si el SQL no se ha corrido o no hay red.
 * En cuanto el servidor contesta, su marca sustituye a la local —aunque sea
 * MENOR—: si no, bastaría con tocar el almacenamiento del navegador para abrir
 * el video, que es justo lo que este candado existe para impedir.
 */

/** Holgura al reanudar: el reproductor puede reportar un salto pequeño (buffer,
 *  YouTube sondeado a 4 Hz, velocidad 2x) sin que nadie haya adelantado nada. */
const ADVANCE_TOLERANCE = 3
/** Holgura de los saltos. Diminuta a propósito: con la tolerancia del avance
 *  (3 s) se podría adelantar el video a picotazos de tres segundos. */
const SEEK_SLACK = 0.75
/** Cada cuántos segundos vistos se escribe la marca local. */
const SAVE_EVERY = 5
/** Cada cuánto se late contra el servidor mientras se ve. */
const BEAT_EVERY_MS = 10_000
/** Cuánto se queda el aviso de "no puedes adelantar". */
const NOTICE_MS = 3600

export interface VideoSeekGate {
  /** ¿Hay candado ahora mismo? (primera pasada sin terminar y sin desbloquear) */
  active: boolean
  /** Quien mira puede quitarse el candado a mano (solo superadmin y capacitador). */
  canOverride: boolean
  /** Quitarse el candado para revisar. Solo esta sesión y solo en este video. */
  override: () => void
  /** La marca que manda ya llegó (la de la base, o el veredicto de que no hay base). */
  ready: boolean
  /** Segundo más lejano ya visto. Tope de los saltos mientras el candado esté puesto. */
  maxWatched: number
  /** El video ya se vio entero alguna vez. */
  done: boolean
  /** Hay que mostrar el aviso de "no se puede adelantar". */
  notice: boolean
  /** Recorta un destino de salto y avisa si lo recortó. */
  clamp: (target: number) => number
  /** Avance natural de la reproducción: mueve el tope. */
  note: (current: number, duration?: number) => void
  /** El video terminó: se levanta el candado. */
  markDone: (duration?: number) => void
  /** Muestra el aviso a mano (clic en un capítulo bloqueado, p. ej.). */
  warn: () => void
}

export function useVideoSeekGate(videoId: string | null | undefined): VideoSeekGate {
  const { role, user } = useAuth()
  const isLearner = role === 'learner'
  // El staff no queda exento: solo puede levantarlo a mano, y viéndolo primero.
  const canOverride = role === 'superadmin' || role === 'capacitador'
  const localKey = useMemo(
    () => (videoId ? videoWatchKey(user?.id, videoId) : null),
    [videoId, user?.id],
  )

  const [mark, setMark] = useState<WatchMark>(() => (localKey ? readWatchMark(localKey) : { ...EMPTY_MARK }))
  const [ready, setReady] = useState(!videoId || !isLearner)

  // Espejos síncronos: el reproductor consulta el tope entre pintados de React
  // (un salto se decide en el mismo tic en que se pide) y el estado llegaría tarde.
  const maxRef = useRef(mark.max)
  const doneRef = useRef(mark.done)
  const lastSavedRef = useRef(mark.max)
  const localKeyRef = useRef(localKey)
  const videoIdRef = useRef(videoId)
  const durationRef = useRef(0)
  /** Cuándo se latió por última vez y con qué marca, para no repetir latidos vacíos. */
  const lastBeatAtRef = useRef(0)
  const lastBeatMaxRef = useRef(-1)

  const [notice, setNotice] = useState(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>()

  // Desbloqueo del staff: vive en memoria y muere con el video. Ni se guarda ni
  // se manda a la base — no es progreso de nadie, es una llave de mantenimiento.
  const [overridden, setOverridden] = useState(false)
  const overriddenRef = useRef(false)
  const override = useCallback(() => {
    overriddenRef.current = true
    setOverridden(true)
  }, [])

  const persistLocal = useCallback(() => {
    if (!localKeyRef.current) return
    writeWatchMark(localKeyRef.current, { max: maxRef.current, done: doneRef.current })
  }, [])

  /** Aplica lo que dice el servidor: manda él, hacia arriba y hacia abajo. */
  const applyServer = useCallback((serverMax: number, serverDone: boolean) => {
    maxRef.current = serverMax
    doneRef.current = serverDone
    lastSavedRef.current = serverMax
    lastBeatMaxRef.current = serverMax
    persistLocal()
    setMark({ max: serverMax, done: serverDone })
  }, [persistLocal])

  /** Un latido, sin esperar a nadie: el reproductor no se detiene por la red. */
  const beat = useCallback((done = false) => {
    const id = videoIdRef.current
    if (!id || !isLearner) return
    lastBeatAtRef.current = Date.now()
    lastBeatMaxRef.current = maxRef.current
    void beatVideoWatch(id, maxRef.current, durationRef.current || null, done)
      .then((row) => {
        // Solo se aplica si el latido corresponde al video que sigue en pantalla
        // (en modo cine se cambia de video mientras la petición viaja).
        if (row && videoIdRef.current === id) applyServer(row.maxSeconds, row.done)
      })
      .catch(() => { /* best-effort: la marca local aguanta */ })
  }, [isLearner, applyServer])

  // Cambió el video (modo cine reutiliza el mismo hook al pasar al siguiente):
  // se cierra el anterior, se relee la caché local y se pregunta a la base.
  useEffect(() => {
    localKeyRef.current = localKey
    videoIdRef.current = videoId
    durationRef.current = 0
    lastBeatAtRef.current = 0
    lastBeatMaxRef.current = -1
    // Otro video, otro candado: el desbloqueo del staff no se hereda.
    overriddenRef.current = false
    setOverridden(false)

    const cached = localKey ? readWatchMark(localKey) : { ...EMPTY_MARK }
    maxRef.current = cached.max
    doneRef.current = cached.done
    lastSavedRef.current = cached.max
    setMark(cached)

    // La vista previa del capacitador enseña el candado tal cual lo ve el
    // aprendiz —para eso es una vista previa—, pero no consulta ni escribe en la
    // base: la marca del staff no es de nadie, y si se releyera en cero cada vez
    // habría que ver el video entero para revisarlo.
    if (!videoId || !isLearner || !user?.id || IS_LEARNER_PREVIEW) {
      setReady(true)
      return
    }

    // Mientras la base contesta se usa la caché local. Es una ventana de unos
    // pocos cientos de milisegundos y el servidor la corrige apenas llega.
    setReady(false)
    let alive = true
    void getVideoWatch(user.id, videoId).then((row) => {
      if (!alive || videoIdRef.current !== videoId) return
      // `null` = no se pudo consultar (SQL sin correr, sin red): se sigue con la
      // marca local, que es candado débil pero candado.
      if (row) applyServer(row.maxSeconds, row.done)
      setReady(true)
    })
    return () => { alive = false }
  }, [localKey, videoId, isLearner, user?.id, applyServer])

  // Al desmontar (cerrar el módulo, cambiar de vista) se guarda y se late: si no,
  // se perderían los últimos segundos vistos y, en un video corto, todos.
  useEffect(() => {
    const flush = () => {
      persistLocal()
      if (maxRef.current > lastBeatMaxRef.current) beat(doneRef.current)
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
      clearTimeout(noticeTimer.current)
    }
  }, [persistLocal, beat])

  const active = !!videoId && !mark.done && !overridden

  const warn = useCallback(() => {
    setNotice(true)
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(false), NOTICE_MS)
  }, [])

  const markDone = useCallback((duration?: number) => {
    if (!videoIdRef.current || doneRef.current) return
    if (duration && duration > 0) durationRef.current = duration
    // Ojo: aquí no se decide nada, se PIDE. El servidor solo concede el final
    // cuando la marca que él acredita llega hasta allá.
    doneRef.current = true
    persistLocal()
    setMark((m) => ({ ...m, done: true }))
    beat(true)
  }, [persistLocal, beat])

  const note = useCallback((current: number, duration?: number) => {
    if (!videoIdRef.current || !Number.isFinite(current)) return
    if (duration && duration > 0) durationRef.current = duration

    const prev = maxRef.current
    // Solo cuenta el avance natural. Un salto hacia adelante mayor que la holgura
    // no acredita nada (con el candado puesto ni siquiera llega hasta aquí; sin
    // candado da igual, pero así la marca nunca miente).
    if (current > prev && current <= prev + ADVANCE_TOLERANCE) {
      maxRef.current = current
      if (current - lastSavedRef.current >= SAVE_EVERY) {
        lastSavedRef.current = current
        persistLocal()
      }
      // Se repinta cada medio segundo: la barra de progreso muestra el tope y con
      // cada tic (4/s) haría trabajar a React sin que se note diferencia.
      setMark((m) => (current - m.max >= 0.5 ? { ...m, max: current } : m))
    }

    // Latido periódico mientras se ve. Va aquí y no en un temporizador porque
    // solo debe latir quien está REPRODUCIENDO: un video pausado no acredita.
    if (
      isLearner
      && !doneRef.current
      && maxRef.current > lastBeatMaxRef.current
      && Date.now() - lastBeatAtRef.current >= BEAT_EVERY_MS
    ) {
      beat(false)
    }
  }, [persistLocal, beat, isLearner])

  const clamp = useCallback((target: number) => {
    if (!videoIdRef.current || doneRef.current || overriddenRef.current) return target
    if (target <= maxRef.current + SEEK_SLACK) return target
    warn()
    return maxRef.current
  }, [warn])

  // El objeto se memoriza porque los reproductores lo meten en las dependencias
  // de sus callbacks: uno nuevo en cada pintado volvería a montar los oyentes de
  // YouTube/Vimeo en bucle.
  return useMemo(
    () => ({
      active, ready, canOverride, override,
      maxWatched: mark.max, done: mark.done, notice,
      clamp, note, markDone, warn,
    }),
    [active, ready, canOverride, override, mark.max, mark.done, notice, clamp, note, markDone, warn],
  )
}
