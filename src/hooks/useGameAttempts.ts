import { useProgressStore } from '@/stores/progressStore';
import { recordedScore, xpFactorForAttempt, type QuizPolicy, DEFAULT_QUIZ_POLICY } from '@/lib/quizPolicy';

/**
 * El presupuesto de intentos de un juego (clasificar, ordenar).
 *
 * Mismo trato que los quizzes y por el mismo motivo: sin tope, cualquiera
 * repetía hasta clavar el 100% y la nota dejaba de decir nada. Con tope, el
 * techo baja en cada intento — pero **agotarlo no cierra el contenido**: se
 * sigue jugando en modo práctica, y llegar al umbral ahí abre el módulo igual.
 * Nadie se queda esperando a que un capacitador lo desatasque.
 *
 * Los juegos llevan más intentos que los quizzes a propósito: un juego también
 * se pierde por arrastrar mal una tarjeta o por no haber entendido la mecánica,
 * no solo por no saber la respuesta.
 */
export function useGameAttempts({
  moduleId,
  unitKey,
  policy = DEFAULT_QUIZ_POLICY,
  savedAttemptCount = 0,
}: {
  moduleId?: string;
  /** La misma clave con la que la compuerta cruza esta unidad. */
  unitKey: string;
  policy?: QuizPolicy;
  /** Intentos ya gastados según la base (no se pueden borrar del navegador). */
  savedAttemptCount?: number;
}) {
  const spendAttempt = useProgressStore((s) => s.spendQuizAttempt);
  const local = useProgressStore(
    (s) => (moduleId ? s.quizAttempts[moduleId]?.[unitKey] ?? 0 : 0),
  );
  const used = Math.max(local, savedAttemptCount);
  const max = policy.gameAttempts;
  const left = max === 0 ? Infinity : Math.max(0, max - used);
  /** Se acabó el presupuesto: lo que venga después es práctica, y no puntúa. */
  const practice = left <= 0;

  /**
   * Cierra un intento y dice con qué nota y con cuánto XP se guarda.
   *
   * En práctica (presupuesto agotado) el XP es 0 —ahí se cobra el fallo— pero
   * la nota NO cae a cero: `recordedScore` la deja en el mínimo del módulo, así
   * que quien resuelve el juego pasa siempre. Sin ese suelo, el promedio se
   * hundía y había que ir a desbloquear gente a mano.
   */
  const settle = (pct: number) => {
    const attempt = practice ? 0 : moduleId ? spendAttempt(moduleId, unitKey) : used + 1;
    return {
      score: recordedScore(pct, attempt, policy.minScore),
      xpFactor: xpFactorForAttempt(attempt),
      attempt,
      practice,
    };
  };

  return { used, left, max, practice, settle };
}
