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

export const SIMULATOR_UNLOCK_THRESHOLD = 1;
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
  completedModules: string[];
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

  markModule: (id: string, courseModuleIds?: string[]) => string[];
  unmarkModule: (id: string) => void;
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
  recheckBadges: (modules: { id: string; courseId?: string | null }[]) => string[];
  reset: () => void;
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
      completedModules: [],
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

      markModule: (id, courseModuleIds) => {
        if (get().completedModules.includes(id)) return [];
        const next = [...get().completedModules, id];
        set({ completedModules: next });

        const snap: MetricSnapshot = { modules_completed: next.length };
        // Métricas por curso: solo se pueden derivar si nos pasan los módulos del
        // curso actual (medir contra el total global daría falsos positivos).
        if (courseModuleIds && courseModuleIds.length > 0) {
          const doneInCourse = courseModuleIds.filter((m) => next.includes(m)).length;
          if (courseModuleIds.length > 1) {
            snap.course_progress_pct = (doneInCourse / courseModuleIds.length) * 100;
          }
          if (doneInCourse >= courseModuleIds.length) snap.courses_completed = 1;
        }
        return get().evaluateBadges(snap);
      },

      unmarkModule: (id) =>
        set({ completedModules: get().completedModules.filter((m) => m !== id) }),

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
        const completedAssigned = s.completedModules.filter((id) =>
          modules.some((m) => m.id === id),
        );

        // Agrupar por curso para % de avance y cursos completos.
        const byCourse = new Map<string, string[]>();
        for (const m of modules) {
          const key = m.courseId ?? '__none__';
          const arr = byCourse.get(key) ?? [];
          arr.push(m.id);
          byCourse.set(key, arr);
        }
        let bestCoursePct = 0;
        let coursesCompleted = 0;
        for (const ids of byCourse.values()) {
          const done = ids.filter((id) => s.completedModules.includes(id)).length;
          if (ids.length > 0) bestCoursePct = Math.max(bestCoursePct, (done / ids.length) * 100);
          if (ids.length > 0 && done >= ids.length) coursesCompleted++;
        }

        const snap: MetricSnapshot = {
          modules_completed: s.completedModules.length,
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
          completedModules: [],
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
    }),
    {
      name: 'learningai.progress',
      version: 5,
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
        return state as Partial<ProgressState>;
      },
    },
  ),
);

export function selectSimulatorUnlocked(state: ProgressState): boolean {
  return state.completedModules.length >= SIMULATOR_UNLOCK_THRESHOLD;
}

export function selectAllModulesCompleted(state: ProgressState, modules: { id: string }[]): boolean {
  const completed = state.completedModules.filter((id) => modules.some((m) => m.id === id));
  return modules.length > 0 && completed.length === modules.length;
}

export function selectCertificationEarned(state: ProgressState, modules: { id: string }[]): boolean {
  return (
    selectAllModulesCompleted(state, modules) &&
    state.attempts.some((a) => a.score >= CERTIFICATION_MIN_SCORE)
  );
}

export function selectBestAttempt(state: ProgressState): SimulatorAttempt | undefined {
  if (state.attempts.length === 0) return undefined;
  return state.attempts.reduce((best, a) => (a.score > best.score ? a : best), state.attempts[0]);
}
