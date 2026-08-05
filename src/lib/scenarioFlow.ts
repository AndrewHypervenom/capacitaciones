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

export function isEndNode(node: LooseNode, type: 'dialogue' | 'choice'): boolean {
  return type === 'choice' ? node.isEnd === true : Boolean(node.terminal)
}

/**
 * Intercambios mínimos que tiene que durar la llamada antes de que se pueda
 * colgar. Se deduce del tamaño del grafo porque al reproducir no sabemos con qué
 * "longitud" se generó: un escenario de 24 momentos debe dar mucha más
 * conversación que uno de 8. Los topes evitan los dos extremos (exigir 8 turnos
 * en un escenario cortito, o dejar pasar un final en el paso 2 de uno largo).
 */
export function minTurnsFor(nodes: Record<string, LooseNode>, type: 'dialogue' | 'choice'): number {
  const nonTerminal = Object.values(nodes).filter((n) => !isEndNode(n, type)).length
  return Math.max(2, Math.min(6, Math.round(nonTerminal / 3)))
}

/** Profundidad mínima de cada momento desde el arranque (start = 1 intercambio). */
function depthsFrom(
  nodes: Record<string, LooseNode>,
  startId: string,
  type: 'dialogue' | 'choice',
): Map<string, number> {
  const depth = new Map<string, number>()
  const first = startId in nodes ? startId : Object.keys(nodes)[0]
  if (!first) return depth
  let frontier = [first]
  depth.set(first, 1)
  let d = 1
  while (frontier.length) {
    const next: string[] = []
    d++
    for (const id of frontier) {
      for (const e of edgesOf(nodes[id], type)) {
        if (e.to && e.to in nodes && !depth.has(e.to)) { depth.set(e.to, d); next.push(e.to) }
      }
    }
    frontier = next
  }
  return depth
}

/**
 * Aleja los finales del arranque: ninguna respuesta puede colgar la llamada antes
 * de `minTurns` intercambios.
 *
 * EL PROBLEMA: la IA cablea el final "poor" como destino de la opción incorrecta
 * del primer o segundo momento. El aprendiz apenas saluda, elige mal una vez y la
 * llamada se corta con la retroalimentación. Ninguna llamada real termina así: el
 * cliente sigue al teléfono, se molesta, insiste, y el agente tiene que
 * recuperarla. Colgar de una además no enseña nada — el aprendiz nunca ve las
 * consecuencias de su error ni el resto del procedimiento.
 *
 * LA REGLA: equivocarse cuesta puntos, no la llamada. Una transición que lleva a
 * un final demasiado pronto se reencamina a un momento normal posterior (el
 * cliente reacciona al error y la conversación sigue). Los finales quedan
 * alcanzables solo cuando ya hubo conversación de verdad.
 *
 * Se aplica al generar y también al reproducir, para sanear lo ya guardado sin
 * tocar la base de datos. Muta `nodes` y devuelve cuántas transiciones se movieron.
 */
export function deferEndings(
  nodes: Record<string, LooseNode>,
  startId: string,
  type: 'dialogue' | 'choice',
  minTurns?: number,
  order?: string[],
): number {
  const ids = Object.keys(nodes)
  const nonTerminal = ids.filter((id) => !isEndNode(nodes[id], type))
  // No se puede exigir más conversación de la que el escenario tiene momentos.
  const required = Math.min(minTurns ?? minTurnsFor(nodes, type), nonTerminal.length)
  if (required <= 1) return 0

  const rank = rankNodes(nodes, startId, type, order)
  let fixed = 0

  // Reencaminar cambia las profundidades (un final que se aleja libera camino), así
  // que se repite hasta que ninguna transición quede corta. El tope es por si un
  // grafo raro no converge: mejor parar que colgarse.
  for (let pass = 0; pass < ids.length + 1; pass++) {
    const depth = depthsFrom(nodes, startId, type)
    let changedThisPass = 0

    for (const id of nonTerminal) {
      const d = depth.get(id)
      if (d === undefined || d >= required) continue // inalcanzable, o ya hubo conversación
      const node = nodes[id]
      const edges = edgesOf(node, type)
      const early = edges.filter((e) => e.to && e.to in nodes && isEndNode(nodes[e.to], type))
      if (early.length === 0) continue

      // Candidatos: momentos normales POSTERIORES a este (el antibucle sigue
      // valiendo). Se prefieren los que este momento no usa todavía, para que las
      // ramas no se fundan todas en el mismo destino y el escenario siga ramificando.
      const used = new Set(edges.map((e) => e.to).filter(Boolean) as string[])
      const forward = nonTerminal
        .filter((other) => (rank.get(other) ?? 0) > (rank.get(id) ?? 0))
        .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
      if (forward.length === 0) continue // no hay a dónde seguir: se respeta el final

      for (const e of early) {
        const target = forward.find((o) => !used.has(o)) ?? forward[0]
        used.add(target)
        e.set(target)
        fixed++
        changedThisPass++
      }
    }

    if (changedThisPass === 0) break
  }

  // Red de seguridad: alejar los finales nunca puede dejar la llamada sin cierre.
  // Si al terminar ningún final quedó alcanzable (escenario con el cierre metido a
  // mitad del guion), el momento más avanzado pasa a ser el que cuelga.
  const reachable = depthsFrom(nodes, startId, type)
  const ends = ids.filter((id) => isEndNode(nodes[id], type))
  if (ends.length && !ends.some((id) => reachable.has(id))) {
    const last = [...reachable.keys()]
      .filter((id) => !isEndNode(nodes[id], type))
      .sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0))[0]
    if (last) {
      for (const e of edgesOf(nodes[last], type)) {
        if (e.to === undefined) continue
        e.set(ends[0])
        fixed++
      }
    }
  }

  return fixed
}

