import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, BookOpen, Phone, PhoneOff, Star, Target } from 'lucide-react';
import { type ChoiceNode, type ChoiceOption, type ChoiceScenario, calcMaxPoints, getChoiceScenario } from '@/data/choiceScenarios';
import { getChoiceScenarioBySlug } from '@/services/choiceScenarios.service';
import { saveSimulatorAttempt, type AiFeedback } from '@/services/certification.service';
import { choiceFeedback, SimAiError, type SimAiErrorKind } from '@/services/simGroq.service';
import { AiFeedbackCard } from '@/components/simulator/AiFeedbackCard';
import { RichText } from '@/components/ui/RichText';
import { unloopScenario, deferEndings, collapseEndings } from '@/lib/scenarioFlow';
import { useAuth } from '@/hooks/useAuth';
import { useUserStore } from '@/stores/userStore';
import { shuffleArray } from '@/lib/quizShuffle';
import type { Language } from '@/stores/userStore';

type Phase = 'intro' | 'call' | 'result';

interface ChatMessage {
  id: string;
  speaker: 'client' | 'agent';
  message: string;
}

const LEVEL_COLORS: Record<string, string> = { basico: '#34c759', medio: '#0071e3', avanzado: '#ff453a' };
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

/** Cuántas veces se tolera volver a un mismo paso antes de cerrar la llamada. */
const MAX_NODE_VISITS = 2;
/** Tope duro de pasos por llamada, por si el grafo tiene un ciclo largo. */
const MAX_STEPS = 40;

/**
 * TIEMPO MÍNIMO DE LECTURA antes de poder responder.
 *
 * Sin esto la simulación se puede "pasar" a puro clic: el aprendiz elige la
 * primera opción apenas aparece, en treinta segundos termina la llamada y no leyó
 * ni lo que dijo el cliente. El resultado sale malo pero tampoco enseña nada,
 * porque nunca hubo una decisión.
 *
 * El tiempo se calcula sobre lo que hay que leer de verdad (mensaje del cliente +
 * las tres respuestas), no es un castigo fijo: un momento corto se desbloquea casi
 * enseguida y uno largo obliga a detenerse. Colgar sigue disponible en todo
 * momento; lo único que espera es la respuesta.
 */
const READ_BASE_MS = 1200;
const READ_PER_WORD_MS = 55;
const READ_MAX_MS = 7000;

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readingTimeMs(node: ChoiceNode | undefined, lang: Language) {
  if (!node) return 0;
  const words =
    countWords(node.message?.[lang] ?? '') +
    (node.options ?? []).reduce((n, o) => n + countWords(o.text?.[lang] ?? ''), 0);
  return Math.min(READ_MAX_MS, READ_BASE_MS + words * READ_PER_WORD_MS);
}

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/**
 * Porcentaje del escenario, acotado a 0-100. El tope importa: si el escenario
 * tiene un ciclo, el aprendiz puede pasar dos veces por el mismo paso y sumar
 * más puntos que el mejor camino, lo que antes mostraba resultados de 120%.
 */
function toScorePct(points: number, max: number) {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((points / max) * 100)));
}

/**
 * Endereza el escenario antes de jugarlo: toda opción lleva hacia adelante, nunca
 * de vuelta al mismo paso ni a uno anterior. Hace falta acá (y no solo al generar)
 * porque las simulaciones ya guardadas arrastran esos ciclos, y era lo que hacía
 * que al elegir mal el cliente repitiera lo mismo hasta que la llamada se cortaba
 * sola. Se trabaja sobre una copia: los escenarios estáticos son del módulo.
 */
function flowFixed(scn: ChoiceScenario): ChoiceScenario {
  const copy = structuredClone(scn);
  const nodes = copy.nodes as unknown as Record<string, Record<string, unknown>>;
  unloopScenario(nodes, copy.startId, 'choice');
  // Un arranque y un cierre: los escenarios ya guardados traían el final "poor"
  // colgado del segundo momento, así que elegir mal una vez sacaba al aprendiz a
  // la pantalla de resultado sin haber hecho la gestión.
  collapseEndings(nodes, copy.startId, 'choice');
  // Y ese cierre queda detrás de una conversación de verdad.
  deferEndings(nodes, copy.startId, 'choice');
  return copy;
}

function getClockTime() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/* ── Íconos SVG para la barra de estado ── */
function SignalBars() {
  return (
    <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 4.5} y={12 - (i + 1) * 3} width="3.5" height={(i + 1) * 3} rx="1" fill="white" />
      ))}
    </svg>
  );
}

function BatteryIcon() {
  return (
    <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
      <rect x="0.75" y="0.75" width="20.5" height="10.5" rx="2.5" stroke="white" strokeWidth="1.5" />
      <rect x="21.75" y="3.5" width="2.75" height="5" rx="1" fill="white" />
      <rect x="2.5" y="2.5" width="15" height="7" rx="1.5" fill="white" />
    </svg>
  );
}

