// src/services/modulePace.service.ts
import { supabase } from '@/lib/supabase';
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode';
import type { PaceLevel } from '@/lib/modulePace';

/**
 * Ritmo de estudio por (usuario, módulo). Vive en las columnas nuevas de
 * `module_time` — la misma fila donde ya está el tiempo activo — para no partir
 * en dos la historia de un módulo.
 *
 * SQL: `supabase/sql/2026-08-14_module_pace.sql` (ALTER TABLE module_time).
 *
 * Todo aquí DEGRADA SOLO: si el ALTER todavía no se corrió, Supabase responde
 * error de columna desconocida, se registra en consola y la app sigue igual
 * (el aviso al aprendiz se muestra con el conteo local; solo se pierde el
 * registro para el capacitador).
 *
 * OJO: `moduleId` es el UUID real (module.dbId), NUNCA el slug.
 */

export interface ModulePaceRow {
  expectedMs: number;
  level: PaceLevel;
  pastes: number;
  tabOuts: number;
  warnings: number;
  maxDepth: number;
  xpFactor: number;
}

const SELECT =
  'expected_ms, pace_level, pastes, tab_outs, rush_warnings, max_depth, xp_factor';

function toRow(data: Record<string, unknown>): ModulePaceRow {
  const n = (v: unknown) => Number(v) || 0;
  const lvl = data.pace_level;
  return {
    expectedMs: n(data.expected_ms),
    level: lvl === 'rush' || lvl === 'fast' ? lvl : 'ok',
    pastes: n(data.pastes),
    tabOuts: n(data.tab_outs),
    warnings: n(data.rush_warnings),
    maxDepth: n(data.max_depth),
    xpFactor: Number(data.xp_factor ?? 1) || 1,
  };
}

export async function getModulePace(
  userId: string,
  moduleId: string,
): Promise<ModulePaceRow | null> {
  const { data, error } = await supabase
    .from('module_time')
    .select(SELECT)
    .eq('user_id', userId)
    .eq('module_id', moduleId)
    .maybeSingle();

  if (error) {
    console.warn('getModulePace (¿falta el ALTER de module_pace?):', error.message);
    return null;
  }
  // Doble casteo a propósito: los tipos generados de `module_time` son de antes
  // del ALTER de ritmo, así que no conocen estas columnas todavía.
  return data ? toRow(data as unknown as Record<string, unknown>) : null;
}

/**
 * Guarda el ritmo. Es un upsert sobre la MISMA fila del cronómetro, así que
 * nunca escribe `elapsed_ms` ni `completed_at`: de eso se encarga
 * `moduleTime.service`, y pisarlos aquí borraría tiempo real.
 */
export async function upsertModulePace(
  userId: string,
  moduleId: string,
  value: ModulePaceRow,
): Promise<void> {
  // Vista previa del capacitador: se ve en pantalla, no se registra (previewMode).
  if (IS_LEARNER_PREVIEW) return;

  const { error } = await supabase.from('module_time').upsert(
    {
      user_id: userId,
      module_id: moduleId,
      expected_ms: Math.round(value.expectedMs),
      pace_level: value.level,
      pastes: value.pastes,
      tab_outs: value.tabOuts,
      rush_warnings: value.warnings,
      max_depth: Math.round(value.maxDepth),
      xp_factor: value.xpFactor,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: 'user_id,module_id' },
  );

  if (error) console.warn('upsertModulePace (¿falta el ALTER de module_pace?):', error.message);
}

/**
 * Ritmo de varios aprendices en una sola consulta, indexado por
 * `${userId}:${moduleId}` para cruzarlo con los intentos del panel del staff.
 */
export async function getModulePacesForUsers(
  userIds: string[],
): Promise<Record<string, ModulePaceRow>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from('module_time')
    .select(`user_id, module_id, ${SELECT}`)
    .in('user_id', ids);

  if (error || !data) {
    if (error) console.warn('getModulePacesForUsers:', error.message);
    return {};
  }
  const out: Record<string, ModulePaceRow> = {};
  for (const row of data as unknown as Record<string, unknown>[]) {
    out[`${row.user_id}:${row.module_id}`] = toRow(row);
  }
  return out;
}
