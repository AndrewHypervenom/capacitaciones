import type { FeedbackKind } from '@/services/siteFeedback.service'

/**
 * Interruptor de la campaña temporal de opiniones.
 *
 * En `true` el botón flotante aparece en TODA la plataforma (junto al chat de
 * ayuda), que es lo que queremos mientras recogemos impresiones del sitio.
 * Al ponerlo en `false` desaparece el botón flotante y el buzón sigue vivo en
 * su vista permanente (/suggestions y el enlace del menú del aprendiz): nadie
 * pierde la posibilidad de reportar un error, solo deja de interrumpir.
 */
export const FEEDBACK_CAMPAIGN_ACTIVE = true

/** Rutas donde el botón estorba (pantalla completa, impresión o juego a fondo). */
const HIDDEN_ON = [
  /^\/login/, /^\/reset-password/, /^\/verify\//, /^\/$/,
  /^\/certificate/,          // se imprime / descarga como PDF
  /^\/quiz/,                 // quiz en vivo: cada segundo cuenta
  /^\/simulator\/(run|choice)/,
]

export function shouldShowFeedbackFab(pathname: string): boolean {
  if (!FEEDBACK_CAMPAIGN_ACTIVE) return false
  return !HIDDEN_ON.some((re) => re.test(pathname))
}

// ─── Tipos de opinión ────────────────────────────────────────────
export interface KindMeta {
  key: FeedbackKind
  emoji: string
  /** color de acento (hex) para chips, bordes y realces */
  color: string
}

export const KINDS: KindMeta[] = [
  { key: 'bug',      emoji: '🐞', color: '#ef4444' },
  { key: 'idea',     emoji: '💡', color: '#f59e0b' },
  { key: 'praise',   emoji: '💚', color: '#10D451' },
  { key: 'question', emoji: '🙋', color: '#8b5cf6' },
]

export const kindMeta = (k: FeedbackKind): KindMeta =>
  KINDS.find((x) => x.key === k) ?? KINDS[1]

// ─── Ánimo (1 a 5) ───────────────────────────────────────────────
export const MOODS: { value: number; emoji: string }[] = [
  { value: 1, emoji: '😖' },
  { value: 2, emoji: '🙁' },
  { value: 3, emoji: '😐' },
  { value: 4, emoji: '🙂' },
  { value: 5, emoji: '🤩' },
]

// ─── Zonas del sitio ─────────────────────────────────────────────
export const AREAS = [
  'courses', 'modules', 'quizzes', 'simulations', 'worlds',
  'certificates', 'profile', 'navigation', 'design', 'other',
] as const
export type AreaKey = (typeof AREAS)[number]

/** Zona sugerida según dónde estaba el usuario al abrir el formulario. */
export function areaFromPath(pathname: string): AreaKey | null {
  if (/^\/courses/.test(pathname)) return 'courses'
  if (/^\/modules/.test(pathname)) return 'modules'
  if (/^\/quiz|^\/arena/.test(pathname)) return 'quizzes'
  if (/^\/simulator/.test(pathname)) return 'simulations'
  if (/^\/world|^\/mission/.test(pathname)) return 'worlds'
  if (/^\/certificate|^\/verify/.test(pathname)) return 'certificates'
  if (/^\/profile/.test(pathname)) return 'profile'
  return null
}

// ─── Preguntas predefinidas ──────────────────────────────────────
/**
 * Pregunta de opción única. `i18nKey` cuelga de `feedback.q.<key>` y cada
 * opción de `feedback.q.<key>.opt.<value>`, para no repetir textos aquí.
 */
export interface PresetQuestion {
  key: string
  options: string[]
  /** En qué tipos de opinión aparece. */
  kinds: FeedbackKind[]
}

export const PRESET_QUESTIONS: PresetQuestion[] = [
  {
    key: 'blocked',
    kinds: ['bug'],
    options: ['no_block', 'slowed', 'blocked'],
  },
  {
    key: 'repeats',
    kinds: ['bug'],
    options: ['first_time', 'sometimes', 'always'],
  },
  {
    key: 'impact',
    kinds: ['idea'],
    options: ['nice', 'useful', 'game_changer'],
  },
  {
    key: 'loved',
    kinds: ['praise'],
    options: ['content', 'games', 'design', 'speed', 'support'],
  },
  {
    key: 'urgency',
    kinds: ['question'],
    options: ['whenever', 'this_week', 'today'],
  },
  {
    key: 'device',
    kinds: ['bug', 'idea', 'praise', 'question'],
    options: ['phone', 'tablet', 'computer'],
  },
]

export function questionsFor(kind: FeedbackKind): PresetQuestion[] {
  return PRESET_QUESTIONS.filter((q) => q.kinds.includes(kind))
}

/** Adivina el dispositivo para preseleccionar la respuesta (el usuario manda). */
export function guessDevice(): string {
  if (typeof window === 'undefined') return 'computer'
  const w = window.innerWidth
  if (w < 640) return 'phone'
  if (w < 1024) return 'tablet'
  return 'computer'
}

// ─── Etiqueta legible de la pantalla ─────────────────────────────
const PAGE_LABELS: Array<[RegExp, string]> = [
  [/^\/dashboard/, 'Panel del aprendiz'],
  [/^\/courses\//, 'Detalle de un curso'],
  [/^\/courses/, 'Catálogo de cursos'],
  [/^\/modules/, 'Un módulo de aprendizaje'],
  [/^\/simulator\/choice/, 'Simulación de opciones'],
  [/^\/simulator\/run/, 'Simulación de diálogo'],
  [/^\/simulator\/result/, 'Resultado de simulación'],
  [/^\/certificate/, 'Certificado'],
  [/^\/quiz/, 'Quiz en vivo'],
  [/^\/arena/, 'Arena'],
  [/^\/world/, 'Mapa del mundo'],
  [/^\/mission/, 'Misión'],
  [/^\/profile/, 'Mi perfil'],
  [/^\/suggestions/, 'Mis sugerencias'],
  [/^\/feedback/, 'Retroalimentación del capacitador'],
  [/^\/admin/, 'Panel de gestión'],
]

export function pageLabelFor(pathname: string): string {
  for (const [re, label] of PAGE_LABELS) if (re.test(pathname)) return label
  return pathname
}
