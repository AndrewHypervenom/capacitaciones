import type { Scenario } from '@/data/scenarios';
import type { SimState } from './simulator';

export interface Score {
  score: number;
  durationSec: number;
  checklistPct: number;
  empathyPct: number;
  resolved: boolean;
}

export function scoreRun(state: SimState, scenario: Scenario): Score {
  const checklistPct = state.completedChecklist.size / scenario.checklist.length;
  const empathyPct = Math.min(1, state.empathyHits / 4);
  const resolved = state.outcome === 'resolved';

  const score = Math.round(
    (checklistPct * 0.55 + empathyPct * 0.2 + (resolved ? 0.25 : 0)) * 100,
  );
  const durationSec = Math.max(
    1,
    Math.round(((state.endedAt ?? Date.now()) - state.startedAt) / 1000),
  );

  return { score, durationSec, checklistPct, empathyPct, resolved };
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
