import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';
import { Flame, ListChecks, Lock, PhoneCall, Sparkles } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';

/* ───────────────────────────────────────────────────────────────────────────
   Parada de práctica: la simulación DENTRO del recorrido del curso.

   Vive en la misma lista que los módulos, justo debajo del módulo que la abre,
   así que comparte su ritmo (alto de fila, marcador de 36px, flecha a la
   derecha) pero se distingue en un vistazo: fondo teñido con el color del
   curso, marcador en squircle en vez de círculo y un hilo de color a la
   izquierda. Se lee como "otra clase de parada en el mismo camino", no como una
   tarjeta suelta que alguien pegó en medio de la lista.

   Bloqueada dice QUÉ falta —el módulo por su nombre—, nunca "bloqueado" a secas.
   ─────────────────────────────────────────────────────────────────────────── */

export interface PracticeStopProps {
  kind: 'call' | 'choice';
  title: string;
  summary: string;
  unlocked: boolean;
  /** Título del módulo que la abre; se nombra en el candado. */
  unlockModuleTitle: string;
  passScore: number;
  difficulty?: 1 | 2 | 3;
  level?: 'basico' | 'medio' | 'avanzado';
  /** Color del curso: tiñe el acento para que la parada sea DE ESTE curso. */
  color: string;
  onStart: () => void;
  /** Posición en la lista, para escalonar la entrada. */
  index?: number;
}

const LEVEL_KEY = { basico: 'basic', medio: 'medium', avanzado: 'advanced' } as const;

