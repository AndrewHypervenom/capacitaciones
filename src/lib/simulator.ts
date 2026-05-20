import type { Scenario, DialogueNode } from '@/data/scenarios';
import { containsAny, countMatches } from './normalize';

export interface Message {
  id: string;
  from: 'customer' | 'agent' | 'system';
  text: string;
  at: number;
}

export interface SimState {
  scenarioId: string;
  language: 'es' | 'en' | 'pt';
  currentNodeId: string;
  turns: number;
  messages: Message[];
  completedChecklist: Set<string>;
  empathyHits: number;
  startedAt: number;
  endedAt?: number;
  outcome?: 'resolved' | 'unresolved';
}

let uidCounter = 0;
const uid = () => `${Date.now().toString(36)}-${(uidCounter++).toString(36)}`;

export function startSim(scenario: Scenario, language: 'es' | 'en' | 'pt'): SimState {
  const startNode = scenario.nodes[scenario.start];
  return {
    scenarioId: scenario.id,
    language,
    currentNodeId: scenario.start,
    turns: 0,
    startedAt: Date.now(),
    completedChecklist: new Set<string>(),
    empathyHits: 0,
    messages: [
      {
        id: uid(),
        from: 'customer',
        text: startNode.customerLine[language],
        at: Date.now(),
      },
    ],
  };
}

export function stepSim(
  state: SimState,
  scenario: Scenario,
  agentText: string,
  language: 'es' | 'en' | 'pt',
): SimState {
  if (state.endedAt) return state;

  const agentMsg: Message = {
    id: uid(),
    from: 'agent',
    text: agentText,
    at: Date.now(),
  };

  const node: DialogueNode = scenario.nodes[state.currentNodeId];

  const completedChecklist = new Set(state.completedChecklist);
  for (const item of scenario.checklist) {
    if (!completedChecklist.has(item.id) && containsAny(agentText, item.keywords)) {
      completedChecklist.add(item.id);
    }
  }

  const empathyDelta = countMatches(agentText, scenario.empathyKeywords);
  const empathyHits = state.empathyHits + empathyDelta;

  let nextNodeId = state.currentNodeId;
  for (const branch of node.branches) {
    if (containsAny(agentText, branch.keywords)) {
      nextNodeId = branch.next;
      break;
    }
  }
  if (nextNodeId === state.currentNodeId && node.fallback) {
    nextNodeId = node.fallback;
  }

  const nextNode = scenario.nodes[nextNodeId];
  const customerMsg: Message = {
    id: uid(),
    from: 'customer',
    text: nextNode.customerLine[language],
    at: Date.now() + 200,
  };

  const turns = state.turns + 1;
  const isTerminal = Boolean(nextNode.terminal);
  const outOfTurns = turns >= scenario.maxTurns;

  return {
    ...state,
    currentNodeId: nextNodeId,
    turns,
    messages: [...state.messages, agentMsg, customerMsg],
    completedChecklist,
    empathyHits,
    endedAt: isTerminal || outOfTurns ? Date.now() : undefined,
    outcome: isTerminal
      ? nextNode.terminal
      : outOfTurns
        ? 'unresolved'
        : undefined,
  };
}

export function endSim(state: SimState): SimState {
  if (state.endedAt) return state;
  return {
    ...state,
    endedAt: Date.now(),
    outcome: state.outcome ?? 'unresolved',
  };
}
