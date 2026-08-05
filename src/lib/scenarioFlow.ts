/**
 * Antibucle de los grafos de simulación.
 *
 * EL PROBLEMA: la IA (y también un capacitador editando a mano) tiende a mandar
 * la respuesta equivocada de vuelta al MISMO momento — "el cliente insiste" —, o
 * a uno anterior. El aprendiz entonces vuelve a oír el mismo mensaje una y otra
 * vez: la llamada deja de avanzar, se siente artificial y, de paso, se podían
 * sumar puntos repetidos. El player tenía un tope de visitas que cortaba la
 * llamada, pero cortar es un mal remedio: la conversación ya se sintió trabada.
 *
 * LA REGLA: la conversación SIEMPRE avanza. Toda transición tiene que llevar a un
 * momento posterior (o a un final, que siempre es un destino válido). Una
 * respuesta equivocada no repite el momento: avanza igual, con menos puntos y con
 * la retroalimentación que explica el error. Eso es lo que hace una llamada real.
 *
 * Se aplica en dos sitios, a propósito:
 *  - al generar (`assembleScenario`), con el orden del esqueleto, que es el orden
 *    narrativo real;
 *  - al reproducir, para sanear también las simulaciones ya guardadas, sin tocar
 *    la base de datos ni pisar lo que el capacitador escribió (solo se corrige el
 *    destino de las transiciones que retroceden).
 */

/** Nodo visto de forma laxa: sirve tanto para los tipos del player como para el JSON recién generado. */
type LooseNode = Record<string, unknown>

/** Una transición del grafo, con cómo leerla y cómo reescribirla. */
interface Edge {
  to: string | undefined
  set: (id: string) => void
}

function isEndNode(node: LooseNode, type: 'dialogue' | 'choice'): boolean {
  return type === 'choice' ? node.isEnd === true : Boolean(node.terminal)
}

/** Todas las transiciones que salen de un momento, según el tipo de simulación. */
function edgesOf(node: LooseNode, type: 'dialogue' | 'choice'): Edge[] {
  if (type === 'choice') {
    const options = Array.isArray(node.options) ? (node.options as LooseNode[]) : []
    return options.map((op) => ({
      to: typeof op.nextId === 'string' ? op.nextId : undefined,
      set: (id: string) => { op.nextId = id },
    }))
  }
  const branches = Array.isArray(node.branches) ? (node.branches as LooseNode[]) : []
  const edges: Edge[] = branches.map((br) => ({
    to: typeof br.next === 'string' ? br.next : undefined,
    set: (id: string) => { br.next = id },
  }))
  edges.push({
    to: typeof node.fallback === 'string' ? node.fallback : undefined,
    set: (id: string) => { node.fallback = id },
  })
  return edges
}

/**
 * Orden narrativo de los momentos: cuanto más lejos del arranque, más tarde en la
 * llamada. Con el esqueleto a mano se usa su orden (es el que la IA diseñó); si
 * no, se deduce con un recorrido en anchura desde el momento inicial.
 */
function rankNodes(
  nodes: Record<string, LooseNode>,
  startId: string,
  type: 'dialogue' | 'choice',
  order?: string[],
): Map<string, number> {
  const ids = Object.keys(nodes)
  const rank = new Map<string, number>()

  if (order?.length) {
    order.forEach((id, i) => { if (id in nodes) rank.set(id, i) })
    // Un momento que no estaba en el esqueleto va al final: no puede ser destino
    // de retroceso de nadie, que es justo lo que queremos.
    for (const id of ids) if (!rank.has(id)) rank.set(id, rank.size + order.length)
    return rank
  }

  let depth = 0
  let frontier = startId in nodes ? [startId] : ids.slice(0, 1)
  const seen = new Set(frontier)
  while (frontier.length) {
    for (const id of frontier) rank.set(id, depth)
    const next: string[] = []
    for (const id of frontier) {
      for (const e of edgesOf(nodes[id], type)) {
        if (e.to && e.to in nodes && !seen.has(e.to)) { seen.add(e.to); next.push(e.to) }
      }
    }
    frontier = next
    depth++
  }
  // Los inalcanzables (grafo roto) quedan detrás de todo lo alcanzable.
  for (const id of ids) if (!rank.has(id)) rank.set(id, depth + 1)
  return rank
}

/**
 * Reescribe las transiciones que no avanzan para que el grafo quede sin ciclos.
 * Muta `nodes` y devuelve cuántas transiciones se corrigieron.
 *
 * @param order Ids en orden narrativo (el esqueleto). Si se omite, se deduce.
 */
export function unloopScenario(
  nodes: Record<string, LooseNode>,
  startId: string,
  type: 'dialogue' | 'choice',
  order?: string[],
): number {
  const rank = rankNodes(nodes, startId, type, order)
  const byRank = Object.keys(nodes).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
  const ends = byRank.filter((id) => isEndNode(nodes[id], type))
  // Un final siempre es un destino legítimo, esté donde esté en el orden: cerrar
  // la llamada nunca es "volver atrás".
  const advances = (from: string, to: string | undefined): boolean =>
    !!to && to in nodes && (isEndNode(nodes[to], type) || (rank.get(to) ?? 0) > (rank.get(from) ?? 0))

  let fixed = 0

  for (const id of byRank) {
    const node = nodes[id]
    if (isEndNode(node, type)) continue
    const edges = edgesOf(node, type)

    // Destino de rescate, en orden de preferencia:
    //   1. otro destino del mismo momento que sí avance (el más cercano, para no
    //      saltarse tramos de la conversación),
    //   2. el momento siguiente en el orden narrativo,
    //   3. un final (mejor cerrar bien que dar vueltas).
    const ownForward = edges
      .map((e) => e.to)
      .filter((to): to is string => advances(id, to))
      .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))[0]
    // Se prefiere un momento normal antes que un final: la llamada sigue en vez
    // de cortarse porque una opción estaba mal apuntada.
    const nextInOrder = byRank.find((other) => !isEndNode(nodes[other], type) && advances(id, other))
    const rescue = ownForward ?? nextInOrder ?? ends[0]
    if (!rescue) continue // Grafo sin salida posible: no empeorarlo inventando.

    for (const e of edges) {
      // `fallback` ausente en un nodo de diálogo no es un ciclo: no lo inventamos
      // acá (de eso se encarga el ensamblado, que sabe qué preveía el esqueleto).
      if (e.to === undefined) continue
      if (advances(id, e.to)) continue
      e.set(rescue)
      fixed++
    }
  }

  return fixed
}
