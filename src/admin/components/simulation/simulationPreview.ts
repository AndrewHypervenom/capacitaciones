import { containsAny, normalize } from '@/lib/normalize'
import type { DialogueNodeData } from './DialogueNodeForm'
import type { ChoiceNodeData } from './ChoiceNodeForm'

/**
 * Motor de la VISTA PREVIA del editor de simulaciones.
 *
 * Reproduce el escenario que el capacitador tiene EN PANTALLA (todavía sin
 * guardar), sin llamar a la IA y sin escribir nada: es un ensayo. Por eso el
 * recorrido usa el motor guionado —el mismo emparejamiento por palabras clave
 * que `stepSim` y el mismo avance por opciones del player— y no Groq: la vista
 * previa tiene que ser instantánea, gratis y determinista para poder revisar el
 * guion, no para calificar a nadie.
 */

export type Lang = 'es' | 'en' | 'pt'
export type PreviewType = 'dialogue' | 'choice'
export type PreviewNode = DialogueNodeData | ChoiceNodeData
export type PreviewNodes = Record<string, PreviewNode>

/* ── Lecturas comunes a los dos tipos de simulación ───────────────────────── */

/** Lo que dice el cliente en ese momento, con respaldo al español si falta la traducción. */
export function nodeText(node: PreviewNode | undefined, type: PreviewType, lang: Lang): string {
  if (!node) return ''
  const field = type === 'choice' ? (node as ChoiceNodeData).message : (node as DialogueNodeData).customerLine
  return (field?.[lang] || field?.es || '').trim()
}

export function isEndNode(node: PreviewNode | undefined, type: PreviewType): boolean {
  if (!node) return false
  return type === 'choice'
    ? (node as ChoiceNodeData).isEnd === true
    : Boolean((node as DialogueNodeData).terminal)
}

/** Destinos a los que puede saltar un momento (para detectar callejones y rutas rotas). */
export function exitsOf(node: PreviewNode | undefined, type: PreviewType): (string | undefined)[] {
  if (!node) return []
  if (type === 'choice') {
    return ((node as ChoiceNodeData).options ?? []).map((o) => o.nextId)
  }
  const d = node as DialogueNodeData
  return [...(d.branches ?? []).map((b) => b.next), d.fallback]
}

/** Momentos alcanzables desde el arranque. Lo que no aparece acá, el aprendiz nunca lo verá. */
export function reachableFrom(nodes: PreviewNodes, startId: string, type: PreviewType): Set<string> {
  const seen = new Set<string>()
  if (!nodes[startId]) return seen
  const queue = [startId]
  seen.add(startId)
  while (queue.length) {
    const id = queue.shift()!
    for (const to of exitsOf(nodes[id], type)) {
      if (to && nodes[to] && !seen.has(to)) {
        seen.add(to)
        queue.push(to)
      }
    }
  }
  return seen
}

/**
 * Mejor puntaje posible (opción múltiple): el camino que más suma sin repetir
 * momentos. Es el denominador del porcentaje que ve el aprendiz, así que la
 * vista previa lo calcula igual que el player (`calcMaxPoints`).
 */
export function bestPoints(nodes: PreviewNodes, startId: string): number {
  let budget = 20000
  const best = (nodeId: string, path: Set<string>): number => {
    const node = nodes[nodeId] as ChoiceNodeData | undefined
    if (!node || !node.options?.length || path.has(nodeId) || budget-- <= 0) return 0
    const next = new Set(path).add(nodeId)
    let max = 0
    for (const opt of node.options) max = Math.max(max, (opt.points ?? 0) + best(opt.nextId, next))
    return max
  }
  return best(startId, new Set())
}

/* ── Emparejamiento por palabras clave (simulación de llamada) ────────────── */

export interface BranchMatch {
  /** Índice de la ruta que coincidió, o -1 si se fue por el respaldo. */
  index: number
  /** Palabra clave concreta que disparó la ruta (para mostrar por qué avanzó). */
  keyword: string | null
  next: string | undefined
  via: 'branch' | 'fallback' | 'stuck'
}

/** Misma regla que `stepSim`: primera ruta cuya palabra clave aparezca; si no, el respaldo. */
export function matchBranch(node: DialogueNodeData | undefined, agentText: string): BranchMatch {
  const branches = node?.branches ?? []
  const n = normalize(agentText)
  for (let i = 0; i < branches.length; i++) {
    const hit = (branches[i].keywords ?? []).find((k) => k && n.includes(normalize(k)))
    if (hit) return { index: i, keyword: hit, next: branches[i].next, via: 'branch' }
  }
  if (node?.fallback) return { index: -1, keyword: null, next: node.fallback, via: 'fallback' }
  return { index: -1, keyword: null, next: undefined, via: 'stuck' }
}

