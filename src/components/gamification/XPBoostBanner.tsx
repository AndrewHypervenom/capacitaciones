import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Rocket, Clock } from 'lucide-react';
import {
  useActiveXPEvent,
  useNextXPEvent,
  xpEventLabel,
  xpEventDescription,
  type XPEvent,
} from '@/stores/xpEventStore';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { Lang } from '@/stores/gamificationStore';
import { cn } from '@/lib/cn';

/* ────────────────────────────────────────────────────────────────────────────
   Anuncio de XP multiplicado.

   Un evento que nadie ve no motiva a nadie: si hoy todo vale ×2 hay que gritarlo
   donde el aprendiz decide qué hacer (panel y catálogo). Dos formatos:
   - `XPBoostCard`  → tarjeta grande para el panel del aprendiz.
   - `XPBoostPill`  → píldora compacta para barras y encabezados.

   La cuenta regresiva es la que crea la urgencia, así que corre de verdad (cada
   segundo) aunque el resto de la app solo se entere del evento cada 30 s.
   ──────────────────────────────────────────────────────────────────────────── */

/** Cuenta regresiva viva hasta `iso`. Devuelve null cuando ya pasó. */
function useCountdown(iso: string | undefined): string | null {
  // El "ahora" vive en estado (no se lee en el render): así el render es puro y
  // la cuenta baja porque el intervalo lo empuja, no por un efecto lateral.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  if (Number.isNaN(ms) || ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Fondo con gradiente que respira; se apaga con reduced-motion. */
function BoostGlow({ color, reduce }: { color: string; reduce: boolean }) {
  if (reduce) {
    return (
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `linear-gradient(120deg, ${color}22, transparent 60%)` }}
      />
    );
  }
  return (
    <>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(120deg, ${color}33, transparent 45%, ${color}22)`,
          backgroundSize: '200% 100%',
        }}
        animate={{ backgroundPosition: ['0% 0%', '100% 0%', '0% 0%'] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
      />
      {/* Barrido de brillo: pasa cada pocos segundos, como un letrero encendido. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-12 bg-gradient-to-r from-transparent via-white/12 to-transparent"
        animate={{ x: ['0%', '460%'] }}
        transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 4.5, ease: [0.16, 1, 0.3, 1] }}
      />
    </>
  );
}

function MultiplierChip({ event, reduce, size = 'md' }: { event: XPEvent; reduce: boolean; size?: 'sm' | 'md' }) {
  return (
    <motion.span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-2xl font-black leading-none text-white',
        size === 'sm' ? 'h-7 px-2 text-[13px]' : 'h-12 w-12 text-[18px]',
      )}
      style={{ background: event.color, boxShadow: `0 8px 24px -8px ${event.color}` }}
      animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      ×{event.multiplier}
    </motion.span>
  );
}

/** Tarjeta grande: panel del aprendiz. Devuelve null si no hay nada que anunciar. */
export function XPBoostCard({ lang, className }: { lang: Lang; className?: string }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const active = useActiveXPEvent();
  const next = useNextXPEvent();
  const event = active ?? next;
  const remaining = useCountdown(active ? active.endsAt : undefined);
  const untilStart = useCountdown(!active && next ? next.startsAt : undefined);

  if (!event) return null;

  const description = xpEventDescription(event, lang);

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'relative overflow-hidden rounded-3xl border p-5',
        active ? 'border-transparent' : 'border-line bg-surface',
        className,
      )}
      style={active ? { borderColor: `${event.color}55`, background: `${event.color}0d` } : undefined}
    >
      {active && <BoostGlow color={event.color} reduce={reduce} />}

      <div className="relative flex items-center gap-4">
        <div className="relative text-[26px] leading-none">
          <motion.span
            className="inline-block"
            animate={reduce || !active ? undefined : { rotate: [0, -8, 8, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            {event.emoji}
          </motion.span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: event.color }}
            >
              {active
                ? t('xp.boost_live', 'XP multiplicado activo')
                : t('xp.boost_soon', 'Próximamente')}
            </span>
            {active && remaining && (
              <span className="inline-flex items-center gap-1 rounded-full bg-bg/60 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-text-muted">
                <Clock className="h-3 w-3" />
                {t('xp.boost_ends_in', { time: remaining, defaultValue: 'Termina en {{time}}' })}
              </span>
            )}
            {!active && untilStart && (
              <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold tabular-nums text-text-muted">
                <Clock className="h-3 w-3" />
                {t('xp.boost_starts_in', { time: untilStart, defaultValue: 'Empieza en {{time}}' })}
              </span>
            )}
          </div>
          <h3 className="mt-0.5 truncate text-[16px] font-bold text-text">
            {xpEventLabel(event, lang)}
          </h3>
          <p className="mt-0.5 text-[12.5px] text-text-muted">
            {description ||
              t('xp.boost_default_desc', {
                x: event.multiplier,
                defaultValue: 'Todo el XP que ganes cuenta ×{{x}}: módulos, quizzes, repasos y certificaciones.',
              })}
          </p>
        </div>

        <MultiplierChip event={event} reduce={reduce} />
      </div>
    </motion.div>
  );
}

/** Píldora compacta: barras superiores, encabezados de curso. */
export function XPBoostPill({ lang, className }: { lang: Lang; className?: string }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const active = useActiveXPEvent();
  const remaining = useCountdown(active?.endsAt);

  if (!active) return null;

  return (
    <motion.span
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 22 }}
      title={`${xpEventLabel(active, lang)}${remaining ? ` · ${t('xp.boost_ends_in', { time: remaining, defaultValue: 'Termina en {{time}}' })}` : ''}`}
      className={cn(
        'relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border px-2.5 py-1',
        className,
      )}
      style={{ borderColor: `${active.color}55`, background: `${active.color}14` }}
    >
      <BoostGlow color={active.color} reduce={reduce} />
      <Rocket className="relative h-3.5 w-3.5" style={{ color: active.color }} />
      <span className="relative text-[11px] font-bold" style={{ color: active.color }}>
        ×{active.multiplier} XP
      </span>
      {remaining && (
        <span className="relative text-[10px] font-semibold tabular-nums text-text-muted">
          {remaining}
        </span>
      )}
    </motion.span>
  );
}
