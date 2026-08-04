// Sonido de las notificaciones (Web Audio, sin archivos).
//
// Aparte del motor de quizzes (`sound.ts`) a propósito: aquel tiene "tema" por
// módulo y puede estar en 'off' sin que eso signifique silenciar los avisos del
// sistema. Aquí manda una sola preferencia: la campana suena o no suena.
//
// El timbre es deliberadamente corto y suave (dos notas con una tercera de
// brillo): tiene que reconocerse en una oficina sin sobresaltar a nadie.

import { soundEnabledNow, useNotificationPrefs, VOLUME_GAIN } from '@/stores/notificationPrefsStore'

export type NotificationSoundKind = 'ping' | 'info'

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    // El navegador arranca el audio suspendido hasta que hay un gesto del
    // usuario. Quien recibe el aviso lleva rato usando el panel, así que casi
    // siempre reanuda; si no, el aviso se ve igual (nunca depende del sonido).
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

interface Tone {
  freq: number
  /** inicio relativo, en segundos */
  at: number
  dur: number
  wave?: OscillatorType
  gain?: number
}

// 'ping' = alguien escribió al chat de ayuda: campana ascendente, clara.
// 'info' = aviso genérico (retroalimentación, restablecimiento): más plano.
const KINDS: Record<NotificationSoundKind, Tone[]> = {
  ping: [
    { freq: 880, at: 0, dur: 0.14, wave: 'sine', gain: 0.16 },
    { freq: 1174.66, at: 0.1, dur: 0.2, wave: 'sine', gain: 0.15 },
    { freq: 1567.98, at: 0.2, dur: 0.42, wave: 'triangle', gain: 0.09 },
  ],
  info: [
    { freq: 659.25, at: 0, dur: 0.16, wave: 'sine', gain: 0.13 },
    { freq: 987.77, at: 0.12, dur: 0.34, wave: 'sine', gain: 0.11 },
  ],
}

function emit(kind: NotificationSoundKind) {
  const c = getCtx()
  if (!c) return
  const mult = VOLUME_GAIN[useNotificationPrefs.getState().volume] ?? 1
  const t0 = c.currentTime
  for (const tone of KINDS[kind]) {
    try {
      const osc = c.createOscillator()
      const vol = c.createGain()
      osc.connect(vol)
      vol.connect(c.destination)
      osc.type = tone.wave ?? 'sine'
      const start = t0 + tone.at
      const end = start + tone.dur
      osc.frequency.setValueAtTime(tone.freq, start)
      vol.gain.setValueAtTime((tone.gain ?? 0.14) * mult, start)
      vol.gain.exponentialRampToValueAtTime(0.0001, end)
      osc.start(start)
      osc.stop(end)
    } catch {
      /* si un oscilador falla, seguimos con los demás */
    }
  }
}

/**
 * Reproduce el timbre de aviso, respetando la preferencia del navegador
 * (interruptor, volumen y silencio temporal). Nunca lanza.
 */
export function playNotificationSound(kind: NotificationSoundKind = 'ping') {
  if (!soundEnabledNow()) return
  emit(kind)
}

/**
 * Suena una vez para que se oiga cómo quedó (botón "Probar" de las opciones).
 * Se salta el silencio temporal: probar el sonido es un gesto explícito.
 */
export function previewNotificationSound() {
  if (!useNotificationPrefs.getState().sound) return
  emit('ping')
}
