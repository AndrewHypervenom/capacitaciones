import { create } from 'zustand';

// ─────────────────────────────────────────────────────────────────────────────
// Gamificación configurable: definiciones de logros (insignias) y niveles de XP.
//
// Antes vivían hardcodeados en progressStore.ts. Ahora son *datos* editables por
// el superadmin (tabla achievement_defs / xp_levels) y se cargan a este store.
// Si la BD aún no responde o está vacía, se usan los DEFAULTS de abajo, que son
// exactamente los 17 logros y 4 niveles originales: nada se rompe sin la BD.
//
// El "motor de reglas": cada logro se otorga cuando una MÉTRICA del aprendiz
// alcanza un UMBRAL (operador implícito ≥). El vocabulario de métricas es fijo
// (lo que el sistema sabe medir); el superadmin combina métrica + umbral + texto
// para crear logros nuevos sin tocar código.
// ─────────────────────────────────────────────────────────────────────────────

export type Lang = 'es' | 'en' | 'pt';

export type BadgeCategory =
  | 'progress'
  | 'streak'
  | 'excellence'
  | 'certification'
  | 'optional';

/** Vocabulario de métricas que el motor sabe medir sobre el aprendiz. */
export type BadgeMetric =
  | 'modules_completed'      // módulos completados (total)
  | 'course_progress_pct'    // % de avance máximo en un curso
  | 'courses_completed'      // cursos completados por entero
  | 'all_assigned_completed' // 1 si completó TODOS sus cursos asignados
  | 'streak_days'            // días seguidos aprendiendo
  | 'quiz_correct_total'     // aciertos acumulados en quizzes
  | 'quiz_best_streak'       // mejor racha de aciertos seguidos
  | 'redeemed_count'         // preguntas falladas y luego acertadas (redención)
  | 'certifications'         // certificaciones de curso obtenidas
  | 'best_cert_score'        // mejor puntaje de certificación (%)
  | 'best_simulator_score'   // mejor puntaje en una simulación (%)
  | 'world_levels_completed' // niveles completados en mundos
  | 'worlds_completed';      // mundos completados por entero

export interface BadgeDef {
  id: string;
  emoji: string;
  category: BadgeCategory;
  /** Métrica que dispara el logro. */
  metric: BadgeMetric;
  /** Umbral: se otorga cuando métrica ≥ threshold. */
  threshold: number;
  /** Logro poco común (excelencia/constancia): se resalta con ⭐. */
  rare?: boolean;
  /** Si está, solo se muestra como meta cuando la función existe o ya se ganó. */
  requires?: 'world' | 'simulator';
  /** Deshabilitado: no se otorga ni se muestra. */
  enabled?: boolean;
  /** Semilla de fábrica: no se puede borrar (sí deshabilitar/editar). */
  builtin?: boolean;
  sort?: number;
  // Textos por idioma (label_es es obligatorio; en/pt caen a es).
  label: string;          // es
  label_en?: string;
  label_pt?: string;
  description: string;    // es
  description_en?: string;
  description_pt?: string;
}

export interface XPLevel {
  level: number;
  label: string;      // es
  label_en?: string;
  label_pt?: string;
  minXP: number;
  maxXP: number;
  color: string;
}

// ── Metadatos de métricas: rótulo y unidad para la UI de administración ──
export interface MetricMeta {
  metric: BadgeMetric;
  label: string;        // es
  label_en: string;
  label_pt: string;
  /** Formato del umbral: cantidad, porcentaje o booleano (1 = sí). */
  unit: 'count' | 'percent' | 'bool';
  /** Categoría sugerida (solo ayuda visual). */
  hint: BadgeCategory;
}

