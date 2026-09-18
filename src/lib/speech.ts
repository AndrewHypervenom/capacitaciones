/**
 * Voz y escucha del navegador para la práctica de pronunciación.
 *
 * Todo pasa en el equipo de quien aprende: `speechSynthesis` lee la frase y
 * `SpeechRecognition` escucha la respuesta. No se sube audio ni se gasta IA.
 *
 * La API no dice si una voz es de hombre o de mujer: se deduce por el nombre.
 * Las voces "Natural"/"Online" de Edge suenan mucho mejor que las de escritorio,
 * así que se prefieren cuando existen.
 */

/** Nombres de voces masculinas conocidas (Edge, Windows, Chrome, macOS/iOS, Android). */
const MALE_NAMES = [
  'male', 'hombre', 'masculino', 'homem',
  // Edge "Natural" / Azure
  'guy', 'andrew', 'brian', 'christopher', 'eric', 'roger', 'steffan', 'davis', 'jason', 'tony',
  'ryan', 'thomas', 'william', 'liam', 'connor', 'mitchell', 'prabhat',
  'jorge', 'alvaro', 'álvaro', 'gonzalo', 'tomas', 'tomás', 'gerardo', 'cecilio', 'liberto',
  'antonio', 'donato', 'fabio', 'duarte', 'julio', 'nicolau', 'humberto',
  'henri', 'remy', 'rémy', 'jean', 'claude', 'fabrice', 'gerard',
  'conrad', 'killian', 'florian', 'ralf', 'bernd', 'christoph',
  'diego', 'giuseppe', 'benigno', 'cataldo', 'gianni', 'rinaldo',
  'keita', 'daichi', 'naoki', 'yunxi', 'yunjian', 'yunyang', 'injoon', 'hyunsu',
  // Windows escritorio
  'david', 'mark', 'george', 'james', 'richard', 'pablo', 'raul', 'raúl', 'daniel', 'paul', 'stefan', 'cosimo', 'ichiro',
  // macOS / iOS
  'alex', 'fred', 'aaron', 'arthur', 'rishi', 'tom', 'oliver', 'gordon', 'reed', 'rocko', 'eddy', 'grandpa', 'juan', 'luca', 'felipe', 'xander', 'yuri', 'maged',
]

const FEMALE_HINTS = [
  'female', 'mujer', 'femenino', 'mulher', 'zira', 'susan', 'hazel', 'helena', 'sabina', 'maria', 'francisca',
  'jenny', 'aria', 'ava', 'emma', 'michelle', 'libby', 'sonia', 'natasha', 'dalia', 'elvira', 'salome', 'salomé',
  'thalita', 'raquel', 'denise', 'francisca', 'samantha', 'victoria', 'karen', 'moira', 'tessa', 'monica', 'mónica',
  'paulina', 'luciana', 'joana', 'amelie', 'amélie', 'katja', 'elsa', 'nanami', 'xiaoxiao', 'sunhi', 'ana',
]

function words(name: string): string[] {
  return name.toLowerCase().split(/[^a-záéíóúüñç]+/i).filter(Boolean)
}

export function isMaleVoice(v: SpeechSynthesisVoice): boolean {
  const w = words(v.name)
  if (w.some((x) => FEMALE_HINTS.includes(x))) return false
  return w.some((x) => MALE_NAMES.includes(x))
}

function matchesLang(v: SpeechSynthesisVoice, lang: string, exact: boolean): boolean {
  const a = v.lang.replace('_', '-').toLowerCase()
  const b = lang.toLowerCase()
  return exact ? a === b : a.split('-')[0] === b.split('-')[0]
}

/** Orden de preferencia entre voces de la MISMA región: primero la que mejor suena. */
function quality(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase()
  if (n.includes('natural')) return 3
  if (n.includes('online') || n.includes('neural') || n.includes('premium') || n.includes('enhanced')) return 2
  if (n.includes('google')) return 1
  return 0
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Las voces llegan tarde en Chrome: la primera llamada a getVoices() viene vacía. */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!speechSupported()) return Promise.resolve([])
  const now = window.speechSynthesis.getVoices()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener('voiceschanged', done)
      resolve(window.speechSynthesis.getVoices())
    }
    window.speechSynthesis.addEventListener('voiceschanged', done)
    // Hay navegadores que nunca disparan el evento.
    setTimeout(done, 1500)
  })
}

