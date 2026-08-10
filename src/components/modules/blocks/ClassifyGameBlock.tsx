// src/components/modules/blocks/ClassifyGameBlock.tsx
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { saveActivityAttempt } from '@/services/activity.service';
import { CompletedActivityBanner } from './CompletedActivityBanner';
import { beginDragUx, endDragUx, withNoSelectDrag } from '@/lib/dragUx';
import { shuffleArray } from '@/lib/quizShuffle';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
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
  /** Último intento guardado en la base (para restaurar "ya completado"). */
  savedAttempt?: any;
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

/** Prefijo de las zonas donde se puede soltar (evita chocar con los ids de caso). */
const ZONE = 'zone-';
const UNASSIGNED_ZONE = `${ZONE}unassigned`;

const chipClass =
  'px-3 py-2 rounded-lg glass border border-glass-border/20 text-[13px] text-text select-none';

/**
 * Caso arrastrable: ratón, dedo (mantener pulsado) y teclado. Antes usaba el
 * arrastre HTML5, que no existe en pantallas táctiles: en el celular no había
 * forma de clasificar nada.
 */
function DraggableCase({
  id,
  fromCategory,
  children,
}: {
  id: string;
  fromCategory: string | null;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { fromCategory },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...withNoSelectDrag(listeners)}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        chipClass,
        'cursor-grab active:cursor-grabbing outline-none transition-colors hover:border-neon-green/30',
        'focus-visible:border-neon-green focus-visible:ring-2 focus-visible:ring-neon-green/30',
        isDragging && 'opacity-40',
      )}
    >
      {children}
    </div>
  );
}

/** Zona donde se sueltan los casos (la bandeja y cada categoría). */
function DropZone({
  id,
  className,
  activeClassName,
  children,
}: {
  id: string;
  className?: string;
  activeClassName?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn(className, isOver && activeClassName)}>
      {children}
    </div>
  );
}