export const METRIC_META: MetricMeta[] = [
  { metric: 'modules_completed',      label: 'Módulos completados',        label_en: 'Modules completed',        label_pt: 'Módulos concluídos',        unit: 'count',   hint: 'progress' },
  { metric: 'course_progress_pct',    label: 'Avance en un curso',         label_en: 'Course progress',          label_pt: 'Progresso do curso',        unit: 'percent', hint: 'progress' },
  { metric: 'courses_completed',      label: 'Cursos completados',         label_en: 'Courses completed',        label_pt: 'Cursos concluídos',         unit: 'count',   hint: 'progress' },
  { metric: 'all_assigned_completed', label: 'Completó todos los cursos',  label_en: 'Completed all courses',    label_pt: 'Concluiu todos os cursos',  unit: 'bool',    hint: 'progress' },
  { metric: 'streak_days',            label: 'Días seguidos (racha)',      label_en: 'Day streak',               label_pt: 'Dias seguidos',             unit: 'count',   hint: 'streak' },
  { metric: 'quiz_correct_total',     label: 'Aciertos totales',           label_en: 'Total correct answers',    label_pt: 'Acertos totais',            unit: 'count',   hint: 'excellence' },
  { metric: 'quiz_best_streak',       label: 'Aciertos seguidos',          label_en: 'Correct in a row',         label_pt: 'Acertos seguidos',          unit: 'count',   hint: 'excellence' },
  { metric: 'redeemed_count',         label: 'Redenciones (fallo→acierto)',label_en: 'Redemptions (miss→hit)',   label_pt: 'Redenções (erro→acerto)',   unit: 'count',   hint: 'excellence' },
  { metric: 'certifications',         label: 'Certificaciones',            label_en: 'Certifications',           label_pt: 'Certificações',             unit: 'count',   hint: 'certification' },
  { metric: 'best_cert_score',        label: 'Mejor puntaje de cert.',     label_en: 'Best certification score', label_pt: 'Melhor nota de cert.',      unit: 'percent', hint: 'certification' },
  { metric: 'best_simulator_score',   label: 'Mejor puntaje de simulador', label_en: 'Best simulator score',     label_pt: 'Melhor nota do simulador',  unit: 'percent', hint: 'optional' },
  { metric: 'world_levels_completed', label: 'Niveles de mundo',           label_en: 'World levels',             label_pt: 'Níveis de mundo',           unit: 'count',   hint: 'optional' },
  { metric: 'worlds_completed',       label: 'Mundos completados',         label_en: 'Worlds completed',         label_pt: 'Mundos concluídos',         unit: 'count',   hint: 'optional' },
];

export function metricMeta(metric: BadgeMetric): MetricMeta {
  return METRIC_META.find((m) => m.metric === metric) ?? METRIC_META[0];
}

export function metricLabel(metric: BadgeMetric, lang: Lang): string {
  const m = metricMeta(metric);
  return lang === 'en' ? m.label_en : lang === 'pt' ? m.label_pt : m.label;
}

// ─── DEFAULTS de fábrica (equivalen a los 17 logros originales) ───────────────

