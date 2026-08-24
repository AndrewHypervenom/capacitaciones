import { toUtcMs } from '@/lib/datetime'

/* ────────────────────────────────────────────────────────────────────────────
   Límite de tiempo para terminar un curso.

   Dos formas de decirlo, porque las dos se usan en la vida real:

   · 'days' — "tienes 15 días desde que te lo asignan". Cada persona tiene su
     propia fecha, contada desde SU asignación (`assigned_at`, sea la suya o la
     de su campaña; manda la más antigua, que es cuando de verdad lo tuvo).
   · 'date' — "todo el mundo lo entrega antes del 30 de noviembre". Una sola
     fecha para todos, típico de lo normativo.

   `deadline_blocks` decide qué pasa al vencer: por defecto solo AVISA (el curso
   se sigue pudiendo hacer, tarde); si se activa, el curso se cierra y hay que
   pedirle al capacitador que amplíe el plazo.

   Todo esto degrada solo: si el SQL todavía no se corrió, las columnas llegan
   `undefined`, el modo se lee como 'none' y el sitio se comporta como antes.
   ──────────────────────────────────────────────────────────────────────────── */

export type DeadlineMode = 'none' | 'days' | 'date'

/** Días que faltan a partir de los cuales el aviso se pone urgente. */
export const DEADLINE_SOON_DAYS = 3

/** Tope del plazo en días: 10 años. Evita el 2147483647 pegado sin querer. */
export const DEADLINE_MAX_DAYS = 3650

const DAY_MS = 86_400_000

/** La parte del curso que define el plazo (lo que trae la fila de `courses`). */
export interface CourseDeadline {
  deadline_mode?: DeadlineMode | null
  deadline_days?: number | null
  deadline_date?: string | null
  deadline_blocks?: boolean | null
}

/** Modo efectivo, tolerante a columnas que aún no existen o a valores raros. */
export function deadlineMode(course: CourseDeadline | null | undefined): DeadlineMode {
  const m = course?.deadline_mode
  if (m === 'days') return (course?.deadline_days ?? 0) > 0 ? 'days' : 'none'
  if (m === 'date') return course?.deadline_date ? 'date' : 'none'
  return 'none'
}

/**
 * Fin del día de una fecha suelta ('YYYY-MM-DD') en milisegundos.
 *
 * `deadline_date` es un `date` sin hora: si lo tomáramos tal cual, el plazo
 * vencería a las 00:00 y el último día no contaría. El plazo llega hasta el
 * final de ese día.
 */
function endOfDay(date: string): number | null {
  const ms = toUtcMs(`${date}T23:59:59.999`)
  return ms
}

/**
 * Instante en que vence el curso para ESTA persona, o null si no tiene plazo.
 *
 * `assignedAt` es la marca de asignación más antigua que le aplica (directa o
 * por campaña). Sin ella, el modo por días no tiene desde dónde contar: pasa
 * con los cursos de catálogo en los que todavía no se ha inscrito, y ahí lo
 * honesto es no inventar una fecha (se muestra "tienes N días" a secas).
 */
export function courseDueMs(
  course: CourseDeadline | null | undefined,
  assignedAt?: string | null,
): number | null {
  switch (deadlineMode(course)) {
    case 'date':
      return endOfDay(course!.deadline_date!)
    case 'days': {
      const start = toUtcMs(assignedAt)
      if (start === null) return null
      return start + course!.deadline_days! * DAY_MS
    }
    default:
      return null
  }
}

export type DeadlineState = 'none' | 'ok' | 'soon' | 'overdue'

export interface DeadlineInfo {
  state: DeadlineState
  /** Instante de vencimiento, o null si no hay plazo (o no se puede fechar). */
  dueMs: number | null
  /** Días completos que faltan; negativo = días de retraso. 0 = vence hoy. */
  daysLeft: number
  /** El curso se cierra: venció, bloquea y no está terminado. */
  blocked: boolean
}

const NO_DEADLINE: DeadlineInfo = { state: 'none', dueMs: null, daysLeft: 0, blocked: false }

/**
 * Estado del plazo para pintarlo y para decidir si el curso sigue abierto.
 *
 * A quien ya terminó no se le dice nada: el plazo era para que lo hiciera, y
 * ya lo hizo. Marcarle "vencido" a alguien que entregó sería mentirle.
 */
export function deadlineInfo(
  course: CourseDeadline | null | undefined,
  opts: { assignedAt?: string | null; completed?: boolean; now?: number } = {},
): DeadlineInfo {
  const dueMs = courseDueMs(course, opts.assignedAt)
  if (dueMs === null) return NO_DEADLINE
  if (opts.completed) return { ...NO_DEADLINE, dueMs }

  const now = opts.now ?? Date.now()
  // Días COMPLETOS que faltan: 0 significa "vence hoy", no "ya venció".
  // Negativo = días completos de retraso.
  const daysLeft = Math.floor((dueMs - now) / DAY_MS)
  const overdue = now > dueMs
  const state: DeadlineState = overdue ? 'overdue' : daysLeft <= DEADLINE_SOON_DAYS ? 'soon' : 'ok'

  return {
    state,
    dueMs,
    daysLeft,
    blocked: overdue && !!course?.deadline_blocks,
  }
}

/** Fecha del vencimiento en el idioma del usuario ("15 de marzo de 2026"). */
export function formatDueDate(dueMs: number, language: string): string {
  const locale = language === 'en' ? 'en-US' : language === 'pt' ? 'pt-BR' : 'es-CO'
  return new Date(dueMs).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}
