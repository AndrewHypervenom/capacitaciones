import i18n from '@/i18n'
import type { GeneratedScenario } from '@/services/ai.service'

/**
 * ANTES Y DESPUÉS de un ajuste con IA.
 *
 * La lista de cambios que escribe la IA ("reescribí el mensaje para que suene más
 * molesto") es su versión de los hechos, no los hechos. Esto compara los dos
 * escenarios de verdad, campo por campo, para que el capacitador vea exactamente
 * qué texto se va y cuál entra ANTES de aplicar nada.
 *
 * OJO con las respuestas de un momento: son las 3 que verá el aprendiz (la óptima,
 * la aceptable y el error), NO tres propuestas entre las que haya que elegir. Y la
 * IA las reordena seguido, así que se emparejan por parecido: una respuesta que solo
 * cambió de lugar se muestra como "cambió de lugar", no como reescrita de cero.
 */

export interface DiffPiece {
  t: 'same' | 'del' | 'ins'
  text: string
}

export interface DiffRow {
  label: string
  before: string
  after: string
  /** Resaltado palabra por palabra. Ausente en valores cortos (ids, puntajes). */
  beforePieces?: DiffPiece[]
  afterPieces?: DiffPiece[]
  /** Respuesta/camino al que pertenece la fila. Sin esto, es un campo del momento. */
  group?: string
  /** Cambio que no es de texto (se movió, es nueva, se elimina). */
  note?: string
}

export interface NodeDiff {
  id: string
  kind: 'changed' | 'added' | 'removed'
  /** Primera línea del momento, para reconocerlo sin leer el id. */
  title: string
  rows: DiffRow[]
  /** El momento tiene respuestas del aprendiz: hay que aclarar qué son. */
  hasAnswers: boolean
}

type Node = Record<string, unknown>
type Item = Record<string, unknown>

const t = (k: string, p?: Record<string, unknown>) => i18n.t(`admin.simulations.ai_edit.diff.${k}`, p)

/** Texto en español de un campo multilingüe (o del string pelado, si lo es). */
function es(value: unknown): string {
  if (typeof value === 'string') return value
  const o = value as { es?: unknown } | null
  return typeof o?.es === 'string' ? o.es : ''
}

/** Campos del momento en sí, sin las respuestas ni los caminos. */
function baseFields(node: Node, type: 'dialogue' | 'choice'): [string, string][] {
  if (type === 'dialogue') {
    return [
      [t('customer_line'), es(node.customerLine)],
      [t('fallback'), String(node.fallback ?? '')],
      [t('nudge'), es(node.nudge)],
      [t('terminal'), String(node.terminal ?? '')],
    ]
  }
  return [
    [t('customer_line'), es(node.message)],
    [t('end_type'), String(node.endType ?? '')],
    [t('end_message'), es(node.endMessage)],
  ]
}

/** Campos de UNA respuesta (choice) o de UN camino (dialogue). */
function itemFields(item: Item, type: 'dialogue' | 'choice'): [string, string][] {
  if (type === 'dialogue') {
    return [
      [t('field_keywords'), Array.isArray(item.keywords) ? item.keywords.join(', ') : ''],
      [t('field_next'), String(item.next ?? '')],
    ]
  }
  return [
    [t('field_text'), es(item.text)],
    [t('field_points'), item.points == null ? '' : String(item.points)],
    [t('field_next'), String(item.nextId ?? '')],
    [t('field_feedback'), es(item.feedback)],
  ]
}

/** Con qué texto se reconoce una respuesta/camino al emparejarlos. */
function itemKey(item: Item, type: 'dialogue' | 'choice'): string {
  return type === 'dialogue'
    ? (Array.isArray(item.keywords) ? item.keywords.join(' ') : '')
    : es(item.text)
}

/** Palabras normalizadas, para medir parecido sin que estorben tildes ni signos. */
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  )
}

/** Jaccard: 1 = idénticas, 0 = nada en común. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const A = tokens(a)
  const B = tokens(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / (A.size + B.size - inter)
}

/** Por debajo de esto ya no son "la misma respuesta reescrita" sino otra distinta. */
const MATCH_THRESHOLD = 0.25

/**
 * Cuánto se parecen dos respuestas/caminos, para decidir si son "la misma".
 *
 * En opción múltiple el puntaje pesa: 10 / 5 / 0 es el PAPEL de la respuesta (la
 * óptima, la aceptable, el error). Con solo comparar textos, una respuesta muy
 * reescrita se veía como una que se fue y otra que llegó, aunque siguiera siendo
 * la óptima de siempre.
 */
