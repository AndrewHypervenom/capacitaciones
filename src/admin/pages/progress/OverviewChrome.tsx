// src/admin/pages/progress/OverviewChrome.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { CountUp, tint } from './ModulesChrome';

/* ────────────────────────────────────────────────────────────────────────────
   Piezas visuales del Panorama de Progreso.

   Todo lo que aquí se dibuja obedece tres reglas:
     1. Aire antes que densidad — el panel anterior apilaba controles hasta no
        dejar respirar los datos. Aquí manda el dato; el control se busca.
     2. El movimiento explica, no decora: las barras crecen hacia su valor, los
        números suben hasta él, y con `prefers-reduced-motion` todo aparece ya
        terminado (nunca a medias, nunca invisible).
     3. Nada de `whileInView` dentro del panel: el contenedor del admin scrollea
        por su cuenta y los elementos se quedaban esperando una entrada que no
        llegaba (ver [[motion_whileinview_admin_trap]]).
   ──────────────────────────────────────────────────────────────────────────── */

const ease = [0.16, 1, 0.3, 1] as const;

export const GREEN = 'rgb(var(--brand-green))';
export const MAGENTA = 'rgb(var(--brand-magenta))';
export const BLUE = '#3b82f6';
export const AMBER = '#f59e0b';
export const VIOLET = '#8b5cf6';
export const CYAN = '#06b6d4';

/* ── Entrada escalonada ─────────────────────────────────────────────────── */

export function Rise({
  children, delay = 0, className, as = 'div',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li';
}) {
  const reduce = useReducedMotion();
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease, delay }}
    >
      {children}
    </Tag>
  );
}

/* ── Tarjeta contenedora de sección ─────────────────────────────────────── */

export function SectionCard({
  title, subtitle, icon, action, children, className, accent,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  accent?: string;
}) {
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-3xl border border-line bg-surface',
        className,
      )}
    >
      {accent && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full opacity-[0.07] blur-3xl"
          style={{ background: accent }}
        />
      )}
      <header className="relative flex flex-wrap items-center gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        {icon && (
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
            style={{ background: tint(accent ?? GREEN, 12), color: accent ?? GREEN }}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {/* Sin `truncate`: el título de una sección se lee entero o no sirve. */}
          <h2 className="text-[15px] font-bold leading-tight tracking-tight text-text">{title}</h2>
          {subtitle && <p className="mt-1 text-[12px] leading-snug text-text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="relative px-5 pb-5 pt-4 sm:px-6 sm:pb-6">{children}</div>
    </section>
  );
}

/* ── KPI grande ─────────────────────────────────────────────────────────── */

export function KpiCard({
  icon, label, value, suffix = '', accent, hint, delta, onClick, active, loading, delay = 0,
  footer, frame,
}: {
  icon: React.ReactNode;
  label: string;
  /** null = todavía no hay dato que mostrar (se pinta "—", nunca un 0 falso). */
  value: number | null;
  suffix?: string;
  accent: string;
  hint?: string;
  /**
   * Referencia de la norma bajo la que se define la métrica. NO se pinta en la
   * tarjeta: va al pie del tooltip, discreta. Un tablero lleno de sellos se lee
   * como una promesa de certificación que el producto no puede sostener; la
   * referencia sirve para explicar de dónde sale un número, no para presumir.
   */
  frame?: string;
  delta?: { value: number; label: string } | null;
  onClick?: () => void;
  active?: boolean;
  loading?: boolean;
  delay?: number;
  footer?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const Tag: React.ElementType = onClick ? 'button' : 'div';

  /* El icono va ANCLADO ARRIBA A LA DERECHA, no en una columna a la izquierda:
     en una fila de seis tarjetas ese icono se comía 55 px del ancho de texto y
     dejaba etiquetas como "Personas alca…". Ahora el texto ocupa la tarjeta
     entera y solo reserva el hueco del icono en su primera línea. */
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay }}
      className="min-w-0"
    >
      <Tooltip
        anchor="element"
        maxWidth={280}
        delay={120}
        className="h-full w-full"
        disabled={loading}
        label={
          <span className="block">
            <span className="block font-semibold">{label}</span>
            {hint && <span className="mt-0.5 block opacity-80">{hint}</span>}
            {frame && <span className="mt-1 block text-[10.5px] uppercase tracking-wider opacity-70">{frame}</span>}
          </span>
        }
      >
        <Tag
          onClick={onClick}
          type={onClick ? 'button' : undefined}
          aria-pressed={onClick ? !!active : undefined}
          className={cn(
            'group relative flex h-full w-full flex-col overflow-hidden rounded-3xl border bg-surface p-5 text-left transition-all duration-500 ease-apple',
            onClick && 'cursor-pointer hover:-translate-y-1 hover:shadow-card-hover',
            active ? 'shadow-card-hover' : 'border-line',
          )}
          style={active ? { borderColor: tint(accent, 55), background: `linear-gradient(160deg, ${tint(accent, 7)}, transparent 60%)` } : undefined}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-[0.10] blur-2xl transition-opacity duration-500 group-hover:opacity-25"
            style={{ background: accent }}
          />
          <span
            className="absolute right-4 top-4 grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-white shadow-lg transition-transform duration-500 ease-apple group-hover:scale-110 group-hover:-rotate-3"
            style={{
              background: `linear-gradient(135deg, ${accent}, color-mix(in srgb, ${accent} 65%, #000))`,
              boxShadow: `0 10px 24px -12px ${tint(accent, 70)}`,
            }}
          >
            {icon}
          </span>

          <div className="relative min-w-0 flex-1">
            {/* Dos líneas de etiqueta como máximo, cortando por palabra: es
                mejor "Personas / alcanzadas" que "Personas alca…". */}
            <p className="min-h-[2.1em] pr-12 text-[10.5px] font-bold uppercase leading-tight tracking-[0.06em] text-text-muted">
              {label}
            </p>
            <p className="mt-1.5 flex items-baseline gap-1.5 text-[30px] font-bold leading-none tracking-tight text-text">
              {loading ? (
                <span className="inline-block h-7 w-16 animate-pulse rounded-lg bg-line/60" />
              ) : value === null ? (
                <span className="text-text-subtle">—</span>
              ) : (
                <CountUp value={value} suffix={suffix} className="tabular-nums" />
              )}
              {delta && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold',
                    delta.value >= 0
                      ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'bg-red-500/10 text-red-500 dark:text-red-400',
                  )}
                >
                  {delta.value >= 0 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {Math.abs(delta.value)}
                </span>
              )}
            </p>
            {hint && (
              <p className="mt-2 line-clamp-2 text-[11.5px] leading-snug text-text-muted [overflow-wrap:anywhere]">
                {hint}
              </p>
            )}
          </div>
          {footer && <div className="relative mt-4">{footer}</div>}
        </Tag>
      </Tooltip>
    </motion.div>
  );
}

