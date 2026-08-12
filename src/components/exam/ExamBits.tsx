import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Check, Clock, Flag, Minus } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatClock, secondsLeft } from '@/services/exams.service';
import { cn } from '@/lib/cn';
import type { ExamDomainScore } from '@/types/exam';

/* ────────────────────────────────────────────────────────────────────────────
   Piezas visuales del examen final.

   Todo respeta `prefers-reduced-motion`: con movimiento reducido los mismos
   componentes se pintan en su estado final, sin animar. La curva es la misma
   `ease-apple` del resto del sitio.
   ──────────────────────────────────────────────────────────────────────────── */

const ease = [0.16, 1, 0.3, 1] as const;

/* ── Marcador circular del puntaje ─────────────────────────────────────────
   El aro se dibuja de 0 al puntaje obtenido, con una muesca en el mínimo
   aprobatorio: el aprendiz ve de un vistazo cuánto le faltó (o le sobró). */
export function ScoreGauge({
  value,
  passScore,
  passed,
  size = 220,
  stroke = 14,
  delay = 0.2,
  passLabel,
}: {
  value: number;
  passScore: number;
  passed: boolean;
  size?: number;
  stroke?: number;
  delay?: number;
  /** Rótulo bajo el número, ya traducido ("80% para aprobar"). */
  passLabel: string;
}) {
  const reduce = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const markAngle = (passScore / 100) * 360 - 90;
  const accent = passed ? 'rgb(var(--neon-green))' : '#F59E0B';

  const [shown, setShown] = useState(reduce ? pct : 0);
  useEffect(() => {
    if (reduce) {
      setShown(pct);
      return;
    }
    // El número sube junto con el aro: cuentan la misma historia.
    let raf = 0;
    const start = performance.now() + delay * 1000;
    const dur = 1400;
    const tick = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / dur));
      // easeOutExpo — frena al final, como el aro.
      const e = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setShown(Math.round(pct * e));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pct, reduce, delay]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-subtle"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={accent}
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c - (pct / 100) * c : c }}
          animate={{ strokeDashoffset: c - (pct / 100) * c }}
          transition={{ duration: reduce ? 0 : 1.4, ease, delay: reduce ? 0 : delay }}
          style={{ filter: `drop-shadow(0 0 12px ${accent}55)` }}
        />
      </svg>

      {/* Muesca del mínimo aprobatorio */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ transform: `rotate(${markAngle}deg)` }}
        aria-hidden
      >
        <span
          className="absolute left-1/2 top-0 block w-[2px] rounded-full bg-text-subtle/70"
          style={{ height: stroke + 6, transform: 'translate(-50%, -3px)' }}
        />
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-[46px] font-semibold leading-none tabular-nums tracking-tight"
          style={{ color: accent }}
        >
          {shown}
          <span className="text-[22px] font-medium opacity-60">%</span>
        </span>
        <span className="mt-1.5 text-[11.5px] uppercase tracking-[0.14em] text-text-subtle">
          {passLabel}
        </span>
      </div>
    </div>
  );
}

/* ── Barra de un dominio en el informe ─────────────────────────────────── */
export function DomainBar({
  domain,
  index = 0,
  label,
}: {
  domain: ExamDomainScore;
  index?: number;
  /** Nombre ya traducido por la pantalla que lo usa. */
  label: string;
}) {
  const reduce = useReducedMotion();
  const color = domain.passed ? 'rgb(var(--neon-green))' : '#F59E0B';

  return (
    <motion.div
      initial={reduce ? undefined : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay: reduce ? 0 : 0.15 + index * 0.08 }}
      className="flex items-center gap-4"
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          domain.passed ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-500',
        )}
      >
        {domain.passed ? (
          <Check className="h-4 w-4" strokeWidth={3} />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <span className="truncate text-[13.5px] font-medium text-text">{label}</span>
          <span className="shrink-0 text-[12px] tabular-nums text-text-muted">
            {domain.correct}/{domain.total}
          </span>
        </div>
        <div className="h-[6px] w-full overflow-hidden rounded-full bg-subtle">
          <motion.div
            className="h-full rounded-full"
            style={{ background: color }}
            initial={{ width: reduce ? `${domain.pct}%` : 0 }}
            animate={{ width: `${domain.pct}%` }}
            transition={{ duration: reduce ? 0 : 1, ease, delay: reduce ? 0 : 0.3 + index * 0.08 }}
          />
        </div>
      </div>

      <span
        className="w-12 shrink-0 text-right text-[14px] font-semibold tabular-nums"
        style={{ color }}
      >
        {domain.pct}%
      </span>
    </motion.div>
  );
}

/* ── Reloj del examen ──────────────────────────────────────────────────────
   Cuenta atrás real contra `expires_at` del servidor (no contra un contador
   local): cerrar la pestaña y volver no regala tiempo. Se pone ámbar bajo 5
   minutos y rojo bajo 1, y late en el último minuto. */
