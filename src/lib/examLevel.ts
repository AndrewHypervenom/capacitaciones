import type { TFunction } from 'i18next'
import type { ExamDifficulty, ExamTargetLevel } from '@/types/exam'

/* ────────────────────────────────────────────────────────────────────────────
   El nivel del examen, en un solo sitio.

   El examen final declara a qué nivel evalúa (`target_level`) y eso es un
   CONTRATO, no una etiqueta: la IA solo escribe a ese nivel, los quizzes de
   módulo de otro nivel no se copian y el examen no se publica con preguntas
   fuera de nivel. Aquí viven las etiquetas y los avisos para que las cuatro
   pantallas que lo tocan digan exactamente lo mismo.
   ──────────────────────────────────────────────────────────────────────────── */

/** Niveles, en el mismo orden en toda la aplicación (de menor a mayor). */
export const DIFFICULTIES: ExamDifficulty[] = ['basico', 'medio', 'avanzado']

export function difficultyLabel(t: TFunction, d: ExamTargetLevel): string {
  return d === 'basico'
    ? t('courses.level_basico', 'Básico')
    : d === 'avanzado'
      ? t('courses.level_avanzado', 'Avanzado')
      : d === 'mixta'
        ? t('admin.exam.level_mixed', 'Mezcla de niveles')
        : t('courses.level_medio', 'Medio')
}

/** Color de la píldora de nivel. El ámbar queda reservado para "fuera de nivel". */
export const DIFFICULTY_PILL: Record<ExamDifficulty, string> = {
  basico: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300',
  medio: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300',
  avanzado: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300',
}

/** `true` si el examen exige un nivel concreto (no acepta mezcla). */
export function isLevelLocked(target: ExamTargetLevel | undefined): target is ExamDifficulty {
  return target !== undefined && target !== 'mixta'
}

/** Una pregunta de nivel `d` ¿entra en un examen de nivel `target`? */
export function levelFits(target: ExamTargetLevel | undefined, d: ExamDifficulty): boolean {
  return !isLevelLocked(target) || target === d
}

/** El texto que explica el bloqueo. Mismo en el modal, en el banco y al publicar. */
export function levelMismatchText(t: TFunction, target: ExamDifficulty, n?: number): string {
  return n === undefined
    ? t('admin.exam.level_mismatch_one', {
        level: difficultyLabel(t, target),
        defaultValue:
          'Este examen evalúa a nivel {{level}}: solo admite preguntas de ese nivel.',
      })
    : t('admin.exam.level_mismatch_n', {
        n,
        level: difficultyLabel(t, target),
        defaultValue:
          'Hay {{n}} preguntas que no son de nivel {{level}}, y este examen solo evalúa a ese nivel.',
      })
}
