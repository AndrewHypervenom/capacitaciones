import { useEffect, useRef, useState } from 'react';
import { getModuleTime, upsertModuleTime } from '@/services/moduleTime.service';

/**
 * Cronómetro de tiempo ACTIVO dedicado a un módulo por un aprendiz.
 *
 * Mide el tiempo real desde que la persona entra al módulo hasta que lo marca
 * como completado, contando SOLO mientras la pestaña está visible (se pausa al
 * cambiar de pestaña o minimizar). Al completarse el módulo el valor queda
 * congelado y ya no vuelve a correr.
 *
 * Persistencia en dos capas:
 *   1. localStorage (por usuario+módulo): caché inmediata, sobrevive recargas y
 *      alimenta el contador en vivo sin esperar a la red.
 *   2. Base de datos (tabla module_time): fuente confiable, cross-dispositivo y
 *      auditable por el capacitador. Se sincroniza al cargar y se escribe en los
 *      eventos de baja frecuencia (pausa, latido cada 30 s, desmontaje, completar).
 *
 * IMPORTANTE: `moduleId` debe ser el UUID real del módulo (module.dbId), NO el
 * slug (module.id en el front es el slug). El FK de module_time apunta a modules.id.
 *
 * Devuelve los milisegundos acumulados y una etiqueta ya formateada
 * (p. ej. "14 min 03 s") lista para pintar.
 */

interface StoredTime {
  elapsedMs: number;
  completedAt: string | null;
}

const DB_HEARTBEAT_MS = 30_000;

function storageKey(userId: string | undefined, moduleId: string | undefined): string {
  return `learningai.moduleTime:${userId || 'anon'}:${moduleId || 'none'}`;
}

function readStored(key: string): StoredTime {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { elapsedMs: 0, completedAt: null };
    const parsed = JSON.parse(raw);
    return {
      elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : 0,
      completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
    };
  } catch {
    return { elapsedMs: 0, completedAt: null };
  }
}

function writeStored(key: string, value: StoredTime): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage lleno o no disponible: ignoramos */
  }
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h} h ${pad(m)} min`;
  if (m > 0) return `${m} min ${pad(s)} s`;
  return `${s} s`;
}

interface Options {
  /** Si es false el cronómetro no corre (p. ej. staff que solo previsualiza). */
  enabled?: boolean;
}

export function useModuleTimer(
  moduleId: string | undefined,
  userId: string | undefined,
  completed: boolean,
  { enabled = true }: Options = {},
) {
  const key = storageKey(userId, moduleId);

  // Acumulado base (lo ya persistido); el tiempo de la sesión activa se suma aparte.
  const baseElapsedRef = useRef(0);
  // Marca de inicio del tramo activo en curso (null = pausado / detenido).
  const sessionStartRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const keyRef = useRef(key);
  keyRef.current = key;

  // Identificadores para la sincronización con BD (solo si ambos existen).
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const moduleIdRef = useRef(moduleId);
  moduleIdRef.current = moduleId;

  const [elapsedMs, setElapsedMs] = useState(0);

  // Escribe el estado actual en la BD (best-effort, no bloquea la UI).
  const flushToDb = (completedAt: string | null) => {
    const uid = userIdRef.current;
    const mid = moduleIdRef.current;
    if (!uid || !mid) return;
    void upsertModuleTime(uid, mid, {
      elapsedMs: baseElapsedRef.current,
      completedAt,
    });
  };

  // Reinicializamos el acumulado cada vez que cambia el módulo/usuario, y
  // reconciliamos con la BD (que puede tener tiempo de otro dispositivo/sesión).
  useEffect(() => {
    const stored = readStored(key);
    baseElapsedRef.current = stored.elapsedMs;
    completedRef.current = stored.completedAt !== null;
    setElapsedMs(stored.elapsedMs);

    if (!userId || !moduleId) return;

    let cancelled = false;
    getModuleTime(userId, moduleId).then((remote) => {
      if (cancelled || !remote) {
        // Si en la BD no hay fila todavía pero localmente ya corrimos tiempo,
        // sembramos la BD con lo que tengamos.
        if (!cancelled && !remote && (stored.elapsedMs > 0 || stored.completedAt)) {
          flushToDb(stored.completedAt);
        }
        return;
      }
      // Nos quedamos con el mayor acumulado y respetamos cualquier completado.
      const mergedMs = Math.max(baseElapsedRef.current, remote.elapsedMs);
      const mergedCompletedAt = remote.completedAt ?? stored.completedAt;
      baseElapsedRef.current = mergedMs;
      writeStored(keyRef.current, { elapsedMs: mergedMs, completedAt: mergedCompletedAt });
      if (mergedCompletedAt) completedRef.current = true;
      // Reflejamos el valor en vivo (si hay un tramo activo, tick lo recalcula).
      const live =
        mergedMs + (sessionStartRef.current !== null ? Date.now() - sessionStartRef.current : 0);
      setElapsedMs(live);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!enabled || !moduleId) return;
    // Si ya se completó (ahora o en una sesión previa), congelamos y no contamos.
    if (completed || completedRef.current) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const now = () => Date.now();

    const accumulate = () => {
      if (sessionStartRef.current !== null) {
        baseElapsedRef.current += now() - sessionStartRef.current;
        sessionStartRef.current = null;
      }
    };

    const persist = () => {
      writeStored(keyRef.current, {
        elapsedMs: baseElapsedRef.current,
        completedAt: null,
      });
    };

    const tick = () => {
      const live =
        baseElapsedRef.current +
        (sessionStartRef.current !== null ? now() - sessionStartRef.current : 0);
      setElapsedMs(live);
    };

    const start = () => {
      if (sessionStartRef.current === null) sessionStartRef.current = now();
      if (interval === null) interval = setInterval(tick, 1000);
      // Latido: vuelca a la BD cada 30 s el acumulado del tramo en curso, para
      // no perder tiempo si la pestaña se cierra en seco sin disparar pausa.
      if (heartbeat === null) {
        heartbeat = setInterval(() => {
          accumulate();
          sessionStartRef.current = now(); // reabrimos el tramo tras plegarlo
          persist();
          flushToDb(null);
        }, DB_HEARTBEAT_MS);
      }
      tick();
    };

    const pause = () => {
      accumulate();
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      persist();
      flushToDb(null);
      setElapsedMs(baseElapsedRef.current);
    };

    const onVisibility = () => {
      if (document.hidden) pause();
      else start();
    };

    // Arrancamos si la pestaña está visible.
    if (!document.hidden) start();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', pause);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', pause);
      // Al desmontar acumulamos y persistimos lo corrido en esta sesión.
      accumulate();
      if (interval !== null) clearInterval(interval);
      if (heartbeat !== null) clearInterval(heartbeat);
      persist();
      flushToDb(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, moduleId, completed]);

  // Al completar el módulo: cerramos el tramo activo y congelamos el total.
  useEffect(() => {
    if (!completed || completedRef.current) return;
    if (sessionStartRef.current !== null) {
      baseElapsedRef.current += Date.now() - sessionStartRef.current;
      sessionStartRef.current = null;
    }
    completedRef.current = true;
    const completedAt = new Date().toISOString();
    writeStored(keyRef.current, {
      elapsedMs: baseElapsedRef.current,
      completedAt,
    });
    flushToDb(completedAt);
    setElapsedMs(baseElapsedRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  return { elapsedMs, label: formatElapsed(elapsedMs) };
}
