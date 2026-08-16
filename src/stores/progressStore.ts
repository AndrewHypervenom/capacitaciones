import { useCallback } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode';
import { currentXPMultiplier } from '@/stores/xpEventStore';
import { pushXPGain, type XPReason } from '@/stores/xpFeedStore';
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

export interface ProgressState {
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

  // ── Repaso ──────────────────────────────────────────────────────────────────
  /**
   * Última fecha (YYYY-MM-DD) en que CADA módulo pagó repaso. Se guarda bajo las
   * dos claves (UUID y slug) por la misma razón que `completedModules`: si solo
   * guardáramos una, el mismo módulo cobraría dos veces según por dónde llegue.
   */
  reviewedAt: Record<string, string>;
  /** Día al que corresponde `reviewXPToday` (se reinicia solo al cambiar de fecha). */
  reviewXPDate: string | null;
  /** XP base de repaso ya cobrado hoy (contra `XP_REWARDS.reviewDailyCap`). */
  reviewXPToday: number;
  /**
   * Vuelta en curso por curso: módulos repasados desde el último bono. Cuando
   * están todos, se paga el bono de re-certificación y la lista se vacía — para
   * cobrarlo otra vez hay que repasar el curso entero de nuevo.
   */
  courseReviewRound: Record<string, string[]>;
  /** Cursos repasados por completo al menos una vez (para la UI y las métricas). */
  courseReviewCount: Record<string, number>;

