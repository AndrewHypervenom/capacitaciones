import { create } from 'zustand';
import { useMemo } from 'react';
import type { Lang } from '@/stores/gamificationStore';

// ─────────────────────────────────────────────────────────────────────────────
// Eventos de XP multiplicado ("hoy es día ×2").
//
// Un evento es una ventana de tiempo con un multiplicador. Mientras está vigente,
// TODO el XP que gana el aprendiz se multiplica: módulos, quizzes, repasos,
// certificaciones, mundos y racha (decisión de producto: es lo más fácil de
// comunicar — "hoy todo vale doble" — y lo más fácil de auditar).
//
// El multiplicador se lee en el instante de otorgar el XP (`currentXPMultiplier`,
// que mira `Date.now()` de verdad, no un reloj cacheado): un evento que termina a
// medianoche deja de pagar exactamente a medianoche aunque la pestaña lleve horas
// abierta.
// ─────────────────────────────────────────────────────────────────────────────

export interface XPEvent {
  id: string;
  emoji: string;
  /** Factor por el que se multiplica el XP (2 = ×2). */
  multiplier: number;
  /** Inicio de la ventana (ISO con zona). */
  startsAt: string;
  /** Fin de la ventana (ISO con zona). */
  endsAt: string;
  /** Apagado manual: el evento existe pero no paga (ni se anuncia). */
  enabled: boolean;
  /** Color de acento para la píldora/banner del aprendiz. */
  color: string;
  label: string; // es
  label_en?: string;
  label_pt?: string;
  description?: string; // es
  description_en?: string;
  description_pt?: string;
}

export type XPEventStatus = 'active' | 'scheduled' | 'ended' | 'off';

export function xpEventLabel(e: XPEvent, lang: Lang): string {
  if (lang === 'en') return e.label_en || e.label;
  if (lang === 'pt') return e.label_pt || e.label;
  return e.label;
}

export function xpEventDescription(e: XPEvent, lang: Lang): string {
  if (lang === 'en') return e.description_en || e.description || '';
  if (lang === 'pt') return e.description_pt || e.description || '';
  return e.description || '';
}

export function xpEventStatus(e: XPEvent, at: number = Date.now()): XPEventStatus {
  if (!e.enabled) return 'off';
  const start = Date.parse(e.startsAt);
  const end = Date.parse(e.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return 'off';
  if (at < start) return 'scheduled';
  if (at > end) return 'ended';
  return 'active';
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface XPEventState {
  events: XPEvent[];
  loaded: boolean;
  /**
   * Reloj grueso (se refresca cada 30 s). Existe solo para que la UI se entere de
   * que un evento empezó o terminó sin recargar la página; el XP NO se calcula
   * con esto (ver `currentXPMultiplier`).
   */
  now: number;
  setEvents: (events: XPEvent[]) => void;
}

export const useXPEventStore = create<XPEventState>((set) => ({
  events: [],
  loaded: false,
  now: Date.now(),
  setEvents: (events) =>
    set({
      events: [...events].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)),
      loaded: true,
    }),
}));

// Un único latido para toda la app: mueve `now` para que las píldoras se
// enciendan/apaguen solas. 30 s es suficiente para un evento de horas y no
// castiga a nadie.
let ticker: ReturnType<typeof setInterval> | null = null;
export function startXPEventTicker(): void {
  if (ticker || typeof window === 'undefined') return;
  ticker = setInterval(() => useXPEventStore.setState({ now: Date.now() }), 30_000);
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

export function activeXPEvents(at: number = Date.now(), events?: XPEvent[]): XPEvent[] {
  return (events ?? useXPEventStore.getState().events).filter(
    (e) => xpEventStatus(e, at) === 'active',
  );
}

/**
 * Multiplicador vigente AHORA. Si hay varios eventos solapados manda el mayor
 * (no se acumulan: dos ×2 no hacen ×4, sería demasiado fácil de romper sin
 * querer al programar dos campañas encima).
 */
export function currentXPMultiplier(at: number = Date.now()): number {
  const active = activeXPEvents(at);
  if (active.length === 0) return 1;
  return Math.max(1, ...active.map((e) => e.multiplier));
}

/** Evento que manda ahora mismo (el de mayor multiplicador), o null. */
export function useActiveXPEvent(): XPEvent | null {
  const events = useXPEventStore((s) => s.events);
  const now = useXPEventStore((s) => s.now);
  return useMemo(() => {
    const active = activeXPEvents(now, events);
    if (active.length === 0) return null;
    return active.reduce((best, e) => (e.multiplier > best.multiplier ? e : best));
  }, [events, now]);
}

/** Próximo evento programado (para anunciarlo antes de que empiece). */
export function useNextXPEvent(): XPEvent | null {
  const events = useXPEventStore((s) => s.events);
  const now = useXPEventStore((s) => s.now);
  return useMemo(() => {
    const upcoming = events
      .filter((e) => xpEventStatus(e, now) === 'scheduled')
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    return upcoming[0] ?? null;
  }, [events, now]);
}
