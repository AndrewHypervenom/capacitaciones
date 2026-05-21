import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MicOff, PauseCircle, PhoneForwarded, PhoneOff } from 'lucide-react';
import { getScenario } from '@/data/scenarios';
import { useScenarios } from '@/hooks/useScenarios';
import { useUserStore } from '@/stores/userStore';
import { useSimStore } from '@/stores/simStore';
import { endSim, startSim, stepSim, type SimState } from '@/lib/simulator';
import { CallTimer } from '@/components/simulator/CallTimer';
import { CustomerPanel } from '@/components/simulator/CustomerPanel';
import { ChatTranscript } from '@/components/simulator/ChatTranscript';
import { Checklist } from '@/components/simulator/Checklist';
import { AgentInput } from '@/components/simulator/AgentInput';
import { cn } from '@/lib/cn';

export default function SimulatorRun() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const nav = useNavigate();
  const language = useUserStore((s) => s.language);
  const { active, setActive, setLastResult } = useSimStore();
  const { scenarios: dbScenarios, loading: scenariosLoading } = useScenarios();

  // Prefer DB scenario (from campaign), fall back to hardcoded
  const scenario = useMemo(() => {
    if (!id) return undefined;
    const fromDb = dbScenarios.find((s) => s.id === id);
    return fromDb ?? getScenario(id);
  }, [id, dbScenarios]);
  const [state, setState] = useState<SimState | null>(
    active && active.scenarioId === id && active.language === language ? active : null,
  );
  const [isCustomerTyping, setIsCustomerTyping] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    };
  }, []);

  if (scenariosLoading) {
    return <div className="mx-auto max-w-3xl px-5 pt-20 text-text-muted">{t('common.loading')}</div>;
  }

  if (!scenario || !state) {
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
    setIsCustomerTyping(false);
    const ended = endSim(state);
    setState(ended);
  };

  const live = !state.endedAt;

  const ControlButton = ({
    label,
    icon: Icon,
    destructive,
    onClick,
  }: {
    label: string;
    icon: typeof MicOff;
    destructive?: boolean;
    onClick?: () => void;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[12px] font-medium transition-colors border',
        destructive
          ? 'bg-danger/10 text-danger hover:bg-danger/15 border-danger/30'
          : 'bg-surface text-text-muted hover:text-text hover:bg-subtle border-line',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl px-5 pt-8 pb-10">
      <div className="surface-card rounded-full px-5 h-14 flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'h-2.5 w-2.5 rounded-full',
              live
                ? 'bg-brand-green shadow-[0_0_10px_rgba(0,213,98,0.55)]'
                : 'bg-text-subtle',
            )}
          />
          <span className="text-[12.5px] uppercase tracking-wider text-text-muted">
            {live ? t('simulator.status_on_call') : t('simulator.status_ended')}
          </span>
          <span className="hidden sm:inline h-4 w-px bg-line mx-1" />
          <CallTimer
            startedAt={state.startedAt}
            endedAt={state.endedAt}
            className="hidden sm:inline font-mono text-[14px] tabular-nums text-text"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <ControlButton label={t('simulator.mute')} icon={MicOff} />
          <ControlButton label={t('simulator.hold')} icon={PauseCircle} />
          <ControlButton label={t('simulator.transfer')} icon={PhoneForwarded} />
          <ControlButton label={t('simulator.end')} icon={PhoneOff} destructive onClick={onEnd} />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_2fr_1fr] gap-5">
        <CustomerPanel scenario={scenario} language={language} live={live} />

        <div className="flex flex-col gap-4">
          <ChatTranscript messages={state.messages} scenario={scenario} isTyping={isCustomerTyping} />
          <AgentInput onSend={onSend} disabled={!live || isCustomerTyping} />
        </div>

        <Checklist scenario={scenario} language={language} completed={state.completedChecklist} />
      </div>
    </div>
  );
}
