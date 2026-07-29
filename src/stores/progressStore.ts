import { useCallback } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  activeBadgeDefs,
  getXPLevel,
  getXPProgress,
  DEFAULT_BADGE_DEFS,
  DEFAULT_XP_LEVELS,
  type BadgeMetric,
  type BadgeCategory,
  type BadgeDef,
  type XPLevel,
} from '@/stores/gamificationStore';

// ─── Re-exports de compatibilidad ─────────────────────────────────────────────
// La definición de logros y niveles se movió a gamificationStore (ahora editable
// por el superadmin). Se re-exporta desde aquí para no romper imports existentes.
export {
  getXPLevel,
  getXPProgress,
  type BadgeCategory,
  type BadgeDef,
  type BadgeMetric,
  type XPLevel,
};
/** @deprecated usa activeBadgeDefs()/useGamificationStore. Solo defaults de fábrica. */
export const BADGE_DEFS = DEFAULT_BADGE_DEFS;
/** @deprecated usa useGamificationStore. Solo defaults de fábrica. */
export const XP_LEVELS = DEFAULT_XP_LEVELS;

// ─── Identidad de un módulo ───────────────────────────────────────────────────
// El progreso se guardaba SOLO por slug. El slug se deriva del título, es
// mutable y se puede repetir entre campañas, así que dos módulos distintos
// podían compartir clave: completar uno marcaba el otro como hecho. La clave
// buena es el UUID (`modules.id`), que es lo que ya usan `module_time` y
// `activity_attempts`.
//
// Migración en curso (ver docs/plan-migracion-progreso-uuid.md): se escriben
// AMBAS claves y se lee `uuid || slug`. El fallback por slug existe para que un
// aprendiz con localStorage viejo (o una fila de BD sin backfill) no vea 0%; se
// retira en la v7, cuando ya nadie escriba slugs.
export interface ModuleKey {
  /** `modules.id` real. Puede faltar en el seed estático de `data/modules.ts`. */
  uuid?: string | null;
  slug: string;
}

/** Adaptador para `LearningModule` (data/modules.ts), donde `id` ES el slug. */
export function keyOfModule(m: { id: string; dbId?: string | null }): ModuleKey {
  return { uuid: m.dbId ?? null, slug: m.id };
}

/** Adaptador para `CourseModuleSummary` (courses.service), donde `id` es el UUID. */
export function keyOfCourseModule(m: { id: string; slug: string }): ModuleKey {
  return { uuid: m.id, slug: m.slug };
}

function doneIn(ids: string[], slugs: string[], k: ModuleKey): boolean {
  return (!!k.uuid && ids.includes(k.uuid)) || (!!k.slug && slugs.includes(k.slug));
}

export interface SimulatorAttempt {
  id: string;
  scenarioId: string;
  date: number;
  score: number;
  durationSec: number;
  checklistPct: number;
  empathyPct: number;
  resolved: boolean;
}

export const CERTIFICATION_MIN_SCORE = 70;

// Umbrales legados: se conservan como referencia/compat. Los valores reales que
// otorgan logros viven ahora en las defs (BD o defaults), no en estas constantes.
export const QUIZ_ACE_TOTAL = 10;
export const PERFECT_RUN_STREAK = 10;
export const FLAWLESS_STREAK = 25;
export const HONOR_ROLL_MIN_SCORE = 95;
export const STREAK_IRON = 30;

// ─── Motor de reglas ──────────────────────────────────────────────────────────
// Un logro se otorga cuando una métrica del aprendiz alcanza el umbral de su def.
export type MetricSnapshot = Partial<Record<BadgeMetric, number>>;

// ─── Store ────────────────────────────────────────────────────────────────────