/** Ítems del checklist que esa frase acaba de satisfacer. */
export function checklistHits(
  checklist: { id: string; keywords: string[] }[],
  agentText: string,
  already: Set<string>,
): string[] {
  return checklist
    .filter((it) => !already.has(it.id) && containsAny(agentText, it.keywords ?? []))
    .map((it) => it.id)
}

/* ── Revisión del guion ───────────────────────────────────────────────────── */

export type IssueCode =
  | 'start_missing'
  | 'empty_text'
  | 'no_exits'
  | 'broken_link'
  | 'unreachable'
  | 'no_ending'
  | 'option_empty'
  | 'no_fallback'
  | 'end_no_type'
  | 'length_tell'

/**
 * Cuánto más larga que la siguiente puede ser la opción correcta antes de que
 * delate la respuesta. Con 30% de diferencia el aprendiz ya la reconoce de un
 * vistazo, sin leer: acierta midiendo renglones en vez de aplicando el
 * procedimiento, que es justo lo contrario de lo que la simulación enseña.
 */
const LENGTH_TELL_RATIO = 1.3
/** Debajo de esto la diferencia es de una palabra o dos: no delata nada. */
const LENGTH_TELL_MIN_CHARS = 25

/**
 * ¿La opción que más suma se reconoce por ser la más larga? Compara la mejor
 * puntuada contra la más larga de las demás; si además de ganar por puntaje gana
 * por tamaño con holgura, el momento tiene el "sesgo de longitud".
 */
function hasLengthTell(node: ChoiceNodeData): boolean {
  const options = (node.options ?? []).filter((o) => (o.text?.es || '').trim())
  if (options.length < 2) return false
  const best = options.reduce((a, b) => ((b.points ?? 0) > (a.points ?? 0) ? b : a))
  // Sin diferencia de puntaje no hay "correcta" que delatar.
  if (options.every((o) => (o.points ?? 0) === (best.points ?? 0))) return false
  const len = (o: typeof best) => (o.text?.es || '').trim().length
  const rest = options.filter((o) => o !== best)
  const longestRest = Math.max(...rest.map(len))
  return len(best) - longestRest >= LENGTH_TELL_MIN_CHARS && len(best) >= longestRest * LENGTH_TELL_RATIO
}

export interface PreviewIssue {
  id: string
  code: IssueCode
  /** `error` rompe el recorrido; `warn` lo deja cojo pero jugable. */
  level: 'error' | 'warn'
  /** Momento al que salta el botón "Corregir". */
  nodeId?: string
}

/**
 * Todo lo que haría que el aprendiz se quede trabado, no llegue nunca a un
 * momento o vea un mensaje en blanco. Se calcula sobre el borrador en pantalla,
 * así que avisa ANTES de guardar y de publicar.
 */
export function reviewScenario(
  nodes: PreviewNodes,
  startId: string,
  type: PreviewType,
): PreviewIssue[] {
  const issues: PreviewIssue[] = []
  const push = (code: IssueCode, level: PreviewIssue['level'], nodeId?: string) =>
    issues.push({ id: `${code}:${nodeId ?? '*'}`, code, level, nodeId })

  if (!nodes[startId]) {
    push('start_missing', 'error')
    return issues
  }

  const reachable = reachableFrom(nodes, startId, type)
  let hasEnding = false

  for (const [id, node] of Object.entries(nodes)) {
    const ending = isEndNode(node, type)
    if (ending && reachable.has(id)) hasEnding = true

    if (!nodeText(node, type, 'es')) push('empty_text', 'warn', id)

    const exits = exitsOf(node, type)
    const realExits = exits.filter((to) => to && nodes[to])

    if (exits.some((to) => to && !nodes[to])) push('broken_link', 'error', id)

    if (type === 'choice') {
      const c = node as ChoiceNodeData
      if (!ending && (c.options ?? []).length === 0) push('no_exits', 'error', id)
      if ((c.options ?? []).some((o) => !o.nextId || !(o.text?.es || '').trim())) {
        push('option_empty', 'warn', id)
      }
      if (ending && !c.endType) push('end_no_type', 'warn', id)
      if (!ending && hasLengthTell(c)) push('length_tell', 'warn', id)
    } else {
      const d = node as DialogueNodeData
      if (!ending && realExits.length === 0) push('no_exits', 'error', id)
      // Sin respaldo, una respuesta que no contenga ninguna palabra clave deja al
      // cliente repitiendo la misma línea: el aprendiz siente que no lo escuchan.
      if (!ending && (d.branches ?? []).length > 0 && !d.fallback) push('no_fallback', 'warn', id)
    }

    if (!reachable.has(id)) push('unreachable', 'warn', id)
  }

  if (!hasEnding) push('no_ending', 'warn')

  // Primero lo que rompe, después lo que solo incomoda.
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
}
