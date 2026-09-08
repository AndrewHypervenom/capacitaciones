/**
 * El recorrido completo de un curso, en UN solo lugar.
 *
 * Antes el porcentaje del curso solo contaba módulos: quien terminaba el
 * temario veía 100% y el botón del certificado seguía apagado, sin ninguna
 * pista de que todavía le faltaba practicar en el simulador, jugar el mundo o
 * presentar el examen final. El número decía "ya está" y la pantalla decía
 * "todavía no".
 *
 * Aquí el curso se mide por PASOS, no por módulos: cada módulo es un paso, cada
 * simulación asignada es un paso, el mundo es un paso y el examen final es un
 * paso. Con 9 módulos y una simulación, terminar el temario es 90% — que es
 * exactamente lo que le falta al aprendiz por hacer.
 *
 * Lo que NO hace: decidir candados. Quién puede entrar a qué lo sigue
 * resolviendo CoursePage con las reglas de desbloqueo del capacitador; esto
 * solo cuenta y ordena lo que falta.
 */

/** Las cuatro etapas que puede tener un curso. Este es también su orden. */
export type JourneyStageKey = 'modules' | 'practice' | 'world' | 'exam';

export const JOURNEY_ORDER: JourneyStageKey[] = ['modules', 'practice', 'world', 'exam'];

export interface JourneyStage {
  key: JourneyStageKey;
  /** Pasos que aporta la etapa. 0 = el curso no la tiene y no se pinta. */
  total: number;
  done: number;
  /** Se puede hacer ahora (falso = lo abre otra etapa o el capacitador). */
  unlocked: boolean;
}

export interface CourseJourney {
  stages: JourneyStage[];
  /** Solo las etapas que este curso tiene (total > 0), en orden. */
  present: JourneyStage[];
  total: number;
  done: number;
  /** 0-1. Con el curso vacío (sin nada asignado) vale 0, nunca NaN. */
  pct: number;
  /** Primera etapa incompleta: lo que toca hacer ahora. */
  next: JourneyStageKey | null;
  /** Etapas incompletas, en orden: el "te falta…" en palabras. */
  pending: JourneyStageKey[];
  complete: boolean;
}

/** Una etapa tal como la recibe el constructor. `unlocked` solo pinta el
 *  candado del desglose: quien no lo sepa (la vista en lote del catálogo) puede
 *  omitirlo en vez de inventárselo. */
export interface JourneyStageInput {
  total: number;
  done: number;
  unlocked?: boolean;
}

export interface CourseJourneyInput {
  modules: { total: number; done: number };
  /** Simulaciones publicadas del curso y cuántas ya aprobó. */
  practice: JourneyStageInput;
  /** El mundo del curso, si existe y está publicado. `total` es 0 o 1. */
  world: JourneyStageInput;
  /** El examen final, si el capacitador lo publicó. `total` es 0 o 1. */
  exam: JourneyStageInput;
}

/* ── Las reglas de "esto ya está" ──────────────────────────────────────────
   Viven aquí y solo aquí: la página del curso las aplica sobre sus lecturas
   detalladas y el catálogo sobre una lectura en lote de todos los cursos a la
   vez. Si divergieran, la tarjeta y la página del mismo curso mostrarían dos
   porcentajes distintos, que es justo lo que este archivo existe para evitar. */

/** Una práctica está hecha cuando su MEJOR puntaje llega al umbral del escenario. */
export function isPracticeDone(
  scenario: { slug: string; passScore: number },
  bestBySlug: Record<string, number>,
): boolean {
  return (bestBySlug[scenario.slug] ?? 0) >= scenario.passScore;
}

export function countPracticeDone(
  scenarios: Array<{ slug: string; passScore: number }>,
  bestBySlug: Record<string, number>,
): number {
  return scenarios.filter((sc) => isPracticeDone(sc, bestBySlug)).length;
}

/**
 * El mundo como UN paso, no uno por nivel: si no, un mundo de veinte niveles se
 * comería el porcentaje del curso entero. Un mundo sin niveles no aporta nada
 * (no hay nada que hacer en él).
 */
export function worldStage(levels: number, levelsDone: number): { total: number; done: number } {
  if (levels <= 0) return { total: 0, done: 0 };
  return { total: 1, done: levelsDone >= levels ? 1 : 0 };
}

export function buildCourseJourney(input: CourseJourneyInput): CourseJourney {
  const stages: JourneyStage[] = [
    {
      key: 'modules',
      total: input.modules.total,
      done: Math.min(input.modules.done, input.modules.total),
      // El temario siempre está abierto: el candado va módulo a módulo, no
      // sobre la etapa entera.
      unlocked: true,
    },
    { key: 'practice', ...clamp(input.practice) },
    { key: 'world', ...clamp(input.world) },
    { key: 'exam', ...clamp(input.exam) },
  ];

  const present = stages.filter((s) => s.total > 0);
  const total = present.reduce((acc, s) => acc + s.total, 0);
  const done = present.reduce((acc, s) => acc + s.done, 0);
  const pending = present.filter((s) => s.done < s.total).map((s) => s.key);

  return {
    stages,
    present,
    total,
    done,
    pct: total > 0 ? done / total : 0,
    next: pending[0] ?? null,
    pending,
    complete: total > 0 && done >= total,
  };
}

function clamp(s: JourneyStageInput) {
  const total = Math.max(0, s.total);
  return { total, done: Math.max(0, Math.min(s.done, total)), unlocked: s.unlocked ?? true };
}