/**
 * Mejor voz para el idioma pedido.
 *
 * LA REGIÓN MANDA SOBRE EL SEXO DE LA VOZ. Windows trae de fábrica voces de
 * Portugal y de España, y una voz pt-PT leyendo portugués de Brasil dice
 * "boa tard" en vez de "boa tardi" y "deskulp" en vez de "deskulpi": enseña
 * una pronunciación que no es la del curso. Una voz de mujer con el acento
 * correcto enseña bien; una de hombre con el acento equivocado, no.
 *
 * Orden: (1) región exacta y de hombre, (2) región exacta, (3) mismo idioma y
 * de hombre, (4) mismo idioma. Sin voz no hay práctica, así que al final se
 * acepta cualquiera del idioma.
 */
export function pickMaleVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  lang = normalizePronLang(lang)
  const rank = (list: SpeechSynthesisVoice[]) => [...list].sort((a, b) => quality(b) - quality(a))[0] ?? null
  const exact = voices.filter((v) => matchesLang(v, lang, true))
  const base = voices.filter((v) => matchesLang(v, lang, false))
  return rank(exact.filter(isMaleVoice))
    ?? rank(exact)
    ?? rank(base.filter(isMaleVoice))
    ?? rank(base)
}

export interface VoiceInfo {
  name: string
  /** Código de la voz elegida ("pt-PT" aunque se pidiera "pt-BR"). */
  lang: string
  /** ¿Es de la región pedida? Si no, la pronunciación que se oye NO es la del curso. */
  sameRegion: boolean
}

/** Qué voz va a sonar para este idioma, para poder avisar si no es la de la región. */
export async function voiceInfoFor(lang: string): Promise<VoiceInfo | null> {
  lang = normalizePronLang(lang)
  const voice = pickMaleVoice(await loadVoices(), lang)
  if (!voice) return null
  return { name: voice.name, lang: voice.lang, sameRegion: matchesLang(voice, lang, true) }
}

/** Velocidades que puede elegir quien aprende. 1 = ritmo natural de la voz. */
export const SPEECH_RATES = [0.6, 0.8, 1, 1.2] as const
export type SpeechRate = (typeof SPEECH_RATES)[number]

/**
 * La frase que está sonando. Es una variable de módulo A PROPÓSITO: Chrome y
 * Edge cortan el audio a media palabra si el navegador recoge el
 * `SpeechSynthesisUtterance` mientras habla. Guardar la referencia hasta el
 * final es el arreglo del "se come la última sílaba".
 */
let current: SpeechSynthesisUtterance | null = null
/** Latido que evita el corte a los ~15 segundos de Chrome. */
let keepAlive: ReturnType<typeof setInterval> | null = null

function stopKeepAlive() {
  if (keepAlive) { clearInterval(keepAlive); keepAlive = null }
}

/**
 * Cola de aire al final. Las voces "Natural" en línea sueltan la última sílaba
 * justo cuando la frase termina ("Desculpe" sonaba "deskul"). Se le añaden
 * comas y un punto: no se leen en voz alta, pero cada coma vale una pausa, y
 * esa pausa es el margen que necesita la cola del audio.
 */
function withTail(text: string): string {
  return `${text.trim()}${' '}, , .`
}

export async function speak(text: string, lang: string, opts: { rate?: number; onEnd?: () => void } = {}): Promise<boolean> {
  if (!speechSupported() || !text.trim()) return false
  lang = normalizePronLang(lang)
  const voices = await loadVoices()
  const synth = window.speechSynthesis
  stopKeepAlive()
  synth.cancel()
  // Cancelar y hablar en el mismo suspiro deja a Chrome en un estado en el que
  // se pierde el arranque: un respiro de un cuadro basta.
  await new Promise((r) => setTimeout(r, 60))
  const u = new SpeechSynthesisUtterance(withTail(text))
  const voice = pickMaleVoice(voices, lang)
  if (voice) u.voice = voice
  u.lang = voice?.lang ?? lang
  u.rate = opts.rate ?? 1
  const finish = () => {
    if (current === u) current = null
    stopKeepAlive()
    opts.onEnd?.()
  }
  u.onend = finish
  u.onerror = finish
  current = u
  synth.speak(u)
  // `resume()` sobre algo que no está en pausa no hace nada; en Chrome basta
  // para que no se corte solo en las frases largas.
  keepAlive = setInterval(() => {
    if (!synth.speaking) { stopKeepAlive(); return }
    synth.resume()
  }, 5000)
  return true
}

export function stopSpeaking() {
  stopKeepAlive()
  current = null
  if (speechSupported()) window.speechSynthesis.cancel()
}

// ─── Reconocimiento ─────────────────────────────────────────────