export function PracticeStop({
  kind,
  title,
  summary,
  unlocked,
  unlockModuleTitle,
  passScore,
  difficulty,
  level,
  color,
  onStart,
  index = 0,
}: PracticeStopProps) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const Icon = kind === 'call' ? PhoneCall : ListChecks;

  // Barrido de luz: se dispara UNA vez, cuando la parada pasa de bloqueada a
  // abierta con la página ya montada (o sea, al volver de terminar el módulo).
  // Si al cargar ya estaba abierta no se anima: un destello en cada visita es
  // ruido, no celebración.
  //
  // El `armed` no es paranoia: el progreso se rehidrata desde la base poco
  // después de montar (useProgressSync), así que un módulo YA terminado llega
  // como bloqueado y se "desbloquea" a los pocos cientos de milisegundos. Sin
  // esta ventana, cada visita a la página del curso celebraría algo que pasó la
  // semana pasada.
  const wasUnlocked = useRef(unlocked);
  const armed = useRef(false);
  const [justUnlocked, setJustUnlocked] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => { armed.current = true; }, 1500);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const flipped = unlocked && !wasUnlocked.current;
    wasUnlocked.current = unlocked;
    if (!flipped || !armed.current) return;
    setJustUnlocked(true);
    const timer = setTimeout(() => setJustUnlocked(false), 1600);
    return () => clearTimeout(timer);
  }, [unlocked]);

  // Halo que sigue al cursor, solo cuando se puede entrar.
  const mx = useMotionValue(-300);
  const my = useMotionValue(-300);
  const halo = useMotionTemplate`radial-gradient(320px circle at ${mx}px ${my}px, ${color}1F, transparent 65%)`;

  const onMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(e.clientX - r.left);
    my.set(e.clientY - r.top);
  };

  const rowClass = cn(
    'group relative block w-full overflow-hidden px-2 py-4 text-left sm:px-3',
    unlocked ? 'cursor-pointer' : 'cursor-default',
  );
  const enter = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 10 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const, delay: Math.min(index, 6) * 0.04 },
      };

  /* Capas decorativas: tinte, hilo del recorrido, halo del cursor y el barrido
     del desbloqueo. Todas `pointer-events-none` — nunca se comen el clic. */
  const decor = (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: unlocked ? `linear-gradient(90deg, ${color}12, ${color}00 55%)` : 'transparent' }}
      />
      <span
        aria-hidden
        className={cn('pointer-events-none absolute inset-y-0 left-0 w-[2px] rounded-full', !unlocked && 'opacity-30')}
        style={{ background: unlocked ? color : 'rgb(var(--line))' }}
      />
      {!reduce && unlocked && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: halo }}
        />
      )}
      {!reduce && justUnlocked && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-1/3"
          style={{ background: `linear-gradient(90deg, transparent, ${color}33, transparent)` }}
          initial={{ x: '-140%' }}
          animate={{ x: '440%' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
    </>
  );

  const body = (
    <div className="relative flex items-center gap-4">
      {/* Marcador: squircle, no círculo. Es lo que dice "esto no es un módulo". */}
      <div className="relative shrink-0">
        {!reduce && unlocked && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-2xl"
            animate={{ boxShadow: [`0 0 0 0 ${color}44`, `0 0 0 10px ${color}00`] }}
            transition={{ duration: 2.4, ease: 'easeOut', repeat: Infinity, repeatDelay: 1.6 }}
          />
        )}
        <div
          className={cn(
            'relative flex h-9 w-9 items-center justify-center rounded-2xl transition-colors duration-300',
            !unlocked && 'border border-dashed border-line bg-subtle text-text-subtle',
          )}
          style={unlocked ? { background: `${color}1A`, color } : undefined}
        >
          {unlocked ? <Icon className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] font-medium uppercase tracking-[0.12em]">
          <span className={cn(!unlocked && 'text-text-subtle')} style={unlocked ? { color } : undefined}>
            {t('course_practice.stop_kicker')}
          </span>
          {unlocked && (
            <motion.span
              initial={reduce || !justUnlocked ? false : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.2 }}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] tracking-normal"
              style={{ background: `${color}1A`, color }}
            >
              <Sparkles className="h-3 w-3" />
              {t('course_practice.stop_unlocked_pill')}
            </motion.span>
          )}
        </div>

        <h3 className={cn('truncate text-[14.5px] font-medium tracking-tight', unlocked ? 'text-text' : 'text-text-muted')}>
          {title}
        </h3>
        <p className="truncate text-[12.5px] text-text-muted">
          {unlocked
            ? summary || t('course_practice.stop_default_summary', { score: passScore })
            : t('course_practice.stop_locked', { title: unlockModuleTitle })}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3 text-[12px] text-text-subtle">
        {unlocked && kind === 'call' && difficulty && (
          <span className="hidden items-center gap-0.5 sm:flex">
            {[1, 2, 3].map((d) => (
              <Flame
                key={d}
                className={cn('h-3 w-3', d > difficulty && 'text-line')}
                style={d <= difficulty ? { color } : undefined}
                fill={d <= difficulty ? 'currentColor' : 'none'}
              />
            ))}
          </span>
        )}
        {unlocked && kind === 'choice' && level && (
          <span className="hidden sm:inline">{t(`simulator.choice.level_${LEVEL_KEY[level]}`)}</span>
        )}
        {unlocked && (
          <span className="hidden tabular-nums sm:inline">{t('course_practice.stop_pass', { score: passScore })}</span>
        )}
        {unlocked && (
          <span className="transition-all duration-500 ease-apple group-hover:translate-x-1 group-hover:text-text">
            &rarr;
          </span>
        )}
      </div>
    </div>
  );

  // Bloqueada NO es un botón: un botón deshabilitado que no lleva a ninguna
  // parte solo genera clics al vacío. Es un aviso que explica qué falta.
  if (!unlocked) {
    return (
      <motion.div {...enter} className={rowClass}>
        {decor}
        {body}
      </motion.div>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onStart}
      onMouseMove={onMouseMove}
      whileTap={reduce ? undefined : { scale: 0.995 }}
      {...enter}
      className={rowClass}
    >
      {decor}
      {body}
    </motion.button>
  );
}
