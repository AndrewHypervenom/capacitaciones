// Motor de sonido procedural para quizzes (Web Audio, sin archivos).
// Unifica el audio de los quizzes de módulo y de video interactivo, igual que
// ya lo hacen mundos, arenas y juegos. El capacitador elige el "tema" por
// módulo; aquí solo se traduce ese tema a tonos.

export type QuizSoundTheme = 'chime' | 'arcade' | 'soft' | 'off'
export type QuizSoundKind = 'correct' | 'wrong' | 'complete'

export const DEFAULT_QUIZ_SOUND_THEME: QuizSoundTheme = 'chime'

export const QUIZ_SOUND_THEMES: { value: QuizSoundTheme; labelKey: string }[] = [
  { value: 'chime', labelKey: 'admin.modules.sound_theme_chime' },
  { value: 'arcade', labelKey: 'admin.modules.sound_theme_arcade' },
  { value: 'soft', labelKey: 'admin.modules.sound_theme_soft' },
  { value: 'off', labelKey: 'admin.modules.sound_theme_off' },
]

export function normalizeQuizSoundTheme(theme: string | null | undefined): QuizSoundTheme {
  if (theme === 'arcade' || theme === 'soft' || theme === 'off' || theme === 'chime') return theme
  return DEFAULT_QUIZ_SOUND_THEME
}

// Tema activo: lo fija la página del módulo/preview al cargar, de modo que los
// quizzes anidados no necesiten recibir el tema por props.
let activeTheme: QuizSoundTheme = DEFAULT_QUIZ_SOUND_THEME

export function setQuizSoundTheme(theme: string | null | undefined) {
  activeTheme = normalizeQuizSoundTheme(theme)
}

export function getQuizSoundTheme(): QuizSoundTheme {
  return activeTheme
}

// ─── Núcleo de reproducción ─────────────────────────────────────────────

// Un solo AudioContext reutilizable; se crea de forma perezosa tras la primera
// interacción del usuario (los quizzes siempre suenan tras un click/respuesta).
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

function playTones(tones: Tone[]) {
  const c = getCtx()
  if (!c) return
  const t0 = c.currentTime
  for (const tone of tones) {
    try {
      const osc = c.createOscillator()
      const vol = c.createGain()
      osc.connect(vol)
      vol.connect(c.destination)
      osc.type = tone.wave ?? 'sine'
      const start = t0 + tone.at
      const end = start + tone.dur
      osc.frequency.setValueAtTime(tone.freq, start)
      vol.gain.setValueAtTime(tone.gain ?? 0.2, start)
      vol.gain.exponentialRampToValueAtTime(0.0001, end)
      osc.start(start)
      osc.stop(end)
    } catch {
      /* si un oscilador falla, seguimos con los demás */
    }
  }
}

// ─── Definición de temas ────────────────────────────────────────────────

const THEMES: Record<Exclude<QuizSoundTheme, 'off'>, Record<QuizSoundKind, Tone[]>> = {
  chime: {
    correct: [
      { freq: 523.25, at: 0, dur: 0.16, wave: 'triangle', gain: 0.18 },
      { freq: 659.25, at: 0.09, dur: 0.16, wave: 'triangle', gain: 0.18 },
      { freq: 783.99, at: 0.18, dur: 0.24, wave: 'triangle', gain: 0.2 },
    ],
    wrong: [
      { freq: 329.63, at: 0, dur: 0.18, wave: 'sine', gain: 0.16 },
      { freq: 246.94, at: 0.14, dur: 0.28, wave: 'sine', gain: 0.16 },
    ],
    complete: [
      { freq: 523.25, at: 0, dur: 0.12, wave: 'triangle', gain: 0.18 },
      { freq: 659.25, at: 0.1, dur: 0.12, wave: 'triangle', gain: 0.18 },
      { freq: 783.99, at: 0.2, dur: 0.12, wave: 'triangle', gain: 0.18 },
      { freq: 1046.5, at: 0.3, dur: 0.12, wave: 'triangle', gain: 0.2 },
      { freq: 1318.5, at: 0.4, dur: 0.45, wave: 'sine', gain: 0.22 },
    ],
  },
  arcade: {
    correct: [
      { freq: 660, at: 0, dur: 0.09, wave: 'square', gain: 0.12 },
      { freq: 880, at: 0.08, dur: 0.14, wave: 'square', gain: 0.12 },
    ],
    wrong: [
      { freq: 200, at: 0, dur: 0.12, wave: 'sawtooth', gain: 0.14 },
      { freq: 120, at: 0.12, dur: 0.2, wave: 'sawtooth', gain: 0.14 },
    ],
    complete: [
      { freq: 523.25, at: 0, dur: 0.08, wave: 'square', gain: 0.12 },
      { freq: 659.25, at: 0.08, dur: 0.08, wave: 'square', gain: 0.12 },
      { freq: 783.99, at: 0.16, dur: 0.08, wave: 'square', gain: 0.12 },
      { freq: 1046.5, at: 0.24, dur: 0.08, wave: 'square', gain: 0.12 },
      { freq: 1318.5, at: 0.32, dur: 0.3, wave: 'square', gain: 0.14 },
    ],
  },
  soft: {
    correct: [{ freq: 659.25, at: 0, dur: 0.28, wave: 'sine', gain: 0.12 }],
    wrong: [{ freq: 293.66, at: 0, dur: 0.32, wave: 'sine', gain: 0.11 }],
    complete: [
      { freq: 523.25, at: 0, dur: 0.24, wave: 'sine', gain: 0.12 },
      { freq: 783.99, at: 0.18, dur: 0.4, wave: 'sine', gain: 0.13 },
    ],
  },
}

/**
 * Reproduce el efecto de un quiz. Usa el tema activo (fijado por la página del
 * módulo) salvo que se pase uno explícito. El tema `off` silencia todo.
 */
export function playQuizSound(kind: QuizSoundKind, theme?: string | null) {
  const resolved = normalizeQuizSoundTheme(theme ?? activeTheme)
  if (resolved === 'off') return
  playTones(THEMES[resolved][kind])
}