interface ProgressState {
  /**
   * Clave BUENA: UUIDs de módulo completados. Es la que manda.
   * @see ModuleKey
   */
  completedModuleIds: string[];
  /**
   * Clave LEGADA: slugs de módulo completados. Se sigue escribiendo para que los
   * RPCs y los clientes viejos no pierdan progreso durante la migración. No leer
   * directo: usa `useModuleDone` / `selectModuleDone`.
   * @deprecated se elimina en la v7 del persist.
   */
  completedModules: string[];
  /**
   * Índice slug → UUID aprendido de los módulos que el aprendiz ha visto. Existe
   * por el reset granular: el RPC del superadmin todavía emite `module_slugs`, y
   * sin traducir a UUID el `filter` limpiaría solo la clave legada — el fallback
   * `uuid || slug` volvería a dar el módulo por completado.
   */
  moduleSlugToId: Record<string, string>;
  attempts: SimulatorAttempt[];
  checkAnswers: Record<string, Record<string, number>>;
  xp: number;
  streak: number;
  lastActivityDate: string | null;
  badges: string[];
  quizCorrectCount: number;
  /** Aciertos seguidos sin fallar; se reinicia en cada respuesta incorrecta. */
  quizStreak: number;
  /** Mejor racha de aciertos alcanzada (no se reinicia). */
  quizBestStreak: number;
  /** Preguntas falladas y luego acertadas al reintentar. */
  redeemedCount: number;
  /** Cursos en los que el aprendiz obtuvo certificación. */
  certifiedCourseIds: string[];
  /** Mejor puntaje de certificación (%). */
  bestCertScore: number;
  /** Niveles de mundo completados (máximo observado). */
  worldLevelsCompleted: number;
  /** Mundos completados por entero (máximo observado). */
  worldsCompleted: number;

  markModule: (key: ModuleKey, courseModules?: ModuleKey[]) => string[];
  unmarkModule: (key: ModuleKey) => void;
  /**
   * Rellena la clave que falte en cada módulo conocido: si un módulo está
   * completado por slug pero no por UUID (localStorage viejo, fila de BD sin
   * backfill) le añade el UUID, y viceversa. Es lo que va vaciando la clave
   * legada en el parque de navegadores sin pedirle nada al aprendiz.
   */
  reconcileModuleKeys: (keys: ModuleKey[]) => void;
  recordCheck: (moduleId: string, quizKey: string, optionIdx: number) => void;
  addAttempt: (attempt: SimulatorAttempt) => string[];
  earnXP: (amount: number) => void;
  updateStreak: () => string[];
  awardBadge: (id: string) => boolean;
  /** Evalúa el motor de reglas contra un snapshot parcial de métricas. */
  evaluateBadges: (metrics: MetricSnapshot) => string[];
  /**
   * Registra el resultado de una pregunta. `redeemed` indica que el aprendiz
   * había fallado esta misma pregunta y ahora la acertó al reintentar → redención.
   */
  recordQuizResult: (correct: boolean, redeemed?: boolean) => string[];
  /** Registra una certificación de curso (con su puntaje) y evalúa logros. */
  recordCertification: (courseId: string, score?: number | null) => string[];
  /** Registra avance de mundo (niveles y mundos completados) y evalúa logros. */
  recordWorldProgress: (levelsCompleted: number, worldsCompleted?: number) => string[];
  recheckBadges: (modules: (ModuleKey & { courseId?: string | null })[]) => string[];
  reset: () => void;
  /**
   * Rehidrata la caché local desde el espejo de BD (`user_progress`). Es SIEMPRE
   * aditiva: une módulos e insignias y toma el máximo de xp/racha, nunca borra.
   * Así, si el localStorage se pierde (otro navegador, otro equipo, limpieza de
   * caché, recarga tras un despliegue), el aprendiz no vuelve a 0% ni tiene que
   * re-marcar módulos que ya completó. Lo que sí borra es un reset explícito del
   * superadmin, que se aplica antes en BD (ver `applyReset`).
   */
  hydrateFromServer: (data: ServerProgress) => void;
  /**
   * Aplica un restablecimiento hecho por el superadmin sobre la caché local, para
   * que la UI deje de mostrar 100%. Limpia solo lo que indique el payload.
   */
  applyReset: (payload: ResetLocalPayload) => void;
}

