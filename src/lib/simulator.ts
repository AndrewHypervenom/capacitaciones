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
  /**
   * El cliente ya señaló el cierre de la llamada, pero NO se termina aún: se
   * deja un turno más para que el agente se despida y pueda sumar el check de
   * cierre. El siguiente turno con cierre (o el fin de turnos) sí la termina.
   */
  awaitingClose?: boolean;
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

  // Cierre en dos tiempos: si el guion llega a un nodo terminal, primero dejamos
  // que el agente se despida (awaitingClose) y solo en el turno siguiente se
  // termina de verdad. Quedarse sin turnos sí corta de inmediato.
  let ended: boolean;
  let awaitingClose: boolean;
  if (outOfTurns) {
    ended = true;
    awaitingClose = false;
  } else if (isTerminal) {
    if (state.awaitingClose) {
      ended = true;
      awaitingClose = false;
    } else {
      ended = false;
      awaitingClose = true;
    }
  } else {
    ended = false;
    awaitingClose = false;
  }

  return {
    ...state,
    currentNodeId: nextNodeId,
    turns,
    messages: [...state.messages, agentMsg, customerMsg],
    completedChecklist,
    empathyHits,
    awaitingClose,
    endedAt: ended ? Date.now() : undefined,
    outcome: ended ? (isTerminal ? nextNode.terminal : 'unresolved') : undefined,
  };
}

/**
 * Aplica al estado un turno resuelto por la IA (Groq): agrega el mensaje del
 * agente y la respuesta libre del cliente, fusiona los checks satisfechos
 * (evaluación semántica, no por palabras clave) y actualiza empatía/cierre.
 */
export function applyTurn(
  state: SimState,
  scenario: Scenario,
  agentText: string,
  result: {
    reply: string
    satisfied: string[]
    empathyDelta: number
    resolved: boolean
    ended: boolean
  },
): SimState {
  if (state.endedAt) return state;

  const agentMsg: Message = { id: uid(), from: 'agent', text: agentText, at: Date.now() };
  const customerMsg: Message = { id: uid(), from: 'customer', text: result.reply, at: Date.now() + 200 };

  // Fusión monotónica: solo se agregan checks válidos del escenario.
  const validIds = new Set(scenario.checklist.map((c) => c.id));
  const completedChecklist = new Set(state.completedChecklist);
  for (const id of result.satisfied ?? []) {
    if (validIds.has(id)) completedChecklist.add(id);
  }

  const empathyHits = state.empathyHits + Math.max(0, Math.min(2, result.empathyDelta ?? 0));
  const turns = state.turns + 1;
  const outOfTurns = turns >= scenario.maxTurns;

  // Cierre en dos tiempos: cuando el cliente da por terminada la llamada
  // (result.ended), NO se corta de golpe — se deja un turno más para que el
  // agente se despida y sume el check de cierre. En el turno siguiente, si el
  // cliente vuelve a cerrar, ahí sí termina. Quedarse sin turnos corta ya.
  let ended: boolean;
  let awaitingClose: boolean;
  if (outOfTurns) {
    ended = true;
    awaitingClose = false;
  } else if (result.ended) {
    if (state.awaitingClose) {
      ended = true;
      awaitingClose = false;
    } else {
      ended = false;
      awaitingClose = true;
    }
  } else {
    ended = false;
    awaitingClose = false;
  }

  return {
    ...state,
    turns,
    messages: [...state.messages, agentMsg, customerMsg],
    completedChecklist,
    empathyHits,
    awaitingClose,
    endedAt: ended ? Date.now() : undefined,
    outcome: ended ? (result.resolved ? 'resolved' : 'unresolved') : undefined,
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