export const DEFAULT_BADGE_DEFS: BadgeDef[] = [
  // ── Progreso (universales) ──
  { id: 'first-module',    category: 'progress',      metric: 'modules_completed',      threshold: 1,  emoji: '🌱', builtin: true, enabled: true, sort: 10, label: 'Primer Paso',         label_en: 'First Step',      label_pt: 'Primeiro Passo',    description: 'Completa tu primer módulo',            description_en: 'Complete your first module',        description_pt: 'Complete seu primeiro módulo' },
  { id: 'halfway',         category: 'progress',      metric: 'course_progress_pct',    threshold: 50, emoji: '⚡', builtin: true, enabled: true, sort: 20, label: 'A Mitad de Camino',   label_en: 'Halfway There',   label_pt: 'Na Metade do Caminho', description: 'Completa la mitad de un curso',     description_en: 'Complete half of a course',         description_pt: 'Complete metade de um curso' },
  { id: 'course-complete', category: 'progress',      metric: 'courses_completed',      threshold: 1,  emoji: '🎓', builtin: true, enabled: true, sort: 30, label: 'Curso Terminado',     label_en: 'Course Complete', label_pt: 'Curso Concluído',   description: 'Completa un curso entero',             description_en: 'Complete a whole course',           description_pt: 'Complete um curso inteiro' },
  { id: 'all-modules',     category: 'progress',      metric: 'all_assigned_completed', threshold: 1,  emoji: '🏆', builtin: true, enabled: true, sort: 40, label: 'Maestría Total',      label_en: 'Total Mastery',   label_pt: 'Maestria Total',    description: 'Completa todos tus cursos asignados',  description_en: 'Complete all your assigned courses', description_pt: 'Conclua todos os seus cursos' },
  // ── Constancia (rachas) ──
  { id: 'streak-3',        category: 'streak',        metric: 'streak_days',            threshold: 3,  emoji: '🔥', builtin: true, enabled: true, sort: 50, label: 'En Racha',            label_en: 'On a Roll',       label_pt: 'Em Sequência',      description: '3 días seguidos aprendiendo',          description_en: '3 days in a row learning',          description_pt: '3 dias seguidos aprendendo' },
  { id: 'streak-7',        category: 'streak',        metric: 'streak_days',            threshold: 7,  emoji: '💫', builtin: true, enabled: true, sort: 60, label: 'Imparable',           label_en: 'Unstoppable',     label_pt: 'Imparável',         description: '7 días seguidos aprendiendo',          description_en: '7 days in a row learning',          description_pt: '7 dias seguidos aprendendo' },
  { id: 'streak-30',       category: 'streak',        metric: 'streak_days',            threshold: 30, emoji: '🗓️', builtin: true, enabled: true, sort: 70, rare: true, label: 'Constancia de Hierro', label_en: 'Iron Streak',   label_pt: 'Constância de Ferro', description: '30 días seguidos aprendiendo',       description_en: '30 days in a row learning',         description_pt: '30 dias seguidos aprendendo' },
  // ── Excelencia (desempeño) ──
  { id: 'quiz-ace',        category: 'excellence',    metric: 'quiz_correct_total',     threshold: 10, emoji: '🧠', builtin: true, enabled: true, sort: 80, label: 'Mente Brillante',     label_en: 'Bright Mind',     label_pt: 'Mente Brilhante',   description: 'Acierta 10 preguntas en total',        description_en: 'Answer 10 questions correctly',     description_pt: 'Acerte 10 perguntas no total' },
  { id: 'perfect-run',     category: 'excellence',    metric: 'quiz_best_streak',       threshold: 10, emoji: '🎯', builtin: true, enabled: true, sort: 90, label: 'Puntería Perfecta',   label_en: 'Perfect Aim',     label_pt: 'Pontaria Perfeita', description: '10 aciertos seguidos sin fallar',      description_en: '10 correct answers in a row',       description_pt: '10 acertos seguidos sem errar' },
  { id: 'flawless',        category: 'excellence',    metric: 'quiz_best_streak',       threshold: 25, emoji: '✨', builtin: true, enabled: true, sort: 100, rare: true, label: 'Sin un Error',       label_en: 'Flawless',        label_pt: 'Sem Erros',         description: '25 aciertos seguidos sin fallar',      description_en: '25 correct answers in a row',       description_pt: '25 acertos seguidos sem errar' },
  { id: 'comeback',        category: 'excellence',    metric: 'redeemed_count',         threshold: 1,  emoji: '🔁', builtin: true, enabled: true, sort: 110, label: 'Segunda Oportunidad', label_en: 'Second Chance',   label_pt: 'Segunda Chance',    description: 'Falla una pregunta y acértala al reintentar', description_en: 'Miss a question and get it right on retry', description_pt: 'Erre uma pergunta e acerte na nova tentativa' },
  // ── Certificación ──
  { id: 'certified',       category: 'certification', metric: 'certifications',         threshold: 1,  emoji: '📜', builtin: true, enabled: true, sort: 120, label: 'Certificado',        label_en: 'Certified',       label_pt: 'Certificado',       description: 'Obtén tu primera certificación de curso', description_en: 'Earn your first course certification', description_pt: 'Obtenha sua primeira certificação' },
  { id: 'honor-roll',      category: 'certification', metric: 'best_cert_score',        threshold: 95, emoji: '🏅', builtin: true, enabled: true, sort: 130, rare: true, label: 'Cuadro de Honor',    label_en: 'Honor Roll',      label_pt: 'Quadro de Honra',   description: 'Certifícate con 95% o más',            description_en: 'Certify with 95% or more',          description_pt: 'Certifique-se com 95% ou mais' },
  // ── Funciones opcionales (condicionales) ──
  { id: 'simulator-ace',   category: 'optional',      metric: 'best_simulator_score',   threshold: 85, emoji: '🎧', builtin: true, enabled: true, sort: 140, requires: 'simulator', label: 'As del Simulador', label_en: 'Simulator Ace', label_pt: 'Ás do Simulador', description: 'Resuelve una simulación con 85% o más', description_en: 'Solve a simulation with 85% or more', description_pt: 'Resolva uma simulação com 85% ou mais' },
  { id: 'world-explorer',  category: 'optional',      metric: 'world_levels_completed', threshold: 1,  emoji: '🗺️', builtin: true, enabled: true, sort: 150, requires: 'world', label: 'Explorador',         label_en: 'Explorer',        label_pt: 'Explorador',        description: 'Completa tu primer nivel en un mundo', description_en: 'Complete your first level in a world', description_pt: 'Complete seu primeiro nível em um mundo' },
  { id: 'world-conqueror', category: 'optional',      metric: 'worlds_completed',       threshold: 1,  emoji: '👑', builtin: true, enabled: true, sort: 160, rare: true, requires: 'world', label: 'Conquistador',     label_en: 'Conqueror',       label_pt: 'Conquistador',      description: 'Completa un mundo entero',             description_en: 'Complete a whole world',            description_pt: 'Complete um mundo inteiro' },
];

