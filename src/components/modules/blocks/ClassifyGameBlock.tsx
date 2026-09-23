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
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CheckCircle2, XCircle, Trophy, RefreshCcw } from 'lucide-react';
import type { GameClassifyBlock, ClassifyCase } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';
import { useGameAttempts } from '@/hooks/useGameAttempts';
import type { QuizPolicy } from '@/lib/quizPolicy';

interface Props {
  block: GameClassifyBlock;
  language: Language;
  userId?: string;
  campaignId?: string;
  moduleId?: string;
  sectionId?: string;
  /** Último intento guardado en la base (para restaurar "ya completado"). */
  savedAttempt?: any;
  /** Intentos ya gastados según la base (el navegador solo puede sumar). */
  savedAttemptCount?: number;
  /** Reglas del curso: cuántos intentos tiene este juego. Ver lib/quizPolicy. */
  policy?: QuizPolicy;
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
 * Se suelta donde está el puntero o el dedo, no donde cae la mayor parte del
 * fantasma. Con la detección por área (la de fábrica) un caso largo soltado cerca
 * del borde de una categoría "rebotaba" a la bandeja o a la categoría vecina, y el
 * aprendiz sentía que el juego se trababa. Si el puntero quedó entre dos zonas se
 * usa el área como respaldo.
 */
const collisionDetection: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  return byPointer.length > 0 ? byPointer : rectIntersection(args);
};

/**
 * Caso arrastrable: ratón, dedo (mantener pulsado) y teclado. Antes usaba el
 * arrastre HTML5, que no existe en pantallas táctiles: en el celular no había
 * forma de clasificar nada.
 */
