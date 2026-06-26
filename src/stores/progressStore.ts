import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

// ─── Badge definitions ─────────────────────────────────────────

export interface BadgeDef {
  id: string;
  emoji: string;
  label: string;
  description: string;
}

export const BADGE_DEFS: BadgeDef[] = [
  { id: 'first-module',        emoji: '🎯', label: 'Primer Paso',         description: 'Completa tu primer módulo' },
  { id: 'halfway',             emoji: '⚡', label: 'A Mitad de Camino',    description: 'Completa la mitad de los módulos' },
  { id: 'all-modules',         emoji: '🏆', label: 'Maestro Completo',     description: 'Completa todos los módulos' },
  { id: 'streak-3',            emoji: '🔥', label: 'En Racha',             description: '3 días consecutivos de aprendizaje' },
  { id: 'streak-7',            emoji: '💫', label: 'Imparable',            description: '7 días consecutivos de aprendizaje' },
  { id: 'simulator-unlocked',  emoji: '📞', label: 'Simulador Desbloqueado', description: 'Desbloquea el simulador de llamadas' },
  { id: 'quiz-ace',            emoji: '🧠', label: 'Mente Brillante',      description: 'Responde 5 quizzes correctamente' },
];

// ─── XP level tiers ───────────────────────────────────────────

export interface XPLevel {
  level: number;
  label: string;
  minXP: number;
  maxXP: number;
  color: string;
}

export const XP_LEVELS: XPLevel[] = [
  { level: 1, label: 'Novato',    minXP: 0,    maxXP: 300,  color: '#888' },
  { level: 2, label: 'Aprendiz',  minXP: 300,  maxXP: 800,  color: '#00c228' },
  { level: 3, label: 'Experto',   minXP: 800,  maxXP: 1500, color: '#7c3aed' },
  { level: 4, label: 'Maestro',   minXP: 1500, maxXP: 9999, color: '#f59e0b' },
];

export function getXPLevel(xp: number): XPLevel {
  return [...XP_LEVELS].reverse().find((l) => xp >= l.minXP) ?? XP_LEVELS[0];
}

export function getXPProgress(xp: number): number {
  const lvl = getXPLevel(xp);
  if (lvl.level === XP_LEVELS.length) return 1;
  return Math.min(1, (xp - lvl.minXP) / (lvl.maxXP - lvl.minXP));
}

// ─── Store ────────────────────────────────────────────────────

interface ProgressState {
  completedModules: string[];
  attempts: SimulatorAttempt[];
  checkAnswers: Record<string, Record<number, number>>;
  xp: number;
  streak: number;
  lastActivityDate: string | null;
  badges: string[];
  quizCorrectCount: number;
  markModule: (id: string, totalModules?: number) => string[];
  unmarkModule: (id: string) => void;
  recordCheck: (moduleId: string, sectionIdx: number, optionIdx: number) => void;
  addAttempt: (attempt: SimulatorAttempt) => void;
  earnXP: (amount: number) => void;
  updateStreak: () => void;
  awardBadge: (id: string) => boolean;
  recordQuizCorrect: () => string[];
  recheckBadges: (modules: { id: string }[]) => string[];
  reset: () => void;
}

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
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

      markModule: (id, totalModules) => {
        if (get().completedModules.includes(id)) return [];
        const next = [...get().completedModules, id];
        set({ completedModules: next });
        const newBadges: string[] = [];

        if (next.length === 1) {
          if (get().awardBadge('first-module')) newBadges.push('first-module');
        }
        if (totalModules && next.length >= Math.ceil(totalModules / 2)) {
          if (get().awardBadge('halfway')) newBadges.push('halfway');
        }
        if (totalModules && next.length >= totalModules) {
          if (get().awardBadge('all-modules')) newBadges.push('all-modules');
        }
        if (next.length >= SIMULATOR_UNLOCK_THRESHOLD) {
          if (get().awardBadge('simulator-unlocked')) newBadges.push('simulator-unlocked');
        }
        return newBadges;
      },

      unmarkModule: (id) =>
        set({ completedModules: get().completedModules.filter((m) => m !== id) }),

      recordCheck: (moduleId, sectionIdx, optionIdx) =>
        set({
          checkAnswers: {
            ...get().checkAnswers,
            [moduleId]: {
              ...(get().checkAnswers[moduleId] ?? {}),
              [sectionIdx]: optionIdx,
            },
          },
        }),

      addAttempt: (attempt) => set({ attempts: [attempt, ...get().attempts].slice(0, 40) }),

      earnXP: (amount) => set({ xp: get().xp + amount }),

      updateStreak: () => {
        const today = todayISO();
        const last = get().lastActivityDate;
        if (last === today) return;

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

        const newBadges: string[] = [];
        if (newStreak >= 3 && get().awardBadge('streak-3')) newBadges.push('streak-3');
        if (newStreak >= 7 && get().awardBadge('streak-7')) newBadges.push('streak-7');
        return newBadges;
      },

      awardBadge: (id) => {
        if (get().badges.includes(id)) return false;
        set({ badges: [...get().badges, id] });
        return true;
      },

      recordQuizCorrect: () => {
        const next = get().quizCorrectCount + 1;
        set({ quizCorrectCount: next });
        const newBadges: string[] = [];
        if (next >= 5 && get().awardBadge('quiz-ace')) newBadges.push('quiz-ace');
        return newBadges;
      },

      recheckBadges: (modules) => {
        const state = get();
        const completed = state.completedModules.filter((id) => modules.some((m) => m.id === id));
        const newBadges: string[] = [];

        if (completed.length >= 1 && get().awardBadge('first-module')) newBadges.push('first-module');
        if (modules.length > 0 && completed.length >= Math.ceil(modules.length / 2) && get().awardBadge('halfway')) newBadges.push('halfway');
        if (modules.length > 0 && completed.length >= modules.length && get().awardBadge('all-modules')) newBadges.push('all-modules');
        if (state.completedModules.length >= SIMULATOR_UNLOCK_THRESHOLD && get().awardBadge('simulator-unlocked')) newBadges.push('simulator-unlocked');
        if (state.streak >= 3 && get().awardBadge('streak-3')) newBadges.push('streak-3');
        if (state.streak >= 7 && get().awardBadge('streak-7')) newBadges.push('streak-7');
        if (state.quizCorrectCount >= 5 && get().awardBadge('quiz-ace')) newBadges.push('quiz-ace');

        return newBadges;
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
        }),
    }),
    {
      name: 'learningai.progress',
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState as Partial<ProgressState>) ?? {};
        if (version < 2) {
          return {
            completedModules: state.completedModules ?? [],
            attempts: state.attempts ?? [],
            checkAnswers: {},
            xp: 0, streak: 0, lastActivityDate: null, badges: [], quizCorrectCount: 0,
          } as Partial<ProgressState>;
        }
        if (version < 3) {
          return {
            ...state,
            xp: 0, streak: 0, lastActivityDate: null, badges: [], quizCorrectCount: 0,
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
