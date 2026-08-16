// src/lib/modulePace.ts
/**
 * Ritmo de estudio de un módulo: ¿el aprendiz lo está leyendo o lo está pasando
 * de afán para marcarlo y salir corriendo?
 *
 * Aquí viven SOLO las reglas puras (umbrales, nivel, factor de XP) y la caché
 * local de señales. Quien las mide es `useModulePace`; quien las guarda en BD es
 * `services/modulePace.service`.
 *
 * La medida base es el TIEMPO ACTIVO real del módulo (el de `useModuleTimer`:
 * se pausa con la pestaña oculta) contra la duración estimada que el capacitador
 * puso al módulo. No es un cronómetro de pantalla abierta: dejar la pestaña
 * puesta no cuenta como estudiar.
 *
 * Regla de honestidad: al aprendiz solo se le anuncia lo que de verdad se mide y
 * se guarda — tiempo activo, profundidad de lectura, pegados de texto y salidas
 * de pestaña. Nada de amenazas sin dato detrás.
 */

export type PaceLevel = 'ok' | 'fast' | 'rush';

/** Señales que se acumulan mientras se estudia el módulo. */
export interface PaceSignals {
  /** Veces que se pegó texto dentro del módulo (respuestas abiertas, comentarios). */
  pastes: number;
  /** Veces que se salió de la pestaña (cambio de pestaña, minimizar) sin completar. */
  tabOuts: number;
  /** Avisos de afán ya mostrados (tope `MAX_WARNINGS`). */
  warnings: number;
  /** Hasta dónde se bajó en el módulo, en % (máximo alcanzado). */
  maxDepth: number;
}

export const EMPTY_SIGNALS: PaceSignals = { pastes: 0, tabOuts: 0, warnings: 0, maxDepth: 0 };

/** Por debajo de esto el ritmo es "rápido" (aviso suave, XP recortado). */
export const FAST_RATIO = 0.6;
/** Por debajo de esto es "de afán" (aviso firme, XP a la mitad). */
export const RUSH_RATIO = 0.35;
/** Profundidad mínima para que el aviso tenga sentido: si aún no bajó, no hay afán. */
export const DEPTH_TO_JUDGE = 80;
/** Cuántas veces como mucho se interrumpe con el banner (no se convierte en ruido). */
export const MAX_WARNINGS = 2;
/** Salidas de pestaña a partir de las cuales la sesión se marca para revisión. */
export const TAB_OUTS_SUSPECT = 3;

/** Duración estimada aceptable: sin dato asumimos 5 min; nunca exigimos más de 45. */
export function expectedMsFor(durationMin: number | undefined | null): number {
  const min = Number(durationMin);
  const safe = Number.isFinite(min) && min > 0 ? Math.min(min, 45) : 5;
  return safe * 60_000;
}

export function paceRatio(elapsedMs: number, durationMin: number | undefined | null): number {
  const expected = expectedMsFor(durationMin);
  if (expected <= 0) return 1;
  return Math.max(0, elapsedMs) / expected;
}

export function paceLevel(ratio: number): PaceLevel {
  if (ratio >= FAST_RATIO) return 'ok';
  if (ratio >= RUSH_RATIO) return 'fast';
  return 'rush';
}

/**
 * Cuánto del XP del módulo se paga según el ritmo.
 *
 * No es un castigo moral: el XP mide aprendizaje, y un módulo cruzado en un
 * tercio del tiempo estimado no dejó el mismo aprendizaje. Nunca baja de la
 * mitad — completar siempre suma algo, para que nadie prefiera no marcarlo.
 */
export function xpFactorFor(level: PaceLevel): number {
  if (level === 'ok') return 1;
  if (level === 'fast') return 0.75;
  return 0.5;
}

/**
 * ¿Esta sesión queda marcada para que la revise el capacitador?
 *
 * Ritmo de afán, o señales que por sí solas no prueban nada pero sí describen
 * un patrón de "responder sin leer": pegar texto y entrar y salir de la pestaña.
 */
export function isFlagged(level: PaceLevel, s: PaceSignals): boolean {
  return level === 'rush' || s.pastes > 0 || s.tabOuts >= TAB_OUTS_SUSPECT;
}

/** Porcentaje del tiempo esperado ya dedicado (para pintar la barra). */
export function pacePct(ratio: number): number {
  return Math.min(100, Math.max(0, Math.round(ratio * 100)));
}

// ─── Caché local de las señales ────────────────────────────────────────────
// Espejo inmediato para sobrevivir recargas dentro del mismo módulo. La fuente
// confiable es la BD (module_time), igual que con el cronómetro.

function key(userId: string | undefined, moduleId: string | undefined): string {
  return `learningai.modulePace:${userId || 'anon'}:${moduleId || 'none'}`;
}

export function readSignals(userId?: string, moduleId?: string): PaceSignals {
  try {
    const raw = localStorage.getItem(key(userId, moduleId));
    if (!raw) return { ...EMPTY_SIGNALS };
    const p = JSON.parse(raw);
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      pastes: n(p.pastes),
      tabOuts: n(p.tabOuts),
      warnings: n(p.warnings),
      maxDepth: Math.min(100, n(p.maxDepth)),
    };
  } catch {
    return { ...EMPTY_SIGNALS };
  }
}

export function writeSignals(
  userId: string | undefined,
  moduleId: string | undefined,
  s: PaceSignals,
): void {
  try {
    localStorage.setItem(key(userId, moduleId), JSON.stringify(s));
  } catch {
    /* localStorage lleno o no disponible: las señales viajan igual a BD */
  }
}

/**
 * Hasta dónde se ha bajado, en % del alto del contenido.
 *
 * `host` es quien scrollea de verdad: normalmente la página, pero puede ser un
 * contenedor con scroll propio (se descubre escuchando en captura; suponer la
 * ventana deja la medición clavada en 0). Si el módulo cabe en una pantalla no
 * hay nada que recorrer: 100.
 */
export function readingDepth(host: Element | null): number {
  const el = (host as HTMLElement) ?? document.scrollingElement ?? document.documentElement;
  const scrollHeight = el.scrollHeight;
  const clientHeight = el.clientHeight || window.innerHeight;
  if (scrollHeight <= clientHeight + 8) return 100;
  const seen = el.scrollTop + clientHeight;
  return Math.min(100, Math.max(0, Math.round((seen / scrollHeight) * 100)));
}
