/**
 * Las reglas del juego de los quizzes, en UN solo sitio.
 *
 * El problema que resuelven: hasta ahora fallar no costaba nada. Al primer clic
 * se pintaba la correcta en verde —hubieras acertado o no— y "Reintentar" era
 * infinito, así que cualquiera terminaba con 100 aunque no supiera la respuesta.
 * El panel del capacitador reportaba ese 100 como si fuera conocimiento.
 *
 * Ahora una pregunta se responde con un presupuesto de intentos, el acierto vale
 * menos cada vez, y la respuesta correcta no se enseña hasta que se acierta o se
 * agotan los intentos.
 *
 * Vive en `lib/` y no dentro de un componente porque las MISMAS reglas rigen en
 * los dos sitios donde se responde —el bloque de quiz (`KnowledgeCheck`) y el
 * marcador de video (`VideoQuizOverlay`)—, y una pregunta puede estar en ambos.
 * Si cada uno llevara su cuenta, el mismo fallo valdría distinto según dónde
 * apareciera.
 */

/**
 * El techo que deja cada intento (1-based). Del tercero en adelante, 40.
 *
 * Manda sobre el XP —ahí sí se cobra el fallo entero— y solo LIMITA la nota,
 * que además tiene su propio suelo. Ver `xpFactorForAttempt` y `recordedScore`.
 */
const ATTEMPT_SCORES = [100, 60, 40] as const;

/**
 * Intentos por defecto cuando el curso no dice otra cosa.
 *
 * Tres, no dos: con cuatro opciones y dos que se parecen, dos intentos cierran
 * la pregunta demasiado pronto y el 0 acaba midiendo la redacción de la
 * pregunta más que lo que la persona sabe. Con tres, la escala queda 100/60/40.
 */
export const DEFAULT_QUIZ_ATTEMPTS = 3;

/**
 * Intentos por defecto de los JUEGOS (clasificar, ordenar).
 *
 * Más que en un quiz a propósito: un juego se pierde por arrastrar mal una
 * tarjeta o por no haber entendido la mecánica todavía, no solo por no saber la
 * respuesta. Tres intentos castigarían la torpeza tanto como el desconocimiento.
 */
export const DEFAULT_GAME_ATTEMPTS = 5;

/** Sin límite de intentos: el comportamiento viejo, para quien lo quiera. */
export const UNLIMITED_ATTEMPTS = 0;

export interface QuizPolicy {
  /** Intentos por pregunta. `UNLIMITED_ATTEMPTS` (0) = sin tope. */
  maxAttempts: number;
  /** Intentos por juego (clasificar, ordenar). 0 = sin tope. */
  gameAttempts: number;
  /**
   * Puntaje mínimo del módulo (`cert_conditions.module_pass_pct`). Es el SUELO
   * de la nota: fallar la baja hasta aquí y ni un punto más.
   */
  minScore: number;
}

export const DEFAULT_QUIZ_POLICY: QuizPolicy = {
  maxAttempts: DEFAULT_QUIZ_ATTEMPTS,
  gameAttempts: DEFAULT_GAME_ATTEMPTS,
  minScore: 80,
};


/** El techo del intento `attempt` (1-based). */
export function scoreForAttempt(attempt: number): number {
  if (attempt < 1) return 0;
  return ATTEMPT_SCORES[Math.min(attempt, ATTEMPT_SCORES.length) - 1];
}

/**
 * Cuánto XP se paga por resolverlo en el intento `attempt`, de 0 a 1.
 *
 * **Aquí es donde duele fallar**, y a propósito: el XP se puede perder entero
 * sin que nadie se quede atascado. La nota, en cambio, tiene suelo (ver
 * `recordedScore`) porque de ella cuelga poder avanzar.
 *
 * `attempt` 0 = lo resolvió practicando, con los intentos ya agotados: cuenta
 * para pasar, pero no paga nada.
 */
export function xpFactorForAttempt(attempt: number): number {
  if (attempt < 1) return 0;
  return scoreForAttempt(attempt) / 100;
}

/**
 * La nota que queda registrada.
 *
 * Dos límites que hacen cosas distintas:
 *  · El TECHO lo pone el intento: clavar el 100% a la segunda no vale 100.
 *  · El SUELO lo pone el mínimo del módulo: por muchos intentos que gaste,
 *    resolverlo nunca deja la nota por debajo de lo que hace falta para pasar.
 *
 * Lo que el suelo NO tapa es el desempeño malo: quien de verdad saca 50% en un
 * juego se queda con 50, porque eso sí es lo que hizo. El suelo perdona el
 * castigo por reintentar, no la ejecución.
 *
 * Sin esto, agotar los intentos dejaba la nota en 0, el promedio del módulo se
 * hundía y alguien tenía que ir a desbloquear gente a mano.
 */
export function recordedScore(pct: number, attempt: number, minScore: number): number {
  const clean = Math.max(0, Math.min(100, Math.round(pct)));
  return Math.min(clean, Math.max(scoreForAttempt(attempt), Math.max(0, Math.min(100, minScore))));
}

/** ¿Quedan intentos después de haber gastado `used`? */
export function hasAttemptsLeft(used: number, policy: QuizPolicy): boolean {
  if (policy.maxAttempts === UNLIMITED_ATTEMPTS) return true;
  return used < policy.maxAttempts;
}

/**
 * ¿Se le enseña ya cuál era la correcta?
 *
 * Solo cuando acertó, o cuando ya no le quedan intentos. Enseñarla antes es lo
 * que convertía el quiz en un trámite: fallar, mirar el verde, reintentar.
 */
export function shouldRevealAnswer(
  correct: boolean,
  used: number,
  policy: QuizPolicy,
): boolean {
  return correct || !hasAttemptsLeft(used, policy);
}
