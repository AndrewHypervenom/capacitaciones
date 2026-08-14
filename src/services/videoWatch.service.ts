// src/services/videoWatch.service.ts
import { supabase } from '@/lib/supabase';
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode';

/**
 * "Hasta dónde vio de verdad" cada persona en cada video, en la BASE.
 *
 * Es lo que sostiene el candado de la primera pasada: sin esto la marca vivía
 * solo en el navegador y cambiar de equipo —o abrir una ventana de incógnito—
 * devolvía el video libre.
 *
 * El cliente no dice cuánto vio: dice en qué segundo va, y el servidor decide
 * cuánto acredita contra su propio reloj (ver `video_watch_beat`). Terminado
 * tampoco se declara: se concede cuando lo acreditado llega al final real.
 *
 * Todo es best-effort: si el SQL no se ha corrido o falla la red, devuelve null
 * y la pantalla sigue con la marca del navegador. Nunca lanza, nunca bloquea.
 */

/* Tabla y función nuevas: todavía no están en los tipos generados de Supabase
   (el SQL se corre a mano), así que se accede sin tipar, como el resto de
   servicios en la misma situación. */
const table = () => (supabase as any).from('video_watch');

export interface VideoWatchRow {
  /** Segundo más lejano acreditado por el servidor. */
  maxSeconds: number;
  /** Ya se vio entero: el candado se levantó. */
  done: boolean;
}

/** Códigos de "esto todavía no existe en la base": se ignoran en silencio. */
function isMissing(code?: string): boolean {
  return code === '42P01' /* tabla */ || code === '42883' /* función */ || code === 'PGRST202';
}

/** La marca de un video. `null` = no se pudo consultar (no que no exista). */
export async function getVideoWatch(
  userId: string,
  videoKey: string,
): Promise<VideoWatchRow | null> {
  const { data, error } = await table()
    .select('max_seconds, done')
    .eq('user_id', userId)
    .eq('video_key', videoKey)
    .maybeSingle();

  if (error) {
    if (!isMissing(error.code)) console.error('getVideoWatch error:', error);
    return null;
  }
  // Sin fila = nunca ha visto este video. Eso NO es un fallo: es la marca en cero,
  // y con ella el candado tiene que quedar puesto.
  if (!data) return { maxSeconds: 0, done: false };

  const r = data as Record<string, unknown>;
  return { maxSeconds: Number(r.max_seconds) || 0, done: r.done === true };
}

/**
 * Un latido: "voy en el segundo N de un video que dura D".
 *
 * Devuelve lo que el servidor acredita —que puede ser MENOS de lo pedido— o
 * null si la función todavía no está en la base.
 */
export async function beatVideoWatch(
  videoKey: string,
  seconds: number,
  durationSecs?: number | null,
  done = false,
): Promise<VideoWatchRow | null> {
  // Vista previa del capacitador: se mira como aprendiz, pero no se ensucian datos.
  if (IS_LEARNER_PREVIEW) return null;

  const { data, error } = await (supabase.rpc as any)('video_watch_beat', {
    p_video_key: videoKey,
    p_seconds: Math.max(0, Math.round(seconds)),
    p_duration: durationSecs && durationSecs > 0 ? Math.round(durationSecs) : null,
    p_done: done,
  });

  if (error) {
    if (!isMissing(error.code)) console.error('video_watch_beat error:', error);
    return null;
  }

  // La función devuelve una tabla de una fila.
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { maxSeconds: Number(row.max_seconds) || 0, done: row.done === true };
}