/** Lo que el espejo de BD sabe del progreso (subconjunto de lo local). */
export interface ServerProgress {
  completedModuleIds: string[];
  completedModules: string[];
  xp: number;
  streak: number;
  lastActivityDate: string | null;
  badges: string[];
}

/** Datos mínimos del payload de notificación que afectan al store local. */
export interface ResetLocalPayload {
  /** UUIDs de módulo a limpiar (clave nueva). */
  module_ids?: string[];
  /** @deprecated slugs; se acepta mientras el RPC de reset siga emitiéndolos. */
  module_slugs?: string[];
  check_answer_keys?: string[];
  scenario_slugs?: string[];
  clear_world?: boolean;
  course_id?: string | null;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

function bestSimScore(attempts: SimulatorAttempt[]): number {
  return attempts.reduce((m, a) => Math.max(m, a.score), 0);
}

export const useProgressStore = create<ProgressState>()(
  persist(
    (set, get) => ({
      completedModuleIds: [],
      completedModules: [],
      moduleSlugToId: {},
      attempts: [],
      checkAnswers: {},
      xp: 0,
      streak: 0,
      lastActivityDate: null,
      badges: [],
      quizCorrectCount: 0,
      quizStreak: 0,
      quizBestStreak: 0,
      redeemedCount: 0,
      certifiedCourseIds: [],
      bestCertScore: 0,
      worldLevelsCompleted: 0,
      worldsCompleted: 0,

      // Núcleo del motor: recorre las defs habilitadas y otorga las que cumplen.
      evaluateBadges: (metrics) => {
        const earned = get().badges;
        const toAward: string[] = [];
        for (const def of activeBadgeDefs()) {
          if (earned.includes(def.id) || toAward.includes(def.id)) continue;
          const value = metrics[def.metric];
          if (value == null) continue;
          if (value >= def.threshold) toAward.push(def.id);
        }
        if (toAward.length > 0) set({ badges: [...earned, ...toAward] });
        return toAward;
      },

      markModule: (key, courseModules) => {
        const s = get();
        if (doneIn(s.completedModuleIds, s.completedModules, key)) return [];

        // Doble escritura: el UUID es la clave real, el slug queda como espejo
        // para los RPCs y los clientes que todavía no leen UUIDs.
        const ids =
          key.uuid && !s.completedModuleIds.includes(key.uuid)
            ? [...s.completedModuleIds, key.uuid]
            : s.completedModuleIds;
        const slugs = s.completedModules.includes(key.slug)
          ? s.completedModules
          : [...s.completedModules, key.slug];
        set({
          completedModuleIds: ids,
          completedModules: slugs,
          ...(key.uuid ? { moduleSlugToId: { ...s.moduleSlugToId, [key.slug]: key.uuid } } : {}),
        });

        const snap: MetricSnapshot = { modules_completed: Math.max(ids.length, slugs.length) };
        // Métricas por curso: solo se pueden derivar si nos pasan los módulos del
        // curso actual (medir contra el total global daría falsos positivos).
        if (courseModules && courseModules.length > 0) {
          const doneInCourse = courseModules.filter((m) => doneIn(ids, slugs, m)).length;
          if (courseModules.length > 1) {
            snap.course_progress_pct = (doneInCourse / courseModules.length) * 100;
          }
          if (doneInCourse >= courseModules.length) snap.courses_completed = 1;
        }
        return get().evaluateBadges(snap);
      },

      unmarkModule: (key) =>
        set({
          completedModuleIds: get().completedModuleIds.filter((u) => u !== key.uuid),
          completedModules: get().completedModules.filter((m) => m !== key.slug),
        }),

      reconcileModuleKeys: (keys) => {
        const s = get();
        const ids = new Set(s.completedModuleIds);
        const slugs = new Set(s.completedModules);
        const index = { ...s.moduleSlugToId };
        let changed = false;
        for (const k of keys) {
          if (!k.uuid) continue;
          if (index[k.slug] !== k.uuid) {
            index[k.slug] = k.uuid;
            changed = true;
          }
          if (slugs.has(k.slug) && !ids.has(k.uuid)) {
            ids.add(k.uuid);
            changed = true;
          } else if (ids.has(k.uuid) && !slugs.has(k.slug)) {
            slugs.add(k.slug);
            changed = true;
          }
        }
        if (changed) {
          set({
            completedModuleIds: [...ids],
            completedModules: [...slugs],
            moduleSlugToId: index,
          });
        }
      },

      recordCheck: (moduleId, quizKey, optionIdx) =>
        set({
          checkAnswers: {
            ...get().checkAnswers,
            [moduleId]: {
              ...(get().checkAnswers[moduleId] ?? {}),
              [quizKey]: optionIdx,
            },
          },
        }),

      addAttempt: (attempt) => {
        const attempts = [attempt, ...get().attempts].slice(0, 40);
        set({ attempts });
        return get().evaluateBadges({ best_simulator_score: bestSimScore(attempts) });
      },

      earnXP: (amount) => set({ xp: get().xp + amount }),

      updateStreak: () => {
        const today = todayISO();
        const last = get().lastActivityDate;
        if (last === today) return [];

        let newStreak = 1;
        if (last) {
          const lastDate = new Date(last);
          const todayDate = new Date(today);
          const diffDays = Math.round(
            (todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
          );
          newStreak = diffDays === 1 ? get().streak + 1 : 1;
        }
        set({ streak: newStreak, lastActivityDate: today });
        return get().evaluateBadges({ streak_days: newStreak });
      },

      awardBadge: (id) => {
        if (get().badges.includes(id)) return false;
        set({ badges: [...get().badges, id] });
        return true;
      },

      recordQuizResult: (correct, redeemed) => {
        if (!correct) {
          // Un fallo reinicia la racha de aciertos; no otorga nada.
          set({ quizStreak: 0 });
          return [];
        }
        const total = get().quizCorrectCount + 1;
        const streak = get().quizStreak + 1;
        const best = Math.max(get().quizBestStreak, streak);
        const redeemedCount = get().redeemedCount + (redeemed ? 1 : 0);
        set({ quizCorrectCount: total, quizStreak: streak, quizBestStreak: best, redeemedCount });

        return get().evaluateBadges({
          quiz_correct_total: total,
          quiz_best_streak: best,
          redeemed_count: redeemedCount,
        });
      },

      recordCertification: (courseId, score) => {
        const ids = get().certifiedCourseIds.includes(courseId)
          ? get().certifiedCourseIds
          : [...get().certifiedCourseIds, courseId];
        const best = Math.max(get().bestCertScore, score ?? 0);
        set({ certifiedCourseIds: ids, bestCertScore: best });
        return get().evaluateBadges({
          certifications: ids.length,
          best_cert_score: best,
        });
      },

      recordWorldProgress: (levelsCompleted, worldsCompleted) => {
        const levels = Math.max(get().worldLevelsCompleted, levelsCompleted);
        const worlds = Math.max(get().worldsCompleted, worldsCompleted ?? 0);
        set({ worldLevelsCompleted: levels, worldsCompleted: worlds });
        return get().evaluateBadges({
          world_levels_completed: levels,
          worlds_completed: worlds,
        });
      },

      // Reevaluación integral: arma el snapshot completo con todo lo conocido y
      // corre el motor. Es la red de seguridad retroactiva (al abrir el panel).
      recheckBadges: (modules) => {
        const s = get();
        const isDone = (k: ModuleKey) => doneIn(s.completedModuleIds, s.completedModules, k);
        const completedAssigned = modules.filter(isDone);

        // Agrupar por curso para % de avance y cursos completos.
        const byCourse = new Map<string, ModuleKey[]>();
        for (const m of modules) {
          const key = m.courseId ?? '__none__';
          const arr = byCourse.get(key) ?? [];
          arr.push(m);
          byCourse.set(key, arr);
        }
        let bestCoursePct = 0;
        let coursesCompleted = 0;
        for (const keys of byCourse.values()) {
          const done = keys.filter(isDone).length;
          if (keys.length > 0) bestCoursePct = Math.max(bestCoursePct, (done / keys.length) * 100);
          if (keys.length > 0 && done >= keys.length) coursesCompleted++;
        }

        const snap: MetricSnapshot = {
          modules_completed: Math.max(s.completedModuleIds.length, s.completedModules.length),
          course_progress_pct: bestCoursePct,
          courses_completed: coursesCompleted,
          all_assigned_completed:
            modules.length > 0 && completedAssigned.length >= modules.length ? 1 : 0,
          streak_days: s.streak,
          quiz_correct_total: s.quizCorrectCount,
          quiz_best_streak: s.quizBestStreak,
          redeemed_count: s.redeemedCount,
          certifications: s.certifiedCourseIds.length,
          best_cert_score: s.bestCertScore,
          best_simulator_score: bestSimScore(s.attempts),
          world_levels_completed: s.worldLevelsCompleted,
          worlds_completed: s.worldsCompleted,
        };
        return get().evaluateBadges(snap);
      },

      reset: () =>
        set({
          completedModuleIds: [],
          completedModules: [],
          moduleSlugToId: {},
          attempts: [],
          checkAnswers: {},
          xp: 0,
          streak: 0,
          lastActivityDate: null,
          badges: [],
          quizCorrectCount: 0,
          quizStreak: 0,
          quizBestStreak: 0,
          redeemedCount: 0,
          certifiedCourseIds: [],
          bestCertScore: 0,
          worldLevelsCompleted: 0,
          worldsCompleted: 0,
        }),

      hydrateFromServer: (data) => {
        const s = get();
        const completedModuleIds = [
          ...new Set([...s.completedModuleIds, ...data.completedModuleIds]),
        ];
        const completedModules = [...new Set([...s.completedModules, ...data.completedModules])];
        const badges = [...new Set([...s.badges, ...data.badges])];
        const lastActivityDate =
          !s.lastActivityDate || (data.lastActivityDate ?? '') > s.lastActivityDate
            ? (data.lastActivityDate ?? s.lastActivityDate)
            : s.lastActivityDate;

        // Solo escribir si algo cambió: evita re-render y un espejo de vuelta.
        if (
          completedModuleIds.length === s.completedModuleIds.length &&
          completedModules.length === s.completedModules.length &&
          badges.length === s.badges.length &&
          data.xp <= s.xp &&
          data.streak <= s.streak &&
          lastActivityDate === s.lastActivityDate
        ) {
          return;
        }

        set({
          completedModuleIds,
          completedModules,
          badges,
          xp: Math.max(s.xp, data.xp),
          streak: Math.max(s.streak, data.streak),
          lastActivityDate,
        });
      },

      applyReset: (payload) => {
        const s = get();
        const patch: Partial<ProgressState> = {};

        // Módulos completados. El RPC de reset puede mandar UUIDs (clave nueva),
        // slugs (clave legada) o ambos; hay que limpiar las dos listas o el
        // fallback `uuid || slug` resucitaría el módulo restablecido.
        const removeIds = new Set(payload.module_ids ?? []);
        if (payload.module_slugs?.length) {
          const removeSlugs = new Set(payload.module_slugs);
          patch.completedModules = s.completedModules.filter((m) => !removeSlugs.has(m));
          // Traducir con el índice aprendido: si no, el UUID sobreviviría al reset.
          for (const slug of removeSlugs) {
            const uuid = s.moduleSlugToId[slug];
            if (uuid) removeIds.add(uuid);
          }
        }
        if (removeIds.size > 0) {
          patch.completedModuleIds = s.completedModuleIds.filter((u) => !removeIds.has(u));
        }

        // Respuestas de knowledge-check (objeto keyed por UUID de módulo).
        if (payload.check_answer_keys?.length) {
          const next = { ...s.checkAnswers };
          for (const k of payload.check_answer_keys) delete next[k];
          patch.checkAnswers = next;
        }

        // Intentos del simulador (guardan scenarioId = slug del escenario).
        if (payload.scenario_slugs?.length) {
          const remove = new Set(payload.scenario_slugs);
          patch.attempts = s.attempts.filter((a) => !remove.has(a.scenarioId));
        }

        // Reset de curso completo: también quita la certificación local y los
        // contadores de mundo (máximos para logros), para no dejar rastros del 100%.
        if (payload.clear_world && payload.course_id != null) {
          patch.certifiedCourseIds = s.certifiedCourseIds.filter((id) => id !== payload.course_id);
        }

        if (Object.keys(patch).length > 0) set(patch);
      },
    }),
    {
      name: 'learningai.progress',
      version: 6,
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState as Partial<ProgressState>) ?? {};
        if (version < 2) {
          return {
            completedModules: state.completedModules ?? [],
            attempts: state.attempts ?? [],
            checkAnswers: {},
            xp: 0, streak: 0, lastActivityDate: null, badges: [], quizCorrectCount: 0, quizStreak: 0,
          } as Partial<ProgressState>;
        }
        if (version < 3) {
          return {
            ...state,
            xp: 0, streak: 0, lastActivityDate: null, badges: [], quizCorrectCount: 0, quizStreak: 0,
          } as Partial<ProgressState>;
        }
        if (version < 4) {
          return { ...state, quizStreak: state.quizStreak ?? 0 } as Partial<ProgressState>;
        }
        // v5: motor de reglas. Se derivan los nuevos contadores desde lo que ya
        // existía para no perder logros ni desbloquear de más. Los logros ya
        // ganados se conservan intactos.
        if (version < 5) {
          return {
            ...state,
            quizBestStreak: state.quizStreak ?? 0,
            redeemedCount: state.badges?.includes('comeback') ? 1 : 0,
            certifiedCourseIds: [],
            bestCertScore: state.badges?.includes('honor-roll') ? 95 : 0,
            worldLevelsCompleted: state.badges?.includes('world-explorer') ? 1 : 0,
            worldsCompleted: state.badges?.includes('world-conqueror') ? 1 : 0,
          } as Partial<ProgressState>;
        }
        // v6: progreso por UUID. NO se puede traducir slug → UUID aquí (migrate
        // es síncrono y sin BD): los arreglos nuevos nacen vacíos y se llenan por
        // `hydrateFromServer` y `reconcileModuleKeys`. Mientras tanto el aprendiz
        // sigue viendo su progreso por el fallback de slug, que no se toca.
        if (version < 6) {
          return {
            ...state,
            completedModuleIds: [],
            moduleSlugToId: {},
          } as Partial<ProgressState>;
        }
        return state as Partial<ProgressState>;
      },
    },
  ),
);