function itemScore(a: Item, b: Item, type: 'dialogue' | 'choice'): number {
  const text = similarity(itemKey(a, type), itemKey(b, type))
  if (type === 'dialogue') return text
  const samePoints = a.points != null && a.points === b.points ? 1 : 0
  return 0.6 * text + 0.4 * samePoints
}

/**
 * Empareja las respuestas de antes con las de después por parecido (la mejor pareja
 * primero). Sin esto, reordenar las tres respuestas se veía como si las tres se
 * hubieran reescrito enteras, que es justo lo que confundía al capacitador.
 */
function matchItems(
  before: Item[],
  after: Item[],
  type: 'dialogue' | 'choice',
): { pairs: [number, number][]; onlyBefore: number[]; onlyAfter: number[] } {
  const scored: { i: number; j: number; s: number }[] = []
  before.forEach((b, i) => {
    after.forEach((a, j) => {
      scored.push({ i, j, s: itemScore(b, a, type) })
    })
  })
  scored.sort((x, y) => y.s - x.s)

  const usedB = new Set<number>()
  const usedA = new Set<number>()
  const pairs: [number, number][] = []
  for (const { i, j, s } of scored) {
    if (s < MATCH_THRESHOLD || usedB.has(i) || usedA.has(j)) continue
    usedB.add(i)
    usedA.add(j)
    pairs.push([i, j])
  }

  // Lo que quedó suelto en el mismo lugar es, casi siempre, una respuesta cambiada
  // de raíz (no una que se fue y otra que llegó): emparejarla lee mejor.
  before.forEach((_, i) => {
    if (usedB.has(i) || usedA.has(i) || i >= after.length) return
    usedB.add(i)
    usedA.add(i)
    pairs.push([i, i])
  })

  pairs.sort((x, y) => x[1] - y[1])
  return {
    pairs,
    onlyBefore: before.map((_, i) => i).filter((i) => !usedB.has(i)),
    onlyAfter: after.map((_, j) => j).filter((j) => !usedA.has(j)),
  }
}

/** Palabras + espacios, para poder recomponer el texto tal cual al pintarlo. */
function splitWords(s: string): string[] {
  return s.split(/(\s+)/).filter((w) => w !== '')
}

/** A partir de acá el resaltado palabra por palabra no vale su costo cuadrático. */
const WORD_DIFF_LIMIT = 400

/**
 * Diferencia palabra por palabra (LCS). Es lo que hace que en una frase larga se vea
 * QUÉ cambió, en vez de dos párrafos casi iguales que hay que comparar a ojo.
 */
