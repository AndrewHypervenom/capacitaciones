// src/services/moduleTime.service.ts
import { supabase } from '@/lib/supabase';

/**
 * Persistencia en BD del tiempo activo por (usuario, módulo).
 *
 * OJO: `moduleId` aquí es el UUID real del módulo (module.dbId), NUNCA el slug
 * (module.id en el front es el slug). La tabla module_time.module_id referencia
 * modules.id, así que pasar el slug rompería el FK.
 */

export interface ModuleTimeRow {
  elapsedMs: number;
  completedAt: string | null;
}

export async function getModuleTime(
  userId: string,
  moduleId: string,
): Promise<ModuleTimeRow | null> {
  const { data, error } = await supabase
    .from('module_time')
    .select('elapsed_ms, completed_at')
    .eq('user_id', userId)
    .eq('module_id', moduleId)
    .maybeSingle();

  if (error) {
    console.error('getModuleTime error:', error);
    return null;
  }
  if (!data) return null;
  return { elapsedMs: Number(data.elapsed_ms) || 0, completedAt: data.completed_at ?? null };
}

/**
 * Guarda el acumulado. `completedAt`:
 *   - string  → marca (o re-marca) el módulo como completado en esa fecha.
 *   - null    → NO toca la columna completed_at (deja intacto un completado
 *               previo). Esto evita una carrera: los volcados "en curso"
 *               (pausa/latido/desmontaje) nunca deben borrar el completado que
 *               escribe el volcado de finalización.
 */
export async function upsertModuleTime(
  userId: string,
  moduleId: string,
  value: { elapsedMs: number; completedAt: string | null },
): Promise<void> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    module_id: moduleId,
    elapsed_ms: Math.round(value.elapsedMs),
    updated_at: new Date().toISOString(),
  };
  // Solo incluimos completed_at cuando finalizamos; si va null lo omitimos para
  // que el ON CONFLICT DO UPDATE no pise un completado ya persistido.
  if (value.completedAt !== null) payload.completed_at = value.completedAt;

  const { error } = await supabase
    .from('module_time')
    .upsert(payload as any, { onConflict: 'user_id,module_id' });

  if (error) console.error('upsertModuleTime error:', error);
}

/** Lee el tiempo de todos los módulos de un aprendiz de una sola vez (panel del staff). */
export async function getModuleTimesForUser(
  userId: string,
): Promise<Record<string, ModuleTimeRow>> {
  const { data, error } = await supabase
    .from('module_time')
    .select('module_id, elapsed_ms, completed_at')
    .eq('user_id', userId);

  if (error || !data) {
    if (error) console.error('getModuleTimesForUser error:', error);
    return {};
  }
  const out: Record<string, ModuleTimeRow> = {};
  for (const row of data) {
    out[row.module_id] = {
      elapsedMs: Number(row.elapsed_ms) || 0,
      completedAt: row.completed_at ?? null,
    };
  }
  return out;
}

/**
 * Lee el tiempo de varios aprendices de una sola consulta. Devuelve un mapa
 * indexado por la clave compuesta `${userId}:${moduleId}` para cruzarlo con los
 * intentos del panel del capacitador.
 */
export async function getModuleTimesForUsers(
  userIds: string[],
): Promise<Record<string, ModuleTimeRow>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from('module_time')
    .select('user_id, module_id, elapsed_ms, completed_at')
    .in('user_id', ids);

  if (error || !data) {
    if (error) console.error('getModuleTimesForUsers error:', error);
    return {};
  }
  const out: Record<string, ModuleTimeRow> = {};
  for (const row of data) {
    out[`${row.user_id}:${row.module_id}`] = {
      elapsedMs: Number(row.elapsed_ms) || 0,
      completedAt: row.completed_at ?? null,
    };
  }
  return out;
}