// ─── Lectura ──────────────────────────────────────────────────────────────────
// ÚNICO punto donde se decide si un módulo está completado. Toda la UI pasa por
// aquí; nadie debe volver a hacer `completedModules.includes(m.slug)` a mano.

export function selectModuleDone(state: ProgressState, key: ModuleKey): boolean {
  return doneIn(state.completedModuleIds, state.completedModules, key);
}

/**
 * Versión hook: se suscribe a las dos claves, así que la UI se re-renderiza
 * tanto si el progreso llega por UUID como por el fallback de slug.
 */
export function useModuleDone(): (key: ModuleKey) => boolean {
  const ids = useProgressStore((s) => s.completedModuleIds);
  const slugs = useProgressStore((s) => s.completedModules);
  return useCallback((key: ModuleKey) => doneIn(ids, slugs, key), [ids, slugs]);
}

export function selectAllModulesCompleted(state: ProgressState, modules: ModuleKey[]): boolean {
  const completed = modules.filter((m) => selectModuleDone(state, m));
  return modules.length > 0 && completed.length === modules.length;
}

export function selectCertificationEarned(state: ProgressState, modules: ModuleKey[]): boolean {
  return (
    selectAllModulesCompleted(state, modules) &&
    state.attempts.some((a) => a.score >= CERTIFICATION_MIN_SCORE)
  );
}

export function selectBestAttempt(state: ProgressState): SimulatorAttempt | undefined {
  if (state.attempts.length === 0) return undefined;
  return state.attempts.reduce((best, a) => (a.score > best.score ? a : best), state.attempts[0]);
}
