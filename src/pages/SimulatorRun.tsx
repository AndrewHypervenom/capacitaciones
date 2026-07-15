import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic, MicOff, PauseCircle, PhoneForwarded, PhoneOff, PlayCircle, Loader2 } from 'lucide-react';
import { getScenario, type Scenario } from '@/data/scenarios';
import { getScenarioBySlug } from '@/services/scenarios.service';
import { useScenarios } from '@/hooks/useScenarios';
import { useUserStore } from '@/stores/userStore';
import { useSimStore } from '@/stores/simStore';
import { endSim, startSim, stepSim, type SimState } from '@/lib/simulator';
import { CallTimer } from '@/components/simulator/CallTimer';
import { CustomerPanel } from '@/components/simulator/CustomerPanel';
import { ChatTranscript } from '@/components/simulator/ChatTranscript';
import { Checklist } from '@/components/simulator/Checklist';
import { AgentInput } from '@/components/simulator/AgentInput';
import { toast } from '@/stores/toastStore';
import { cn } from '@/lib/cn';

export default function SimulatorRun() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const nav = useNavigate();
  const location = useLocation();
  const language = useUserStore((s) => s.language);
  const { active, setActive, setLastResult, setContext } = useSimStore();
  const { scenarios: dbScenarios, loading: scenariosLoading } = useScenarios();

  // Contexto de curso (si se entró desde la página del curso).
  useEffect(() => {
    const st = location.state as
      | { courseId?: string; campaignId?: string; returnTo?: string }
      | null;
    if (st && (st.courseId || st.returnTo)) {
      setContext({
        courseId: st.courseId ?? null,
        campaignId: st.campaignId ?? null,
        returnTo: st.returnTo ?? null,
      });
    }
  }, [location.state, setContext]);

  // Respaldo: escenario traído directo de BD por slug (staff sin campaña o
  // aprendiz cross-campaña no lo encuentran en useScenarios).
  const [fetchedScenario, setFetchedScenario] = useState<Scenario | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Prefer DB scenario (from campaign), fall back to hardcoded, then to direct fetch
  const scenario = useMemo(() => {
    if (!id) return undefined;
    const fromDb = dbScenarios.find((s) => s.id === id);
    return fromDb ?? getScenario(id) ?? fetchedScenario ?? undefined;
  }, [id, dbScenarios, fetchedScenario]);

  useEffect(() => {
    if (!id || scenariosLoading || scenario) return;
    let alive = true;
    getScenarioBySlug(id)
      .then((s) => {
        if (!alive) return;
        if (s) setFetchedScenario(s);
        else setNotFound(true);
      })
      .catch(() => { if (alive) setNotFound(true); });
    return () => { alive = false; };
  }, [id, scenariosLoading, scenario]);
  const [state, setState] = useState<SimState | null>(
    active && active.scenarioId === id && active.language === language ? active : null,
  );
  const [isCustomerTyping, setIsCustomerTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Controles de la barra de llamada (silencio / espera / transferencia).
  const [muted, setMuted] = useState(false);
  const [hold, setHold] = useState(false);
  const [holdStartedAt, setHoldStartedAt] = useState<number | null>(null);
  const [holdOffsetMs, setHoldOffsetMs] = useState(0);
  const [transferring, setTransferring] = useState(false);
  const transferTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!scenario) return;
    if (!state || state.scenarioId !== scenario.id || state.language !== language) {
      const fresh = startSim(scenario, language);
      setState(fresh);
      setActive(fresh);
    }
  }, [scenario, state, language, setActive]);

  useEffect(() => {
    if (state?.endedAt) {
      setLastResult(state);
      setActive(null);
      const timeout = setTimeout(() => {
        nav(`/simulator/result/${state.scenarioId}`);
      }, 1200);
      return () => clearTimeout(timeout);
    }
  }, [state?.endedAt, state, nav, setActive, setLastResult]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (transferTimeoutRef.current) clearTimeout(transferTimeoutRef.current);
    };
  }, []);

  if (notFound && !scenario) {
    return (
      <div className="mx-auto max-w-3xl px-5 pt-20 text-center">
        <p className="text-text-muted mb-4">{t('simulator.not_found')}</p>
        <button
          onClick={() => nav(-1)}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-semibold text-on-primary"
        >
          {t('common.back')}
        </button>
      </div>
    );
  }

  if (scenariosLoading || !scenario || !state) {
    return <div className="mx-auto max-w-3xl px-5 pt-20 text-text-muted">{t('common.loading')}</div>;
  }

  const onSend = (text: string) => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    const nextState = stepSim(state, scenario, text, language);

    // Show agent message immediately, then reveal customer reply after typing indicator
    const hasNewCustomerMsg = nextState.messages.length > state.messages.length + 1;

    if (hasNewCustomerMsg) {
      const intermediateState: SimState = {
        ...state,
        messages: nextState.messages.slice(0, -1),
        completedChecklist: nextState.completedChecklist,
      };
      setState(intermediateState);
      setActive(intermediateState);
      setIsCustomerTyping(true);

      const delay = 800 + Math.random() * 400;
      typingTimeoutRef.current = setTimeout(() => {
        setIsCustomerTyping(false);
        setState(nextState);
        setActive(nextState);
      }, delay);
    } else {
      setState(nextState);
      setActive(nextState);
    }
  };

  const onEnd = () => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (transferTimeoutRef.current) clearTimeout(transferTimeoutRef.current);
    setIsCustomerTyping(false);
    const ended = endSim(state);
    setState(ended);
  };

  const live = !state.endedAt;

  const toggleMute = () => {
    if (!live) return;
    const next = !muted;
    setMuted(next);
    toast.info(
      next ? t('simulator.toast_muted_on') : t('simulator.toast_muted_off'),
      next ? t('simulator.toast_muted_on_desc') : t('simulator.toast_muted_off_desc'),
    );
  };

  const toggleHold = () => {
    if (!live || transferring) return;
    if (hold) {
      // Reanudar: acumular el tiempo que estuvo en espera para descontarlo del cronómetro.
      if (holdStartedAt) setHoldOffsetMs((o) => o + (Date.now() - holdStartedAt));
      setHoldStartedAt(null);
      setHold(false);
      toast.info(t('simulator.toast_hold_off'), t('simulator.toast_hold_off_desc'));
    } else {
      setHoldStartedAt(Date.now());
      setHold(true);
      toast.info(t('simulator.toast_hold_on'), t('simulator.toast_hold_on_desc'));
    }
  };

  const onTransfer = () => {
    if (!live || transferring) return;
    setTransferring(true);
    transferTimeoutRef.current = setTimeout(() => {
      setTransferring(false);
      transferTimeoutRef.current = null;
      toast.success(t('simulator.toast_transferred'), t('simulator.toast_transferred_desc'));
    }, 2200);
  };

  // El input queda inhabilitado mientras el agente no puede hablar con el cliente.
  const inputBlocked = !live || isCustomerTyping || muted || hold || transferring;

  type CallStatus = 'on_call' | 'hold' | 'transferring' | 'ended';
  const callStatus: CallStatus = transferring
    ? 'transferring'
    : hold
      ? 'hold'
      : live
        ? 'on_call'
        : 'ended';

  const statusStyles: Record<CallStatus, { dot: string; label: string; text: string }> = {
    on_call: {
      dot: 'bg-brand-green shadow-[0_0_10px_rgba(0,213,98,0.55)]',
      label: t('simulator.status_on_call'),
      text: 'text-text-muted',
    },
    hold: {
      dot: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.55)]',
      label: t('simulator.status_on_hold'),
      text: 'text-amber-500',
    },
    transferring: {
      dot: 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.55)]',
      label: t('simulator.status_transferring'),
      text: 'text-sky-500',
    },
    ended: {
      dot: 'bg-text-subtle',
      label: t('simulator.status_ended'),
      text: 'text-text-muted',
    },
  };
  const status = statusStyles[callStatus];

  const ControlButton = ({
    label,
    icon: Icon,
    destructive,
    active,
    accent = 'amber',
    disabled,
    busy,
    onClick,
  }: {
    label: string;
    icon: typeof MicOff;
    destructive?: boolean;
    active?: boolean;
    accent?: 'amber' | 'sky';
    disabled?: boolean;
    busy?: boolean;
    onClick?: () => void;
  }) => {
    const accentCls =
      accent === 'sky'
        ? 'bg-sky-400/15 text-sky-500 border-sky-400/40 shadow-[0_0_16px_rgba(56,189,248,0.28)]'
        : 'bg-amber-400/15 text-amber-500 border-amber-400/40 shadow-[0_0_16px_rgba(251,191,36,0.28)]';
    return (
      <motion.button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        whileTap={disabled ? undefined : { scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={cn(
          'relative inline-flex items-center justify-center gap-1.5 h-11 w-11 sm:w-auto sm:h-9 sm:px-3.5 rounded-full text-[12px] font-medium transition-colors border overflow-hidden',
          disabled && 'opacity-40 cursor-not-allowed',
          destructive
            ? 'bg-danger/10 text-danger hover:bg-danger/15 border-danger/30'
            : active
              ? accentCls
              : 'bg-surface text-text-muted hover:text-text hover:bg-subtle border-line',
        )}
      >
        {/* Halo pulsante cuando el control está activo */}
        {active && !destructive && (
          <motion.span
            aria-hidden
            className={cn(
              'absolute inset-0 rounded-full',
              accent === 'sky' ? 'bg-sky-400/10' : 'bg-amber-400/10',
            )}
            animate={{ opacity: [0.15, 0.5, 0.15] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <span className="relative z-10 inline-flex items-center gap-1.5">
          {busy ? (
            <Loader2 className="h-4 w-4 sm:h-3.5 sm:w-3.5 animate-spin" />
          ) : (
            <Icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          )}
          <span className="hidden sm:inline">{label}</span>
        </span>
      </motion.button>
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-5 pt-8 pb-10">
      <div className="surface-card rounded-full px-5 h-14 flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            {(callStatus === 'on_call' || callStatus === 'hold' || callStatus === 'transferring') && (
              <motion.span
                aria-hidden
                className={cn('absolute inline-flex h-full w-full rounded-full', status.dot)}
                animate={{ scale: [1, 2.4], opacity: [0.5, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
              />
            )}
            <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', status.dot)} />
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={callStatus}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className={cn('text-[12.5px] uppercase tracking-wider', status.text)}
            >
              {status.label}
            </motion.span>
          </AnimatePresence>
          <span className="hidden sm:inline h-4 w-px bg-line mx-1" />
          <CallTimer
            startedAt={state.startedAt}
            endedAt={state.endedAt}
            pausedAt={hold ? holdStartedAt : null}
            holdOffsetMs={holdOffsetMs}
            className={cn(
              'hidden sm:inline font-mono text-[14px] tabular-nums transition-colors',
              hold ? 'text-amber-500' : 'text-text',
            )}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <ControlButton
            label={t('simulator.mute')}
            icon={muted ? MicOff : Mic}
            active={muted}
            disabled={!live}
            onClick={toggleMute}
          />
          <ControlButton
            label={t('simulator.hold')}
            icon={hold ? PlayCircle : PauseCircle}
            active={hold}
            disabled={!live || transferring}
            onClick={toggleHold}
          />
          <ControlButton
            label={t('simulator.transfer')}
            icon={PhoneForwarded}
            accent="sky"
            active={transferring}
            busy={transferring}
            disabled={!live || transferring}
            onClick={onTransfer}
          />
          <ControlButton label={t('simulator.end')} icon={PhoneOff} destructive onClick={onEnd} />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_2fr_1fr] gap-5">
        <CustomerPanel scenario={scenario} language={language} live={live} />

        <div className="flex flex-col gap-4">
          <div className="relative flex-1">
            <ChatTranscript messages={state.messages} scenario={scenario} isTyping={isCustomerTyping} />

            {/* Overlays de estado de la llamada */}
            <AnimatePresence>
              {(hold || transferring) && (
                <motion.div
                  key={transferring ? 'transfer' : 'hold'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-2xl bg-surface/80 backdrop-blur-sm text-center px-6"
                >
                  {transferring ? (
                    <>
                      <motion.div
                        className="mb-4 grid place-items-center h-14 w-14 rounded-full bg-sky-400/15 text-sky-500"
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
                      >
                        <PhoneForwarded className="h-6 w-6" />
                      </motion.div>
                      <p className="text-[15px] font-semibold text-text">
                        {t('simulator.transfer_overlay_title')}
                      </p>
                      <p className="text-[12.5px] text-text-muted mt-1">
                        {t('simulator.transfer_overlay_hint')}
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="mb-4 flex items-end justify-center gap-1 h-10">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <motion.span
                            key={i}
                            className="w-1.5 rounded-full bg-amber-400"
                            animate={{ height: ['20%', '100%', '35%'] }}
                            transition={{
                              duration: 0.9,
                              repeat: Infinity,
                              ease: 'easeInOut',
                              delay: i * 0.12,
                            }}
                            style={{ height: '40%' }}
                          />
                        ))}
                      </div>
                      <p className="text-[15px] font-semibold text-amber-500">
                        {t('simulator.hold_overlay_title')}
                      </p>
                      <p className="text-[12.5px] text-text-muted mt-1">
                        {t('simulator.hold_overlay_hint')}
                      </p>
                      <button
                        onClick={toggleHold}
                        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-[12.5px] font-semibold text-amber-500 transition-colors hover:bg-amber-400/20"
                      >
                        <PlayCircle className="h-4 w-4" />
                        {t('simulator.toast_hold_off')}
                      </button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Insignia de micrófono silenciado */}
            <AnimatePresence>
              {muted && !hold && !transferring && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  className="absolute top-3 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/15 px-3 py-1.5 text-[11.5px] font-semibold text-amber-500 shadow-lg backdrop-blur-sm"
                >
                  <MicOff className="h-3.5 w-3.5" />
                  {t('simulator.muted_badge')}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <AgentInput onSend={onSend} disabled={inputBlocked} />
        </div>

        <Checklist scenario={scenario} language={language} completed={state.completedChecklist} />
      </div>
    </div>
  );
}
