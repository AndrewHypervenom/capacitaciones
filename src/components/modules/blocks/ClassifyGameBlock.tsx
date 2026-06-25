// src/components/modules/blocks/ClassifyGameBlock.tsx
import { useState, useRef, useEffect } from 'react';
import { saveActivityAttempt } from '@/services/activity.service';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Trophy, RefreshCcw } from 'lucide-react';
import type { GameClassifyBlock, ClassifyCase } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

interface Props {
  block: GameClassifyBlock;
  language: Language;
  userId?: string;
  campaignId?: string;
  moduleId?: string;
  sectionId?: string;
}

const CATEGORY_STYLES: Record<string, { border: string; bg: string; text: string; badge: string }> = {
  purple: { border: 'border-purple-500/40', bg: 'bg-purple-500/8', text: 'text-purple-400', badge: 'bg-purple-500/15 text-purple-400' },
  pink:   { border: 'border-pink-500/40',   bg: 'bg-pink-500/8',   text: 'text-pink-400',   badge: 'bg-pink-500/15 text-pink-400' },
  red:    { border: 'border-red-500/40',    bg: 'bg-red-500/8',    text: 'text-red-400',    badge: 'bg-red-500/15 text-red-400' },
  orange: { border: 'border-orange-500/40', bg: 'bg-orange-500/8', text: 'text-orange-400', badge: 'bg-orange-500/15 text-orange-400' },
  blue:   { border: 'border-blue-500/40',   bg: 'bg-blue-500/8',   text: 'text-blue-400',   badge: 'bg-blue-500/15 text-blue-400' },
  green:  { border: 'border-neon-green/40', bg: 'bg-neon-green/8', text: 'text-neon-green', badge: 'bg-neon-green/15 text-neon-green' },
};

function getStyle(color?: string) {
  return CATEGORY_STYLES[color ?? 'purple'] ?? CATEGORY_STYLES.purple;
}

function playSound(type: 'success' | 'error' | 'final') {
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
        play(523, 0.15, 0); play(659, 0.15, 0.1); play(784, 0.2, 0.2);
        break;
      case 'error':
        play(200, 0.15, 0, 'sawtooth', 0.2); play(150, 0.2, 0.15, 'sawtooth', 0.2);
        break;
      case 'final':
        play(523, 0.1, 0); play(659, 0.1, 0.1); play(784, 0.1, 0.2);
        play(1047, 0.1, 0.3); play(1319, 0.4, 0.4, 'sine', 0.4);
        break;
    }
  } catch { /* silencio */ }
}