/** Avisos que el reloj da una sola vez, en segundos restantes. */
const TIMER_MILESTONES = [300, 60];

export function ExamTimer({
  expiresAt,
  onExpire,
  onMilestone,
  className,
}: {
  expiresAt: string | null;
  onExpire: () => void;
  /** Se dispara UNA vez al cruzar 5 min y 1 min. Para avisar sin ser pesado. */
  onMilestone?: (secondsLeft: number) => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [left, setLeft] = useState(() => secondsLeft(expiresAt));
  const fired = useRef(false);
  const announced = useRef<Set<number>>(new Set());
  // El callback vive en una ref para que cambiar de identidad no reinicie el
  // intervalo: reiniciarlo cada render haría saltar el reloj.
  const milestoneRef = useRef(onMilestone);
  milestoneRef.current = onMilestone;

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const s = secondsLeft(expiresAt);
      setLeft(s);

      for (const m of TIMER_MILESTONES) {
        if (s <= m && s > 0 && !announced.current.has(m)) {
          announced.current.add(m);
          milestoneRef.current?.(m);
        }
      }

      if (s <= 0 && !fired.current) {
        fired.current = true;
        onExpire();
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt, onExpire]);

  if (!expiresAt) return null;

  const urgent = left <= 60;
  const warn = left <= 300;

  return (
    <motion.div
      animate={urgent && !reduce ? { scale: [1, 1.045, 1] } : undefined}
      transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium tabular-nums transition-colors duration-500',
        urgent
          ? 'border-danger/40 bg-danger/10 text-danger'
          : warn
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-600'
            : 'border-line text-text-muted',
        className,
      )}
      role="timer"
      aria-live={urgent ? 'assertive' : 'off'}
    >
      <Clock className="h-3.5 w-3.5" />
      {formatClock(left)}
    </motion.div>
  );
}

/* ── Navegador de preguntas ────────────────────────────────────────────────
   Rejilla con el estado de cada pregunta. Es lo que convierte el examen en
   algo navegable en vez de un cuestionario lineal: se puede saltar, marcar
   para revisar y ver de un vistazo qué falta. */
export type QuestionMark = 'answered' | 'flagged' | 'empty';

export function QuestionNav({
  marks,
  current,
  onPick,
  className,
  labelPrefix = 'Pregunta',
  cols = 'grid-cols-8 sm:grid-cols-10',
  tooltipFor,
}: {
  marks: QuestionMark[];
  current: number;
  onPick: (i: number) => void;
  className?: string;
  labelPrefix?: string;
  /** Rejilla: el panel de envío es ancho, el riel lateral es angosto. */
  cols?: string;
  /** Texto del globo de cada casilla ("Pregunta 3 · sin responder"). */
  tooltipFor?: (index: number, mark: QuestionMark) => string;
}) {
  return (
    <div className={cn('grid gap-1.5', cols, className)}>
      {marks.map((m, i) => {
        const active = i === current;
        const btn = (
          <button
            onClick={() => onPick(i)}
            aria-label={`${labelPrefix} ${i + 1}`}
            aria-current={active}
            className={cn(
              'relative grid h-8 w-full place-items-center rounded-lg text-[12px] font-medium tabular-nums transition-all duration-300',
              active && 'ring-2 ring-primary ring-offset-2 ring-offset-bg',
              m === 'answered' && 'bg-primary/12 text-primary',
              m === 'flagged' && 'bg-amber-500/15 text-amber-600',
              m === 'empty' && 'bg-subtle text-text-subtle hover:text-text',
            )}
          >
            {i + 1}
            {m === 'flagged' && (
              <Flag className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 fill-current" />
            )}
          </button>
        );

        return tooltipFor ? (
          <Tooltip key={i} label={tooltipFor(i, m)} anchor="element" delay={220}>
            {btn}
          </Tooltip>
        ) : (
          <span key={i} className="contents">
            {btn}
          </span>
        );
      })}
    </div>
  );
}

/* ── Casilla de respuesta ──────────────────────────────────────────────────
   Un solo componente para una y varias respuestas: cambia el indicador
   (círculo vs cuadrado) y el texto de ayuda lo pone la pantalla. */