/**
 * Preferencia entre finales cuando hay que quedarse con uno solo. El cierre que
 * sobrevive es el de la gestión completada: es el único que sirve de cierre
 * genérico, porque quien lo hizo mal ya se entera por el puntaje y la
 * retroalimentación, no por el cliente colgando enojado.
 */
const END_PRIORITY: Record<'dialogue' | 'choice', string[]> = {
  dialogue: ['resolved', 'partial', 'escalated'],
  choice: ['excellent', 'good', 'poor'],
}

function endKind(node: LooseNode, type: 'dialogue' | 'choice'): string {
  const raw = type === 'choice' ? node.endType : node.terminal
  return typeof raw === 'string' ? raw : ''
}

/**
 * Deja UN SOLO final en el escenario y borra los momentos que ya nadie alcanza.
 *
 * EL PROBLEMA: la IA escribe tres o cuatro cierres (excelente, aceptable, malo) y
 * los cuelga de opciones distintas. Elegir mal una vez llevaba al cierre "malo" y
 * la llamada se acababa ahí: el aprendiz salía disparado a la pantalla de
 * resultado sin haber hecho la gestión. Un final por camino convierte cada
 * decisión en una trampa mortal.
 *
 * LA REGLA: la simulación tiene un arranque y un cierre. Todos los caminos pasan
 * por la gestión completa y desembocan en el mismo cierre; lo que cambia entre un
 * aprendiz y otro es el puntaje y la retroalimentación, que es donde de verdad se
 * mide el desempeño (la pantalla de resultado ya se calcula con el puntaje, no con
 * el tipo de final).
 *
 * Muta `nodes` y devuelve el id del final que quedó, o undefined si no había ninguno.
 */
export function collapseEndings(
  nodes: Record<string, LooseNode>,
  startId: string,
  type: 'dialogue' | 'choice',
  order?: string[],
): string | undefined {
  const ends = Object.keys(nodes).filter((id) => isEndNode(nodes[id], type))
  if (ends.length === 0) return undefined

  const priority = END_PRIORITY[type]
  const scoreOf = (id: string) => {
    const i = priority.indexOf(endKind(nodes[id], type))
    return i === -1 ? priority.length : i
  }
  const rank = rankNodes(nodes, startId, type, order)
  // El mejor cierre; a igualdad, el que el guion puso más tarde (el más completo).
  const keep = [...ends].sort(
    (a, b) => scoreOf(a) - scoreOf(b) || (rank.get(b) ?? 0) - (rank.get(a) ?? 0),
  )[0]

  if (ends.length > 1) {
    const dropped = new Set(ends.filter((id) => id !== keep))
    for (const id of Object.keys(nodes)) {
      if (dropped.has(id)) continue
      for (const e of edgesOf(nodes[id], type)) {
        if (e.to && dropped.has(e.to)) e.set(keep)
      }
    }
    for (const id of dropped) delete nodes[id]
  }

  // Un solo arranque también: sin los otros cierres pueden quedar tramos sueltos,
  // y un momento al que no llega nadie es un segundo comienzo fantasma que solo
  // confunde al capacitador en el editor.
  const reachable = depthsFrom(nodes, startId, type)
  for (const id of Object.keys(nodes)) {
    if (!reachable.has(id) && id !== startId) delete nodes[id]
  }

  return keep
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