interface RecognitionLike {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function recognitionSupported(): boolean {
  return recognitionCtor() !== null
}

export type ListenError = 'unsupported' | 'no-speech' | 'not-allowed' | 'network' | 'other'

/**
 * Escucha una sola frase. Devuelve las alternativas que entendió el navegador
 * (varias, para darle a la persona el beneficio de la duda) y una función para
 * cortar antes de tiempo.
 */
export function listenOnce(
  lang: string,
  handlers: { onResult: (alternatives: string[]) => void; onError: (e: ListenError) => void; onEnd: () => void },
): { stop: () => void } {
  const Ctor = recognitionCtor()
  if (!Ctor) {
    handlers.onError('unsupported')
    handlers.onEnd()
    return { stop: () => {} }
  }
  const rec = new Ctor()
  rec.lang = normalizePronLang(lang)
  rec.interimResults = false
  rec.continuous = false
  rec.maxAlternatives = 5
  let settled = false
  rec.onresult = (e) => {
    const first = e.results[0]
    if (!first) return
    settled = true
    handlers.onResult(Array.from(first).map((a) => a.transcript))
  }
  rec.onerror = (e) => {
    const map: Record<string, ListenError> = {
      'no-speech': 'no-speech', 'audio-capture': 'not-allowed', 'not-allowed': 'not-allowed',
      'service-not-allowed': 'not-allowed', network: 'network', aborted: 'no-speech',
    }
    if (settled) return
    settled = true
    handlers.onError(map[e.error] ?? 'other')
  }
  rec.onend = () => {
    if (!settled) handlers.onError('no-speech')
    handlers.onEnd()
  }
  rec.start()
  return { stop: () => rec.stop() }
}

// ─── Comparación ────────────────────────────────────────────────

function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}']/gu, '')
    .replace(/'/g, '')
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/** Unidades a comparar: palabras, o caracteres en idiomas que no separan con espacios. */
function units(text: string): string[] {
  if (CJK.test(text)) return Array.from(text.replace(/[\s\p{P}]/gu, ''))
  return text.split(/\s+/).filter(Boolean)
}

export function tokenize(text: string): string[] {
  return units(text).map(normalizeWord).filter(Boolean)
}

/** Distancia de edición entre dos palabras, para perdonar una letra de más o de menos. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return dp[a.length][b.length]
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  // Palabras largas: se perdona un error (el reconocedor a veces cambia una letra).
  return Math.max(a.length, b.length) >= 5 && editDistance(a, b) <= 1
}

export interface PronunciationResult {
  /** 0–100. */
  score: number
  /** Por cada palabra de la frase original, si se reconoció. */
  words: Array<{ word: string; ok: boolean }>
  heard: string
}

/**
 * Compara la frase esperada con lo que entendió el navegador. Alinea en orden
 * (subsecuencia común más larga) para que una palabra dicha fuera de lugar no
 * cuente como acierto. De varias alternativas se queda con la mejor.
 */
export function scorePronunciation(expected: string, alternatives: string[]): PronunciationResult {
  const original = units(expected)
  const exp = original.map(normalizeWord)
  let best: PronunciationResult = { score: 0, words: original.map((word) => ({ word, ok: false })), heard: alternatives[0] ?? '' }

  for (const alt of alternatives) {
    const got = tokenize(alt)
    const n = exp.length
    const m = got.length
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = exp[i] && sameWord(exp[i], got[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    const ok = Array(n).fill(false)
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (exp[i] && sameWord(exp[i], got[j])) { ok[i] = true; i++; j++ }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++
      else j++
    }
    const counted = exp.filter(Boolean).length || 1
    const hits = ok.filter((x, k) => x && exp[k]).length
    // Palabras de más restan un poco: decir la frase y agregar otra cosa no es 100.
    const extra = Math.max(0, m - hits)
    const score = Math.max(0, Math.round((hits / counted) * 100 - extra * 5))
    if (score > best.score || (score === best.score && !best.heard)) {
      best = { score, words: original.map((word, k) => ({ word, ok: ok[k] || !exp[k] })), heard: alt }
    }
  }
  return best
}

/** Idiomas que se ofrecen en el editor. El valor es el código que usan voz y reconocimiento. */
export const PRONUNCIATION_LANGS: Array<{ value: string; label: string }> = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-MX', label: 'Español (México)' },
  { value: 'es-CO', label: 'Español (Colombia)' },
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'fr-FR', label: 'Français' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'zh-CN', label: '中文 (普通话)' },
  { value: 'ko-KR', label: '한국어' },
]

/**
 * El portugués que se enseña es SIEMPRE el de Brasil (decisión del usuario,
 * 2026-09-18). Cualquier "pt", "pt-PT" o variante —de un bloque viejo, de la
 * IA o escrito a mano— se lee como pt-BR: voz, reconocimiento y selector.
 */
export function normalizePronLang(lang: string): string {
  return /^pt(-|_|$)/i.test(lang.trim()) ? 'pt-BR' : lang
}