/* ── Indicador de escritura (3 puntos rebotando) ── */
function TypingIndicator() {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 12 }}>
      <div
        style={{
          background: 'rgba(255,255,255,0.12)',
          borderRadius: '18px 18px 18px 4px',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 40,
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            style={{ width: 7, height: 7, borderRadius: '50%', background: '#86868b' }}
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 0.55, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Estrellas de resultado ── */
function ResultStars({ endType }: { endType: 'excellent' | 'good' | 'poor' }) {
  const count = endType === 'excellent' ? 5 : endType === 'good' ? 3 : 1;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: i < count ? 1 : 0.45, opacity: i < count ? 1 : 0.18 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20, delay: i * 0.08 }}
        >
          <Star size={32} fill={i < count ? '#ff9500' : 'none'} stroke={i < count ? '#ff9500' : '#555'} />
        </motion.div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════ */
export default function ChoiceSimulatorRun() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const language = useUserStore((s) => s.language);
  const { user } = useAuth();

  // Contexto de curso (si se llegó desde la página del curso): liga el intento
  // al curso para certificación y permite volver a él al salir.
  const simContext = (location.state ?? {}) as {
    courseId?: string;
    campaignId?: string;
    returnTo?: string;
  };

  const [scenario, setScenario] = useState<ChoiceScenario | null>(null);
  const [phase, setPhase] = useState<Phase>('intro');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [maxPoints, setMaxPoints] = useState(0);
  const [callSeconds, setCallSeconds] = useState(0);
  const [typing, setTyping] = useState(false);
  const [waitingForUser, setWaitingForUser] = useState(false);
  // Paso activo. No se deduce del último mensaje del cliente: un paso hablado
  // por el agente dejaba la llamada colgada esperando a un cliente que nunca
  // hablaba.
  const [activeNodeId, setActiveNodeId] = useState('');
  const [endType, setEndType] = useState<'excellent' | 'good' | 'poor'>('good');
  const [endMessage, setEndMessage] = useState<Record<Language, string> | null>(null);
  const [earlyEnd, setEarlyEnd] = useState(false);
  // La conversación se cerró sola: ciclo, tope de pasos o paso inexistente.
  const [stuckEnd, setStuckEnd] = useState(false);
  const [decisions, setDecisions] = useState(0);
  // Última decisión, para que el aprendiz entienda por qué sube o no el puntaje.
  const [lastChoice, setLastChoice] = useState<{ letter: string; points: number; best: number } | null>(null);
  // Segundos que faltan para poder responder (ver `readingTimeMs`). 0 = habilitado.
  const [readSecondsLeft, setReadSecondsLeft] = useState(0);
  const [clockTime, setClockTime] = useState(getClockTime);

  const [aiFeedback, setAiFeedback] = useState<AiFeedback | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackReady, setFeedbackReady] = useState(false);
  const [feedbackError, setFeedbackError] = useState<SimAiErrorKind | null>(null);
  // Cambiarlo dispara de nuevo el efecto de feedback (botón "Reintentar").
  const [feedbackAttempt, setFeedbackAttempt] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Antibucle: cuántas veces se pasó por cada paso y cuántos pasos lleva la llamada.
  const visitsRef = useRef<Record<string, number>>({});
  const stepsRef = useRef(0);
  const attemptSavedRef = useRef(false);
  const feedbackReqRef = useRef(false);
  // Solo false en el desmontaje real (no atado al ciclo del efecto), para que la
  // petición de feedback en vuelo siempre pueda apagar el loading.
  // Se vuelve a poner en true al montar: con StrictMode (dev) el efecto corre
  // mount → cleanup → mount, y sin esto el ref quedaba en false para siempre,
  // así que el .finally() del feedback nunca apagaba el loading ("Analizando…"
  // eterno aunque la IA respondiera o fallara).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!id) return;
    // Primero los escenarios estáticos; si no está, se busca en la base
    // (escenarios creados por el capacitador en Simulaciones).
    const local = getChoiceScenario(id);
    if (local) {
      setScenario(flowFixed(local));
      return;
    }
    let active = true;
    getChoiceScenarioBySlug(id)
      .then((s) => { if (active) setScenario(s ? flowFixed(s) : s); })
      .catch(() => { if (active) setScenario(null); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    const interval = setInterval(() => setClockTime(getClockTime()), 30000);
    return () => clearInterval(interval);
  }, []);

  const clearAllTimeouts = () => {
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
  };

  useEffect(() => () => clearAllTimeouts(), []);

  useEffect(() => {
    if (phase !== 'call') return;
    const interval = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  // Retroalimentación personalizada con IA (Groq) sobre las decisiones tomadas.
  useEffect(() => {
    if (phase !== 'result' || feedbackReqRef.current || !scenario) return;
    feedbackReqRef.current = true;
    const transcript = messages.map(
      (m) => ({ from: m.speaker === 'agent' ? 'agent' : 'customer', text: m.message }) as const,
    );
    if (transcript.length === 0) {
      setFeedbackLoading(false);
      setFeedbackReady(true);
      return;
    }
    const pct = toScorePct(totalPoints, maxPoints);
    choiceFeedback({
      language,
      scenario: {
        title: scenario.title[language],
        objective: scenario.objective[language],
        customerName: scenario.clientName,
      },
      transcript,
      metrics: { scorePct: pct },
    })
      .then((fb) => { if (mountedRef.current) { setAiFeedback(fb); setFeedbackError(null); } })
      .catch((err) => {
        // IA no disponible → intento sin feedback, pero explicando el motivo en pantalla.
        if (mountedRef.current) setFeedbackError(err instanceof SimAiError ? err.kind : 'unknown');
      })
      .finally(() => { if (mountedRef.current) { setFeedbackLoading(false); setFeedbackReady(true); } });
  }, [phase, scenario, messages, maxPoints, totalPoints, language, feedbackAttempt]);

  const retryFeedback = useCallback(() => {
    feedbackReqRef.current = false;
    setFeedbackError(null);
    setFeedbackLoading(true);
    setFeedbackAttempt((n) => n + 1);
  }, []);

  // Persistir el intento en BD (auditable + cuenta para la certificación del curso).
  // Espera a que la IA termine (o falle) para guardar el feedback junto al intento.
  useEffect(() => {
    if (phase !== 'result' || attemptSavedRef.current || !user?.id || !scenario || !feedbackReady) return;
    attemptSavedRef.current = true;
    const pct = toScorePct(totalPoints, maxPoints);
    saveSimulatorAttempt(user.id, {
      courseId: simContext.courseId ?? null,
      campaignId: simContext.campaignId ?? null,
      scenarioSlug: scenario.id,
      score: pct,
      checklistPct: pct / 100,
      empathyPct: pct / 100,
      // Se considera resuelta si llegó a un final bueno por sus propios medios
      // y con al menos la mitad de los puntos posibles.
      resolved: !earlyEnd && !stuckEnd && endType !== 'poor' && pct >= 50,
      durationSec: callSeconds,
      aiFeedback,
    }).catch(() => {});
  }, [phase, user?.id, scenario, maxPoints, totalPoints, earlyEnd, stuckEnd, endType, callSeconds, feedbackReady, aiFeedback, simContext.courseId, simContext.campaignId]);

  const endCall = useCallback((node: ChoiceNode) => {
    setEndType(node.endType ?? 'poor');
    setEndMessage(node.endMessage ?? null);
    const tid = setTimeout(() => setPhase('result'), 1500);
    timeoutRefs.current.push(tid);
  }, []);

  /**
   * Cierre de emergencia: el escenario ya no puede avanzar (ciclo, paso
   * inexistente o un paso sin opciones que tampoco es final). Antes esto
   * dejaba la llamada colgada en "El cliente está hablando…" para siempre o
   * daba vueltas por el mismo tramo; ahora termina y se califica lo hecho.
   */
  const endStuck = useCallback(() => {
    clearAllTimeouts();
    setTyping(false);
    setWaitingForUser(false);
    setActiveNodeId('');
    setStuckEnd(true);
    setEndMessage(null);
    const tid = setTimeout(() => setPhase('result'), 900);
    timeoutRefs.current.push(tid);
  }, []);

  const showClientMessage = useCallback(
    (nodeId: string, scn: ChoiceScenario) => {
      const node = scn.nodes[nodeId];
      // Paso inexistente (nextId roto) → no dejar la llamada colgada.
      if (!node) {
        endStuck();
        return;
      }
      // Antibucle: un escenario con ciclos repetía el mismo tramo sin fin y,
      // de paso, sumaba puntos repetidos.
      const visits = (visitsRef.current[nodeId] ?? 0) + 1;
      visitsRef.current[nodeId] = visits;
      stepsRef.current += 1;
      if (visits > MAX_NODE_VISITS || stepsRef.current > MAX_STEPS) {
        endStuck();
        return;
      }
      setTyping(true);
      setWaitingForUser(false);
      const delay = 1200 + Math.random() * 600;
      const tid = setTimeout(() => {
        setTyping(false);
        setMessages((prev) => [
          ...prev,
          { id: `${nodeId}_${Date.now()}`, speaker: node.speaker, message: node.message[language] },
        ]);
        if (node.isEnd) {
          endCall(node);
        } else if (node.options?.length) {
          setActiveNodeId(nodeId);
          setWaitingForUser(true);
        } else {
          // Paso sin salida y sin marcar como final.
          endStuck();
        }
      }, delay);
      timeoutRefs.current.push(tid);
    },
    [endCall, endStuck, language],
  );

  const startCall = useCallback(() => {
    if (!scenario) return;
    clearAllTimeouts();
    visitsRef.current = {};
    stepsRef.current = 0;
    setMaxPoints(calcMaxPoints(scenario));
    setTotalPoints(0);
    setCallSeconds(0);
    setMessages([]);
    setDecisions(0);
    setLastChoice(null);
    setStuckEnd(false);
    setWaitingForUser(false);
    setActiveNodeId('');
    setTyping(false);
    setPhase('call');
    const tid = setTimeout(() => showClientMessage(scenario.startId, scenario), 400);
    timeoutRefs.current.push(tid);
  }, [scenario, showClientMessage]);

  const handleOptionSelect = useCallback(
    (option: ChoiceOption, index: number, scn: ChoiceScenario) => {
      const options = scn.nodes[activeNodeId]?.options ?? [];
      const best = options.length ? Math.max(...options.map((o) => o.points)) : option.points;
      setWaitingForUser(false);
      setActiveNodeId('');
      setMessages((prev) => [
        ...prev,
        { id: `agent_${Date.now()}`, speaker: 'agent', message: option.text[language] },
      ]);
      setTotalPoints((prev) => prev + option.points);
      setDecisions((n) => n + 1);
      setLastChoice({ letter: LETTERS[index] ?? '?', points: option.points, best });
      const tid = setTimeout(() => showClientMessage(option.nextId, scn), 600);
      timeoutRefs.current.push(tid);
    },
    [showClientMessage, language, activeNodeId],
  );

  // Orden de las respuestas: barajado por nodo. Un guion se juega varias veces y
  // con el orden de la base la mejor opción caía siempre en el mismo sitio: se
  // respondía de memoria, sin leer. Solo se recalcula al cambiar de nodo, así que
  // el reloj de la ventana de lectura no las hace bailar a mitad de la decisión.
  const currentOptions = useMemo(
    () => (waitingForUser && scenario ? shuffleArray(scenario.nodes[activeNodeId]?.options ?? []) : []),
    [waitingForUser, scenario, activeNodeId],
  );

  // Ventana de lectura: al aparecer las respuestas quedan apagadas el tiempo que
  // cuesta leer ese momento, y se van habilitando solas.
  useEffect(() => {
    if (!waitingForUser || !activeNodeId || !scenario) {
      setReadSecondsLeft(0);
      return;
    }
    const ms = readingTimeMs(scenario.nodes[activeNodeId], language);
    if (ms <= 0) {
      setReadSecondsLeft(0);
      return;
    }
    const deadline = Date.now() + ms;
    setReadSecondsLeft(Math.ceil(ms / 1000));
    const iv = setInterval(() => {
      const left = deadline - Date.now();
      setReadSecondsLeft(left > 0 ? Math.ceil(left / 1000) : 0);
      if (left <= 0) clearInterval(iv);
    }, 200);
    return () => clearInterval(iv);
  }, [waitingForUser, activeNodeId, scenario, language]);

  const handleEndCall = useCallback(() => {
    clearAllTimeouts();
    setTyping(false);
    setWaitingForUser(false);
    setEarlyEnd(true);
    setEndType('poor');
    setEndMessage(null);
    setPhase('result');
  }, []);

  const handleRetry = useCallback(() => {
    clearAllTimeouts();
    visitsRef.current = {};
    stepsRef.current = 0;
    setDecisions(0);
    setLastChoice(null);
    setStuckEnd(false);
    attemptSavedRef.current = false;
    feedbackReqRef.current = false;
    setAiFeedback(null);
    setFeedbackLoading(true);
    setFeedbackReady(false);
    setFeedbackError(null);
    setPhase('intro');
    setMessages([]);
    setTotalPoints(0);
    setMaxPoints(0);
    setCallSeconds(0);
    setTyping(false);
    setWaitingForUser(false);
    setActiveNodeId('');
    setEarlyEnd(false);
    setEndMessage(null);
  }, []);

  const getLevelLabel = (level: string) =>
    t(`simulator.choice.level_${level === 'basico' ? 'basic' : level === 'medio' ? 'medium' : 'advanced'}`);

  if (!scenario) {
    return (
      <div className="fixed inset-0 bg-bg z-50 flex items-center justify-center">
        <p className="text-text-muted text-sm">{t('simulator.choice.loading')}</p>
      </div>
    );
  }

  const scorePercent = toScorePct(totalPoints, maxPoints);
  const levelColor = LEVEL_COLORS[scenario.level] ?? '#86868b';
  // El puntaje manda sobre el final narrativo: mostrar "¡Excelente!" con 40%
  // (o al revés) era lo que hacía incomprensible el resultado.
  const resultTier: 'excellent' | 'good' | 'poor' =
    earlyEnd ? 'poor' :
    scorePercent >= 80 ? 'excellent' :
    scorePercent >= 50 ? 'good' : 'poor';
  const resultColor = resultTier === 'excellent' ? '#34c759' : resultTier === 'good' ? '#0071e3' : '#ff3b30';
  const resultTitle =
    resultTier === 'excellent' ? t('simulator.choice.result_excellent') :
    resultTier === 'good'      ? t('simulator.choice.result_good') :
                                 t('simulator.choice.result_poor');

  return (
    <div
      className="fixed inset-0 bg-bg z-50 overflow-y-auto"
      style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}
    >
      <AnimatePresence mode="wait">

        {/* ══════════ FASE: INTRO ══════════ */}
        {phase === 'intro' && (
          <motion.div
            key="intro"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="min-h-screen px-5 pt-12 pb-24"
          >
            <button
              onClick={() => nav(simContext.returnTo ?? '/dashboard')}
              className="absolute top-6 left-6 flex items-center gap-2 text-[14px] text-text-muted hover:text-text transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('simulator.choice.back')}
            </button>

            {/* Dos columnas con jerarquía: a la izquierda lo que hay que leer
                (el caso y el objetivo, que pueden ser largos), a la derecha la
                ficha del cliente, las reglas y el botón siempre a la vista.
                En una fila de tarjetas iguales, un objetivo de un párrafo
                estiraba las de al lado y dejaba dos cajas medio vacías. */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto w-full max-w-5xl"
            >
              <header className="mb-9 text-center">
                <div className="text-[12px] uppercase tracking-wider text-text-subtle mb-3">
                  {t('simulator.choice_section_title')}
                </div>
                <h1 className="text-[30px] md:text-[38px] font-semibold tracking-[-0.04em] text-text text-balance leading-[1.15]">
                  {scenario.title[language]}
                </h1>
                <span
                  className="mt-4 inline-block text-[11px] uppercase tracking-widest font-semibold px-3 py-1 rounded-full"
                  style={{ color: levelColor, background: `${levelColor}20`, border: `1px solid ${levelColor}40` }}
                >
                  {getLevelLabel(scenario.level)}
                </span>
              </header>

              <div className="grid items-start gap-5 lg:grid-cols-[1.55fr_1fr]">
                {/* ── Lo que hay que leer ── */}
                <div className="space-y-5">
                  <section className="surface-card p-6 md:p-8">
                    <div className="flex items-center gap-2.5 mb-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                        <Phone className="h-4 w-4" />
                      </span>
                      <h2 className="text-[12px] uppercase tracking-wider text-text-subtle font-medium">
                        {t('simulator.choice.the_case')}
                      </h2>
                    </div>
                    <RichText
                      text={scenario.description[language]}
                      className="text-[15px] leading-[1.7] text-text-muted"
                    />
                  </section>

                  {scenario.objective[language] && (
                    <section className="surface-card p-6 md:p-8 border-l-[3px] border-l-primary">
                      <div className="flex items-center gap-2.5 mb-4">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                          <Target className="h-4 w-4" />
                        </span>
                        <h2 className="text-[12px] uppercase tracking-wider text-text-subtle font-medium">
                          {t('simulator.choice.objective')}
                        </h2>
                      </div>
                      <p className="text-[15px] leading-[1.7] text-text">{scenario.objective[language]}</p>
                    </section>
                  )}
                </div>

                {/* ── Con quién hablas, las reglas y el botón ── */}
                <aside className="space-y-5 lg:sticky lg:top-6">
                  <section className="surface-card p-6 text-center">
                    <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-[22px] font-semibold text-primary">
                      {scenario.clientName.trim().charAt(0).toUpperCase()}
                    </div>
                    <p className="text-[11px] uppercase tracking-wider text-text-subtle mb-1.5 font-medium">
                      {t('simulator.customer')}
                    </p>
                    <p className="text-[17px] font-semibold tracking-tight text-text leading-snug">
                      {scenario.clientName}
                    </p>
                    <p className="text-[13px] text-text-muted mt-0.5">{scenario.clientCompany[language]}</p>
                  </section>

                  {/* Reglas antes de empezar: qué se espera y cómo se califica. */}
                  <section className="surface-card p-6">
                    <p className="text-text text-[13px] font-semibold mb-4">{t('simulator.choice.how_it_works')}</p>
                    <ol className="space-y-3.5">
                      {[
                        t('simulator.choice.rule_choose'),
                        t('simulator.choice.rule_points'),
                        t('simulator.choice.rule_end'),
                      ].map((rule, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="shrink-0 mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                            {i + 1}
                          </span>
                          <p className="text-text-muted text-[12.5px] leading-relaxed">{rule}</p>
                        </li>
                      ))}
                    </ol>
                  </section>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={startCall}
                    className="flex w-full items-center justify-center gap-3 px-8 py-4 rounded-full font-semibold text-[16px] text-black cursor-pointer shadow-[0_10px_30px_-12px_rgba(52,199,89,0.9)]"
                    style={{ background: '#34c759' }}
                  >
                    <Phone className="w-5 h-5" />
                    {t('simulator.choice.accept_call')}
                  </motion.button>
                </aside>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* ══════════ FASE: LLAMADA ══════════ */}
        {phase === 'call' && (
          <motion.div
            key="call"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="min-h-screen flex items-center justify-center px-4 md:px-6 py-6 md:py-10"
          >
            <div className="flex flex-col lg:flex-row items-center lg:items-start gap-6 lg:gap-8 w-full max-w-[900px]">

              {/* ── Mobile: chat nativo sin frame ── */}
              <div className="md:hidden w-full flex flex-col rounded-3xl overflow-hidden" style={{ background: '#000' }}>
                {/* Header compacto */}
                <div className="flex items-center gap-3 px-4 py-3" style={{ background: 'rgba(8,8,8,0.95)' }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: 'rgba(0,113,227,0.2)',
                      border: '2px solid rgba(0,113,227,0.5)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>
                      {scenario.clientName[0]}
                    </span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: 'white', fontWeight: 600, fontSize: 14, margin: 0 }}>
                      {scenario.clientName}
                    </p>
                    <p style={{ color: '#86868b', fontSize: 11, margin: 0 }}>
                      {scenario.clientCompany[language]}
                    </p>
                  </div>
                  <p style={{ color: '#34c759', fontSize: 13, fontWeight: 600, fontFamily: 'monospace', flexShrink: 0 }}>
                    {formatTime(callSeconds)}
                  </p>
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={handleEndCall}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: '#ff3b30',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <PhoneOff size={18} color="white" />
                  </motion.button>
                </div>

                {/* Chat area */}
                <div style={{ height: 340, overflowY: 'auto', padding: '8px 14px' }}>
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 16, scale: 0.92 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.4 }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: msg.speaker === 'agent' ? 'flex-end' : 'flex-start',
                        marginBottom: 12,
                      }}
                    >
                      <span style={{ fontSize: 10, color: '#86868b', marginBottom: 3 }}>
                        {msg.speaker === 'client' ? scenario.clientName : t('simulator.choice.you')}
                      </span>
                      <div
                        style={{
                          maxWidth: '85%',
                          padding: '10px 14px',
                          borderRadius: msg.speaker === 'client' ? '4px 18px 18px 18px' : '18px 4px 18px 18px',
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: 'white',
                          background: msg.speaker === 'client' ? 'rgba(255,255,255,0.12)' : '#0071e3',
                        }}
                      >
                        {msg.message}
                      </div>
                    </motion.div>
                  ))}
                  <AnimatePresence>
                    {typing && (
                      <motion.div key="typing" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
                        <span style={{ fontSize: 10, color: '#86868b', paddingLeft: 2, display: 'block', marginBottom: 3 }}>{scenario.clientName}</span>
                        <TypingIndicator />
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* ── Desktop: Marco de iPhone decorativo ── */}
              <div
                className="relative shrink-0 hidden md:block"
                style={{
                  width: 375,
                  height: 750,
                  background: 'linear-gradient(145deg, #2a2a2a, #1a1a1a)',
                  borderRadius: 52,
                  boxShadow: '0 40px 100px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.1)',
                }}
              >
                {/* Botones físicos — lado izquierdo */}
                <div style={{ position: 'absolute', left: -4, top: 118, width: 4, height: 30, background: 'linear-gradient(90deg,#111,#2d2d2d)', borderRadius: '3px 0 0 3px' }} />
                <div style={{ position: 'absolute', left: -4, top: 168, width: 4, height: 58, background: 'linear-gradient(90deg,#111,#2d2d2d)', borderRadius: '3px 0 0 3px' }} />
                <div style={{ position: 'absolute', left: -4, top: 242, width: 4, height: 58, background: 'linear-gradient(90deg,#111,#2d2d2d)', borderRadius: '3px 0 0 3px' }} />
                <div style={{ position: 'absolute', right: -4, top: 178, width: 4, height: 82, background: 'linear-gradient(-90deg,#111,#2d2d2d)', borderRadius: '0 3px 3px 0' }} />

                {/* Pantalla */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 6,
                    borderRadius: 46,
                    overflow: 'hidden',
                    background: '#000',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Barra de estado */}
                  <div
                    style={{
                      height: 52,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 22px',
                      position: 'relative',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>{clockTime}</span>
                    {/* Dynamic Island */}
                    <div
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: 10,
                        transform: 'translateX(-50%)',
                        width: 112,
                        height: 32,
                        background: '#000',
                        borderRadius: 16,
                        boxShadow: '0 0 0 2px #1c1c1c',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        paddingRight: 10,
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: '#0f0f0f',
                          border: '1px solid #2a2a2a',
                        }}
                      />
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <SignalBars />
                      <BatteryIcon />
                    </div>
                  </div>

                  {/* Encabezado de llamada */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      paddingTop: 8,
                      paddingBottom: 16,
                      flexShrink: 0,
                      background: 'linear-gradient(to bottom, rgba(8,8,8,0.95) 60%, rgba(0,0,0,0) 100%)',
                    }}
                  >
                    <div
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: '50%',
                        background: 'rgba(0,113,227,0.2)',
                        border: '2px solid rgba(0,113,227,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 26, fontWeight: 700, color: 'white' }}>
                        {scenario.clientName[0]}
                      </span>
                    </div>
                    <p style={{ color: 'white', fontWeight: 600, fontSize: 14, margin: 0 }}>
                      {scenario.clientName}
                    </p>
                    <p style={{ color: '#86868b', fontSize: 12, margin: '3px 0 5px' }}>
                      {scenario.clientCompany[language]}
                    </p>
                    <p style={{ color: '#34c759', fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>
                      {formatTime(callSeconds)}
                    </p>
                  </div>

                  {/* Área de chat */}
                  <div style={{ flex: 1, overflowY: 'auto', padding: '4px 14px 8px' }}>
                    {messages.map((msg) => (
                      <motion.div
                        key={msg.id}
                        initial={{ opacity: 0, y: 16, scale: 0.92 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.4 }}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: msg.speaker === 'agent' ? 'flex-end' : 'flex-start',
                          marginBottom: 12,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            color: '#86868b',
                            marginBottom: 3,
                            paddingLeft: msg.speaker === 'client' ? 2 : 0,
                            paddingRight: msg.speaker === 'agent' ? 2 : 0,
                          }}
                        >
                          {msg.speaker === 'client' ? scenario.clientName : t('simulator.choice.you')}
                        </span>
                        <div
                          style={{
                            maxWidth: '80%',
                            padding: '10px 14px',
                            borderRadius:
                              msg.speaker === 'client'
                                ? '4px 18px 18px 18px'
                                : '18px 4px 18px 18px',
                            fontSize: 13,
                            lineHeight: 1.5,
                            color: 'white',
                            background:
                              msg.speaker === 'client'
                                ? 'rgba(255,255,255,0.12)'
                                : '#0071e3',
                          }}
                        >
                          {msg.message}
                        </div>
                      </motion.div>
                    ))}

                    <AnimatePresence>
                      {typing && (
                        <motion.div
                          key="typing"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.2 }}
                        >
                          <span style={{ fontSize: 10, color: '#86868b', paddingLeft: 2, display: 'block', marginBottom: 3 }}>
                            {scenario.clientName}
                          </span>
                          <TypingIndicator />
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div ref={messagesEndRef} />
                  </div>

                  {/* Botón de colgar */}
                  <div
                    style={{
                      height: 80,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <motion.button
                      whileHover={{ scale: 1.07 }}
                      whileTap={{ scale: 0.93 }}
                      onClick={handleEndCall}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: '50%',
                        background: '#ff3b30',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <PhoneOff size={22} color="white" />
                    </motion.button>
                  </div>
                </div>
              </div>

              {/* ── DERECHA: Panel de opciones ── */}
              <div className="flex-1 flex flex-col gap-5 w-full max-w-lg">
                <div className="bg-surface border border-line rounded-3xl p-5 md:p-6">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <p className="text-text font-bold text-lg">
                      {t('simulator.choice.your_response')}
                    </p>
                    <span className="text-text-muted text-[12px] shrink-0 mt-1.5">
                      {t('simulator.choice.decision_n', { n: decisions + 1 })}
                    </span>
                  </div>
                  <p className="text-text-muted text-[13px] mb-4">
                    {t('simulator.choice.select_prompt')}
                  </p>

                  {/* Qué pasó con la última decisión: sin esto el puntaje subía
                      o se quedaba quieto sin explicación. */}
                  <AnimatePresence>
                    {lastChoice && (
                      <motion.p
                        key={`fb_${decisions}`}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="text-[12px] mb-4 rounded-xl px-3 py-2 bg-subtle border border-line"
                        style={{ color: lastChoice.points >= lastChoice.best ? '#34c759' : lastChoice.points > 0 ? '#0071e3' : '#ff453a' }}
                      >
                        {t('simulator.choice.last_choice', {
                          letter: lastChoice.letter,
                          points: lastChoice.points,
                          best: lastChoice.best,
                        })}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <AnimatePresence mode="wait">
                    {waitingForUser && currentOptions.length > 0 ? (
                      <motion.div key="options" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* Ventana de lectura: responder sin leer no es una decisión. */}
                        {readSecondsLeft > 0 && (
                          <p className="text-[12px] text-text-muted m-0 mb-1 flex items-center gap-1.5">
                            <BookOpen className="h-3.5 w-3.5 shrink-0" />
                            {t('simulator.choice.read_first', { s: readSecondsLeft })}
                          </p>
                        )}
                        {currentOptions.map((opt, i) => (
                          <motion.button
                            key={i}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: readSecondsLeft > 0 ? 0.55 : 1, x: 0 }}
                            transition={{ delay: i * 0.08, ease: [0.16, 1, 0.3, 1], duration: 0.35 }}
                            onClick={() => handleOptionSelect(opt, i, scenario)}
                            disabled={readSecondsLeft > 0}
                            className="bg-subtle border border-line enabled:hover:bg-line"
                            style={{
                              borderRadius: 16,
                              padding: 16,
                              textAlign: 'left',
                              cursor: readSecondsLeft > 0 ? 'default' : 'pointer',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 12,
                            }}
                            whileHover={readSecondsLeft > 0 ? undefined : ({ scale: 1.01 } as never)}
                            whileTap={readSecondsLeft > 0 ? undefined : { scale: 0.98 }}
                          >
                            <span
                              style={{
                                flexShrink: 0,
                                width: 24,
                                height: 24,
                                borderRadius: '50%',
                                background: 'rgba(0,113,227,0.2)',
                                border: '1px solid rgba(0,113,227,0.4)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 11,
                                fontWeight: 700,
                                color: '#0071e3',
                                marginTop: 1,
                              }}
                            >
                              {LETTERS[i]}
                            </span>
                            <p className="text-text text-[13px] leading-[1.55] m-0">
                              {opt.text[language]}
                            </p>
                          </motion.button>
                        ))}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="waiting"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 0' }}
                      >
                        <p className="text-text-muted text-[14px]">{t('simulator.choice.client_speaking')}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Tarjeta de puntuación en vivo */}
                <div className="bg-surface border border-line rounded-2xl p-4">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span className="text-text-muted text-[13px]">{t('simulator.choice.live_score')}</span>
                    <span className="text-text font-bold text-lg">{totalPoints} / {maxPoints} pts</span>
                  </div>
                  {maxPoints > 0 && (
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(128,128,128,0.2)', overflow: 'hidden' }}>
                      <motion.div
                        style={{ height: '100%', borderRadius: 2, background: '#0071e3' }}
                        animate={{ width: `${scorePercent}%` }}
                        transition={{ ease: 'easeOut', duration: 0.4 }}
                      />
                    </div>
                  )}
                  {maxPoints > 0 && (
                    <p className="text-text-muted text-[11px] mt-1.5 text-right">
                      {scorePercent}{t('simulator.choice.pct_of_max')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ══════════ FASE: RESULTADO ══════════ */}
        {phase === 'result' && (
          <motion.div
            key="result"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="min-h-screen px-5 pt-12 pb-24"
          >
            {/* Mismo ancho y ritmo que el resultado de la simulación de llamada
                (SimulatorResult): tarjeta de puntaje + métricas en fila, no una
                columna angosta. */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto w-full max-w-5xl"
            >
              <header className="mb-10 text-center">
                <div className="text-[12px] uppercase tracking-wider text-text-subtle mb-3">
                  {t('simulator.result_title')}
                </div>
                <h1 className="text-[32px] md:text-[40px] font-semibold tracking-[-0.04em] text-text text-balance">
                  {scenario.title[language]}
                </h1>
              </header>

              <div className="surface-card p-10 md:p-12 mb-6 text-center">
                <ResultStars endType={resultTier} />

                <div
                  className="tabular-nums"
                  style={{ fontSize: 'clamp(72px, 14vw, 140px)', fontWeight: 700, color: resultColor, lineHeight: 1 }}
                >
                  {scorePercent}%
                </div>

                <h2 className="text-text text-[22px] font-semibold mt-4">{resultTitle}</h2>

                {(earlyEnd || stuckEnd || endMessage) && (
                  <p className="text-text-muted text-sm leading-relaxed max-w-xl mx-auto mt-3">
                    {earlyEnd
                      ? t('simulator.choice.ended_early')
                      : stuckEnd
                        ? t('simulator.choice.ended_stuck')
                        : endMessage?.[language]}
                  </p>
                )}

                {/* Cómo se calculó el número grande. */}
                <p className="text-text-subtle text-[12px] leading-relaxed max-w-xl mx-auto mt-4">
                  {t('simulator.choice.scoring_hint', { points: totalPoints, max: maxPoints })}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-5 mb-8">
                {[
                  { id: 'points', label: t('simulator.choice.stat_points'), value: `${totalPoints} / ${maxPoints}` },
                  { id: 'decisions', label: t('simulator.choice.stat_decisions'), value: String(decisions) },
                  { id: 'duration', label: t('simulator.choice.stat_duration'), value: formatTime(callSeconds) },
                  { id: 'level', label: t('simulator.choice.stat_level'), value: getLevelLabel(scenario.level) },
                ].map(({ id, label, value }) => (
                  <div key={id} className="surface-card p-6 text-center sm:text-left">
                    <p className="text-text-muted text-[11px] uppercase tracking-wider mb-2 font-medium">{label}</p>
                    <p className="text-text text-[28px] font-semibold tracking-tight tabular-nums">{value}</p>
                  </div>
                ))}
              </div>

              {(feedbackLoading || aiFeedback || feedbackError) && (
                <div className="mb-8">
                  <AiFeedbackCard
                    feedback={aiFeedback}
                    loading={feedbackLoading}
                    error={feedbackError}
                    onRetry={retryFeedback}
                  />
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={handleRetry}
                  className="text-text text-sm font-medium cursor-pointer bg-surface border border-line rounded-2xl px-8 py-3 hover:bg-subtle transition-colors"
                >
                  {t('simulator.choice.retry')}
                </button>
                <button
                  onClick={() => nav(simContext.returnTo ?? '/dashboard')}
                  className="text-text-muted text-sm cursor-pointer hover:text-text transition-colors bg-surface border border-line rounded-2xl px-8 py-3"
                >
                  {t('simulator.back_dashboard')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