export function ClassifyGameBlockRenderer({ block, language, userId, campaignId, moduleId, sectionId }: Props) {
  const [assigned, setAssigned] = useState<Record<string, ClassifyCase[]>>(() =>
    Object.fromEntries(block.categories.map((c) => [c.id, []]))
  );
  const [unassigned, setUnassigned] = useState<ClassifyCase[]>(() => [...block.cases].sort(() => Math.random() - 0.5));
  const [submitted, setSubmitted] = useState(false);
  const dragCase = useRef<{ caseId: string; fromCategory: string | null } | null>(null);

  // SEGUIMIENTO EN TIEMPO REAL: Controladores de tiempo y fallas analíticas
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [fallosDetectados, setFallosDetectados] = useState(0);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (!submitted) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((p) => p + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [submitted]);

  const handleDragStart = (caseId: string, fromCategory: string | null) => {
    dragCase.current = { caseId, fromCategory };
  };

  const handleDropOnCategory = (toCategoryId: string) => {
    if (!dragCase.current) return;
    const { caseId, fromCategory } = dragCase.current;

    setAssigned((prev) => {
      const next = { ...prev };
      if (fromCategory) {
        next[fromCategory] = next[fromCategory].filter((c) => c.id !== caseId);
      }
      const allCases = [...block.cases];
      const found = allCases.find((c) => c.id === caseId);
      if (!found) return next;
      if (!next[toCategoryId].find((c) => c.id === caseId)) {
        next[toCategoryId] = [...next[toCategoryId], found];
      }
      return next;
    });

    if (!fromCategory) {
      setUnassigned((prev) => prev.filter((c) => c.id !== caseId));
    }

    dragCase.current = null;
  };

  const handleDropOnUnassigned = () => {
    if (!dragCase.current) return;
    const { caseId, fromCategory } = dragCase.current;
    if (!fromCategory) return;

    const found = block.cases.find((c) => c.id === caseId);
    if (!found) return;

    setAssigned((prev) => ({
      ...prev,
      [fromCategory]: prev[fromCategory].filter((c) => c.id !== caseId),
    }));
    setUnassigned((prev) => [...prev, found]);
    dragCase.current = null;
  };

  const handleSubmit = () => {
    const allAssigned = unassigned.length === 0;
    if (!allAssigned) return;

    // Casos mal ubicados, con su texto legible para el mensaje de feedback
    const casosFallidos = block.cases.filter((c) => {
      const asignadoEnCat = assigned[c.correctCategoryId]?.find((a) => a.id === c.id);
      return !asignadoEnCat;
    });
    const erroresEnEsteIntento = casosFallidos.length;

    setFallosDetectados(erroresEnEsteIntento);
    setSubmitted(true);

    const correct = block.cases.filter((c) =>
      assigned[c.correctCategoryId]?.find((a) => a.id === c.id)
    ).length;
    const total = block.cases.length;
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

    if (correct === total) {
      playSound('final');
    } else if (correct >= total / 2) {
      playSound('success');
    } else {
      playSound('error');
    }

    // Mensaje legible para mostrar en el modal de feedback del aprendiz
    let mensajeDetalle: string | null = null;
    if (erroresEnEsteIntento > 0) {
      const nombresFallidos = casosFallidos
        .slice(0, 3)
        .map((c) => c.text[language] || c.text.es)
        .join(', ');
      const extra = erroresEnEsteIntento > 3 ? ` y ${erroresEnEsteIntento - 3} más` : '';
      mensajeDetalle = `${erroresEnEsteIntento} de ${total} casos mal ubicados: ${nombresFallidos}${extra}.`;
    }

    // ── GUARDADO EN SUPABASE ──
    if (userId && campaignId) {
      void saveActivityAttempt({
        user_id: userId,
        campaign_id: campaignId,
        module_id: moduleId || '',
        section_id: sectionId || '',
        game_type: 'CLASSIFY_CASES',
        score: pct,
        attempt_number: 1,
        status: pct >= 70 ? 'completed' : 'failed',
        time_spent_seconds: elapsedSeconds,
        submitted_answers: {
          aciertos: correct,
          total_cases: total,
          errores: erroresEnEsteIntento,
          mensaje: 'Juego de clasificar casos completado',
          mensaje_detalle: mensajeDetalle,
        },
      });
    } else {
      console.warn('[ClassifyGameBlock] Falta userId o campaignId — no se guardó el intento.');
    }
  };

  const handleReset = () => {
    setAssigned(Object.fromEntries(block.categories.map((c) => [c.id, []])));
    setUnassigned([...block.cases].sort(() => Math.random() - 0.5));
    setSubmitted(false);
    setElapsedSeconds(0);
    setFallosDetectados(0);
  };

  const correctCount = submitted
    ? block.cases.filter((c) => assigned[c.correctCategoryId]?.find((a) => a.id === c.id)).length
    : 0;
  const total = block.cases.length;
  const pct = total > 0 ? Math.round((correctCount / total) * 100) : 0;
  const allAssigned = unassigned.length === 0;

  return (
    <div className="space-y-5">
      {block.title?.[language] && (
        <h3 className="font-bold text-[1.15rem] text-text text-center">
          {block.title[language]}
        </h3>
      )}
      {block.instructions?.[language] && (
        <p className="text-[13px] text-text-subtle text-center">
          {block.instructions[language]}
        </p>
      )}

      {!submitted && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropOnUnassigned}
          className={cn(
            'min-h-[64px] rounded-xl border border-dashed border-glass-border/30 p-3 flex flex-wrap gap-2',
            'transition-colors',
            unassigned.length === 0 && 'border-neon-green/20 bg-neon-green/3',
          )}
        >
          {unassigned.length === 0 ? (
            <p className="text-[12px] text-neon-green/50 w-full text-center py-2">
              Todos los casos han sido asignados
            </p>
          ) : (
            unassigned.map((c) => (
              <div
                key={c.id}
                draggable
                onDragStart={() => handleDragStart(c.id, null)}
                className="px-3 py-2 rounded-lg glass border border-glass-border/20 text-[13px] text-text cursor-grab active:cursor-grabbing select-none hover:border-neon-green/30 transition-colors"
              >
                {c.text[language] || c.text.es}
              </div>
            ))
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {block.categories.map((cat) => {
          const style = getStyle(cat.color);
          const casesInCat = assigned[cat.id] ?? [];
          return (
            <div
              key={cat.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => !submitted && handleDropOnCategory(cat.id)}
              className={cn(
                'rounded-xl border-2 border-dashed p-3 min-h-[100px] transition-all duration-200',
                style.border,
                submitted ? style.bg : 'bg-transparent hover:' + style.bg,
              )}
            >
              <p className={cn('text-[11px] font-bold uppercase tracking-widest mb-2', style.text)}>
                {cat.name[language] || cat.name.es}
              </p>
              <div className="flex flex-wrap gap-2">
                {casesInCat.length === 0 && !submitted && (
                  <p className="text-[11px] text-text-subtle/40 w-full text-center py-2">
                    Arrastra casos aquí
                  </p>
                )}
                {casesInCat.map((c) => {
                  const isCorrect = submitted && c.correctCategoryId === cat.id;
                  const isWrong   = submitted && c.correctCategoryId !== cat.id;
                  return (
                    <div
                      key={c.id}
                      draggable={!submitted}
                      onDragStart={() => handleDragStart(c.id, cat.id)}
                      className={cn(
                        'px-3 py-2 rounded-lg text-[13px] select-none transition-all duration-200 flex items-center gap-2',
                        !submitted && 'cursor-grab active:cursor-grabbing glass border border-glass-border/20 text-text hover:border-neon-green/30',
                        isCorrect && 'bg-neon-green/10 border border-neon-green/30 text-neon-green cursor-default',
                        isWrong   && 'bg-red-500/10 border border-red-500/30 text-red-400 cursor-default',
                      )}
                    >
                      {c.text[language] || c.text.es}
                      {isCorrect && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                      {isWrong   && <XCircle className="h-3.5 w-3.5 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {!submitted && (
        <button
          onClick={handleSubmit}
          disabled={!allAssigned}
          className={cn(
            'w-full py-2.5 rounded-xl text-[13.5px] font-semibold transition-colors border',
            allAssigned
              ? 'bg-neon-green/10 border-neon-green/20 text-neon-green hover:bg-neon-green/20'
              : 'bg-glass-border/5 border-glass-border/10 text-text-subtle/40 cursor-not-allowed',
          )}
        >
          {allAssigned ? 'Evaluar respuestas' : `Asigna todos los casos para continuar (${unassigned.length} restantes)`}
        </button>
      )}

      <AnimatePresence>
        {submitted && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="glass rounded-2xl p-6 space-y-5 border border-glass-border/10"
          >
            <div className="flex items-center gap-3">
              <Trophy className="h-5 w-5 text-neon-green shrink-0" />
              <span className="text-[15px] font-semibold text-text">Resultado final</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-4 bg-neon-green/8 border border-neon-green/15 text-center">
                <p className="text-[32px] font-bold text-neon-green leading-none">{correctCount}</p>
                <p className="text-[11px] text-text-subtle mt-2 leading-tight">
                  {correctCount === 1 ? 'caso' : 'casos'}<br />correctos
                </p>
              </div>
              <div className="rounded-xl p-4 glass border border-glass-border/10 text-center">
                <p className="text-[32px] font-bold text-text leading-none">{pct}%</p>
                <p className="text-[11px] text-text-subtle mt-2 leading-tight">
                  eficacia<br />de clasificación
                </p>
              </div>
            </div>

            {pct === 100 && (
              <p className="text-[13px] text-neon-green text-center">
                ¡Perfecto! Clasificaste todos los casos correctamente.
              </p>
            )}
            {pct < 100 && pct >= 50 && (
              <p className="text-[13px] text-text-subtle text-center">
                Buen intento. Revisa los casos marcados en rojo e inténtalo de nuevo.
              </p>
            )}
            {pct < 50 && (
              <p className="text-[13px] text-red-400 text-center">
                Repasa el material e inténtalo de nuevo.
              </p>
            )}

            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl glass border border-glass-border/15 text-text-subtle text-[13px] hover:text-text transition-colors"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Volver a intentar
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