  /**
   * Marca el módulo como completado y paga su XP.
   *
   * `xpFactor` (0..1) recorta ese XP cuando el módulo se pasó de afán: el ritmo
   * real de estudio lo mide `useModulePace` y la pantalla lo anuncia ANTES de
   * completar. Por defecto 1 (sin recorte). Nunca cambia el completado en sí:
   * ir rápido paga menos, pero el módulo queda hecho.
   */
  markModule: (key: ModuleKey, courseModules?: ModuleKey[], opts?: { xpFactor?: number }) => string[];
  unmarkModule: (key: ModuleKey) => void;
  /**
   * Rellena la clave que falte en cada módulo conocido: si un módulo está
   * completado por slug pero no por UUID (localStorage viejo, fila de BD sin
   * backfill) le añade el UUID, y viceversa. Es lo que va vaciando la clave
   * legada en el parque de navegadores sin pedirle nada al aprendiz.
   */
  reconcileModuleKeys: (keys: ModuleKey[]) => void;
  /**
   * Cobra el repaso de un módulo YA completado: paga `reviewRate` del XP del
   * módulo, una vez por día por módulo y hasta el tope diario. No toca el estado
   * de completado ni la certificación: repasar nunca quita nada.
   */
  reviewModule: (
    key: ModuleKey,
    opts?: { courseModules?: ModuleKey[]; courseId?: string | null },
  ) => ReviewOutcome;
  /** ¿Este módulo ya cobró repaso hoy? (para pintar el botón sin intentarlo). */
  reviewedToday: (key: ModuleKey) => boolean;
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
  recordQuizResult: (correct: boolean, redeemed?: boolean, moduleId?: string) => string[];
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
   * Une el progreso que acaba de escribir OTRA pestaña del mismo navegador.
   *
   * Con dos pestañas abiertas cada una tenía su copia en memoria y la última en
   * guardar pisaba a la otra: se completaba un módulo en una y desaparecía al
   * volver a la otra. Ahora, cuando una pestaña escribe el localStorage, las
   * demás pasan por aquí. La fusión es aditiva por el mismo motivo que
   * `hydrateFromServer`: nunca puede quitar avance ya ganado.
   */
  mergeFromTab: (incoming: Partial<ProgressState>) => void;
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

/**
 * Economía de XP. Antes el único origen era completar un módulo (100 XP), así que
 * el nivel medía "módulos vistos" y se disparaba en pocas sesiones. Ahora premia
 * también acertar, mejorar en el simulador, certificarse, avanzar en mundos y
 * volver cada día.
 *
 * Regla de oro: **todo XP se otorga dentro de las acciones del store**, detrás del
 * mismo candado que evita duplicar el logro/contador correspondiente. Nada de
 * `earnXP` suelto en componentes: un re-render o un "volver a hacerlo" lo farmea.
 * `earnXP` queda solo para casos puntuales fuera de este catálogo.
 */
export const XP_REWARDS = {
  /** Completar un módulo por primera vez. */
  module: 100,
  /** Cada respuesta correcta de quiz/knowledge-check. */
  quizCorrect: 15,
  /** Extra por acertar una pregunta que antes se falló (redención). */
  quizRedeemed: 10,
  /** Primer día de racha y cada día seguido que vuelve (×día, tope aparte). */
  dailyStreak: 25,
  /** Tope de XP por racha en un mismo día (evita farmear con rachas largas). */
  dailyStreakMax: 150,
  /** Por punto porcentual de MEJORA sobre el mejor puntaje previo del simulador. */
  simulatorPerPoint: 3,
  /** Certificarse en un curso (solo la primera vez por curso). */
  certification: 300,
  /** Cada nivel de mundo nuevo. */
  worldLevel: 60,
  /** Cada mundo completado por entero. */
  worldComplete: 400,
  /**
   * Fracción del XP original que paga REPASAR algo ya completado. Repasar suma —
   * si no, el aprendiz que ya terminó todo no tiene nada que ganar y desaparece —
   * pero nunca tanto como la primera vez.
   */
  reviewRate: 0.25,
  /**
   * Tope de XP de repaso por día (medido ANTES del multiplicador: en un día ×2 el
   * repaso puede rendir el doble, que es justo la gracia del evento). Sin tope,
   * un curso de 40 módulos se convierte en una máquina de XP.
   */
  reviewDailyCap: 300,
} as const;

/** XP de repaso para una recompensa base, redondeado a entero. */
export function reviewValue(base: number): number {
  return Math.max(1, Math.round(base * XP_REWARDS.reviewRate));
}

/**
 * Aplica el multiplicador del evento vigente y anuncia la ganancia a la capa de
 * animación. TODO el XP del store pasa por aquí: es el único punto donde existe
 * el ×2/×5, así que no hay forma de que una fuente se quede sin evento (ni de
 * que una animación muestre XP que no se acreditó).
 */
function boosted(base: number, reason: XPReason): number {
  if (base <= 0) return 0;
  const multiplier = currentXPMultiplier();
  const amount = Math.round(base * multiplier);
  pushXPGain({ amount, multiplier, reason });
  return amount;
}

/**
 * XP base de un módulo con el recorte por ritmo ya aplicado. El factor se acota
 * a [0.25, 1]: por muy de afán que se haya pasado, completar siempre paga algo
 * (si no, saldría a cuenta no marcarlo) y nunca puede pagar de más.
 */
export function moduleXP(xpFactor?: number): number {
  const f = typeof xpFactor === 'number' && Number.isFinite(xpFactor) ? xpFactor : 1;
  return Math.max(1, Math.round(XP_REWARDS.module * Math.min(1, Math.max(0.25, f))));
}

/** Estado inicial del subsistema de repaso (reutilizado por reset y migraciones). */
const REVIEW_INITIAL = {
  reviewedAt: {} as Record<string, string>,
  reviewXPDate: null as string | null,
  reviewXPToday: 0,
  courseReviewRound: {} as Record<string, string[]>,
  courseReviewCount: {} as Record<string, number>,
};

/** Resultado de intentar cobrar un repaso (lo consume la UI para animar/avisar). */
export interface ReviewOutcome {
  /** XP realmente acreditado (0 si no aplicaba). */
  xp: number;
  /** Multiplicador con el que se pagó. */
  multiplier: number;
  /** Bono extra por completar la vuelta entera al curso. */
  courseBonus: number;
  status:
    | 'granted'      // se pagó
    | 'not-completed'// no es repaso: el módulo aún no estaba completado
    | 'already-today'// ya se cobró hoy este módulo
    | 'capped';      // se agotó el tope diario de repaso
}

/** Almacén volátil para la vista previa: se comporta como localStorage pero no persiste. */
const memoryStorage: Storage = (() => {
  const map = new Map<string, string>();
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, v) },
  } as Storage;
})();

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
      reviewedAt: {},
      reviewXPDate: null,
      reviewXPToday: 0,
      courseReviewRound: {},
      courseReviewCount: {},

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

      markModule: (key, courseModules, opts) => {
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
          // El XP del módulo vive aquí, después del candado de arriba: así vale
          // una sola vez aunque la pantalla llame a completar dos veces. El
          // recorte por ritmo se aplica sobre la base, antes del evento del día:
          // así un día ×2 sigue duplicando lo que de verdad se ganó.
          xp: s.xp + boosted(moduleXP(opts?.xpFactor), 'module'),
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

      reviewedToday: (key) => {
        const s = get();
        const today = todayISO();
        return [key.uuid, key.slug].some((k) => !!k && s.reviewedAt[k] === today);
      },

      reviewModule: (key, opts) => {
        const s = get();
        const multiplier = currentXPMultiplier();
        const nil = (status: ReviewOutcome['status']): ReviewOutcome => ({
          xp: 0, multiplier, courseBonus: 0, status,
        });

        // Repaso es, por definición, volver sobre algo ya completado. Si no lo
        // está, esto no es un repaso: lo suyo es completarlo (markModule).
        if (!doneIn(s.completedModuleIds, s.completedModules, key)) return nil('not-completed');

        const today = todayISO();
        const keys = [key.uuid, key.slug].filter(Boolean) as string[];
        if (keys.some((k) => s.reviewedAt[k] === today)) return nil('already-today');

        // El tope se mide en XP BASE (sin evento): así un día ×2 rinde el doble
        // en vez de tocar el techo a la mitad de los módulos.
        const spent = s.reviewXPDate === today ? s.reviewXPToday : 0;
        const base = Math.min(reviewValue(XP_REWARDS.module), XP_REWARDS.reviewDailyCap - spent);
        if (base <= 0) return nil('capped');

        const gained = boosted(base, 'review');

        // Vuelta al curso: se acumulan los módulos repasados desde el último bono.
        const courseId = opts?.courseId ?? null;
        const courseModules = opts?.courseModules ?? [];
        let round = { ...s.courseReviewRound };
        let counts = s.courseReviewCount;
        let courseBonus = 0;
        let bonusBase = 0;
        if (courseId && courseModules.length > 0) {
          const seen = new Set(round[courseId] ?? []);
          for (const k of keys) seen.add(k);
          const allReviewed = courseModules.every((m) =>
            [m.uuid, m.slug].some((k) => !!k && seen.has(k)),
          );
          if (allReviewed) {
            // Curso repasado entero: se paga el equivalente a re-certificarse y
            // arranca una vuelta nueva. Para volver a cobrarlo hay que repasar
            // todos los módulos otra vez, no solo el último.
            //
            // El bono también consume el tope diario: si no, un curso de un solo
            // módulo pagaría el bono entero todos los días por un clic.
            bonusBase = Math.max(
              0,
              Math.min(
                reviewValue(XP_REWARDS.certification),
                XP_REWARDS.reviewDailyCap - spent - base,
              ),
            );
            courseBonus = boosted(bonusBase, 'review-course');
            round = { ...round, [courseId]: [] };
            counts = { ...counts, [courseId]: (counts[courseId] ?? 0) + 1 };
          } else {
            round = { ...round, [courseId]: [...seen] };
          }
        }

        const reviewedAt = { ...s.reviewedAt };
        for (const k of keys) reviewedAt[k] = today;

        set({
          reviewedAt,
          reviewXPDate: today,
          reviewXPToday: spent + base + bonusBase,
          courseReviewRound: round,
          courseReviewCount: counts,
          xp: s.xp + gained + courseBonus,
        });

        return { xp: gained, multiplier, courseBonus, status: 'granted' };
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
        const prevBest = bestSimScore(get().attempts);
        const attempts = [attempt, ...get().attempts].slice(0, 40);
        // Se paga la MEJORA, no el intento: repetir la misma simulación con el
        // mismo puntaje no da nada, superarse sí.
        const gain = boosted(
          Math.max(0, Math.round(attempt.score - prevBest)) * XP_REWARDS.simulatorPerPoint,
          'simulator',
        );
        set({ attempts, ...(gain > 0 ? { xp: get().xp + gain } : {}) });
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
        // Una sola vez al día (arriba se sale si `last === today`) y creciente con
        // la racha, hasta un tope: la constancia paga, pero no sustituye estudiar.
        const gain = boosted(
          Math.min(XP_REWARDS.dailyStreak * newStreak, XP_REWARDS.dailyStreakMax),
          'streak',
        );
        set({ streak: newStreak, lastActivityDate: today, xp: get().xp + gain });
        return get().evaluateBadges({ streak_days: newStreak });
      },

      awardBadge: (id) => {
        if (get().badges.includes(id)) return false;
        set({ badges: [...get().badges, id] });
        return true;
      },

      recordQuizResult: (correct, redeemed, moduleId) => {
        if (!correct) {
          // Un fallo reinicia la racha de aciertos; no otorga nada.
          set({ quizStreak: 0 });
          return [];
        }
        const s = get();
        const total = s.quizCorrectCount + 1;
        const streak = s.quizStreak + 1;
        const best = Math.max(s.quizBestStreak, streak);
        const redeemedCount = s.redeemedCount + (redeemed ? 1 : 0);

        // Si el módulo ya estaba completado, responder es REPASAR: tarifa
        // reducida y contra el mismo tope diario que el resto del repaso. Sin
        // esto, un módulo terminado seguía pagando aciertos a precio completo
        // cada vez que se abría — el agujero más grande de la economía.
        // `moduleId` puede ser UUID o slug: `doneIn` mira las dos listas.
        const isReview =
          !!moduleId && doneIn(s.completedModuleIds, s.completedModules, { uuid: moduleId, slug: moduleId });

        let gain: number;
        let reviewSpent = s.reviewXPToday;
        let reviewDate = s.reviewXPDate;
        if (isReview) {
          const today = todayISO();
          const spent = s.reviewXPDate === today ? s.reviewXPToday : 0;
          const wanted =
            reviewValue(XP_REWARDS.quizCorrect) + (redeemed ? reviewValue(XP_REWARDS.quizRedeemed) : 0);
          const base = Math.max(0, Math.min(wanted, XP_REWARDS.reviewDailyCap - spent));
          gain = boosted(base, 'review');
          reviewSpent = spent + base;
          reviewDate = today;
        } else {
          gain = boosted(XP_REWARDS.quizCorrect + (redeemed ? XP_REWARDS.quizRedeemed : 0), 'quiz');
        }

        set({
          quizCorrectCount: total,
          quizStreak: streak,
          quizBestStreak: best,
          redeemedCount,
          xp: s.xp + gain,
          ...(isReview ? { reviewXPDate: reviewDate, reviewXPToday: reviewSpent } : {}),
        });

        return get().evaluateBadges({
          quiz_correct_total: total,
          quiz_best_streak: best,
          redeemed_count: redeemedCount,
        });
      },

      recordCertification: (courseId, score) => {
        // Certificate.tsx llama a esto en cada visita al certificado: el XP solo
        // se paga si el curso no estaba ya en la lista.
        const isNew = !get().certifiedCourseIds.includes(courseId);
        const ids = isNew ? [...get().certifiedCourseIds, courseId] : get().certifiedCourseIds;
        const best = Math.max(get().bestCertScore, score ?? 0);
        set({
          certifiedCourseIds: ids,
          bestCertScore: best,
          ...(isNew ? { xp: get().xp + boosted(XP_REWARDS.certification, 'certification') } : {}),
        });
        return get().evaluateBadges({
          certifications: ids.length,
          best_cert_score: best,
        });
      },

      recordWorldProgress: (levelsCompleted, worldsCompleted) => {
        const prevLevels = get().worldLevelsCompleted;
        const prevWorlds = get().worldsCompleted;
        const levels = Math.max(prevLevels, levelsCompleted);
        const worlds = Math.max(prevWorlds, worldsCompleted ?? 0);
        // WorldMap/LearnerDashboard reportan el máximo observado en cada carga:
        // se paga solo el DELTA, así reabrir el mapa no regala XP.
        const gain = boosted(
          (levels - prevLevels) * XP_REWARDS.worldLevel +
            (worlds - prevWorlds) * XP_REWARDS.worldComplete,
          'world',
        );
        set({
          worldLevelsCompleted: levels,
          worldsCompleted: worlds,
          ...(gain > 0 ? { xp: get().xp + gain } : {}),
        });
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
          reviewedAt: {},
          reviewXPDate: null,
          reviewXPToday: 0,
          courseReviewRound: {},
          courseReviewCount: {},
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

      mergeFromTab: (incoming) => {
        const s = get();
        const union = (a: string[] = [], b: string[] = []) => [...new Set([...a, ...b])];
        const maxOf = (a: number, b: number | undefined) => Math.max(a, b ?? 0);

        // Respuestas de quiz: se unen por módulo y, dentro de cada módulo, gana la
        // entrada de la otra pestaña solo para preguntas que aquí no se han tocado.
        const checkAnswers: ProgressState['checkAnswers'] = { ...s.checkAnswers };
        for (const [moduleKey, answers] of Object.entries(incoming.checkAnswers ?? {})) {
          checkAnswers[moduleKey] = { ...answers, ...(s.checkAnswers[moduleKey] ?? {}) };
        }

        // Intentos del simulador: unión por id, ordenados por fecha.
        const byId = new Map(s.attempts.map((a) => [a.id, a]));
        for (const a of incoming.attempts ?? []) if (!byId.has(a.id)) byId.set(a.id, a);
        const attempts = [...byId.values()].sort((a, b) => a.date - b.date);

        const next: Partial<ProgressState> = {
          completedModuleIds: union(s.completedModuleIds, incoming.completedModuleIds),
          completedModules: union(s.completedModules, incoming.completedModules),
          badges: union(s.badges, incoming.badges),
          certifiedCourseIds: union(s.certifiedCourseIds, incoming.certifiedCourseIds),
          moduleSlugToId: { ...incoming.moduleSlugToId, ...s.moduleSlugToId },
          reviewedAt: { ...incoming.reviewedAt, ...s.reviewedAt },
          courseReviewRound: { ...incoming.courseReviewRound, ...s.courseReviewRound },
          courseReviewCount: { ...incoming.courseReviewCount, ...s.courseReviewCount },
          checkAnswers,
          attempts,
          xp: maxOf(s.xp, incoming.xp),
          streak: maxOf(s.streak, incoming.streak),
          quizCorrectCount: maxOf(s.quizCorrectCount, incoming.quizCorrectCount),
          quizBestStreak: maxOf(s.quizBestStreak, incoming.quizBestStreak),
          redeemedCount: maxOf(s.redeemedCount, incoming.redeemedCount),
          bestCertScore: maxOf(s.bestCertScore, incoming.bestCertScore),
          worldLevelsCompleted: maxOf(s.worldLevelsCompleted, incoming.worldLevelsCompleted),
          worldsCompleted: maxOf(s.worldsCompleted, incoming.worldsCompleted),
          lastActivityDate:
            !s.lastActivityDate || (incoming.lastActivityDate ?? '') > s.lastActivityDate
              ? (incoming.lastActivityDate ?? s.lastActivityDate)
              : s.lastActivityDate,
        };

        // El tope diario de XP por repaso es un contador de HOY: si la otra
        // pestaña ya gastó más, hay que respetarlo o se farmearía abriendo
        // pestañas. Solo aplica si ambas hablan del mismo día.
        if (incoming.reviewXPDate && incoming.reviewXPDate === s.reviewXPDate) {
          next.reviewXPToday = maxOf(s.reviewXPToday, incoming.reviewXPToday);
        } else if (incoming.reviewXPDate && !s.reviewXPDate) {
          next.reviewXPDate = incoming.reviewXPDate;
          next.reviewXPToday = incoming.reviewXPToday ?? 0;
        }

        // CRÍTICO: si nada cambió, no escribir. Cada `set` hace que `persist`
        // reescriba el localStorage, lo que dispara el evento `storage` en la
        // otra pestaña, que volvería a fusionar y a escribir… un ping-pong
        // infinito entre las dos. Como la fusión es aditiva y conmutativa,
        // basta con detenerse cuando ya no aporta nada nuevo.
        const changed =
          next.completedModuleIds!.length !== s.completedModuleIds.length ||
          next.completedModules!.length !== s.completedModules.length ||
          next.badges!.length !== s.badges.length ||
          next.certifiedCourseIds!.length !== s.certifiedCourseIds.length ||
          next.attempts!.length !== s.attempts.length ||
          next.xp !== s.xp ||
          next.streak !== s.streak ||
          next.quizCorrectCount !== s.quizCorrectCount ||
          next.quizBestStreak !== s.quizBestStreak ||
          next.redeemedCount !== s.redeemedCount ||
          next.bestCertScore !== s.bestCertScore ||
          next.worldLevelsCompleted !== s.worldLevelsCompleted ||
          next.worldsCompleted !== s.worldsCompleted ||
          next.lastActivityDate !== s.lastActivityDate ||
          (next.reviewXPToday !== undefined && next.reviewXPToday !== s.reviewXPToday) ||
          (next.reviewXPDate !== undefined && next.reviewXPDate !== s.reviewXPDate) ||
          JSON.stringify(next.checkAnswers) !== JSON.stringify(s.checkAnswers) ||
          JSON.stringify(next.moduleSlugToId) !== JSON.stringify(s.moduleSlugToId) ||
          JSON.stringify(next.reviewedAt) !== JSON.stringify(s.reviewedAt) ||
          JSON.stringify(next.courseReviewRound) !== JSON.stringify(s.courseReviewRound) ||
          JSON.stringify(next.courseReviewCount) !== JSON.stringify(s.courseReviewCount);

        if (changed) set(next);
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
      // Vista previa del capacitador: el progreso vive en memoria y muere al
      // cerrar el modal. El iframe comparte el localStorage de la pestaña, así
      // que sin esto responder un quiz en la vista previa le sumaba XP de verdad
      // al capacitador (y useProgressSync lo espejaba a BD). Ver previewMode.ts.
      ...(IS_LEARNER_PREVIEW ? { storage: createJSONStorage(() => memoryStorage) } : {}),
      version: 8,
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
        // v7: economía de XP ampliada + curva de niveles más larga. Sin esto, un
        // aprendiz veterano bajaría de nivel de golpe: su XP viejo solo contaba
        // módulos (100 c/u) y los umbrales nuevos son mucho más altos. Se le
        // re-acredita lo que ya había hecho con las tarifas nuevas y se toma el
        // máximo, nunca menos de lo que tenía.
        if (version < 7) {
          const s = state;
          const modules = Math.max(
            s.completedModuleIds?.length ?? 0,
            s.completedModules?.length ?? 0,
          );
          const rebaselined =
            modules * XP_REWARDS.module +
            (s.quizCorrectCount ?? 0) * XP_REWARDS.quizCorrect +
            (s.redeemedCount ?? 0) * XP_REWARDS.quizRedeemed +
            (s.certifiedCourseIds?.length ?? 0) * XP_REWARDS.certification +
            (s.worldLevelsCompleted ?? 0) * XP_REWARDS.worldLevel +
            (s.worldsCompleted ?? 0) * XP_REWARDS.worldComplete;
          return {
            ...s,
            xp: Math.max(s.xp ?? 0, rebaselined),
            ...REVIEW_INITIAL,
          } as Partial<ProgressState>;
        }
        // v8: repaso con XP. Los contadores nacen vacíos a propósito: el primer
        // repaso después de actualizar paga, aunque el aprendiz ya hubiera vuelto
        // al módulo antes (no hay historia que reconstruir y regalar un cobro es
        // mejor que castigar por actualizar).
        if (version < 8) {
          return { ...state, ...REVIEW_INITIAL } as Partial<ProgressState>;
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