export function ClassifyGameBlockRenderer({ block, language, userId, campaignId, moduleId, sectionId, savedAttempt }: Props) {
  const { t } = useTranslation();
  // Vista "ya completado": si hay intento en la base y el aprendiz no ha vuelto a
  // interactuar en esta sesión, mostramos el aviso en vez de rearrancar el juego.
  const [interacted, setInteracted] = useState(false);
  const [assigned, setAssigned] = useState<Record<string, ClassifyCase[]>>(() =>
    Object.fromEntries(block.categories.map((c) => [c.id, []]))
  );
  const [unassigned, setUnassigned] = useState<ClassifyCase[]>(() => shuffleArray(block.cases));
  const [submitted, setSubmitted] = useState(false);
  // Caso que se está arrastrando ahora mismo (para pintar el "fantasma" que
  // sigue al dedo o al cursor).
  const [activeCase, setActiveCase] = useState<ClassifyCase | null>(null);

  // Ratón: arrastra tras 6 px. Dedo: mantener pulsado 180 ms (así un deslizamiento
  // normal sigue haciendo scroll). Teclado: Espacio + flechas.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

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

  // Si el bloque se desmonta a mitad de un arrastre, el <body> se quedaría sin
  // poder seleccionar texto.
  useEffect(() => endDragUx, []);

  const handleDragStart = (event: DragStartEvent) => {
    beginDragUx();
    setInteracted(true);
    setActiveCase(block.cases.find((c) => c.id === event.active.id) ?? null);
  };

  const handleDragCancel = () => {
    endDragUx();
    setActiveCase(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    endDragUx();
    setActiveCase(null);
    const { active, over } = event;
    if (!over || submitted) return;
    const caseId = String(active.id);
    const fromCategory =
      (active.data.current as { fromCategory?: string | null } | undefined)?.fromCategory ?? null;
    const zone = String(over.id);
    if (zone === UNASSIGNED_ZONE) {
      handleDropOnUnassigned(caseId, fromCategory);
    } else if (zone.startsWith(ZONE)) {
      const toCategoryId = zone.slice(ZONE.length);
      if (toCategoryId === fromCategory) return;
      handleDropOnCategory(toCategoryId, caseId, fromCategory);
    }
  };

  const handleDropOnCategory = (
    toCategoryId: string,
    caseId: string,
    fromCategory: string | null,
  ) => {
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
  };

  const handleDropOnUnassigned = (caseId: string, fromCategory: string | null) => {
    if (!fromCategory) return;

    const found = block.cases.find((c) => c.id === caseId);
    if (!found) return;

    setAssigned((prev) => ({
      ...prev,
      [fromCategory]: prev[fromCategory].filter((c) => c.id !== caseId),
    }));
    setUnassigned((prev) => [...prev, found]);
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

    // Detalle caso por caso: dónde lo puso el aprendiz y dónde iba. Es lo que el
    // capacitador necesita para ver si entendió el criterio o solo tuvo suerte.
    const nombreCategoria = (id: string | null) => {
      if (!id) return null;
      const cat = block.categories.find((c) => c.id === id);
      return cat ? cat.name[language] || cat.name.es : null;
    };
    const detalle = block.cases.map((c) => {
      const catElegida = block.categories.find((cat) => assigned[cat.id]?.some((a) => a.id === c.id))?.id ?? null;
      return {
        caso: c.text[language] || c.text.es,
        categoria_elegida: nombreCategoria(catElegida),
        categoria_correcta: nombreCategoria(c.correctCategoryId),
        correcta: catElegida === c.correctCategoryId,
      };
    });

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
          detalle,
        },
      });
    } else {
      console.warn('[ClassifyGameBlock] Falta userId o campaignId — no se guardó el intento.');
    }
  };

  const handleReset = () => {
    setInteracted(true);
    setAssigned(Object.fromEntries(block.categories.map((c) => [c.id, []])));
    setUnassigned(shuffleArray(block.cases));
    setSubmitted(false);
    setElapsedSeconds(0);
    setFallosDetectados(0);
  };

  // Aviso "ya completado" (intento previo en la base, sin interacción esta sesión).
  if (savedAttempt && !interacted) {
    return (
      <CompletedActivityBanner
        scorePct={savedAttempt.score}
        detail={savedAttempt.submitted_answers?.mensaje_detalle ?? null}
        onRedo={handleReset}
      />
    );
  }

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

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {!submitted && (
          <DropZone
            id={UNASSIGNED_ZONE}
            className={cn(
              'min-h-[64px] rounded-xl border border-dashed border-glass-border/30 p-3 flex flex-wrap gap-2',
              'transition-colors',
              unassigned.length === 0 && 'border-neon-green/20 bg-neon-green/3',
            )}
            activeClassName="border-neon-green/50 bg-neon-green/5"
          >
            {unassigned.length === 0 ? (
              <p className="text-[12px] text-neon-green/50 w-full text-center py-2">
                {t('module.blocks.classify.all_assigned')}
              </p>
            ) : (
              unassigned.map((c) => (
                <DraggableCase key={c.id} id={c.id} fromCategory={null}>
                  {c.text[language] || c.text.es}
                </DraggableCase>
              ))
            )}
          </DropZone>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mt-5">
          {block.categories.map((cat) => {
            const style = getStyle(cat.color);
            const casesInCat = assigned[cat.id] ?? [];
            return (
              <DropZone
                key={cat.id}
                id={`${ZONE}${cat.id}`}
                className={cn(
                  'rounded-xl border-2 border-dashed p-3 min-h-[100px] transition-all duration-200',
                  style.border,
                  submitted && style.bg,
                )}
                activeClassName={cn('scale-[1.01]', style.bg)}
              >
                <p className={cn('text-[11px] font-bold uppercase tracking-widest mb-2', style.text)}>
                  {cat.name[language] || cat.name.es}
                </p>
                <div className="flex flex-wrap gap-2">
                  {casesInCat.length === 0 && !submitted && (
                    <p className="text-[11px] text-text-subtle/40 w-full text-center py-2">
                      {t('module.blocks.classify.drop_here')}
                    </p>
                  )}
                  {casesInCat.map((c) => {
                    const isCorrect = submitted && c.correctCategoryId === cat.id;
                    const isWrong   = submitted && c.correctCategoryId !== cat.id;
                    if (submitted) {
                      return (
                        <div
                          key={c.id}
                          className={cn(
                            'px-3 py-2 rounded-lg text-[13px] select-none flex items-center gap-2 cursor-default',
                            isCorrect && 'bg-neon-green/10 border border-neon-green/30 text-neon-green',
                            isWrong   && 'bg-red-500/10 border border-red-500/30 text-red-400',
                          )}
                        >
                          {c.text[language] || c.text.es}
                          {isCorrect && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                          {isWrong   && <XCircle className="h-3.5 w-3.5 shrink-0" />}
                        </div>
                      );
                    }
                    return (
                      <DraggableCase key={c.id} id={c.id} fromCategory={cat.id}>
                        {c.text[language] || c.text.es}
                      </DraggableCase>
                    );
                  })}
                </div>
              </DropZone>
            );
          })}
        </div>

        {/* Fantasma que sigue al dedo/cursor: en táctil es lo que hace evidente
            que el caso se está moviendo, porque el original se queda en su sitio.

            VA EN UN PORTAL A <body> A PROPÓSITO: el DragOverlay se posiciona con
            `position: fixed`, y cada sección del módulo está envuelta en <Reveal>,
            cuya clase .reveal-in deja un `transform: translateY(0)`. Un transform
            distinto de `none` convierte a ese elemento en el bloque contenedor de
            sus descendientes fijos, así que el fantasma quedaba desplazado respecto
            al cursor tanto como lo estuviera la sección en la página. El portal lo
            saca de ese contenedor; el contexto de DndContext viaja por el portal. */}
        {createPortal(
          <DragOverlay dropAnimation={null} zIndex={9999}>
            {activeCase ? (
              <div className={cn(chipClass, 'border-neon-green/50 shadow-xl cursor-grabbing')}>
                {activeCase.text[language] || activeCase.text.es}
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>

      {!submitted && (
        <p className="text-[11px] text-text-subtle/70 text-center">
          {t('module.blocks.classify.drag_hint')}
        </p>
      )}

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
          {allAssigned ? t('module.blocks.classify.evaluate') : t('module.blocks.classify.assign_all', { count: unassigned.length })}
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
              <span className="text-[15px] font-semibold text-text">{t('module.blocks.result_final')}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl p-4 bg-neon-green/8 border border-neon-green/15 text-center">
                <p className="text-[32px] font-bold text-neon-green leading-none">{correctCount}</p>
                <p className="text-[11px] text-text-subtle mt-2 leading-tight">
                  {correctCount === 1 ? t('module.blocks.classify.cases_one') : t('module.blocks.classify.cases_other')}<br />{t('module.blocks.classify.correct_label')}
                </p>
              </div>
              <div className="rounded-xl p-4 glass border border-glass-border/10 text-center">
                <p className="text-[32px] font-bold text-text leading-none">{pct}%</p>
                <p className="text-[11px] text-text-subtle mt-2 leading-tight">
                  {t('module.blocks.classify.efficiency')}<br />{t('module.blocks.classify.of_classification')}
                </p>
              </div>
            </div>

            {pct === 100 && (
              <p className="text-[13px] text-neon-green text-center">
                {t('module.blocks.classify.perfect')}
              </p>
            )}
            {pct < 100 && pct >= 50 && (
              <p className="text-[13px] text-text-subtle text-center">
                {t('module.blocks.classify.good_try')}
              </p>
            )}
            {pct < 50 && (
              <p className="text-[13px] text-red-400 text-center">
                {t('module.blocks.classify.review_material')}
              </p>
            )}

            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl glass border border-glass-border/15 text-text-subtle text-[13px] hover:text-text transition-colors"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              {t('module.blocks.retry')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
