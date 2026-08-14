// src/services/reinforcementStudy.service.ts
import { supabase } from '@/lib/supabase';
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode';

/**
 * Espejo auditable del repaso de la ruta de refuerzo (tabla `reinforcement_study`).
 *
 * La medición manda en el navegador —es donde ocurre el repaso— y aquí se
 * espeja para que el capacitador pueda responder "¿repasó de verdad, cuánto y
 * qué módulo?". Todo es best-effort: si la tabla todavía no existe (SQL sin
 * correr) o falla la red, la app del aprendiz sigue igual. Nunca bloquea.
 *
 * Al volver a entrar se lee de vuelta, así que cambiar de equipo no borra lo
 * repasado: gana el mayor acumulado, como en `module_time`.
 */

/* La tabla es nueva y todavía no está en los tipos generados de Supabase (el
   SQL lo corre el capacitador a mano), así que se accede sin tipar, como el
   resto de servicios en la misma situación. */
const table = () => (supabase as any).from('reinforcement_study');

export interface ReinforcementStudyRow {
  moduleId: string;
  requiredMs: number;
  creditedMs: number;
  progressPct: number;
  /** Hasta dónde se leyó, 0-100. */
  depthPct: number;
  completedAt: string | null;
}

/** Fila del panel del capacitador (una por aprendiz y módulo). */
export interface ReinforcementStudyAudit extends ReinforcementStudyRow {
  userId: string;
  /** `profiles` no guarda el email (vive en auth.users); aquí basta el nombre. */
  displayName: string | null;
  moduleTitle: string;
  startedAt: string;
  updatedAt: string;
}

/**
 * Un latido de repaso: "sigo aquí, en el tramo N de M".
 *
 * NO se envía cuánto tiempo se lleva — eso lo calcula el servidor contra su
 * propio reloj y el latido anterior, con techo por latido. Por eso repetir
 * latidos, abrir varias pestañas o tocar el almacenamiento del navegador no
 * adelanta el repaso ni un segundo.
 *
 * Devuelve el estado que manda (el de la base) o null si todavía no está la
 * función en la base: en ese caso la pantalla sigue midiendo en local y el
 * check se abrirá igual, pero sin blindaje. Nunca lanza.
 */
export async function beatReinforcementStudy(
  reinforcementId: string,
  moduleId: string,
  /** Hasta dónde se ha leído, 0-100. */
  depthPct: number,
): Promise<ReinforcementStudyRow | null> {
  // Vista previa del capacitador: se mide en pantalla pero no se persiste.
  if (IS_LEARNER_PREVIEW) return null;

  const { data, error } = await (supabase.rpc as any)('reinforcement_beat', {
    p_reinforcement_id: reinforcementId,
    p_module_id: moduleId,
    p_depth_pct: Math.max(0, Math.min(100, Math.round(depthPct))),
  });

  if (error || !data) {
    // 42883 = la función no existe todavía (SQL sin correr).
    if (error && error.code !== '42883') console.error('reinforcement_beat error:', error);
    return null;
  }

  const r = data as Record<string, unknown>;
  return {
    moduleId: String(r.module_id ?? moduleId),
    requiredMs: Number(r.required_ms) || 0,
    creditedMs: Number(r.credited_ms) || 0,
    progressPct: Number(r.progress_pct) || 0,
    depthPct: Number(r.depth_pct) || 0,
    completedAt: (r.completed_at as string) ?? null,
  };
}

/** Lo repasado por una persona en una ruta (para no perderlo al cambiar de equipo). */
export async function getReinforcementStudy(
  userId: string,
  reinforcementId: string,
): Promise<Record<string, ReinforcementStudyRow>> {
  const { data, error } = await table()
    .select('module_id, required_ms, credited_ms, progress_pct, depth_pct, completed_at')
    .eq('user_id', userId)
    .eq('reinforcement_id', reinforcementId);

  if (error || !data) {
    if (error && error.code !== '42P01') console.error('getReinforcementStudy error:', error);
    return {};
  }

  const out: Record<string, ReinforcementStudyRow> = {};
  for (const r of data as Record<string, unknown>[]) {
    const moduleId = String(r.module_id);
    out[moduleId] = {
      moduleId,
      requiredMs: Number(r.required_ms) || 0,
      creditedMs: Number(r.credited_ms) || 0,
      progressPct: Number(r.progress_pct) || 0,
      depthPct: Number(r.depth_pct) || 0,
      completedAt: (r.completed_at as string) ?? null,
    };
  }
  return out;
}

/** Auditoría del curso completo: quién repasó, qué módulo y cuánto. */
export async function getReinforcementStudyAudit(
  courseId: string,
): Promise<ReinforcementStudyAudit[]> {
  const { data, error } = await (supabase.rpc as any)('get_reinforcement_study', {
    p_course_id: courseId,
  });

  if (error || !data) {
    // 42883 = la función no existe todavía (SQL sin correr): sin auditoría, pero
    // el panel del examen tiene que seguir abriendo.
    if (error && error.code !== '42883') console.error('getReinforcementStudyAudit error:', error);
    return [];
  }

  return (data as Record<string, unknown>[]).map((r) => ({
    userId: String(r.user_id),
    displayName: (r.display_name as string) ?? null,
    moduleId: String(r.module_id),
    moduleTitle: (r.module_title as string) ?? '—',
    requiredMs: Number(r.required_ms) || 0,
    creditedMs: Number(r.credited_ms) || 0,
    progressPct: Number(r.progress_pct) || 0,
    depthPct: Number(r.depth_pct) || 0,
    startedAt: String(r.started_at),
    completedAt: (r.completed_at as string) ?? null,
    updatedAt: String(r.updated_at),
  }));
}
