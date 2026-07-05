import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, RefreshCcw, Trophy, Timer, AlertCircle } from 'lucide-react';
import { saveActivityAttempt } from '@/services/activity.service';
import type { GameSortBlock, GameSortProcess } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

function normalizeProcesses(block: GameSortBlock): GameSortProcess[] {
  if (block.processes && block.processes.length > 0) return block.processes;
  if (block.steps && block.steps.length > 0) {
    return [{ id: 'legacy-process', steps: block.steps }];
  }
  return [];
}

function shuffled<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function playSound(type: 'success' | 'error' | 'complete' | 'final') {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const play = (freq: number, duration: number, delay: number, wave: OscillatorType = 'sine', gain = 0.5) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      vol.gain.setValueAtTime(gain, ctx.currentTime + delay);
      vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + duration);
    };
    switch (type) {
      case 'success':
        play(523, 0.15, 0);
        play(659, 0.15, 0.1);
        play(784, 0.2, 0.2);
        break;
      case 'error':
        play(200, 0.15, 0, 'sawtooth', 0.25);
        play(150, 0.2, 0.15, 'sawtooth', 0.25);
        break;
      case 'complete':
        play(523, 0.1, 0);
        play(659, 0.1, 0.08);
        play(784, 0.1, 0.16);
        play(1047, 0.3, 0.24);
        break;
      case 'final':
        play(523, 0.1, 0);
        play(659, 0.1, 0.1);
        play(784, 0.1, 0.2);
        play(1047, 0.1, 0.3);
        play(1319, 0.4, 0.4, 'sine', 0.4);
        break;
    }
  } catch {
    // Silencio si no es soportado
  }
}

type Phase = 'playing' | 'error' | 'success' | 'final';

interface Props {
  block: GameSortBlock;
  language: Language;
  userId?: string;
  campaignId?: string;
  moduleId?: string;
  sectionId?: string;
  onScoreChange?: (score: number, total: number) => void;
}

const fadeSlide = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -14 },
  transition: { duration: 0.22, ease: 'easeOut' },
};