export const DEFAULT_XP_LEVELS: XPLevel[] = [
  { level: 1, label: 'Novato',   label_en: 'Novice',     label_pt: 'Novato',       minXP: 0,    maxXP: 300,  color: '#888' },
  { level: 2, label: 'Aprendiz', label_en: 'Apprentice', label_pt: 'Aprendiz',     minXP: 300,  maxXP: 800,  color: '#10D451' },
  { level: 3, label: 'Experto',  label_en: 'Expert',     label_pt: 'Especialista', minXP: 800,  maxXP: 1500, color: '#7c3aed' },
  { level: 4, label: 'Maestro',  label_en: 'Master',     label_pt: 'Mestre',       minXP: 1500, maxXP: 9999, color: '#f59e0b' },
];

// ─── Resolvers de texto por idioma ────────────────────────────────────────────

export function badgeLabel(def: BadgeDef, lang: Lang): string {
  if (lang === 'en') return def.label_en || def.label;
  if (lang === 'pt') return def.label_pt || def.label;
  return def.label;
}

export function badgeDescription(def: BadgeDef, lang: Lang): string {
  if (lang === 'en') return def.description_en || def.description;
  if (lang === 'pt') return def.description_pt || def.description;
  return def.description;
}

export function xpLevelLabel(lvl: XPLevel, lang: Lang): string {
  if (lang === 'en') return lvl.label_en || lvl.label;
  if (lang === 'pt') return lvl.label_pt || lvl.label;
  return lvl.label;
}

// ─── Cálculo de nivel de XP (lee la config activa por defecto) ────────────────

export function getXPLevel(xp: number, levels?: XPLevel[]): XPLevel {
  const list = (levels ?? useGamificationStore.getState().xpLevels)
    .slice()
    .sort((a, b) => a.minXP - b.minXP);
  return [...list].reverse().find((l) => xp >= l.minXP) ?? list[0];
}

export function getXPProgress(xp: number, levels?: XPLevel[]): number {
  const list = (levels ?? useGamificationStore.getState().xpLevels)
    .slice()
    .sort((a, b) => a.minXP - b.minXP);
  const lvl = getXPLevel(xp, list);
  if (lvl.level === list[list.length - 1]?.level) return 1;
  const span = lvl.maxXP - lvl.minXP;
  if (span <= 0) return 1;
  return Math.min(1, (xp - lvl.minXP) / span);
}

// ─── Store: config viva de gamificación ───────────────────────────────────────

interface GamificationState {
  badgeDefs: BadgeDef[];
  xpLevels: XPLevel[];
  loaded: boolean;
  loading: boolean;
  setBadgeDefs: (defs: BadgeDef[]) => void;
  setXPLevels: (levels: XPLevel[]) => void;
}

export const useGamificationStore = create<GamificationState>((set) => ({
  badgeDefs: DEFAULT_BADGE_DEFS,
  xpLevels: DEFAULT_XP_LEVELS,
  loaded: false,
  loading: false,
  setBadgeDefs: (defs) =>
    set({ badgeDefs: [...defs].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)) }),
  setXPLevels: (levels) =>
    set({ xpLevels: [...levels].sort((a, b) => a.minXP - b.minXP) }),
}));

/** Solo las insignias habilitadas, en orden. */
export function activeBadgeDefs(): BadgeDef[] {
  return useGamificationStore
    .getState()
    .badgeDefs.filter((b) => b.enabled !== false)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}