export function AnswerChoice({
  letter,
  text,
  selected,
  multi,
  state = 'idle',
  onClick,
  index = 0,
  hint,
  tag,
}: {
  letter: string;
  text: string;
  selected: boolean;
  multi?: boolean;
  /** En el informe: marca la correcta y la fallada. */
  state?: 'idle' | 'correct' | 'wrong' | 'missed';
  onClick?: () => void;
  index?: number;
  /** Tecla que selecciona esta opción. Solo se enseña en pantallas con teclado. */
  hint?: string;
  /** Rótulo del informe ("Tu respuesta", "Correcta"). */
  tag?: string;
}) {
  const reduce = useReducedMotion();
  const readOnly = !onClick;

  return (
    <motion.button
      type="button"
      disabled={readOnly}
      onClick={onClick}
      initial={reduce ? undefined : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease, delay: reduce ? 0 : index * 0.05 }}
      whileTap={reduce || readOnly ? undefined : { scale: 0.985 }}
      className={cn(
        'group flex w-full items-start gap-3.5 rounded-2xl border px-4 py-3.5 text-left transition-all duration-300',
        readOnly ? 'cursor-default' : 'hover:border-primary/40 hover:bg-subtle/50',
        state === 'idle' && selected && 'border-primary bg-primary/[0.06]',
        state === 'idle' && !selected && 'border-line',
        state === 'correct' && 'border-primary/50 bg-primary/[0.07]',
        state === 'wrong' && 'border-danger/50 bg-danger/[0.06]',
        state === 'missed' && 'border-primary/30 border-dashed',
      )}
    >
      <span
        className={cn(
          'mt-px grid h-6 w-6 shrink-0 place-items-center text-[11.5px] font-semibold transition-colors duration-300',
          multi ? 'rounded-md' : 'rounded-full',
          state === 'correct'
            ? 'bg-primary text-on-primary'
            : state === 'wrong'
              ? 'bg-danger text-white'
              : selected
                ? 'bg-primary text-on-primary'
                : 'border border-line text-text-subtle group-hover:border-text-subtle',
        )}
      >
        {state === 'correct' || (state === 'idle' && selected) ? (
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        ) : state === 'wrong' ? (
          <Minus className="h-3.5 w-3.5" strokeWidth={3} />
        ) : (
          letter.toUpperCase()
        )}
      </span>
      <span className="min-w-0 flex-1 text-[14.5px] leading-relaxed text-text">
        {text}
        {tag && (
          <span
            className={cn(
              'ml-2 align-middle rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
              state === 'correct'
                ? 'bg-primary/12 text-primary'
                : state === 'wrong'
                  ? 'bg-danger/10 text-danger'
                  : 'bg-subtle text-text-muted',
            )}
          >
            {tag}
          </span>
        )}
      </span>

      {/* Atajo de teclado: se enseña solo donde hay teclado de verdad y se
          apaga cuando la opción ya está elegida — deja de ser información útil
          y compite con la marca de selección. */}
      {hint && !selected && (
        <kbd className="mt-0.5 hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 font-mono text-[10.5px] leading-none text-text-subtle opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 sm:block">
          {hint}
        </kbd>
      )}
    </motion.button>
  );
}

/* ── Celebración ───────────────────────────────────────────────────────────
   Confeti con puros divs animados: sin librería ni canvas, se apaga solo y
   respeta el movimiento reducido. */
export function Confetti({ fire, count = 90 }: { fire: boolean; count?: number }) {
  const reduce = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 2.4 + Math.random() * 1.8,
        rotate: Math.random() * 720 - 360,
        drift: Math.random() * 160 - 80,
        size: 6 + Math.random() * 7,
        color: ['#10D451', '#B33D9E', '#F59E0B', '#0EA5E9', '#FFFFFF'][i % 5],
        round: i % 3 === 0,
      })),
    [count],
  );

  if (!fire || reduce) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className={cn('absolute top-[-6vh]', p.round ? 'rounded-full' : 'rounded-[2px]')}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 1.7,
            background: p.color,
          }}
          initial={{ y: 0, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: '110vh', x: p.drift, rotate: p.rotate, opacity: [1, 1, 0] }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}

/* ── Sello de aprobado ─────────────────────────────────────────────────────
   El momento de la certificación: el sello entra girando y "se estampa". */
export function PassSeal({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? undefined : { scale: 2.2, opacity: 0, rotate: -18 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 180, damping: 16, delay: reduce ? 0 : 0.45 }}
      className="relative inline-flex items-center justify-center"
    >
      {!reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          initial={{ boxShadow: '0 0 0 0 rgb(var(--neon-green) / 0.55)' }}
          animate={{ boxShadow: '0 0 0 26px rgb(var(--neon-green) / 0)' }}
          transition={{ duration: 1.2, delay: 0.65, ease: 'easeOut' }}
        />
      )}
      {children}
    </motion.div>
  );
}

/* ── Barra de progreso del examen ─────────────────────────────────────────── */
export function ExamProgress({ done, total }: { done: number; total: number }) {
  const reduce = useReducedMotion();
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-subtle">
      <motion.div
        className="h-full rounded-full bg-primary"
        animate={{ width: `${pct}%` }}
        transition={{ duration: reduce ? 0 : 0.5, ease }}
      />
    </div>
  );
}