/* ── Barra apilada con leyenda ──────────────────────────────────────────── */

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function StackedBar({
  segments, height = 12, className, showLegend = true, total: totalOverride,
}: {
  segments: Segment[];
  height?: number;
  className?: string;
  showLegend?: boolean;
  total?: number;
}) {
  const reduce = useReducedMotion();
  const total = totalOverride ?? segments.reduce((s, x) => s + x.value, 0);
  const visible = segments.filter((s) => s.value > 0);

  return (
    <div className={className}>
      <div
        className="flex w-full gap-1 overflow-hidden rounded-full bg-line/50"
        style={{ height }}
      >
        {total === 0 ? null : visible.map((s, i) => (
          <motion.span
            key={s.key}
            className="rounded-full"
            style={{ background: s.color }}
            initial={reduce ? false : { flexGrow: 0 }}
            animate={{ flexGrow: s.value }}
            transition={{ duration: 0.8, ease, delay: 0.06 * i }}
          />
        ))}
      </div>
      {showLegend && (
        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {segments.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-[12px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="text-text-muted">{s.label}</span>
              <span className="font-bold tabular-nums text-text">{s.value}</span>
              {total > 0 && (
                <span className="tabular-nums text-text-subtle">
                  {Math.round((s.value / total) * 100)}%
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Anillo de participación ────────────────────────────────────────────── */

export function Donut({
  value, total, size = 132, stroke = 14, accent = GREEN, label, sublabel,
}: {
  value: number;
  total: number;
  size?: number;
  stroke?: number;
  accent?: string;
  label?: string;
  sublabel?: string;
}) {
  const reduce = useReducedMotion();
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          className="stroke-zinc-200/80 dark:stroke-zinc-800"
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={accent}
          strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={reduce ? false : { strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * Math.min(100, pct)) / 100 }}
          transition={{ duration: 1, ease }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-[26px] font-bold leading-none tabular-nums text-text">
            <CountUp value={pct} suffix="%" />
          </p>
          {label && <p className="mt-1 text-[11px] font-semibold text-text-muted">{label}</p>}
          {sublabel && <p className="text-[10.5px] text-text-subtle">{sublabel}</p>}
        </div>
      </div>
    </div>
  );
}

/* ── Medidor de NPS (−100 … 100) ────────────────────────────────────────── */

export function NpsGauge({
  score, promoters, passives, detractors, labels,
}: {
  score: number | null;
  promoters: number;
  passives: number;
  detractors: number;
  labels: { promoters: string; passives: string; detractors: string; empty: string };
}) {
  const reduce = useReducedMotion();
  const total = promoters + passives + detractors;
  // La aguja vive en 0..100% del ancho: −100 a la izquierda, +100 a la derecha.
  const pos = score === null ? 50 : ((score + 100) / 200) * 100;
  const tone = score === null ? '#a1a1aa' : score >= 50 ? '#22c55e' : score >= 0 ? '#f59e0b' : '#ef4444';

  return (
    <div>
      <div className="flex items-end gap-3">
        <p className="text-[42px] font-bold leading-none tracking-tight tabular-nums" style={{ color: tone }}>
          {score === null ? '—' : <CountUp value={score} />}
        </p>
        <p className="pb-1.5 text-[12px] text-text-muted">
          {score === null ? labels.empty : `${total} ${total === 1 ? 'respuesta' : 'respuestas'}`}
        </p>
      </div>

      <div className="relative mt-4 h-3 w-full overflow-hidden rounded-full"
        style={{ background: 'linear-gradient(90deg, #ef4444, #f59e0b 50%, #22c55e)' }}
      >
        {score !== null && (
          <motion.span
            className="absolute top-1/2 h-6 w-1.5 -translate-y-1/2 rounded-full bg-white shadow-md ring-1 ring-black/10"
            initial={reduce ? false : { left: '50%' }}
            animate={{ left: `calc(${pos}% - 3px)` }}
            transition={{ duration: 0.9, ease }}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-semibold text-text-subtle">
        <span>−100</span><span>0</span><span>+100</span>
      </div>

      <StackedBar
        className="mt-4"
        height={10}
        segments={[
          { key: 'p', label: labels.promoters, value: promoters, color: '#22c55e' },
          { key: 'n', label: labels.passives, value: passives, color: '#f59e0b' },
          { key: 'd', label: labels.detractors, value: detractors, color: '#ef4444' },
        ]}
      />
    </div>
  );
}

/* ── Mini barras horizontales (ranking) ─────────────────────────────────── */

export function RankBar({
  value, max, accent = GREEN, delay = 0,
}: {
  value: number;
  max: number;
  accent?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line/50">
      <motion.span
        className="block h-full rounded-full"
        style={{ background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 50%, #fff))` }}
        initial={reduce ? false : { width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease, delay }}
      />
    </div>
  );
}

/* ── Avatar con iniciales ───────────────────────────────────────────────── */

export function PersonAvatar({
  name, url, size = 34, accent = GREEN,
}: {
  name: string;
  url?: string | null;
  size?: number;
  accent?: string;
}) {
  const [failed, setFailed] = useState(false);
  const letters = useMemo(
    () => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?',
    [name],
  );
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover ring-1 ring-line"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-bold"
      style={{
        width: size, height: size,
        background: tint(accent, 14), color: accent,
        fontSize: size * 0.36,
      }}
      aria-hidden
    >
      {letters}
    </span>
  );
}

/* ── Encabezado de tabla ordenable ──────────────────────────────────────── */

export function SortableTh({
  label, active, dir, onClick, align = 'left', className, title,
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
  title?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        'sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface/95 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider backdrop-blur',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
    >
      {/* `title` es la explicación de la columna, no un atributo del navegador:
          va por el Tooltip del sitio (ver [[tooltip_convention]]). */}
      <Tooltip anchor="element" delay={120} maxWidth={260} label={title ?? ''} disabled={!title}>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'inline-flex items-center gap-1 transition-colors hover:text-text',
            active ? 'text-text' : 'text-text-muted',
          )}
        >
          {label}
          <span className={cn('transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover/table:opacity-40')}>
            {dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        </button>
      </Tooltip>
    </th>
  );
}

/* ── Estados vacíos y esqueletos ────────────────────────────────────────── */

export function EmptyState({
  icon, title, description, action,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-subtle text-text-subtle">
        {icon}
      </span>
      <p className="text-[14px] font-semibold text-text">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3">
          <span className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-line/60" />
          {Array.from({ length: cols }).map((__, c) => (
            <span
              key={c}
              className="h-3.5 animate-pulse rounded-full bg-line/60"
              style={{ flex: c === 0 ? 3 : 1, animationDelay: `${(r * cols + c) * 40}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Píldora de estado ──────────────────────────────────────────────────── */

export function StatusPill({
  tone, children, icon,
}: {
  tone: 'green' | 'amber' | 'red' | 'blue' | 'neutral';
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    green: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    red: 'bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/20',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    neutral: 'bg-subtle text-text-muted border-line',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-bold',
        tones[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/* ── Cinta superior con el resultado de un filtro activo ────────────────── */

export function FilterChip({
  label, onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle/60 px-2.5 py-1 text-[11.5px] font-medium text-text-muted transition-colors hover:border-red-500/40 hover:text-text"
    >
      {label}
      <span className="text-[13px] leading-none">×</span>
    </button>
  );
}

/* ── Menú desplegable simple (exportar, rangos) ─────────────────────────── */

export function Menu({
  button, children, align = 'right', open, onOpenChange,
}: {
  button: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [internal, setInternal] = useState(false);
  const isOpen = open ?? internal;
  const setOpen = onOpenChange ?? setInternal;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen, setOpen]);

  return (
    <div className="relative" ref={ref}>
      {button({ open: isOpen, toggle: () => setOpen(!isOpen) })}
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18, ease }}
          className={cn(
            'absolute z-40 mt-2 min-w-[230px] overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-card-hover',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children(() => setOpen(false))}
        </motion.div>
      )}
    </div>
  );
}

export function MenuItem({
  icon, label, description, onClick, disabled,
}: {
  icon?: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition-colors',
        disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-subtle',
      )}
    >
      {icon && <span className="mt-0.5 shrink-0 text-text-muted">{icon}</span>}
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-text">{label}</span>
        {description && <span className="block text-[11px] leading-snug text-text-subtle">{description}</span>}
      </span>
    </button>
  );
}
