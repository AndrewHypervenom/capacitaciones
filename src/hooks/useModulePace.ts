// src/hooks/useModulePace.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEPTH_TO_JUDGE,
  EMPTY_SIGNALS,
  MAX_WARNINGS,
  expectedMsFor,
  isFlagged,
  paceLevel,
  paceRatio,
  pacePct,
  readSignals,
  readingDepth,
  writeSignals,
  xpFactorFor,
  type PaceLevel,
  type PaceSignals,
} from '@/lib/modulePace';
import { getModulePace, upsertModulePace } from '@/services/modulePace.service';

/**
 * Mide el ritmo con el que se está pasando un módulo y decide cuándo avisar.
 *
 * El tiempo NO se cuenta aquí: llega ya medido desde `useModuleTimer` (tiempo
 * activo, pausado con la pestaña oculta). Este hook añade las tres señales que
 * el cronómetro no ve —hasta dónde bajó, si pegó texto, cuántas veces salió de
 * la pestaña— y las guarda en la misma fila de `module_time`.
 *
 * El aviso NO salta al entrar: mientras la persona no haya bajado hasta el final
 * del módulo, ir "rápido" solo significa que acaba de llegar. Por eso hace falta
 * profundidad ≥ 80% para juzgar el ritmo, y por eso se interrumpe como mucho
 * `MAX_WARNINGS` veces.
 */

const DB_HEARTBEAT_MS = 60_000;

export interface ModulePace {
  /** Nivel del ritmo con lo corrido hasta ahora. */
  level: PaceLevel;
  /** Tiempo activo / duración estimada. */
  ratio: number;
  /** Ese mismo dato en % (para la barra), tope 100. */
  pct: number;
  /** Cuánto falta para llegar a un ritmo sano (0 si ya llegó). */
  remainingMs: number;
  /** Fracción del XP del módulo que corresponde a este ritmo (1 = completo). */
  xpFactor: number;
  /** Señales acumuladas (ya unidas con lo que hubiera en BD). */
  signals: PaceSignals;
  /** ¿Esta sesión queda marcada para revisión del capacitador? */
  flagged: boolean;
  /** ¿Hay que mostrar el banner de afán ahora mismo? */
  warn: boolean;
  /** Cierra el banner de esta sesión (el registro se queda igual). */
  dismiss: () => void;
  /** Vuelca a BD el estado definitivo (se llama al completar el módulo). */
  flush: () => void;
}

