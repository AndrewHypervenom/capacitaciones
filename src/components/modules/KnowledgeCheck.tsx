import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Sparkles, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SectionQuiz } from '@/data/modules';
import type { Language } from '@/stores/userStore';
import { useProgressStore } from '@/stores/progressStore';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';
import { playQuizSound } from '@/lib/sound';
import { shuffledIndicesMoved } from '@/lib/quizShuffle';
import { saveActivityAttempt } from '@/services/activity.service';
import { toast } from '@/stores/toastStore';
import {
  DEFAULT_QUIZ_POLICY,
  hasAttemptsLeft,
  recordedScore,
  shouldRevealAnswer,
  xpFactorForAttempt,
  type QuizPolicy,
} from '@/lib/quizPolicy';
import { RichTextInline } from '@/components/ui/RichText';

interface Props {
  moduleId: string;
  sectionIdx: number;
  sectionId?: string;
  userId?: string;
  campaignId?: string;
  quiz: SectionQuiz;
  language: Language;
  quizIndex?: number;
  totalQuizzes?: number;
  /**
   * Identificador único del quiz dentro del módulo. Necesario para los quizzes
   * que vienen como bloques dinámicos (varios por sección): sin él, todos los
   * bloques de una sección colisionarían en el store y en la compuerta. Se
   * guarda en el intento (`quiz_key`) para poder cruzarlo con `gradedUnits`.
   */
  quizKey?: string;
  /**
   * Último intento guardado en la base para este quiz. Permite restaurar la
   * respuesta cuando el store local (localStorage) no la tiene todavía —p. ej.
   * en otro dispositivo o tras limpiar el navegador— para que el aprendiz no
   * tenga que responderla de nuevo.
   */
  savedAttempt?: any;
  /**
   * Cuántos intentos lleva gastados esta pregunta SEGÚN LA BASE. Es lo que
   * impide recuperar el presupuesto limpiando el navegador o entrando desde
   * otro equipo: el store local solo puede sumar, nunca restar.
   */
  savedAttemptCount?: number;
  /**
   * Reglas del curso: cuántos intentos tiene la pregunta. Si no llega, se
   * usan las de fábrica (ver src/lib/quizPolicy.ts) — nunca "sin límite", que
   * era el comportamiento que había que quitar.
   */
  policy?: QuizPolicy;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'];

/**
 * Deduce el índice de la opción elegida a partir de un intento guardado.
 * Prioriza el índice explícito (`opcion_index`); si es un intento antiguo,
 * intenta casar el texto en cualquier idioma; como último recurso, si acertó
 * (score 100) asume la opción correcta.
 */
function restoredOptionIndex(savedAttempt: any, quiz: SectionQuiz): number | null {
  const sa = savedAttempt?.submitted_answers;
  if (!sa) return null;
  if (typeof sa.opcion_index === 'number' && sa.opcion_index >= 0) return sa.opcion_index;
  const chosen = sa.opcion_elegida;
  if (typeof chosen === 'string') {
    for (const lang of ['es', 'en', 'pt'] as const) {
      const idx = quiz.options[lang]?.indexOf(chosen);
      if (typeof idx === 'number' && idx >= 0) return idx;
    }
  }
  if (savedAttempt?.score === 100) return quiz.correct;
  return null;
}

const CONFETTI_COLORS = [
  'bg-neon-green',
  'bg-neon-magenta',
  'bg-amber-400',
  'bg-neon-green',
  'bg-neon-magenta',
  'bg-orange-400',
  'bg-neon-green',
  'bg-neon-magenta',
];

function ConfettiPiece({
  color,
  angle,
  delay,
  isBar,
}: {
  color: string;
  angle: number;
  delay: number;
  isBar?: boolean;
}) {
  const rad = (angle * Math.PI) / 180;
  const dist = 56 + Math.random() * 24;
  const x = Math.cos(rad) * dist;
  const y = Math.sin(rad) * dist;
  return (
    <motion.span
      className={cn(
        'absolute',
        color,
        isBar ? 'h-0.5 w-2 rounded-sm' : 'h-2.5 w-2.5 rounded-full',
      )}
      style={{ top: '50%', left: '50%' }}
      initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
      animate={{ x, y: y - 28, opacity: 0, scale: 0.3, rotate: angle }}
      transition={{ duration: 0.75, delay, ease: [0.16, 1, 0.3, 1] }}
    />
  );
}

export function KnowledgeCheck({
  moduleId,
  sectionIdx,
  sectionId,
  userId,
  campaignId,
  quiz,
  language,
  quizIndex,
  totalQuizzes,
  quizKey,
  savedAttempt,
  savedAttemptCount = 0,
  policy = DEFAULT_QUIZ_POLICY,
}: Props) {
  const { t } = useTranslation();
  const recordCheck = useProgressStore((s) => s.recordCheck);
  const recordQuizResult = useProgressStore((s) => s.recordQuizResult);
  const markQuizFailed = useProgressStore((s) => s.markQuizFailed);

  // Llave estable del quiz dentro del módulo: la explícita (bloques) o el índice
  // de sección (quiz de sección tradicional).
  const storeKey = quizKey ?? String(sectionIdx);

  // stored: respuesta persistida en el store (undefined si nunca respondió, -1 si la borró)
  const stored = useProgressStore((s) => s.checkAnswers[moduleId]?.[storeKey]);

  // Inicializar con la respuesta guardada para que al volver a la página el quiz
  // siga mostrándose respondido (y no parezca que "no se guardó nada"). El store
  // local manda; si no tiene nada (undefined), caemos al intento de la base.
  const [selected, setSelected] = useState<number | null>(() => {
    if (typeof stored === 'number' && stored >= 0) return stored;
    if (stored === undefined) {
      const idx = restoredOptionIndex(savedAttempt, quiz);
      if (idx !== null && idx >= 0) return idx;
    }
    return null;
  });

  // El intento de la base puede llegar de forma asíncrona (fetch en ModulePage):
  // si aún no hay respuesta local ni selección, restauramos desde la base y
  // sincronizamos el store para que la compuerta del módulo la cuente.
  useEffect(() => {
    if (selected !== null || stored !== undefined) return;
    const idx = restoredOptionIndex(savedAttempt, quiz);
    if (idx !== null && idx >= 0) {
      setSelected(idx);
      recordCheck(moduleId, storeKey, idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAttempt, stored]);
  const [showConfetti, setShowConfetti] = useState(false);
  const reducedMotion = useReducedMotion();

  /* ── El presupuesto de intentos ─────────────────────────────────────────
     Sale del store persistido, no de un `useState`: si viviera solo en el
     componente, recargar la página devolvería los intentos y el tope no
     serviría de nada. */
  const spendQuizAttempt = useProgressStore((s) => s.spendQuizAttempt);
  const localAttempts = useProgressStore(
    (s) => s.quizAttempts[moduleId]?.[storeKey] ?? 0,
  );
  /* El mayor de los dos. El local va por delante (responde sin esperar al
     guardado) y el de la base es el que no se puede borrar desde el navegador.
     Cuando el capacitador reinicia, se van los dos a la vez: borra las filas y
     el aviso de reinicio limpia la caché local (ver applyReset). */
  const attemptsUsed = Math.max(localAttempts, savedAttemptCount);
  const attemptsLeft = policy.maxAttempts === 0
    ? Infinity
    : Math.max(0, policy.maxAttempts - attemptsUsed);

  /**
   * ¿Falló esta pregunta un día ANTERIOR? Es lo único que hace que acertarla
   * cuente como redención ("Segunda Oportunidad").
   *
   * Se lee del store, no de un `useState` de la sesión: con estado local,
   * fallar y acertar en el mismo minuto volvía a pagar el logro — justo el
   * atajo que el tope de intentos viene a cerrar.
   */
  const failedOn = useProgressStore((s) => s.quizFailedOn[moduleId]?.[storeKey]);
  const failedBefore = !!failedOn && failedOn < new Date().toISOString().split('T')[0];


  /**
   * Modo práctica: se agotaron los intentos y la persona quiere volver a
   * responderla igual.
   *
   * La NOTA ya está cerrada (quedó en 0) y no se vuelve a tocar: no se gasta
   * intento, no se guarda nada y el capacitador sigue viendo lo que de verdad
   * pasó. Lo que se reabre es la pregunta, para poder comprobar que ya se
   * entendió. Sin esto la pantalla terminaba en "cuenta como fallada" y punto
   * muerto: ni decía qué hacer, ni dejaba hacer nada.
   */
  const [practice, setPractice] = useState(false);

  // Orden en que se pintan las opciones. Es SOLO presentación: la respuesta
  // elegida, el store y el intento guardado siguen usando el índice original,
  // así que un intento viejo se restaura igual de bien. Se rebaraja al
  // reintentar para que repetir no sea recordar dónde estaba la buena.
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const optionCount = quiz.options[language]?.length ?? 0;
  const order = useMemo(
    () => shuffledIndicesMoved(optionCount),
    // El idioma entra a propósito: cambiarlo repinta las opciones y el orden
    // debe rehacerse para el número de opciones de ESE idioma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [optionCount, language, shuffleSeed],
  );

  /**
   * Opción que se está guardando. Mientras tanto el quiz NO está respondido:
   * solo se da por respondido cuando la base confirma el intento.
   *
   * Antes se marcaba respondido en el navegador y el guardado iba aparte, sin
   * esperar. Si fallaba, el quiz se veía contestado para siempre —no se podía
   * volver a responder— pero la base no lo tenía, así que la compuerta del
   * módulo lo seguía pidiendo y el aprendiz se quedaba trabado sin salida.
   */
  const [saving, setSaving] = useState<number | null>(null);

  /** Guarda el intento y dice si la base lo confirmó de verdad. */
  const persistAttempt = async (payload: Record<string, unknown>): Promise<boolean> => {
    const { data, error } = await saveActivityAttempt({
      user_id: userId,
      campaign_id: campaignId,
      module_id: moduleId,
      section_id: sectionId || '',
      game_type: 'KNOWLEDGE_CHECK',
      time_spent_seconds: 0,
      ...payload,
    });
    // `data` vacío = la operación no tocó ninguna fila: tampoco quedó guardado.
    const ok = !error && Array.isArray(data) && data.length > 0;
    if (!ok) toast.error(t('module.check_save_failed'));
    return ok;
  };

  // ─── ELEGIR OPCIÓN ────────────────────────────────────────────────────────
  const choose = async (i: number) => {
    if (selected !== null || saving !== null) return;
    // Sin intentos solo se puede responder en modo práctica, y eso no puntúa.
    if (!practice && !hasAttemptsLeft(attemptsUsed, policy)) return;

    /* ── Modo práctica ────────────────────────────────────────────────────
       La NOTA ya está cerrada y no se toca: no gasta intento y su puntaje no
       cuenta. Pero sí se guarda, marcado como práctica, por una razón que no
       es cosmética: acertar aquí es lo que DESBLOQUEA el módulo.

       Nota y desbloqueo son cosas distintas. La nota dice qué sabía la persona
       sin ayuda —y se queda en 0—; el desbloqueo dice si ya lo entendió. Sin
       esta fila, un quiz fallado dejaba el módulo cerrado y alguien tenía que
       ir a reiniciarle la actividad a cada persona: una pregunta mal redactada
       se convertía en setecientos desbloqueos a mano. */
    if (practice) {
      const ok = i === quiz.correct;
      if (userId && campaignId) {
        setSaving(i);
        const saved = await persistAttempt({
          /* Resolverlo aquí vale el MÍNIMO del módulo, no 0: el XP ya se
             perdió entero al agotar los intentos, y hundir además la nota es
             lo que dejaba el módulo cerrado y obligaba a desbloquear gente a
             mano. Fallar practicando sigue valiendo 0, pero como el promedio
             se queda con el mejor intento, no le quita nada ya ganado. */
          score: recordedScore(ok ? 100 : 0, 0, policy.minScore),
          status: ok ? 'completed' : 'failed',
          submitted_answers: {
            quiz_key: quizKey ?? null,
            opcion_index: i,
            practica: true,
            correcta: ok,
            pregunta: quiz.question[language],
            opcion_elegida: quiz.options[language][i],
            opcion_correcta: quiz.options[language][quiz.correct],
            mensaje_detalle: ok
              ? 'Practicando tras agotar los intentos: acertó (nota al mínimo, sin XP)'
              : 'Practicando tras agotar los intentos: falló',
          },
        });
        setSaving(null);
        if (!saved) return; // sigue sin responder: puede volver a elegir
      }
      setSelected(i);
      playQuizSound(ok ? 'correct' : 'wrong');
      return;
    }

    const isCorrectAnswer = i === quiz.correct;
    // Número que tendrá este intento. Se gasta de verdad (spendQuizAttempt)
    // solo cuando la base lo confirma: un guardado fallido no cuesta intento.
    const usedNow = (useProgressStore.getState().quizAttempts[moduleId]?.[storeKey] ?? 0) + 1;
    /* Dos cosas distintas, y solo una puede llegar a cero:
       · La NOTA baja con el intento pero tiene SUELO en el mínimo del módulo,
         para que resolverlo nunca impida completar.
       · El XP sí se cobra entero: a la primera se paga completo, después menos.
       Antes cualquier reintento guardaba 100 y el panel leía el último intento,
       así que insistir borraba el error. */
    const score = recordedScore(isCorrectAnswer ? 100 : 0, usedNow, policy.minScore);
    const xpFactor = xpFactorForAttempt(usedNow);

    // 1. Guardar en la base y esperar la confirmación (solo si hay ids; sin
    //    ellos —vista sin sesión completa— se queda en el navegador como antes).
    if (userId && campaignId) {
      setSaving(i);
      const saved = await persistAttempt({
        score,
        status: isCorrectAnswer ? 'completed' : 'failed',
        submitted_answers: {
          quiz_key: quizKey ?? null,
          opcion_index: i,
          aciertos: isCorrectAnswer ? 1 : 0,
          total: 1,
          errores: isCorrectAnswer ? 0 : 1,
          pregunta: quiz.question[language],
          opcion_elegida: quiz.options[language][i],
          opcion_correcta: quiz.options[language][quiz.correct],
          // Explícito para el panel del capacitador (no deducirlo del puntaje).
          correcta: isCorrectAnswer,
          // El número de intento es lo que convierte el detalle en información:
          // "acertó" no dice lo mismo a la primera que a la tercera después de
          // dos fallos.
          intento: usedNow,
          intentos_max: policy.maxAttempts || null,
          mensaje_detalle: isCorrectAnswer
            ? usedNow > 1
              ? `Acertó en el intento ${usedNow}`
              : null
            : `Respondió "${quiz.options[language][i]}" — correcto era "${quiz.options[language][quiz.correct]}"`,
        },
      });
      setSaving(null);
      if (!saved) return; // sigue sin responder: puede volver a elegir
    }

    // 2. Confirmado: ahora sí queda respondido en pantalla y en el store.
    setSelected(i);
    recordCheck(moduleId, storeKey, i);
    // Este intento ya se gastó, se acierte o no.
    spendQuizAttempt(moduleId, storeKey);

    // Sonido de feedback (usa el tema del módulo activo).
    playQuizSound(isCorrectAnswer ? 'correct' : 'wrong');

    // Alimentar los logros de desempeño: aciertos totales, racha de aciertos y
    // redención (fallar y luego acertar la misma pregunta). Un fallo reinicia la
    // racha dentro del store.
    // `moduleId` va al store para que distinga repaso de primera vez: si el
    // módulo ya está completado, el acierto paga tarifa de repaso (ver
    // XP_REWARDS.reviewRate) en vez del precio completo.
    /* Redención: solo si el fallo fue OTRO DÍA. Antes bastaba fallar y acertar
       al segundo clic —con la correcta ya pintada en verde delante—, así que el
       logro premiaba justo el atajo que el tope de intentos viene a cerrar.
       Volver al día siguiente y acertar sí es haberlo estudiado. */
    const redeemed = isCorrectAnswer && failedBefore;
    recordQuizResult(isCorrectAnswer, redeemed, moduleId, xpFactor);
    if (!isCorrectAnswer) markQuizFailed(moduleId, storeKey);

    // 3. Confetti si acertó
    if (isCorrectAnswer && !reducedMotion) {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 800);
    }
  };

  // ─── REINTENTAR (solo cuando falló) ──────────────────────────────────────
  const retry = () => {
    if (!hasAttemptsLeft(attemptsUsed, policy)) return;
    setSelected(null);
    setShuffleSeed((n) => n + 1);
    // Limpiamos la RESPUESTA, no los intentos gastados: el presupuesto no se
    // recarga por reintentar, que es justo lo que lo hacía inútil.
    recordCheck(moduleId, storeKey, -1); // -1 = sin respuesta
  };

  /** Reabre la pregunta SIN puntuar: la nota ya quedó cerrada en 0. */
  const startPractice = () => {
    setPractice(true);
    setSelected(null);
    setShuffleSeed((n) => n + 1);
  };

  const answered = selected !== null;
  const correct = answered && selected === quiz.correct;
  /* ¿Se le enseña ya cuál era la buena? Solo si acertó o se quedó sin intentos.
     Esta línea es el cambio de fondo: antes la correcta se pintaba en verde en
     cuanto respondías, así que fallar, mirar y reintentar era gratis. */
  const revealed = answered && (practice || shouldRevealAnswer(correct, attemptsUsed, policy));
  /** Falló y todavía le quedan intentos: se le dice que no, no cuál era. */
  const canRetry = answered && !correct && !practice && hasAttemptsLeft(attemptsUsed, policy);
  /** Se quedó sin intentos sin acertar. La nota quedó cerrada en 0. */
  const exhausted = answered && !correct && !practice && !hasAttemptsLeft(attemptsUsed, policy);

  return (
    <motion.div
      className="mt-10 rounded-3xl overflow-hidden glass-md"
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-glass-border/8">
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-xl bg-neon-green/8 flex items-center justify-center ring-1 ring-neon-green/14">
            <Sparkles className="h-3.5 w-3.5 text-neon-green" />
          </div>
          <span className="text-[11px] uppercase tracking-wider text-text-subtle font-semibold">
            {t('module.knowledge_check')}
          </span>
          {/* La regla se anuncia ANTES, no al agotarla. Enterarse de que había
              dos intentos cuando ya no queda ninguno es una trampa, no una
              regla: nadie puede administrar un presupuesto que no sabía que
              tenía. */}
          {!answered && policy.maxAttempts > 0 && (
            <span className="text-[11px] tabular-nums text-text-subtle">
              · {t('module.check_attempts_budget', { count: attemptsLeft })}
            </span>
          )}
        </div>

        {/* Indicadores de progreso (multi-quiz) */}
        {totalQuizzes !== undefined && totalQuizzes > 1 && quizIndex !== undefined && (
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalQuizzes }).map((_, i) => (
              <motion.span
                key={i}
                className={cn(
                  'inline-block rounded-full transition-all duration-300',
                  i < quizIndex
                    ? 'h-2 w-2 bg-neon-green'
                    : i === quizIndex
                      ? answered
                        ? correct
                          ? 'h-2 w-2 bg-neon-green'
                          : 'h-2 w-2 bg-neon-magenta'
                        : 'h-2.5 w-2.5 bg-text-muted'
                      : 'h-1.5 w-1.5 bg-glass-border/20',
                )}
              />
            ))}
          </div>
        )}
      </div>