export default function SortGameBlock({ block, language, userId, campaignId, moduleId, sectionId }: Props) {
  const { t } = useTranslation();
  const processes = normalizeProcesses(block);

  // ESTADOS INTERNOS
  const [processIdx, setProcessIdx] = useState(0);
  const [items, setItems] = useState(() => (processes[0] ? shuffled(processes[0].steps) : []));
  const [dragId, setDragId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('playing');
  const [usedHelp, setUsedHelp] = useState<boolean[]>(() => new Array(processes.length).fill(false));
  const [elapsed, setElapsed] = useState(0);
  const [savedTime, setSavedTime] = useState(0);
  const [showBlockedPop, setShowBlockedPop] = useState(false);

  const timerRef = useRef<any>(null);

  // ─── 1. EFFECT DE GUARDADO EN SUPABASE  ───
  useEffect(() => {
    if (phase === 'final' && userId && campaignId) {
      const guardarProgresoEnSupabase = async () => {
        try {
          console.log("Sincronizando juego interactivo...");
          const sId = sectionId || (block as any).id || '';
          const mId = moduleId || '';

          const scoreFirstTryLocal = processes.length - usedHelp.filter(Boolean).length;
          const scoreWithHelpLocal = usedHelp.filter(Boolean).length;
          const pct = processes.length > 0
            ? Math.round((scoreFirstTryLocal / processes.length) * 100)
            : 100;

          let mensajeDetalle: string | null = null;
          if (scoreWithHelpLocal > 0) {
            const nombresRepasar = processes
              .filter((_, i) => usedHelp[i])
              .slice(0, 3)
              .map((p) => p.title?.[language] || p.title?.es || 'Proceso sin título')
              .join(', ');
            const extra = scoreWithHelpLocal > 3 ? ` y ${scoreWithHelpLocal - 3} más` : '';
            mensajeDetalle = `${scoreWithHelpLocal} de ${processes.length} procesos necesitaron repaso: ${nombresRepasar}${extra}.`;
          }

          await saveActivityAttempt({
            user_id: userId,
            campaign_id: campaignId,
            module_id: mId,
            section_id: sId,
            game_type: 'SORT_PROCESS',
            score: pct,
            attempt_number: 1,
            status: pct === 100 ? 'completed' : 'failed',
            time_spent_seconds: elapsed || null,
            submitted_answers: {
              mensaje: "Juego de ordenar completado",
              proceso_finalizado: (block as any).title?.es || 'Secuenciación',
              aciertos: scoreFirstTryLocal,
              total: processes.length,
              errores: scoreWithHelpLocal,
              mensaje_detalle: mensajeDetalle,
            }
          });

          console.log("¡Intento guardado con éxito en user_progress!");
        } catch (err) {
          console.error("Fallo crítico en el bloque automático:", err);
        }
      };

      void guardarProgresoEnSupabase();
    }
  }, [phase, userId, campaignId, block, elapsed, moduleId, sectionId, processes, usedHelp, language]);

  // ─── EFFECTS DE TEMPORIZADOR Y CONTROL DE FASES ───
  useEffect(() => {
    if (phase === 'playing') {
      timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (phase === 'success' || phase === 'error') setSavedTime(elapsed);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, elapsed]);

  useEffect(() => {
    if (phase !== 'success') return;
    const isLastProcess = processIdx === processes.length - 1;
    if (!isLastProcess) return;
    const timer = setTimeout(() => {
      setPhase('final');
      playSound('final');
    }, 1800);
    return () => clearTimeout(timer);
  }, [phase, processIdx, processes.length]);

  if (processes.length === 0) return null;

  const currentProcess = processes[processIdx];
  const correctOrder   = currentProcess.steps.map((s) => s.id);
  const multiProcess   = processes.length > 1;
  const isLastProcess  = processIdx === processes.length - 1;

  const feedbackCorrect = currentProcess.feedback_correct?.[language] || currentProcess.feedback_correct?.es || t('module.blocks.sort.default_correct');
  const feedbackWrong = currentProcess.feedback_wrong?.[language] || currentProcess.feedback_wrong?.es || t('module.blocks.sort.default_wrong');

  // MANEJADORES DE ACCIONES
  const handleDragStart = (id: string) => setDragId(id);

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setItems((prev) => {
      const next = [...prev];
      const from = next.findIndex((s) => s.id === dragId);
      const to   = next.findIndex((s) => s.id === targetId);
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragId(null);
  };

  const handleVerify = async () => {
    const isCorrect = items.every((item, i) => item.id === correctOrder[i]);

    if (isCorrect) {
      setPhase('success');
      playSound('success');
    } else {
      setUsedHelp((prev) => {
        const next = [...prev]; next[processIdx] = true; return next;
      });
      setPhase('error');
      playSound('error');
    }
  };

  const handleRetry = () => {
    setElapsed(0);
    setItems(shuffled(currentProcess.steps));
    setPhase('playing');
  };

  const handleNext = () => {
    const nextIdx = processIdx + 1;
    if (nextIdx >= processes.length) {
      setPhase('final');
      playSound('final');
    } else {
      setProcessIdx(nextIdx);
      setItems(shuffled(processes[nextIdx].steps));
      setElapsed(0);
      setPhase('playing');
      playSound('complete');
    }
  };

  const handleArrowClick = () => {
    if (phase !== 'success') {
      setShowBlockedPop(true);
      setTimeout(() => setShowBlockedPop(false), 2500);
    } else {
      handleNext();
    }
  };

  const handleReset = () => {
    setProcessIdx(0);
    setItems(shuffled(processes[0].steps));
    setUsedHelp(new Array(processes.length).fill(false));
    setElapsed(0);
    setPhase('playing');
  };

  const scoreFirstTry = processes.length - usedHelp.filter(Boolean).length;
  const scoreWithHelp = usedHelp.filter(Boolean).length;

  return (
    <div className="space-y-5">
      {/* Badges de progreso */}
      {multiProcess && phase !== 'final' && (
        <div className="flex flex-col items-center gap-2">
          <div className="relative flex items-center justify-center gap-0">
            <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-[3px] bg-glass-border/20 rounded-full z-0" />
            <div
              className="absolute top-1/2 -translate-y-1/2 left-0 h-[3px] bg-neon-green rounded-full z-0 transition-all duration-500"
              style={{ width: `${(processIdx / (processes.length - 1)) * 100}%` }}
            />
            {processes.map((_, i) => (
              <div key={i} className="relative z-10 px-3">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold transition-all duration-300 border-2',
                  i < processIdx   && 'bg-neon-green border-neon-green text-black',
                  i === processIdx && 'bg-[#1a1a1a] border-neon-green text-neon-green shadow-[0_0_10px_rgba(0,255,100,0.3)]',
                  i > processIdx   && 'bg-[#1a1a1a] border-glass-border/30 text-text-subtle',
                )}>
                  {i < processIdx ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Título */}
      {phase !== 'final' && (
        <div className="text-center space-y-1">
          {block.title?.[language] && (
            <h3 className="font-bold text-[1.15rem] text-text">
              {block.title[language]}
            </h3>
          )}
          {currentProcess.title?.[language] || currentProcess.title?.es ? (
            <p className="text-[13px] text-text-subtle">
              {currentProcess.title?.[language] || currentProcess.title?.es}
            </p>
          ) : block.instructions?.[language] ? (
            <p className="text-[13px] text-text-subtle">
              {block.instructions[language]}
            </p>
          ) : null}
        </div>
      )}

      {/* Área principal */}
      {phase !== 'final' && (
        <div className="relative flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              {phase === 'playing' && (
                <motion.div key={`playing-${processIdx}`} {...fadeSlide} className="space-y-2">
                  {items.map((step, index) => (
                    <div
                      key={step.id}
                      draggable
                      onDragStart={() => handleDragStart(step.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(step.id)}
                      className={cn(
                        'flex items-center gap-0 rounded-xl border transition-all duration-200 select-none cursor-grab active:cursor-grabbing overflow-hidden',
                        'border-neon-green/30 hover:border-neon-green/60',
                        dragId === step.id && 'opacity-40 scale-95',
                      )}
                    >
                      <span className="text-[13px] font-bold text-text-subtle w-9 text-center shrink-0 py-3">
                        {index + 1}
                      </span>
                      <div className="flex-1 glass border-l border-neon-green/20 px-4 py-3">
                        <span className="text-[14px] text-text">
                          {step.text[language] || step.text.es}
                        </span>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={handleVerify}
                    className="w-full mt-1 py-2.5 rounded-xl bg-neon-green/10 border border-neon-green/20 text-neon-green text-[13.5px] font-semibold hover:bg-neon-green/20 transition-colors"
                  >
                    {t('module.blocks.sort.verify')}
                  </button>
                </motion.div>
              )}

              {phase === 'error' && (
                <motion.div key={`error-${processIdx}`} {...fadeSlide} className="space-y-2">
                  {items.map((step, index) => {
                    const wrong = step.id !== correctOrder[index];
                    return (
                      <div
                        key={step.id}
                        className={cn(
                          'flex items-center gap-0 rounded-xl border select-none overflow-hidden transition-all duration-200',
                          wrong ? 'border-red-500/40' : 'border-neon-green/30',
                        )}
                      >
                        <span className={cn(
                          'text-[13px] font-bold w-9 text-center shrink-0 py-3',
                          wrong ? 'text-red-400' : 'text-neon-green',
                        )}>
                          {index + 1}
                        </span>
                        <div className={cn(
                          'flex-1 border-l px-4 py-3 flex items-center justify-between glass',
                          wrong ? 'border-red-500/20 bg-red-500/5' : 'border-neon-green/20 bg-neon-green/5',
                        )}>
                          <span className={cn('text-[14px]', wrong ? 'text-red-300' : 'text-text')}>
                            {step.text[language] || step.text.es}
                          </span>
                          {wrong && <span className="text-red-400 text-[13px] font-bold shrink-0 ml-2">✕</span>}
                          {!wrong && <CheckCircle2 className="h-4 w-4 text-neon-green shrink-0 ml-2" />}
                        </div>
                      </div>
                    );
                  })}
                  <div className="rounded-xl px-4 py-3 border bg-red-500/8 border-red-500/20 space-y-1">
                    <p className="text-[13px] font-semibold text-red-400 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {feedbackWrong}
                    </p>
                    <div className="flex justify-end">
                      <span className="text-[11px] text-text-subtle/50 flex items-center gap-1">
                        <Timer className="h-3 w-3" />
                        {formatTime(savedTime)} {t('module.blocks.seconds_suffix')}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleRetry}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl glass border border-glass-border/15 text-text-subtle text-[13px] hover:text-text transition-colors"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    {t('module.blocks.retry')}
                  </button>
                </motion.div>
              )}

              {phase === 'success' && (
                <motion.div key={`success-${processIdx}`} {...fadeSlide} className="space-y-2">
                  {items.map((step, index) => (
                    <div
                      key={step.id}
                      className="flex items-center gap-0 rounded-xl border border-neon-green/40 select-none overflow-hidden"
                    >
                      <span className="text-[13px] font-bold text-neon-green w-9 text-center shrink-0 py-3">
                        {index + 1}
                      </span>
                      <div className="flex-1 glass border-l border-neon-green/20 bg-neon-green/5 px-4 py-3 flex items-center justify-between">
                        <span className="text-[14px] text-text">
                          {step.text[language] || step.text.es}
                        </span>
                        <CheckCircle2 className="h-4 w-4 text-neon-green shrink-0 ml-2" />
                      </div>
                    </div>
                  ))}
                  <div className="rounded-xl px-4 py-3 border bg-neon-green/8 border-neon-green/20 space-y-1">
                    <p className="text-[13px] font-semibold text-neon-green">
                      {feedbackCorrect}
                    </p>
                    <div className="flex justify-end">
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 dark:bg-black/20 border border-line/40 text-text-muted flex items-center gap-1">
                        <Timer className="h-3 w-3 text-text-muted" />
                        {formatTime(savedTime)} {t('module.blocks.seconds_suffix')}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={handleRetry}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl glass border border-glass-border/15 text-text-subtle text-[13px] hover:text-text transition-colors"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    {t('module.blocks.retry')}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {multiProcess && !(phase === 'success' && isLastProcess) && (
            <div className="relative flex flex-col items-center shrink-0">
              <button
                onClick={handleArrowClick}
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300',
                  phase === 'success'
                    ? 'border-neon-green text-neon-green hover:bg-neon-green/10 cursor-pointer'
                    : 'border-glass-border/20 text-text-subtle/30 cursor-not-allowed',
                )}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </button>
              <AnimatePresence>
                {showBlockedPop && (
                  <motion.div
                    initial={{ opacity: 0, x: 8, scale: 0.92 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 8, scale: 0.92 }}
                    transition={{ duration: 0.18 }}
                    className="absolute right-12 top-1/2 -translate-y-1/2 z-20 w-48 px-3 py-2.5 rounded-xl glass border border-red-500/20 bg-red-500/10 shadow-lg"
                  >
                    <p className="text-[12px] text-red-400 leading-snug font-medium">
                      {t('module.blocks.sort.complete_to_continue')}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* FINAL */}
      {phase === 'final' && (
        <motion.div
          key="final"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="space-y-4"
        >
          <div className="glass rounded-2xl p-6 space-y-5 border border-glass-border/10">
            <div className="flex items-center gap-3">
              <Trophy className="h-5 w-5 text-neon-green shrink-0" />
              <span className="text-[15px] font-semibold text-text">{t('module.blocks.result_final')}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-glass-border/20 bg-white dark:bg-white/5 backdrop-blur-sm flex flex-col justify-between space-y-2 shadow-sm transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-text-subtle dark:text-text-muted uppercase tracking-wider">
                    {t('module.blocks.sort.efficiency')}
                  </span>
                  <span className="text-emerald-500 text-xs">🎯</span>
                </div>
                <p className="text-2xl font-bold text-neutral-800 dark:text-text">
                  {processes.length > 0 ? Math.round((scoreFirstTry / processes.length) * 100) : 100}%
                </p>
                <p className="text-[10px] text-text-subtle/80 dark:text-text-subtle">
                  {t('module.blocks.sort.efficiency_detail', { total: processes.length, done: scoreFirstTry })}
                </p>
              </div>

              <div className={cn(
                "p-4 rounded-xl border flex flex-col justify-between space-y-2 shadow-sm transition-colors",
                scoreWithHelp > 0 
                  ? "border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/10" 
                  : "border-green-200 bg-green-50/50 dark:border-green-500/30 dark:bg-green-500/10"
              )}>
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-[11px] font-semibold uppercase tracking-wider",
                    scoreWithHelp > 0 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"
                  )}>
                    {t('module.blocks.sort.flows_to_fix')}
                  </span>
                  <span className="text-xs">{scoreWithHelp > 0 ? '⚠️' : '✅'}</span>
                </div>
                <p className={cn(
                  "text-2xl font-bold",
                  scoreWithHelp > 0 ? "text-amber-800 dark:text-amber-300" : "text-green-800 dark:text-green-300"
                )}>
                  {scoreWithHelp} {scoreWithHelp === 1 ? t('module.blocks.sort.section_one') : t('module.blocks.sort.section_other')}
                </p>
                <p className="text-[10px] text-text-subtle/80 dark:text-text-subtle">
                  {scoreWithHelp > 0
                    ? t('module.blocks.sort.fix_hint')
                    : t('module.blocks.sort.no_alerts')}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {processes.map((proc, i) => (
                <div
                  key={proc.id}
                  className={cn(
                    'flex items-center justify-between px-4 py-3 rounded-xl border text-[13px]',
                    !usedHelp[i] ? 'bg-neon-green/5 border-neon-green/20 text-text' : 'bg-glass-border/5 border-glass-border/15 text-text',
                  )}
                >
                  <span>{proc.title?.[language] || proc.title?.es || `Proceso ${i + 1}`}</span>
                  <span className={cn(
                    'text-[11px] px-2.5 py-0.5 rounded-full font-medium',
                    !usedHelp[i] ? 'bg-neon-green/10 text-neon-green' : 'bg-glass-border/10 text-text-subtle',
                  )}>
                    {!usedHelp[i] ? t('module.blocks.sort.first_try') : t('module.blocks.sort.needs_review')}
                  </span>
                </div>
              ))}
            </div>
            {scoreFirstTry === processes.length && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-[13px] text-neon-green text-center"
              >
                {t('module.blocks.sort.all_first_try')}
              </motion.p>
            )}
          </div>
          <button
            onClick={handleReset}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl glass border border-glass-border/15 text-text-subtle text-[13px] hover:text-text transition-colors"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            {t('module.blocks.retry')}
          </button>
        </motion.div>
      )}
    </div>
  );
}