export function useModulePace(
  moduleId: string | undefined,
  userId: string | undefined,
  durationMin: number | undefined,
  elapsedMs: number,
  completed: boolean,
  { enabled = true }: { enabled?: boolean } = {},
): ModulePace {
  const signalsRef = useRef<PaceSignals>({ ...EMPTY_SIGNALS });
  const [signals, setSignals] = useState<PaceSignals>({ ...EMPTY_SIGNALS });
  const [dismissed, setDismissed] = useState(false);

  // El nivel se recalcula en cada render (el tiempo entra por props), pero el
  // volcado a BD necesita leerlo desde los listeners: por eso también en ref.
  const levelRef = useRef<PaceLevel>('ok');
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const moduleIdRef = useRef(moduleId);
  moduleIdRef.current = moduleId;
  const expectedRef = useRef(expectedMsFor(durationMin));
  expectedRef.current = expectedMsFor(durationMin);

  const commit = useCallback((next: PaceSignals) => {
    signalsRef.current = next;
    setSignals(next);
    writeSignals(userIdRef.current, moduleIdRef.current, next);
  }, []);

  const flushToDb = useCallback(() => {
    const uid = userIdRef.current;
    const mid = moduleIdRef.current;
    if (!uid || !mid) return;
    void upsertModulePace(uid, mid, {
      expectedMs: expectedRef.current,
      level: levelRef.current,
      pastes: signalsRef.current.pastes,
      tabOuts: signalsRef.current.tabOuts,
      warnings: signalsRef.current.warnings,
      maxDepth: signalsRef.current.maxDepth,
      xpFactor: xpFactorFor(levelRef.current),
    });
  }, []);

  // Carga local + reconciliación con BD (otra sesión, otro equipo): siempre nos
  // quedamos con el máximo, para que cerrar y volver a abrir no borre señales.
  useEffect(() => {
    const local = readSignals(userId, moduleId);
    signalsRef.current = local;
    setSignals(local);
    setDismissed(false);
    if (!userId || !moduleId) return;

    let cancelled = false;
    void getModulePace(userId, moduleId).then((remote) => {
      if (cancelled || !remote) return;
      const merged: PaceSignals = {
        pastes: Math.max(local.pastes, remote.pastes),
        tabOuts: Math.max(local.tabOuts, remote.tabOuts),
        warnings: Math.max(local.warnings, remote.warnings),
        maxDepth: Math.max(local.maxDepth, remote.maxDepth),
      };
      commit(merged);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, moduleId, commit]);

  // Las tres señales que el cronómetro no ve.
  useEffect(() => {
    if (!enabled || !moduleId || completed) return;

    let scrollHost: Element | null = null;
    let pendingDepth = signalsRef.current.maxDepth;
    let dirty = false;

    const bump = (patch: Partial<PaceSignals>) => {
      commit({ ...signalsRef.current, ...patch });
      dirty = true;
    };

    // Profundidad: quién scrollea de verdad se descubre en captura (el scroll de
    // un contenedor no burbujea hasta window).
    const onScroll = (e: Event) => {
      const target = e.target;
      scrollHost =
        target === document || target === document.documentElement || target === document.body
          ? document.scrollingElement
          : (target as Element);
      const d = readingDepth(scrollHost);
      if (d > pendingDepth) {
        pendingDepth = d;
        bump({ maxDepth: d });
      }
    };

    // Pegar texto no prueba nada por sí solo (también se copia de los apuntes),
    // pero es parte del patrón que el capacitador sí puede leer en contexto.
    const onPaste = () => bump({ pastes: signalsRef.current.pastes + 1 });

    const onVisibility = () => {
      if (document.hidden) bump({ tabOuts: signalsRef.current.tabOuts + 1 });
    };

    // Módulo que cabe en una pantalla: no hay scroll que esperar.
    const initialDepth = readingDepth(null);
    if (initialDepth > pendingDepth) {
      pendingDepth = initialDepth;
      bump({ maxDepth: initialDepth });
    }

    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('visibilitychange', onVisibility);

    const heartbeat = setInterval(() => {
      if (!dirty) return;
      dirty = false;
      flushToDb();
    }, DB_HEARTBEAT_MS);

    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(heartbeat);
      flushToDb();
    };
  }, [enabled, moduleId, completed, commit, flushToDb]);

  const ratio = paceRatio(elapsedMs, durationMin);
  // Apagado (staff previsualizando): ritmo neutro. Ni avisos ni recorte de XP —
  // quien revisa un módulo no lo está estudiando.
  const level = enabled ? paceLevel(ratio) : 'ok';
  levelRef.current = level;

  /* El banner se abre por condiciones y se cierra solo a mano (o al completar).
     El contador de avisos se sube en el momento de abrirlo —es lo que ve el
     capacitador: "se le avisó dos veces y siguió igual"— pero NO se vuelve a
     leer para mantenerlo abierto: si se mirara, el propio incremento apagaría
     el banner en el mismo render en que aparece. */
  const shouldOpen =
    enabled &&
    !completed &&
    !dismissed &&
    level !== 'ok' &&
    signals.maxDepth >= DEPTH_TO_JUDGE &&
    signals.warnings < MAX_WARNINGS;

  // Se guarda el módulo para el que se abrió, no un booleano: así cambiar de
  // módulo cierra el aviso sin necesidad de un efecto de limpieza.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!shouldOpen) return;
    setOpenedFor(moduleIdRef.current ?? null);
    commit({ ...signalsRef.current, warnings: signalsRef.current.warnings + 1 });
    flushToDb();
    // Solo al pasar a "hay que avisar": las dependencias completas volverían a
    // entrar con cada tic del cronómetro y el contador se dispararía.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldOpen]);

  const warn = !!moduleId && openedFor === moduleId && !completed && !dismissed;

  return useMemo<ModulePace>(
    () => ({
      level,
      ratio,
      pct: pacePct(ratio),
      remainingMs: Math.max(0, expectedMsFor(durationMin) - elapsedMs),
      xpFactor: xpFactorFor(level),
      signals,
      flagged: isFlagged(level, signals),
      warn,
      dismiss: () => setDismissed(true),
      flush: flushToDb,
    }),
    [level, ratio, durationMin, elapsedMs, signals, warn, flushToDb],
  );
}