      <div className="px-6 py-6">
        {/* Pregunta */}
        <p className="text-[16.5px] font-semibold leading-snug mb-6 tracking-tight">
          <RichTextInline text={quiz.question[language]} />
        </p>

        {/* Opciones */}
        <div className="space-y-2.5 mb-2">
          {/* Se recorre el orden barajado: `i` es el índice ORIGINAL de la opción
              y `position` solo decide su letra y el retardo de entrada. */}
          {order.map((i, position) => {
            const opt = quiz.options[language][i];
            const isSelected = selected === i;
            // `isCorrect` solo se puede usar para PINTAR cuando ya se reveló.
            const isCorrect = i === quiz.correct;
            const showCorrect = revealed && isCorrect;
            const showState = answered;

            return (
              <motion.button
                key={i}
                onClick={() => void choose(i)}
                disabled={answered || saving !== null || (!practice && attemptsLeft <= 0)}
                initial={reducedMotion ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: reducedMotion ? 0 : position * 0.07,
                  duration: 0.3,
                  ease: [0.16, 1, 0.3, 1],
                }}
                whileHover={!answered && !reducedMotion ? { scale: 1.006, y: -1 } : undefined}
                whileTap={!answered && !reducedMotion ? { scale: 0.98 } : undefined}
                className={cn(
                  'w-full text-left flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border transition-all duration-200 group',
                  !showState &&
                    'glass border-glass-border/10 hover:border-neon-green/25 hover:bg-glass/6 cursor-pointer',
                  showState && isSelected && isCorrect && 'glass border-neon-green/25 bg-neon-green/6',
                  showState && isSelected && !isCorrect && 'glass border-neon-magenta/25 bg-neon-magenta/6',
                  showState && !isSelected && showCorrect && 'glass border-neon-green/20 opacity-70',
                  showState && !isSelected && !showCorrect && 'glass border-glass-border/5 opacity-35',
                  answered && 'cursor-default',
                  // Guardando: la elegida queda marcada y las demás se apagan.
                  saving !== null && (saving === i ? 'border-neon-green/25 animate-pulse' : 'opacity-50'),
                  saving !== null && 'cursor-wait',
                )}
              >
                {/* Badge de letra / check / X */}
                <span
                  className={cn(
                    'shrink-0 relative inline-flex items-center justify-center h-8 w-8 rounded-xl text-[12px] font-bold transition-all',
                    !showState &&
                      'bg-glass/8 text-text-muted group-hover:bg-neon-green/10 group-hover:text-neon-green border border-glass-border/10',
                    showState && isSelected && isCorrect && 'bg-neon-green/80 text-black',
                    showState && isSelected && !isCorrect && 'bg-neon-magenta/80 text-white',
                    showState && !isSelected && showCorrect && 'bg-neon-green/10 text-neon-green',
                    showState && !isSelected && !showCorrect && 'bg-glass/8 text-text-subtle',
                  )}
                >
                  {showState && !isSelected && showCorrect ? (
                    // La correcta que no eligió. Antes era su letra pintada de
                    // verde y no se leía como "esta era": parecía decoración.
                    <Check className="h-4 w-4" strokeWidth={3} />
                  ) : showState && isSelected ? (
                    <>
                      {isCorrect ? (
                        <Check className="h-4 w-4" strokeWidth={3} />
                      ) : (
                        <X className="h-4 w-4" strokeWidth={3} />
                      )}
                      {/* Confetti */}
                      {isCorrect &&
                        showConfetti &&
                        !reducedMotion &&
                        CONFETTI_COLORS.map((color, ci) => (
                          <ConfettiPiece
                            key={ci}
                            color={color}
                            angle={(ci / CONFETTI_COLORS.length) * 360 + 30}
                            delay={ci * 0.05}
                            isBar={ci % 2 === 0}
                          />
                        ))}
                    </>
                  ) : (
                    OPTION_LABELS[position] ?? String(position + 1)
                  )}
                </span>

                <span className="text-[14.5px] leading-snug flex-1"><RichTextInline text={opt} inertLinks /></span>
                {/* En palabras, no solo en color: un verde sin etiqueta obliga a
                    deducir qué pasó, y con daltonismo no dice nada. */}
                {showState && showCorrect && (
                  <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-neon-green">
                    {t('module.check_was_correct')}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>

        {saving !== null && (
          <p className="mt-3 text-[12.5px] text-text-subtle" role="status">
            {t('module.check_saving')}
          </p>
        )}

        {/* Explicación */}
        <AnimatePresence>
          {answered && (
            <motion.div
              key="explanation"
              initial={reducedMotion ? false : { opacity: 0, height: 0, y: 6 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div
                className={cn(
                  'mt-5 rounded-2xl px-5 py-4 glass',
                  correct ? 'border-neon-green/20' : 'border-neon-magenta/20',
                )}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full animate-glow-pulse',
                      correct ? 'bg-neon-green' : exhausted ? 'bg-text-muted' : 'bg-neon-magenta',
                    )}
                  />
                  <span
                    className={cn(
                      'text-[11px] uppercase tracking-wider font-semibold',
                      correct ? 'text-neon-green' : exhausted ? 'text-text-muted' : 'text-neon-magenta',
                    )}
                  >
                    {/* Tres estados, no dos. Antes, sin intentos, seguía diciendo
                        "revisa otra vez" — pedirle reintentar a quien ya no puede
                        es lo que hacía la pantalla incomprensible. */}
                    {correct
                      ? t('module.check_correct')
                      : exhausted
                        ? t('module.check_closed')
                        : t('module.check_incorrect')}
                  </span>
                </div>
                {/* La explicación TAMBIÉN se guarda hasta el final: casi siempre
                    contiene la respuesta, así que enseñarla mientras quedan
                    intentos es regalarla por la puerta de al lado. Mientras
                    tanto se dice lo único útil: que esa no era. */}
                {revealed ? (
                  <p className="text-[14px] leading-relaxed text-text/90">
                    <RichTextInline text={quiz.explanation[language]} />
                  </p>
                ) : (
                  <p className="text-[14px] leading-relaxed text-text/90">
                    {t('module.check_try_again')}
                  </p>
                )}

                {/* Reintentar solo si falló y le queda presupuesto. Acertar ya no
                    ofrece "rehacer": con el puntaje decreciente, volver a
                    responder solo podría BAJARLE la nota. */}
                {canRetry && (
                  <button
                    onClick={retry}
                    className="mt-4 flex items-center gap-1.5 text-[12.5px] font-medium text-neon-magenta/70 transition-colors hover:text-neon-magenta cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('module.blocks.retry')}
                    {policy.maxAttempts > 0 && (
                      <span className="tabular-nums text-text-subtle">
                        {t('module.check_attempts_left', { count: attemptsLeft })}
                      </span>
                    )}
                  </button>
                )}

                {/* Qué pasó y qué puede hacer AHORA. Antes esto era una línea
                    gris al pie, debajo de la explicación: lo más importante de
                    la pantalla, escrito como una nota al margen, y sin ninguna
                    salida. */}
                {exhausted && (
                  <div className="mt-4 rounded-xl border border-glass-border/12 px-4 py-3">
                    <p className="text-[13px] font-medium text-text">
                      {t('module.check_closed_title')}
                    </p>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-text-muted">
                      {t('module.check_closed_hint')}
                    </p>
                    <button
                      onClick={startPractice}
                      className="mt-3 flex items-center gap-1.5 text-[12.5px] font-medium text-text-muted transition-colors hover:text-text cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {t('module.check_practice_again')}
                    </button>
                  </div>
                )}

                {/* En práctica se dice, para que nadie crea que recuperó la nota. */}
                {practice && (
                  <p className="mt-3 text-[12px] text-text-subtle">
                    {t('module.check_practice_note')}
                  </p>
                )}

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
