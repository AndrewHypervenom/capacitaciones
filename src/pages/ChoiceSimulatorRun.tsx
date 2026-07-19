import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Phone, PhoneOff, Star } from 'lucide-react';
import { type ChoiceNode, type ChoiceOption, type ChoiceScenario, calcMaxPoints, getChoiceScenario } from '@/data/choiceScenarios';
import { getChoiceScenarioBySlug } from '@/services/choiceScenarios.service';
import { saveSimulatorAttempt, type AiFeedback } from '@/services/certification.service';
import { choiceFeedback } from '@/services/simGroq.service';
import { AiFeedbackCard } from '@/components/simulator/AiFeedbackCard';
import { useAuth } from '@/hooks/useAuth';
import { useUserStore } from '@/stores/userStore';
import type { Language } from '@/stores/userStore';

type Phase = 'intro' | 'call' | 'result';

interface ChatMessage {
  id: string;
  speaker: 'client' | 'agent';
  message: string;
}

const LEVEL_COLORS: Record<string, string> = { basico: '#34c759', medio: '#0071e3', avanzado: '#ff453a' };
const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
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
  const [clockTime, setClockTime] = useState(getClockTime);

  const [aiFeedback, setAiFeedback] = useState<AiFeedback | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [feedbackReady, setFeedbackReady] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const attemptSavedRef = useRef(false);
  const feedbackReqRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    // Primero los escenarios estáticos; si no está, se busca en la base
    // (escenarios creados por el capacitador en Simulaciones).
    const local = getChoiceScenario(id);
    if (local) {
      setScenario(local);
      return;
    }
    let active = true;
    getChoiceScenarioBySlug(id)
      .then((s) => { if (active) setScenario(s); })
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
    const pct = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;
    let alive = true;
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
      .then((fb) => { if (alive) setAiFeedback(fb); })
      .catch(() => { /* IA no disponible → intento sin feedback */ })
      .finally(() => { if (alive) { setFeedbackLoading(false); setFeedbackReady(true); } });
    return () => { alive = false; };
  }, [phase, scenario, messages, maxPoints, totalPoints, language]);

  // Persistir el intento en BD (auditable + cuenta para la certificación del curso).
  // Espera a que la IA termine (o falle) para guardar el feedback junto al intento.
  useEffect(() => {
    if (phase !== 'result' || attemptSavedRef.current || !user?.id || !scenario || !feedbackReady) return;
    attemptSavedRef.current = true;
    const pct = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;
    saveSimulatorAttempt(user.id, {
      courseId: simContext.courseId ?? null,
      campaignId: simContext.campaignId ?? null,
      scenarioSlug: scenario.id,
      score: pct,
      checklistPct: pct / 100,
      empathyPct: pct / 100,
      resolved: !earlyEnd && endType !== 'poor',
      durationSec: callSeconds,
      aiFeedback,
    }).catch(() => {});
  }, [phase, user?.id, scenario, maxPoints, totalPoints, earlyEnd, endType, callSeconds, feedbackReady, aiFeedback, simContext.courseId, simContext.campaignId]);

  const endCall = useCallback((node: ChoiceNode) => {
    setEndType(node.endType ?? 'poor');
    setEndMessage(node.endMessage ?? null);
    const tid = setTimeout(() => setPhase('result'), 1500);
    timeoutRefs.current.push(tid);
  }, []);

  const showClientMessage = useCallback(
    (nodeId: string, scn: ChoiceScenario) => {
      const node = scn.nodes[nodeId];
      if (!node) return;
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
        }
      }, delay);
      timeoutRefs.current.push(tid);
    },
    [endCall, language],
  );

  const startCall = useCallback(() => {
    if (!scenario) return;
    clearAllTimeouts();
    setMaxPoints(calcMaxPoints(scenario));
    setTotalPoints(0);
    setCallSeconds(0);
    setMessages([]);
    setWaitingForUser(false);
    setActiveNodeId('');
    setTyping(false);
    setPhase('call');
    const tid = setTimeout(() => showClientMessage(scenario.startId, scenario), 400);
    timeoutRefs.current.push(tid);
  }, [scenario, showClientMessage]);

  const handleOptionSelect = useCallback(
    (option: ChoiceOption, scn: ChoiceScenario) => {
      setWaitingForUser(false);
      setActiveNodeId('');
      setMessages((prev) => [
        ...prev,
        { id: `agent_${Date.now()}`, speaker: 'agent', message: option.text[language] },
      ]);
      setTotalPoints((prev) => prev + option.points);
      const tid = setTimeout(() => showClientMessage(option.nextId, scn), 600);
      timeoutRefs.current.push(tid);
    },
    [showClientMessage, language],
  );

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
    attemptSavedRef.current = false;
    feedbackReqRef.current = false;
    setAiFeedback(null);
    setFeedbackLoading(true);
    setFeedbackReady(false);
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

  const currentOptions = waitingForUser ? scenario.nodes[activeNodeId]?.options ?? [] : [];
  const scorePercent = maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0;
  const levelColor = LEVEL_COLORS[scenario.level] ?? '#86868b';
  const resultColor = endType === 'excellent' ? '#34c759' : endType === 'good' ? '#0071e3' : '#ff3b30';
  const resultTitle =
    endType === 'excellent' ? t('simulator.choice.result_excellent') :
    endType === 'good'      ? t('simulator.choice.result_good') :
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
            className="min-h-screen flex flex-col items-center justify-center px-4 py-16 relative"
          >
            <button
              onClick={() => nav(simContext.returnTo ?? '/dashboard')}
              className="absolute top-6 left-6 flex items-center gap-2 text-[14px] text-text-muted hover:text-text transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('simulator.choice.back')}
            </button>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-lg bg-surface border border-line rounded-3xl p-8"
            >
              <div className="flex flex-col items-center text-center">
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
                  style={{ background: 'rgba(0,113,227,0.15)', border: '1px solid rgba(0,113,227,0.35)' }}
                >
                  <Phone className="w-9 h-9" style={{ color: '#0071e3' }} />
                </div>

                <span
                  className="text-[11px] uppercase tracking-widest font-semibold mb-3 px-3 py-1 rounded-full"
                  style={{ color: levelColor, background: `${levelColor}20`, border: `1px solid ${levelColor}40` }}
                >
                  {getLevelLabel(scenario.level)}
                </span>

                <h1 className="text-[34px] font-bold text-text tracking-tight leading-tight mb-3">
                  {scenario.title[language]}
                </h1>
                <p className="text-[16px] leading-relaxed mb-8 text-text-muted">
                  {scenario.description[language]}
                </p>

                <div className="w-full mb-8 bg-surface border border-line rounded-2xl p-5">
                  {[
                    { label: t('simulator.customer'), value: scenario.clientName },
                    { label: t('simulator.choice.company'), value: scenario.clientCompany[language] },
                    { label: t('simulator.choice.objective'), value: scenario.objective[language] },
                  ].map(({ label, value }, i, arr) => (
                    <div
                      key={label}
                      className="flex items-start justify-between py-3"
                      style={{ borderBottom: i < arr.length - 1 ? '1px solid rgba(128,128,128,0.15)' : 'none' }}
                    >
                      <span className="text-[13px] shrink-0 mr-4 text-text-muted">{label}</span>
                      <span className="text-[13px] text-text text-right">{value}</span>
                    </div>
                  ))}
                </div>

                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={startCall}
                  className="flex items-center gap-3 px-8 py-4 rounded-full font-semibold text-[16px] text-black cursor-pointer"
                  style={{ background: '#34c759' }}
                >
                  <Phone className="w-5 h-5" />
                  {t('simulator.choice.accept_call')}
                </motion.button>
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
                  <p className="text-text font-bold text-lg mb-1">
                    {t('simulator.choice.your_response')}
                  </p>
                  <p className="text-text-muted text-[13px] mb-5">
                    {t('simulator.choice.select_prompt')}
                  </p>

                  <AnimatePresence mode="wait">
                    {waitingForUser && currentOptions.length > 0 ? (
                      <motion.div key="options" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {currentOptions.map((opt, i) => (
                          <motion.button
                            key={i}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.08, ease: [0.16, 1, 0.3, 1], duration: 0.35 }}
                            onClick={() => handleOptionSelect(opt, scenario)}
                            className="bg-subtle border border-line hover:bg-line"
                            style={{
                              borderRadius: 16,
                              padding: 16,
                              textAlign: 'left',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: 12,
                            }}
                            whileHover={{ scale: 1.01 } as never}
                            whileTap={{ scale: 0.98 }}
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
                    <span className="text-text font-bold text-lg">{totalPoints} pts</span>
                  </div>
                  {maxPoints > 0 && (
                    <div style={{ height: 4, borderRadius: 2, background: 'rgba(128,128,128,0.2)', overflow: 'hidden' }}>
                      <motion.div
                        style={{ height: '100%', borderRadius: 2, background: '#0071e3' }}
                        animate={{ width: `${(totalPoints / maxPoints) * 100}%` }}
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
            className="min-h-screen flex items-center justify-center px-4 py-16"
          >
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-lg bg-surface border border-line rounded-3xl p-8 text-center"
            >
              <ResultStars endType={endType} />

              <h2 className="text-text text-[28px] font-bold mb-3">{resultTitle}</h2>

              <div style={{ fontSize: 72, fontWeight: 700, color: resultColor, lineHeight: 1, marginBottom: 12 }}>
                {scorePercent}%
              </div>

              {(earlyEnd || endMessage) && (
                <p className="text-text-muted text-sm leading-relaxed max-w-[360px] mx-auto mb-7">
                  {earlyEnd ? t('simulator.choice.ended_early') : endMessage?.[language]}
                </p>
              )}

              <div className="bg-surface border border-line rounded-2xl p-4 mb-7">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
                  {[
                    { label: t('simulator.choice.stat_points'), value: `${totalPoints} / ${maxPoints}` },
                    { label: t('simulator.choice.stat_duration'), value: formatTime(callSeconds) },
                    { label: t('simulator.choice.stat_level'), value: getLevelLabel(scenario.level) },
                  ].map(({ label, value }, i) => (
                    <div
                      key={label}
                      style={{
                        padding: '0 12px',
                        textAlign: 'center',
                        borderRight: i < 2 ? '1px solid rgba(128,128,128,0.15)' : 'none',
                      }}
                    >
                      <p className="text-text-muted text-[11px] uppercase tracking-widest mb-1">{label}</p>
                      <p className="text-text text-sm font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {(feedbackLoading || aiFeedback) && (
                <div className="mb-7">
                  <AiFeedbackCard feedback={aiFeedback} loading={feedbackLoading} />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                <button
                  onClick={handleRetry}
                  className="w-full text-text text-sm font-medium cursor-pointer bg-surface border border-line rounded-2xl px-6 py-3 hover:bg-subtle transition-colors"
                >
                  {t('simulator.choice.retry')}
                </button>
                <button
                  onClick={() => nav(simContext.returnTo ?? '/dashboard')}
                  className="text-text-muted text-sm cursor-pointer hover:text-text transition-colors bg-transparent border-none py-1"
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
