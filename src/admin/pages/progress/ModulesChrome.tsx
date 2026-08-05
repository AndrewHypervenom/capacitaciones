import React, { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/hooks/useReducedMotion'

/* ────────────────────────────────────────────────────────────────────────
   Piezas visuales del panel de Progreso de Módulos. Viven aparte para que
   `TrainerFeedbackPanel` siga siendo legible: aquí solo hay presentación
   (números que cuentan, barras de avance, distribución de notas, anillos).
   Todo respeta `prefers-reduced-motion`: sin movimiento, el valor final se
   pinta directo — nunca se queda a medias ni invisible.
   ──────────────────────────────────────────────────────────────────────── */

/** Curva corporativa (misma que `ease-apple`). */
const ease = [0.16, 1, 0.3, 1] as const

/** Color base de una nota: verde ≥90, ámbar ≥70, rojo por debajo. */
export const scoreHex = (score: number) => (score >= 90 ? '#22c55e' : score >= 70 ? '#f59e0b' : '#ef4444')

/** Clases de texto equivalentes a `scoreHex`. */
export const scoreTextTone = (score: number) => {
  if (score >= 90) return 'text-green-600 dark:text-green-400'
  if (score >= 70) return 'text-amber-500 dark:text-amber-400'
  return 'text-red-500 dark:text-red-400'
}

/** Tinte translúcido de un color CSS arbitrario. */
export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

export const initials = (name: string) =>
  name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'

/* ── Número que cuenta hasta su valor ─────────────────────────────────── */

export function CountUp({ value, suffix = '', className }: { value: number; suffix?: string; className?: string }) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(0)
  const spring = useSpring(mv, { stiffness: 90, damping: 20, mass: 0.6 })
  const rounded = useTransform(spring, (v) => `${Math.round(v)}${suffix}`)

  // `mv` arranca en 0 para que el número suba al montar; los cambios posteriores
  // se animan solos. No es setState: no dispara re-render en cadena.
  useEffect(() => { mv.set(value) }, [value, mv])

  if (reduce) return <span className={className}>{`${value}${suffix}`}</span>
  return <motion.span className={className}>{rounded}</motion.span>
}

/* ── Barra de avance de revisión (evaluadas / total) ──────────────────── */

export function ProgressBar({
  pct, accent = 'rgb(var(--brand-green))', className, height = 6, delay = 0,
}: {
  pct: number
  accent?: string
  className?: string
  height?: number
  delay?: number
}) {
  const reduce = useReducedMotion()
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  return (
    <div
      className={cn('relative w-full overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.span
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 55%, #fff))` }}
        initial={reduce ? false : { width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.7, ease, delay }}
      />
    </div>
  )
}

/* ── Distribución de notas: una sola barra con 3 tramos ───────────────── */

export function ScoreDistribution({
  perfect, passed, failed, className, height = 5,
}: {
  perfect: number
  passed: number
  failed: number
  className?: string
  height?: number
}) {
  const reduce = useReducedMotion()
  const total = perfect + passed + failed
  if (total === 0) return null
  const segments = [
    { n: perfect, color: '#22c55e' },
    { n: passed, color: '#f59e0b' },
    { n: failed, color: '#ef4444' },
  ].filter((s) => s.n > 0)

  return (
    <div className={cn('flex w-full gap-0.5 overflow-hidden rounded-full', className)} style={{ height }}>
      {segments.map((s, i) => (
        <motion.span
          key={i}
          className="rounded-full"
          style={{ background: s.color }}
          initial={reduce ? false : { flexGrow: 0, opacity: 0 }}
          animate={{ flexGrow: s.n, opacity: 1 }}
          transition={{ duration: 0.6, ease, delay: 0.05 * i }}
        />
      ))}
    </div>
  )
}

/* ── Anillo de nota con trazo animado ─────────────────────────────────── */

export function ScoreRing({
  score, size = 44, stroke = 4, showLabel = true,
}: {
  score: number
  size?: number
  stroke?: number
  showLabel?: boolean
}) {
  const reduce = useReducedMotion()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = scoreHex(score)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-zinc-200 dark:stroke-zinc-800" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={reduce ? false : { strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * Math.max(0, Math.min(100, score))) / 100 }}
          transition={{ duration: 0.9, ease }}
        />
      </svg>
      {showLabel && (
        <span
          className="absolute inset-0 grid place-items-center text-[11px] font-bold tabular-nums"
          style={{ color, fontSize: size >= 60 ? 15 : 11 }}
        >
          {Math.round(score)}
        </span>
      )}
    </div>
  )
}

/* ── Tarjeta KPI compacta de la cabecera ──────────────────────────────── */

export function StatTile({
  icon, label, value, suffix, accent, sub, onClick, active,
}: {
  icon: React.ReactNode
  label: string
  value: number
  suffix?: string
  accent: string
  sub?: React.ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const Tag: React.ElementType = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={cn(
        'group relative min-w-0 overflow-hidden rounded-2xl border bg-surface px-3.5 py-2.5 text-left transition-all duration-300 ease-apple',
        onClick && 'hover:-translate-y-0.5 hover:shadow-card-hover cursor-pointer',
      )}
      style={{ borderColor: active ? tint(accent, 45) : undefined }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full opacity-[0.12] blur-2xl transition-opacity group-hover:opacity-25"
        style={{ background: accent }}
      />
      <div className="relative flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: tint(accent, 14), color: accent }}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[9.5px] font-bold uppercase tracking-wider text-text-muted">{label}</p>
          <p className="mt-0.5 text-[19px] font-bold leading-none tabular-nums text-text">
            <CountUp value={value} suffix={suffix} />
          </p>
        </div>
      </div>
      {sub && <div className="relative mt-2">{sub}</div>}
    </Tag>
  )
}

/* ── Resaltado del término buscado dentro de un texto ─────────────────── */

export function Highlight({ text, term }: { text: string; term: string }) {
  const q = term.trim()
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-[rgb(var(--brand-green))]/20 px-0.5 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}

/* ── Hook: atajo de teclado para enfocar la búsqueda (⌘K / Ctrl+K, "/") ── */

export function useSearchHotkey() {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      const hit = ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)
      if (!hit) return
      e.preventDefault()
      ref.current?.focus()
      ref.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return ref
}