function DraggableCase({
  id,
  fromCategory,
  selected,
  onSelect,
  children,
}: {
  id: string;
  fromCategory: string | null;
  selected: boolean;
  onSelect: () => void;
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
      // Tocar sin arrastrar lo selecciona (luego se toca la categoría). El clic
      // no sube a la zona que lo contiene: esa zona también escucha clics.
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      onContextMenu={(e) => e.preventDefault()}
      aria-pressed={selected}
      className={cn(
        chipClass,
        // touch-manipulation: sin él, el doble toque de zoom del celular compite
        // con el «mantener pulsado» que activa el arrastre.
        'cursor-grab active:cursor-grabbing outline-none transition-colors hover:border-neon-green/30 touch-manipulation',
        'focus-visible:border-neon-green focus-visible:ring-2 focus-visible:ring-neon-green/30',
        selected && 'border-neon-green bg-neon-green/10 ring-2 ring-neon-green/40',
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
  onPlace,
  children,
}: {
  id: string;
  className?: string;
  activeClassName?: string;
  /** Hay un caso seleccionado con un toque: tocar la zona lo pone aquí. */
  onPlace?: () => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      onClick={onPlace}
      className={cn(className, onPlace && 'cursor-pointer', isOver && activeClassName)}
    >
      {children}
    </div>
  );
}

export function ClassifyGameBlockRenderer({ block, language, userId, campaignId, moduleId, sectionId, savedAttempt, savedAttemptCount = 0, policy }: Props) {
  /* Presupuesto de intentos. Agotarlo NO cierra el juego: se sigue jugando en
     práctica y llegar al umbral abre el módulo igual (ver useGameAttempts). */
  const attempts = useGameAttempts({
    moduleId,
    unitKey: `${sectionId || ''}__CLASSIFY_CASES`,
    policy,
    savedAttemptCount,
  });
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
  // Alternativa a arrastrar: tocar un caso y después tocar su categoría. Nació de
  // un comentario de NPS («se traba mucho» al arrastrar): en el celular, mantener
  // pulsado y arrastrar con el scroll de por medio es lo que más falla.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Ratón: arrastra tras 6 px. Dedo: mantener pulsado 180 ms (así un deslizamiento
  // normal sigue haciendo scroll). Teclado: Espacio + flechas.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  // Tiempo del intento: basta con la hora de arranque. Antes era un contador en
  // estado que volvía a pintar el juego entero cada segundo, también en mitad de
  // un arrastre, y eso se notaba como tirones.
  const startedAtRef = useRef(0);
  useEffect(() => { startedAtRef.current = Date.now(); }, []);

  // Si el bloque se desmonta a mitad de un arrastre, el <body> se quedaría sin
  // poder seleccionar texto.
  useEffect(() => endDragUx, []);

  // Esc suelta la selección hecha con un toque.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  /** Categoría donde está hoy un caso (null = sigue en la bandeja). */
  const categoryOf = (caseId: string) =>
    block.categories.find((c) => assigned[c.id]?.some((a) => a.id === caseId))?.id ?? null;

  // Soltar un caso donde empezó dispara además un clic sobre él; sin este aviso
  // quedaba seleccionado tras el arrastre.
  const justDraggedRef = useRef(false);
  const releaseDragGuard = () => {
    setTimeout(() => { justDraggedRef.current = false; }, 0);
  };

  const toggleSelect = (caseId: string) => {
    if (justDraggedRef.current) { justDraggedRef.current = false; return; }
    if (submitted) return;
    setInteracted(true);
    setSelectedId((cur) => (cur === caseId ? null : caseId));
  };

  const placeSelected = (zone: string) => {
    if (!selectedId || submitted) return;
    const fromCategory = categoryOf(selectedId);
    if (zone === UNASSIGNED_ZONE) {
      handleDropOnUnassigned(selectedId, fromCategory);
    } else {
      const toCategoryId = zone.slice(ZONE.length);
      if (toCategoryId !== fromCategory) handleDropOnCategory(toCategoryId, selectedId, fromCategory);
    }
    setSelectedId(null);
  };

  const handleDragStart = (event: DragStartEvent) => {
    beginDragUx();
    setInteracted(true);
    setSelectedId(null);
    justDraggedRef.current = true;
    setActiveCase(block.cases.find((c) => c.id === event.active.id) ?? null);
  };

  const handleDragCancel = () => {
    endDragUx();
    releaseDragGuard();
    setActiveCase(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    endDragUx();
    releaseDragGuard();
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
    // El intento pone el TECHO de la nota, y el mínimo del módulo su SUELO:
    // resolverlo nunca deja por debajo de lo que hace falta para pasar. Lo que
    // sí se pierde entero es el XP (ver quizPolicy).
    const settled = attempts.settle(pct);
    if (userId && campaignId) {
      void saveActivityAttempt({
        user_id: userId,
        campaign_id: campaignId,
        module_id: moduleId || '',
        section_id: sectionId || '',
        game_type: 'CLASSIFY_CASES',
        score: settled.score,
        attempt_number: settled.attempt,
        status: pct >= 70 ? 'completed' : 'failed',
        time_spent_seconds: Math.round((Date.now() - startedAtRef.current) / 1000),
        submitted_answers: {
          aciertos: correct,
          total_cases: total,
          errores: erroresEnEsteIntento,
          mensaje: 'Juego de clasificar casos completado',
          mensaje_detalle: mensajeDetalle,
          detalle,
          intento: settled.attempt,
          // `pct_real` es lo que de verdad logró. En práctica el `score` va en 0
          // para no tocar la nota, pero la compuerta necesita saber si llegó.
          pct_real: pct,
          ...(settled.practice ? { practica: true } : {}),
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
    setSelectedId(null);
    startedAtRef.current = Date.now();
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
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {!submitted && (
          <DropZone
            id={UNASSIGNED_ZONE}
            onPlace={selectedId && categoryOf(selectedId) ? () => placeSelected(UNASSIGNED_ZONE) : undefined}
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
                <DraggableCase
                  key={c.id}
                  id={c.id}
                  fromCategory={null}
                  selected={selectedId === c.id}
                  onSelect={() => toggleSelect(c.id)}
                >
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
                onPlace={selectedId && !submitted ? () => placeSelected(`${ZONE}${cat.id}`) : undefined}
                // Sin `scale` al pasar por encima: agrandar la zona en pleno
                // arrastre corría las demás y el destino se movía bajo el dedo.
                className={cn(
                  'rounded-xl border-2 border-dashed p-3 min-h-[100px] transition-colors duration-150',
                  style.border,
                  submitted && style.bg,
                  selectedId && !submitted && 'border-solid',
                )}
                activeClassName={cn('border-solid', style.bg)}
              >
                <p className={cn('text-[11px] font-bold uppercase tracking-widest mb-2', style.text)}>
                  {cat.name[language] || cat.name.es}
                </p>
                <div className="flex flex-wrap gap-2">
                  {casesInCat.length === 0 && !submitted && (
                    <p className={cn(
                      'text-[11px] w-full text-center py-2',
                      selectedId ? 'text-neon-green/80' : 'text-text-subtle/40',
                    )}>
                      {selectedId ? t('module.blocks.classify.tap_to_place') : t('module.blocks.classify.drop_here')}
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
                      <DraggableCase
                        key={c.id}
                        id={c.id}
                        fromCategory={cat.id}
                        selected={selectedId === c.id}
                        onSelect={() => toggleSelect(c.id)}
                      >
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

            {/* Reintentar siempre se puede. Lo que cambia es qué vale: con
                presupuesto, el techo del puntaje baja; sin presupuesto, ya no
                puntúa pero sigue abriendo el módulo si se alcanza el umbral.
                Nunca se cierra el contenido. */}
            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl glass border border-glass-border/15 text-text-subtle text-[13px] hover:text-text transition-colors"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              {attempts.practice ? t('module.blocks.retry_practice') : t('module.blocks.retry')}
              {!attempts.practice && attempts.max > 0 && (
                <span className="tabular-nums text-text-subtle/70">
                  {t('module.check_attempts_left', { count: attempts.left })}
                </span>
              )}
            </button>
            <p className="text-center text-[11.5px] text-text-subtle">
              {attempts.practice
                ? t('module.blocks.retry_practice_note')
                : t('module.blocks.retry_score_note')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