export function wordDiff(before: string, after: string): { before: DiffPiece[]; after: DiffPiece[] } | null {
  const a = splitWords(before)
  const b = splitWords(after)
  if (a.length > WORD_DIFF_LIMIT || b.length > WORD_DIFF_LIMIT) return null

  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const left: DiffPiece[] = []
  const right: DiffPiece[] = []
  const push = (arr: DiffPiece[], kind: DiffPiece['t'], text: string) => {
    const last = arr[arr.length - 1]
    if (last && last.t === kind) last.text += text
    else arr.push({ t: kind, text })
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(left, 'same', a[i])
      push(right, 'same', b[j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(left, 'del', a[i++])
    } else {
      push(right, 'ins', b[j++])
    }
  }
  while (i < a.length) push(left, 'del', a[i++])
  while (j < b.length) push(right, 'ins', b[j++])

  return { before: left, after: right }
}

/** Una fila por cada campo que de verdad cambió. */
function diffFields(before: [string, string][], after: [string, string][], group?: string): DiffRow[] {
  const prevMap = new Map(before)
  const nextMap = new Map(after)
  const labels = [...new Set([...before.map(([l]) => l), ...after.map(([l]) => l)])]
  const rows: DiffRow[] = []

  for (const label of labels) {
    const bef = prevMap.get(label) ?? ''
    const aft = nextMap.get(label) ?? ''
    if (bef === aft) continue
    // Las frases se resaltan palabra por palabra; un id o un puntaje se lee entero.
    const long = bef.length + aft.length > 40
    const pieces = long && bef && aft ? wordDiff(bef, aft) : null
    rows.push({
      label,
      before: bef,
      after: aft,
      ...(group ? { group } : {}),
      ...(pieces ? { beforePieces: pieces.before, afterPieces: pieces.after } : {}),
    })
  }
  return rows
}

/** Cómo se llama cada respuesta/camino en el "antes y después". */
function groupLabel(type: 'dialogue' | 'choice', n: number, points?: unknown): string {
  if (type === 'dialogue') return t('path_n', { n })
  return points == null ? t('answer_n', { n }) : t('answer_n_pts', { n, pts: points })
}

function listOf(node: Node | undefined, type: 'dialogue' | 'choice'): Item[] {
  const raw = type === 'dialogue' ? node?.branches : node?.options
  return Array.isArray(raw) ? (raw as Item[]) : []
}

/** Primera línea del momento, recortada, para el encabezado de su tarjeta. */
function nodeTitle(node: Node | undefined, type: 'dialogue' | 'choice'): string {
  const line = es(type === 'dialogue' ? node?.customerLine : node?.message).replace(/\s+/g, ' ').trim()
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}

/**
 * Compara el escenario que está hoy en el editor con el que propone la IA.
 * Devuelve solo los momentos que cambian de verdad, y dentro de cada uno solo los
 * campos que cambian: si la IA dice que tocó algo y el texto es idéntico, acá no
 * aparece (y eso también es información).
 */
export function diffScenarios(
  before: GeneratedScenario | null,
  after: GeneratedScenario | null,
  type: 'dialogue' | 'choice',
): NodeDiff[] {
  const a = (before?.nodes ?? {}) as Record<string, Node>
  const b = (after?.nodes ?? {}) as Record<string, Node>
  const ids = [...new Set([...Object.keys(a), ...Object.keys(b)])]
  const out: NodeDiff[] = []

  for (const id of ids) {
    const prev = a[id]
    const next = b[id]
    const kind: NodeDiff['kind'] = !prev ? 'added' : !next ? 'removed' : 'changed'

    const rows: DiffRow[] = diffFields(
      prev ? baseFields(prev, type) : [],
      next ? baseFields(next, type) : [],
    )

    const prevItems = listOf(prev, type)
    const nextItems = listOf(next, type)
    const { pairs, onlyBefore, onlyAfter } = matchItems(prevItems, nextItems, type)

    // Se arman por posición FINAL (así se leen en el mismo orden en que quedarán en
    // el editor) y las eliminadas van al final, que es donde estorban menos.
    const blocks: { order: number; rows: DiffRow[] }[] = []

    for (const [i, j] of pairs) {
      const group = groupLabel(type, j + 1, nextItems[j]?.points)
      const block: DiffRow[] = []
      // Que solo se haya movido de lugar es un cambio real, y muy distinto de que la
      // hayan reescrito: se dice con todas las letras y sin dos bloques de texto.
      if (i !== j) {
        block.push({
          label: t('moved'),
          before: '',
          after: '',
          group,
          note: t('moved_note', { from: i + 1, to: j + 1 }),
        })
      }
      block.push(...diffFields(itemFields(prevItems[i], type), itemFields(nextItems[j], type), group))
      if (block.length > 0) blocks.push({ order: j, rows: block })
    }

    for (const j of onlyAfter) {
      const group = groupLabel(type, j + 1, nextItems[j]?.points)
      blocks.push({
        order: j,
        rows: [
          { label: t('item_new'), before: '', after: '', group, note: t('item_new_note') },
          ...diffFields([], itemFields(nextItems[j], type), group),
        ],
      })
    }

    for (const i of onlyBefore) {
      // Lleva su posición VIEJA y se dice que es la vieja: si no, "Respuesta 3" de
      // las eliminadas chocaba con la "Respuesta 3" que sí queda.
      const group = t('removed_group', { n: i + 1 })
      blocks.push({
        order: Number.MAX_SAFE_INTEGER,
        rows: [
          { label: t('item_removed'), before: '', after: '', group, note: t('item_removed_note') },
          ...diffFields(itemFields(prevItems[i], type), [], group),
        ],
      })
    }

    blocks.sort((x, y) => x.order - y.order)
    for (const b of blocks) rows.push(...b.rows)

    if (rows.length === 0) continue
    out.push({
      id,
      kind,
      title: nodeTitle(next ?? prev, type),
      rows,
      hasAnswers: type === 'choice' && (prevItems.length > 0 || nextItems.length > 0),
    })
  }

  // Primero lo que se agrega o se quita (es lo más drástico), después los retoques.
  const weight = { added: 0, removed: 1, changed: 2 }
  return out.sort((x, y) => weight[x.kind] - weight[y.kind])
}
