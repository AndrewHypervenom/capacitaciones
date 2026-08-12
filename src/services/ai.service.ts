import { supabase } from '@/lib/supabase'
import { throwAiError, useAiCreditsStore } from '@/lib/aiCredits'
import { unloopScenario, deferEndings, collapseEndings, minTurnsFor, isEndNode } from '@/lib/scenarioFlow'
import type { ContentBlock } from '@/types/blocks'

export interface CacheUsage {
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  input_tokens: number
  output_tokens: number
}

export interface GeneratedDialogueMeta {
  title_es: string; title_en: string; title_pt: string
  summary_es: string; summary_en: string; summary_pt: string
  country: 'CO' | 'MX' | 'AR'
  difficulty: 1 | 2 | 3
  /** Quién llama a quién. Con callType 'auto' es lo que la IA dedujo del material. */
  call_type?: 'inbound' | 'outbound'
  customer_name: string; customer_phone: string
  customer_reason_es: string; customer_reason_en: string; customer_reason_pt: string
  avatar_seed: number; max_turns: number
  empathy_keywords: string[]
  checklist_items: unknown[]
}

export interface GeneratedChoiceMeta {
  title_es: string; title_en: string; title_pt: string
  description: string; client_name: string; client_company: string
  objective: string; level: 'basico' | 'medio' | 'avanzado'
}

export interface GeneratedDialogue {
  metadata: GeneratedDialogueMeta
  start_node_id: string
  nodes: Record<string, unknown>
}

export interface GeneratedChoice {
  metadata: GeneratedChoiceMeta
  start_node_id: string
  nodes: Record<string, unknown>
}

export type GeneratedScenario = GeneratedDialogue | GeneratedChoice

export interface GeneratedModuleMeta {
  slug: string
  title_es: string; title_en: string; title_pt: string
  subtitle_es: string; subtitle_en: string; subtitle_pt: string
  icon: string
  duration_min: number
  objectives_es: string[]; objectives_en: string[]; objectives_pt: string[]
  key_takeaways_es: string[]; key_takeaways_en: string[]; key_takeaways_pt: string[]
}

/**
 * Bloque tal como lo emite la IA: idéntico a `ContentBlock` del sitio, salvo que las
 * imágenes referencian `image_index` (la URL real se resuelve al guardar el módulo).
 */
export type GeneratedBlock =
  | Exclude<ContentBlock, { type: 'image' }>
  | { type: 'image'; image_index: number; caption?: { es: string; en: string; pt: string } }

export interface GeneratedModuleSection {
  heading_es: string; heading_en: string; heading_pt: string
  /** Estilo visual de la sección (default/immersive/spotlight/feature). */
  section_style?: GeneratedSectionStyle
  /** Contenido dinámico de la sección (párrafos, listas, quiz, flashcards, etc.). */
  blocks: GeneratedBlock[]
}

export interface GeneratedModule {
  metadata: GeneratedModuleMeta
  sections: GeneratedModuleSection[]
}

/** Extensión pedida a la IA. Se traduce en el servidor a cantidad de nodos y profundidad. */
export type ScenarioLength = 'short' | 'medium' | 'long'

/** Nodos aproximados por extensión: solo para avisarle al capacitador cuánto va a tardar. */
export const SCENARIO_LENGTH_NODES: Record<ScenarioLength, number> = { short: 12, medium: 20, long: 28 }

/**
 * Avance real del proceso (no un temporizador falso): el panel lo usa para decir
 * en qué está la IA y por qué se está demorando.
 */
export interface SimProgress {
  stage: 'module' | 'document' | 'outline' | 'writing' | 'translating' | 'editing'
  /** Detalle humano de lo que está pasando ahora mismo. */
  detail?: string
  /** Solo en 'translating': lotes de nodos ya traducidos / totales. */
  done?: number
  total?: number
  /**
   * Título del escenario, en cuanto la IA lo decide (al terminar el esqueleto). El
   * indicador global deja de decir "sin título" a mitad del proceso, sin esperar a
   * que estén escritos todos los diálogos.
   */
  title?: string
}

/**
 * Umbral de condensado. ~2.400 caracteres por página → 120k ≈ 50 páginas, que es
 * el límite que pidió el capacitador: por debajo se manda el documento tal cual
 * (fidelidad total), por encima Haiku lo condensa a un briefing operativo.
 */
export const SIM_DOC_CONDENSE_THRESHOLD = 120_000
/**
 * Tope duro de lo que viaja al prompt aunque el condensado se quede corto. DEBE ser
 * >= el umbral de condensado: cuando valía 60k, un manual de 25-50 páginas no se
 * condensaba (estaba bajo el umbral) pero igual se le cortaba la mitad final en
 * silencio, y el capacitador no se enteraba de que la IA nunca leyó esas páginas.
 */
const SIM_DOC_HARD_LIMIT = SIM_DOC_CONDENSE_THRESHOLD

/** ¿Este documento necesita pasar por el condensado con Haiku? */
export function simDocNeedsCondense(text: string): boolean {
  return text.length > SIM_DOC_CONDENSE_THRESHOLD
}

/** Páginas estimadas de un texto extraído (solo para mostrárselo al capacitador). */
export function estimateDocPages(text: string): number {
  return Math.max(1, Math.round(text.length / 2400))
}

/**
 * Condensa un documento largo a un briefing operativo (Haiku) para que quepa en el
 * prompt del escenario sin perder las reglas duras. Llamada aparte a propósito:
 * encadenarla con la generación de Sonnet rozaba el timeout del gateway.
 */
export async function condenseSimulationDocument(opts: {
  documentContext: string
  documentName?: string
  description?: string
}, signal?: AbortSignal): Promise<string> {
  const { data } = await postGenerateSimulation({
    mode: 'condense',
    type: 'dialogue',
    description: opts.description ?? '',
    documentContext: opts.documentContext,
    documentName: opts.documentName,
  }, signal)
  const brief = (data as { brief?: string })?.brief?.trim()
  if (!brief) throw new Error('No se pudo condensar el documento')
  return brief
}

/** Tipo de llamada: quién marca a quién. Decide quién lleva la iniciativa del guion. */
export type CallType = 'inbound' | 'outbound' | 'auto'

/** Un momento del esqueleto: id, qué pasa ahí y a dónde puede saltar. */
export interface OutlineBeat {
  id: string
  beat: string
  next?: string[]
  terminal?: string
}

/**
 * Momentos por petición al escribir los diálogos. Seis es el punto donde cada
 * llamada dura ~20-30 s: lo bastante corta para no toparse con ningún límite y lo
 * bastante grande para que los momentos de un mismo tramo salgan coherentes entre sí.
 */
const SIM_NODE_BATCH = 6

/**
 * Baraja las opciones de un momento (Fisher-Yates).
 *
 * La IA las escribe SIEMPRE en el mismo orden (óptima, aceptable, incorrecta),
 * así que sin esto la respuesta correcta es siempre la "A" y el aprendiz aprende
 * la posición en vez del procedimiento. Se baraja acá, en el ensamblado, y no se
 * confía en pedírselo al modelo: el orden queda garantizado.
 *
 * Cada opción es autónoma (lleva su `nextId`, `points` y `feedback`), por eso
 * cambiar el orden no altera el grafo ni el puntaje.
 */
function shuffleOptions(options: Record<string, unknown>[]): Record<string, unknown>[] {
  const out = [...options]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Junta el esqueleto con los diálogos escritos y DEJA EL GRAFO SANO. Es la red de
 * seguridad de la generación por partes: si un lote falló o la IA inventó un destino
 * que no existe, el escenario igual queda navegable en vez de romperse a mitad de
 * la simulación (que es lo que vería el aprendiz).
 */
/**
 * Intercambios mínimos antes de un final, por longitud del escenario. Es el mismo
 * número que el prompt le exige a la IA: acá se hace cumplir de verdad.
 */
const MIN_TURNS_BEFORE_END: Record<ScenarioLength, number> = { short: 4, medium: 6, long: 8 }

function assembleScenario(
  plan: { metadata: unknown; start_node_id?: string },
  outline: OutlineBeat[],
  written: Record<string, unknown>,
  type: 'dialogue' | 'choice',
  minTurns: number,
): GeneratedScenario {
  const beatById = new Map(outline.map((b) => [b.id, b]))
  const nodes: Record<string, Record<string, unknown>> = {}

  // 1. Todo momento del esqueleto existe, aunque su lote se haya perdido.
  for (const b of outline) {
    const node = written[b.id]
    nodes[b.id] = node && typeof node === 'object'
      ? { ...(node as Record<string, unknown>) }
      : placeholderNode(b, type)
  }

  const exists = (id: unknown): id is string => typeof id === 'string' && id in nodes
  const firstTerminal = outline.find((b) => b.terminal)?.id
  // Destino de rescate para una referencia rota: lo que el esqueleto había previsto
  // para ese momento; si tampoco sirve, un final (nunca un salto al vacío).
  const safeTarget = (from: string): string | undefined => {
    const declared = (beatById.get(from)?.next ?? []).find(exists)
    return declared ?? (exists(firstTerminal) ? firstTerminal : undefined)
  }

  // 2. Ninguna transición apunta a un id inexistente.
  for (const [id, node] of Object.entries(nodes)) {
    if (type === 'dialogue') {
      const branches = Array.isArray(node.branches) ? node.branches as Record<string, unknown>[] : []
      node.branches = branches.filter((br) => exists(br?.next))
      if (!exists(node.fallback) && !node.terminal) {
        const target = safeTarget(id)
        if (target) node.fallback = target
        else delete node.fallback
      }
    } else {
      const options = Array.isArray(node.options) ? node.options as Record<string, unknown>[] : []
      const kept = options.filter((op) => exists(op?.nextId))
      // Un nodo intermedio sin ninguna opción válida dejaría al aprendiz encerrado.
      if (kept.length === 0 && !node.isEnd) {
        const target = safeTarget(id)
        if (target) {
          kept.push({
            text: { es: 'Continuar con la gestión', en: '', pt: '' },
            nextId: target, points: 5, feedback: 'Sigue adelante con la llamada.',
          })
        } else {
          node.isEnd = true
          node.endType = node.endType ?? 'good'
        }
      }
      node.options = shuffleOptions(kept)
    }
  }

  // 3. El nodo de arranque existe de verdad.
  const start = exists(plan.start_node_id) ? plan.start_node_id : (outline[0]?.id ?? 'start')

  // 4. La conversación siempre avanza: ninguna respuesta devuelve al aprendiz al
  //    mismo momento ni a uno anterior. El orden del esqueleto ES el orden
  //    narrativo, así que acá el antibucle sabe exactamente qué es "adelante".
  const order = outline.map((b) => b.id)
  unloopScenario(nodes, start, type, order)

  // 5. Un arranque y un cierre. Con varios finales, elegir mal una vez mandaba al
  //    aprendiz directo a la pantalla de resultado sin haber hecho la gestión.
  collapseEndings(nodes, start, type, order)

  // 6. Y ese cierre único queda detrás de una conversación de verdad: equivocarse
  //    al saludar molesta al cliente, no termina la llamada. El orden narrativo se
  //    recalcula porque el colapso pudo dejar el cierre a mitad del esqueleto.
  const finalOrder = [
    ...order.filter((id) => id in nodes && !isEndNode(nodes[id], type)),
    ...order.filter((id) => id in nodes && isEndNode(nodes[id], type)),
  ]
  deferEndings(nodes, start, type, Math.min(minTurns, minTurnsFor(nodes, type)), finalOrder)

  return { metadata: plan.metadata, start_node_id: start, nodes } as unknown as GeneratedScenario
}

/** Nodo mínimo pero válido para un momento cuyo lote no llegó (ver `assembleScenario`). */
function placeholderNode(b: OutlineBeat, type: 'dialogue' | 'choice'): Record<string, unknown> {
  const line = { es: b.beat, en: '', pt: '' }
  if (type === 'dialogue') {
    return b.terminal
      ? { customerLine: line, branches: [], terminal: b.terminal }
      : { customerLine: line, branches: [], fallback: b.next?.[0] }
  }
  return b.terminal
    ? { message: line, speaker: 'client', isEnd: true, endType: b.terminal, endMessage: line }
    : {
        message: line,
        speaker: 'client',
        options: (b.next ?? []).map((nextId, i) => ({
          text: { es: i === 0 ? 'Responder correctamente' : 'Responder de otra forma', en: '', pt: '' },
          nextId, points: i === 0 ? 10 : 5, feedback: 'Continúa la gestión.',
        })),
      }
}

export async function generateSimulation(opts: {
  type: 'dialogue' | 'choice'
  description: string
  moduleContext?: string
  /**
   * Texto del documento de apoyo (manual, política, guion). Es lo que hace que la
   * simulación se sienta del negocio real y no una llamada genérica. Si supera el
   * umbral se condensa antes con Haiku.
   */
  documentContext?: string
  documentName?: string
  /**
   * Escenario actual (metadata + nodos). Si se envía, la IA MEJORA y extiende
   * ese contenido en vez de generar uno nuevo desde cero. `description` se toma
   * como instrucciones opcionales de la mejora.
   */
  existing?: GeneratedScenario
  /** Extensión del escenario (por defecto 'long'). */
  length?: ScenarioLength
  /** Inbound (el cliente llama), outbound (la entidad llama) o 'auto' (lo deduce del material). */
  callType?: CallType
  /**
   * Traducir a inglés y portugués al terminar. Por defecto NO: primero se pule el
   * español y la traducción se pide después con `translateScenario`, cuando el
   * escenario ya está bien. Traducir de una alarga bastante la espera.
   */
  translate?: boolean
}, signal?: AbortSignal, onProgress?: (p: SimProgress) => void): Promise<{ data: GeneratedScenario; usage: CacheUsage }> {
  // Media por defecto: 'long' con documento largo se iba hasta ~7 min de espera.
  const length = opts.length ?? 'medium'
  const nodes = SCENARIO_LENGTH_NODES[length]

  // Documento de apoyo: si es un manual largo, primero se condensa; si no, va tal cual
  // (recortado por seguridad) para conservar la letra exacta de los procedimientos.
  let documentContext = opts.documentContext?.trim() || undefined
  if (documentContext && simDocNeedsCondense(documentContext)) {
    onProgress?.({
      stage: 'document',
      detail: `El documento es largo (~${estimateDocPages(documentContext)} páginas). Claude lo está condensando en un resumen operativo con las reglas, plazos y procedimientos que necesita la simulación.`,
    })
    documentContext = await condenseSimulationDocument({
      documentContext,
      documentName: opts.documentName,
      description: opts.description,
    }, signal)
  }
  if (documentContext && documentContext.length > SIM_DOC_HARD_LIMIT) {
    documentContext = documentContext.slice(0, SIM_DOC_HARD_LIMIT)
  }

  // ETAPA 1 — el esqueleto. Salida corta, así que esta petición nunca se cae.
  onProgress?.({
    stage: 'outline',
    detail: `Claude está diseñando el mapa de la simulación: ~${nodes} momentos, con sus caminos, objeciones y finales. Todavía no escribe diálogos.`,
  })

  const base = { ...opts, existing: undefined, documentContext, length, esOnly: true, callType: opts.callType ?? 'auto' }

  const { data: outlineData, usage: outlineUsage } = await postGenerateSimulation(
    { ...base, mode: 'outline' },
    signal,
    ({ nodes: drawn }) => {
      if (drawn <= 0) return
      onProgress?.({
        stage: 'outline',
        detail: `Diseñando el mapa de la conversación: ${drawn} de ~${nodes} momentos definidos.`,
        done: Math.min(drawn, nodes),
        total: nodes,
      })
    },
    (attempt, attempts) => onProgress?.({
      stage: 'outline',
      detail: `La conexión se cortó antes de terminar. Reintentando (intento ${attempt} de ${attempts})…`,
    }),
  )

  const plan = outlineData as { metadata: unknown; start_node_id?: string; outline?: OutlineBeat[] }
  const outline = (plan.outline ?? []).filter((b) => b && typeof b.id === 'string')
  if (outline.length === 0) throw new Error('La IA no devolvió un esqueleto válido para el escenario. Inténtalo de nuevo.')

  // El esqueleto ya trae la ficha: desde acá la simulación tiene nombre propio y el
  // indicador global puede dejar de llamarla "sin título" — falta lo más largo
  // (escribir los diálogos) y es justo cuando conviene saber qué se está generando.
  const planTitle = String((plan.metadata as Record<string, unknown> | undefined)?.title_es ?? '').trim()
  if (planTitle) onProgress?.({ stage: 'outline', title: planTitle })

  // ETAPA 2 — los diálogos, de a pocos momentos por petición. Acá está la clave: el
  // escenario puede tener 12 o 34 momentos y ninguna petición se alarga por eso.
  const ids = outline.map((b) => b.id)
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += SIM_NODE_BATCH) batches.push(ids.slice(i, i + SIM_NODE_BATCH))

  const usage: CacheUsage = { ...outlineUsage }
  const writtenNodes: Record<string, unknown> = {}

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]
    const before = Object.keys(writtenNodes).length
    onProgress?.({
      stage: 'writing',
      detail: `Escribiendo los diálogos: ${before} de ${ids.length} momentos listos (lote ${b + 1} de ${batches.length}).`,
      done: before,
      total: ids.length,
    })

    const { data: nodeData, usage: nodeUsage } = await postGenerateSimulation(
      { ...base, mode: 'nodes', metadata: plan.metadata, outline, batch, existing: opts.existing },
      signal,
      ({ nodes: inFlight }) => {
        onProgress?.({
          stage: 'writing',
          detail: `Escribiendo los diálogos: ${before + Math.min(inFlight, batch.length)} de ${ids.length} momentos listos.`,
          done: before + Math.min(inFlight, batch.length),
          total: ids.length,
        })
      },
      (attempt, attempts) => onProgress?.({
        stage: 'writing',
        detail: `La conexión se cortó antes de terminar. Reintentando el lote (intento ${attempt} de ${attempts})…`,
      }),
    )

    Object.assign(writtenNodes, (nodeData as { nodes?: Record<string, unknown> })?.nodes ?? {})
    for (const k of Object.keys(nodeUsage ?? {}) as (keyof CacheUsage)[]) {
      usage[k] = (usage[k] ?? 0) + (nodeUsage[k] ?? 0)
    }
  }

  const scenario = assembleScenario(plan, outline, writtenNodes, opts.type, MIN_TURNS_BEFORE_END[length])

  if (!opts.translate) {
    // Sin traducción: en/pt quedan con el español (mejor que un hueco) hasta que el
    // capacitador pida "Traducir" desde el panel.
    return { data: deepFillTranslations(scenario) as GeneratedScenario, usage }
  }

  return { data: await translateScenario(scenario, signal, onProgress), usage }
}

/* ────────────────────────────────────────────────────────────────────────────
 * EDICIÓN DIRIGIDA ("Ajustar con IA")
 *
 * El capacitador ya tiene su simulación y quiere cambiar UNA parte ("que el
 * cliente exija un supervisor en la objeción", "cambia el motivo por un cobro
 * duplicado"). Antes la única salida era regenerar todo y perder lo que ya
 * estaba bien, o borrar la simulación y empezar de cero hasta que saliera.
 *
 * Acá la IA devuelve un PARCHE: solo los momentos que tocó. Todo lo demás queda
 * exactamente como lo escribió el capacitador.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Lo que devuelve la IA en modo edición: el diff, no el escenario. */
export interface ScenarioPatch {
  /** Momentos reescritos o nuevos, completos. Reemplazan al actual con ese id. */
  nodes?: Record<string, unknown>
  /** Momentos a eliminar. */
  removed?: string[]
  /** Solo los campos de la ficha que cambian. */
  metadata?: Record<string, unknown>
  start_node_id?: string
  /** Qué cambió, en palabras del propio modelo. Es lo que lee el capacitador. */
  changes?: string[]
}

/** Resumen de un ajuste ya aplicado, para mostrarlo antes de aceptar. */
export interface ScenarioEditSummary {
  changed: string[]
  added: string[]
  removed: string[]
  /** La ficha del escenario (cliente, motivo, título…) también cambió. */
  metadata: boolean
  /** Las transiciones que hubo que reencaminar para no dejar destinos rotos. */
  rewired: number
  changes: string[]
}

/**
 * Quita inglés y portugués antes de mandar el escenario a editar. La IA solo
 * necesita el español para entender qué hay y qué cambiar, y así el escenario
 * actual ocupa la mitad del prompt (un escenario largo son 30 momentos × 3
 * idiomas: mandarlo entero era pagar dos tercios de tokens por nada).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripTranslations(value: any): any {
  if (Array.isArray(value)) return value.map(stripTranslations)
  if (value && typeof value === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {}
    for (const k of Object.keys(value)) {
      if (k.endsWith('_en') || k.endsWith('_pt') || k === 'en' || k === 'pt') continue
      o[k] = stripTranslations(value[k])
    }
    return o
  }
  return value
}

/**
 * Pide un ajuste dirigido sobre un escenario existente. Devuelve el PARCHE tal
 * como lo mandó la IA: aplicarlo (y sanearlo) es cosa de `applyScenarioPatch`,
 * para que el capacitador pueda ver primero qué va a cambiar.
 */
export async function editSimulation(opts: {
  type: 'dialogue' | 'choice'
  /** El escenario tal como está hoy en el editor. */
  current: GeneratedScenario
  /** Qué quiere cambiar, en sus palabras. */
  instructions: string
  /** Momentos elegidos. Vacío = la IA decide dónde tocar. */
  focusIds?: string[]
  moduleContext?: string
  documentContext?: string
  documentName?: string
}, signal?: AbortSignal, onProgress?: (p: SimProgress) => void): Promise<{ patch: ScenarioPatch; usage: CacheUsage }> {
  const total = opts.focusIds?.length || undefined
  /** Máximo de momentos escritos visto: si baja, la función volvió a preguntar. */
  let peak = 0
  onProgress?.({
    stage: 'editing',
    detail: total === 1
      ? 'Claude está leyendo la simulación y reescribiendo el momento que elegiste.'
      : total
        ? `Claude está leyendo la simulación y reescribiendo los ${total} momentos que elegiste.`
        : 'Claude está leyendo la simulación completa para decidir qué momentos hay que tocar.',
  })

  // El tipo de llamada ya está decidido en la ficha: se manda explícito para que la
  // guía del prompt no sea la de "dedúcelo del material" (que le pide reescribir todo
  // el escenario coherente con su decisión — justo lo contrario de un ajuste puntual).
  const callType = (opts.current.metadata as { call_type?: string }).call_type === 'outbound'
    ? 'outbound' as const
    : 'inbound' as const

  const { data, usage } = await postGenerateSimulation({
    mode: 'edit',
    type: opts.type,
    description: '',
    callType,
    esOnly: true,
    current: stripTranslations(opts.current),
    instructions: opts.instructions,
    focusIds: opts.focusIds ?? [],
    moduleContext: opts.moduleContext,
    documentContext: opts.documentContext,
    documentName: opts.documentName,
  }, signal, ({ nodes: written }) => {
    if (written <= 0) return
    // OJO: esto cuenta los momentos que la IA va escribiendo, que NO es lo mismo que
    // los que elegiste. Mostrarlo como "8/1" hacía pensar que se estaba pasando de la
    // raya; y si el conteo baja es que la función volvió a preguntar (segunda
    // oportunidad cuando la respuesta no trajo el JSON), no que empezó de cero.
    if (written < peak) {
      onProgress?.({ stage: 'editing', detail: 'La IA se salió del formato. Se lo estamos pidiendo de nuevo…' })
      peak = written
      return
    }
    peak = written
    onProgress?.({
      stage: 'editing',
      detail: `Reescribiendo: ${written} momento${written === 1 ? '' : 's'} escrito${written === 1 ? '' : 's'}.`,
    })
  }, (attempt, attempts) => {
    onProgress?.({
      stage: 'editing',
      detail: `La conexión se cortó antes de terminar. Reintentando (intento ${attempt} de ${attempts})…`,
    })
  })

  const patch = (data ?? {}) as ScenarioPatch
  if (!patch.nodes && !patch.removed?.length && !patch.metadata) {
    throw new Error('La IA no devolvió ningún cambio. Prueba a decirlo de otra forma o a elegir los momentos a ajustar.')
  }
  return { patch, usage }
}

/**
 * Aplica un parche sobre el escenario actual y lo deja consistente.
 *
 * Lo importante es lo que NO hace: no vuelve a escribir nada que la IA no haya
 * mandado. Lo único que se toca de más son las transiciones que quedarían
 * apuntando a un momento eliminado — de eso se encarga `unloopScenario`, el
 * mismo saneador que ya corre al generar y al reproducir.
 */
export function applyScenarioPatch(
  current: GeneratedScenario,
  patch: ScenarioPatch,
  type: 'dialogue' | 'choice',
): { scenario: GeneratedScenario; summary: ScenarioEditSummary } {
  const nodes: Record<string, unknown> = { ...(current.nodes ?? {}) }
  const startBefore = current.start_node_id

  const changed: string[] = []
  const added: string[] = []
  for (const [id, node] of Object.entries(patch.nodes ?? {})) {
    if (!node || typeof node !== 'object') continue
    ;(id in nodes ? changed : added).push(id)
    nodes[id] = node
  }

  // Eliminar nunca puede dejar el escenario sin arranque ni sin cierre: si la IA
  // se pasa de entusiasta, ese borrado se ignora en silencio (el resto se aplica).
  const removed: string[] = []
  for (const id of patch.removed ?? []) {
    if (!(id in nodes)) continue
    if (id === startBefore || id === patch.start_node_id) continue
    if (Object.keys(nodes).length <= 2) break
    delete nodes[id]
    removed.push(id)
  }

  const start = patch.start_node_id && patch.start_node_id in nodes
    ? patch.start_node_id
    : startBefore in nodes ? startBefore : Object.keys(nodes)[0]

  // Destinos rotos (por lo eliminado) y transiciones que retroceden: se reencaminan.
  const rewired = unloopScenario(nodes as Record<string, Record<string, unknown>>, start, type)

  const metadata = patch.metadata
    ? { ...(current.metadata as unknown as Record<string, unknown>), ...patch.metadata }
    : current.metadata

  // La IA edita en español; en/pt de lo tocado se rellenan con el español para que
  // nada quede en blanco. El capacitador traduce de verdad con "Traducir a EN/PT".
  const scenario = deepFillTranslations({
    metadata,
    start_node_id: start,
    nodes,
  }) as GeneratedScenario

  return {
    scenario,
    summary: {
      changed, added, removed, rewired,
      metadata: !!patch.metadata && Object.keys(patch.metadata).length > 0,
      changes: (patch.changes ?? []).filter((c) => typeof c === 'string' && c.trim()),
    },
  }
}

/** Nodos por llamada de traducción (Haiku): suficientes para ir rápido, sin cortar el JSON. */
const TRANSLATE_NODE_BATCH = 4

/**
 * Vacía inglés y portugués para que la pasada de traducción los rellene de verdad.
 * Hace falta porque `deepFillTranslations` copia el español en en/pt: sin esto, al
 * traducir después Haiku ve los campos "llenos" (en español) y no los toca.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function blankTranslations(value: any): any {
  if (Array.isArray(value)) return value.map(blankTranslations)
  if (value && typeof value === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {}
    for (const k of Object.keys(value)) o[k] = blankTranslations(value[k])
    if (typeof o.es === 'string') {
      if (typeof o.en === 'string') o.en = ''
      if (typeof o.pt === 'string') o.pt = ''
    }
    for (const k of Object.keys(o)) {
      if (!k.endsWith('_es')) continue
      const base = k.slice(0, -3)
      for (const lang of ['en', 'pt']) {
        const key = `${base}_${lang}`
        if (typeof o[key] === 'string') o[key] = ''
        else if (Array.isArray(o[key])) o[key] = []
      }
    }
    return o
  }
  return value
}

/**
 * Traduce a inglés y portugués un escenario ya escrito en español (Haiku, por lotes).
 * Se usa cuando el capacitador ya pulió el contenido y recién ahí quiere los 3 idiomas.
 */
export async function translateScenario(
  scenario: GeneratedScenario,
  signal?: AbortSignal,
  onProgress?: (p: SimProgress) => void,
): Promise<GeneratedScenario> {
  const source = blankTranslations(scenario) as GeneratedScenario
  const entries = Object.entries(source.nodes ?? {})
  const batches = Math.ceil(entries.length / TRANSLATE_NODE_BATCH)
  const total = batches + 1 // + la metadata

  let out = source
  onProgress?.({ stage: 'translating', detail: 'Traduciendo la ficha del escenario…', done: 0, total })

  try {
    const meta = await translateGenerated<{ metadata: unknown }>({ metadata: source.metadata }, signal)
    if (meta?.metadata) out = { ...out, metadata: meta.metadata } as GeneratedScenario
  } catch { /* red de seguridad al final */ }

  // Los nodos van por lotes: acota cada llamada y evita respuestas cortadas.
  const nodes: Record<string, unknown> = {}
  for (let i = 0; i < entries.length; i += TRANSLATE_NODE_BATCH) {
    const n = i / TRANSLATE_NODE_BATCH + 1
    onProgress?.({
      stage: 'translating',
      detail: `Traduciendo los momentos de la conversación a inglés y portugués (lote ${n} de ${batches}).`,
      done: n,
      total,
    })
    const batch = Object.fromEntries(entries.slice(i, i + TRANSLATE_NODE_BATCH))
    let translated = batch
    try {
      translated = await translateGenerated<Record<string, unknown>>(batch, signal)
    } catch { /* red de seguridad al final */ }
    Object.assign(nodes, translated ?? batch)
  }

  return deepFillTranslations({ ...out, nodes }) as GeneratedScenario
}

/**
 * Errores que NO vienen de nuestra función sino de la infraestructura de Supabase.
 * No traen JSON (o traen uno con otra forma), así que sin esto el capacitador veía
 * "Unexpected token '<'" o un "Error del servidor (546)" que no le dice nada.
 *
 * - 502/504: el gateway cortó la conexión mientras la función seguía escribiendo.
 * - 546 (WORKER_LIMIT): Supabase MATÓ al worker por pasarse de tiempo/memoria. Es lo
 *   que aparece cuando el escenario pedido es tan largo que Claude no termina dentro
 *   del límite de la Edge Function; la salida es acortar el escenario, no reintentar.
 * - 503: la función no arrancó (BOOT_ERROR), casi siempre un despliegue a medias.
 */
function edgeInfraError(status: number): string | null {
  if (status === 546) {
    return 'El servidor cortó la generación por límite de recursos: el escenario pedido es demasiado grande. Elige extensión "Media" o "Corta", acorta la descripción o usa un documento de apoyo más breve.'
  }
  if (status === 502 || status === 504) {
    return 'La generación tardó demasiado y el servidor cortó la conexión. Intenta con una descripción más corta o un escenario más simple.'
  }
  if (status === 503) {
    return 'El servicio de generación no está disponible en este momento (la función no arrancó). Inténtalo de nuevo en un minuto.'
  }
  return null
}

/** Avance que emite la función mientras Claude escribe (nodos ya cerrados en el JSON). */
type SimStreamTick = (p: { nodes: number; chars: number }) => void

/**
 * El stream se cortó a mitad de camino: no llegó el evento 'done' ni un 'error'.
 * No es un fallo de la IA sino de la conexión (el gateway de Supabase cierra la
 * conexión inactiva, o el worker se quedó sin recursos), así que se distingue del
 * resto de errores para poder REINTENTARLO en vez de mostrárselo al capacitador.
 */
class SimStreamTruncated extends Error {
  constructor() {
    super('La conexión se interrumpió mientras se generaba el escenario.')
    this.name = 'SimStreamTruncated'
  }
}

/**
 * Lee la respuesta en streaming de `generate-simulation` (eventos SSE `data: {...}`).
 * El escenario final llega en el evento `done`; los errores que ocurren DESPUÉS de
 * que salieron los headers viajan como evento `error`, no como status HTTP.
 */
async function readSimulationStream(
  response: Response,
  onTick?: SimStreamTick,
): Promise<{ data: unknown; usage: CacheUsage }> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let done: { data: unknown; usage: CacheUsage } | null = null

  for (;;) {
    const { value, done: finished } = await reader.read()
    if (finished) break
    buffer += value

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        let evt: { type?: string; message?: string; nodes?: number; chars?: number; data?: unknown; usage?: CacheUsage }
        try { evt = JSON.parse(payload) } catch { continue }

        if (evt.type === 'progress') {
          onTick?.({ nodes: evt.nodes ?? 0, chars: evt.chars ?? 0 })
        } else if (evt.type === 'error') {
          throwAiError(evt.message ?? 'Error generando simulación')
        } else if (evt.type === 'done') {
          done = { data: evt.data, usage: evt.usage as CacheUsage }
        }
      }
    }
  }

  // El stream terminó sin 'done': la conexión se cayó a mitad de la escritura.
  if (!done) throw new SimStreamTruncated()
  return done
}

/** Intentos totales cuando la conexión se corta sola (el primero + 2 reintentos). */
const SIM_STREAM_ATTEMPTS = 3

/**
 * Reintenta solo cuando la conexión se cortó (no cuando la IA falló de verdad).
 * Nada se guarda antes del evento 'done', así que volver a pedirlo es seguro: el
 * capacitador ve "reintentando" en vez de un error que lo obliga a empezar de cero.
 */
async function postGenerateSimulation(
  body: Record<string, unknown>,
  signal?: AbortSignal,
  onTick?: SimStreamTick,
  onRetry?: (attempt: number, total: number) => void,
): Promise<{ data: unknown; usage: CacheUsage }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runGenerateSimulation(body, signal, onTick)
    } catch (err) {
      const truncated = err instanceof SimStreamTruncated
      if (!truncated) throw err
      if (attempt >= SIM_STREAM_ATTEMPTS || signal?.aborted) {
        throw new Error(
          'La conexión con el servidor de IA se cortó varias veces seguidas. Vuelve a intentarlo en un minuto; si sigue pasando, pide el ajuste por partes (menos momentos a la vez).',
        )
      }
      onRetry?.(attempt + 1, SIM_STREAM_ATTEMPTS)
      await new Promise((r) => setTimeout(r, 1500 * attempt))
      if (signal?.aborted) throw err
    }
  }
}

async function runGenerateSimulation(
  body: Record<string, unknown>,
  signal?: AbortSignal,
  onTick?: SimStreamTick,
): Promise<{ data: unknown; usage: CacheUsage }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-simulation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal,
    },
  )

  const gateway = edgeInfraError(response.status)
  if (gateway) throw new Error(gateway)

  // Escribir el escenario va en streaming (así el gateway no corta a los ~2 min);
  // el condensado del documento es corto y sigue viniendo como JSON de una.
  if (response.ok && response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
    const result = await readSimulationStream(response, onTick)
    useAiCreditsStore.getState().markOk()
    return result
  }

  const result = await response.json().catch(() => ({ error: `Error del servidor (${response.status})` }))
  if (!response.ok || result.error) {
    throwAiError(result.error ?? 'Error generando simulación')
  }

  useAiCreditsStore.getState().markOk()
  return { data: result.data, usage: result.usage as CacheUsage }
}

export interface DocImage {
  mediaType: string
  dataBase64: string
  /** Página del documento (1-based) donde apareció la figura; ancla la captura a su paso. */
  page?: number
}

/** Contexto del documento compartido por las llamadas de generación (se cachea en el servidor). */
export interface DocContext {
  documentText?: string
  images?: DocImage[]
  contextImages?: DocImage[]
  /** Modo manual paso a paso: fidelidad máxima, conservar y anclar cada captura a su paso. */
  manualMode?: boolean
}

export type GeneratedSectionStyle = 'default' | 'immersive' | 'spotlight' | 'feature'

/** Esquema de un módulo: metadata + títulos de sección, sin el contenido de los bloques. */
export interface ModuleOutline {
  metadata: GeneratedModuleMeta
  sections: {
    heading_es: string; heading_en: string; heading_pt: string
    section_style?: GeneratedSectionStyle
  }[]
}

/**
 * Rellena inglés/portugués a partir del español, de forma recursiva y en JS puro.
 * Red de seguridad: garantiza que ningún campo quede vacío aunque la traducción con
 * IA falle o se saltee algo. En el peor caso muestra el español (mejor que un hueco).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deepFillTranslations(value: any): any {
  if (Array.isArray(value)) return value.map(deepFillTranslations)
  if (value && typeof value === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {}
    for (const k of Object.keys(value)) o[k] = deepFillTranslations(value[k])
    // Objetos de texto { es, en, pt }
    if (typeof o.es === 'string') {
      if (!o.en) o.en = o.es
      if (!o.pt) o.pt = o.es
    }
    // Tríos *_es / *_en / *_pt (strings o arrays)
    for (const k of Object.keys(o)) {
      if (!k.endsWith('_es')) continue
      const base = k.slice(0, -3)
      const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0)
      if (empty(o[`${base}_en`])) o[`${base}_en`] = o[k]
      if (empty(o[`${base}_pt`])) o[`${base}_pt`] = o[k]
    }
    return o
  }
  return value
}

/** Traduce (en/pt) un JSON generado en español, con Haiku. Devuelve el mismo objeto relleno. */
export async function translateGenerated<T>(payload: T, signal?: AbortSignal): Promise<T> {
  const { data } = await postGenerateModule({ mode: 'translate', payload, description: '' }, signal)
  return data as T
}

async function postGenerateModule(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ data: unknown; usage: CacheUsage }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-module`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
      signal,
    },
  )

  const gateway = edgeInfraError(response.status)
  if (gateway) throw new Error(gateway)

  const result = await response.json().catch(() => ({ error: `Error del servidor (${response.status})` }))
  if (!response.ok || result.error) {
    throwAiError(result.error ?? 'Error generando módulo')
  }
  useAiCreditsStore.getState().markOk()
  return { data: result.data, usage: result.usage as CacheUsage }
}

/** Recuadro de una captura dentro de una página (porcentaje 0-100). */
export interface CaptureBox { x: number; y: number; w: number; h: number; caption_es?: string }
export interface CaptureDetection {
  pages?: { page: number; captures?: CaptureBox[] }[]
}

/**
 * Modo manual + PDF escaneado: localiza con visión las capturas relevantes de cada
 * página (recuadros en %). El cliente las recorta luego con `cropCaptures`.
 */
export async function detectCaptures(opts: {
  contextImages: DocImage[]
}, signal?: AbortSignal): Promise<{ data: CaptureDetection; usage: CacheUsage }> {
  const { data, usage } = await postGenerateModule({
    mode: 'detect-figures',
    description: '',
    contextImages: opts.contextImages,
  }, signal)
  return { data: (data ?? { pages: [] }) as CaptureDetection, usage }
}

export async function generateModule(opts: {
  description: string
} & DocContext): Promise<{ data: GeneratedModule; usage: CacheUsage }> {
  // Solo español: traducir aquí costaba plata en contenido que casi siempre se
  // reescribe después. En/pt quedan con el español y el capacitador pide la
  // traducción cuando el curso ya está listo (ver translation.service.ts).
  const { data, usage } = await postGenerateModule({ esOnly: true, ...opts })
  return { data: deepFillTranslations(data as GeneratedModule) as GeneratedModule, usage }
}

/**
 * Paso 1 (a prueba de límites): genera solo el esquema del módulo, en español.
 * En/pt se rellenan con el español hasta que se pida traducir de verdad.
 */
export async function generateModuleOutline(opts: {
  description: string
  /** Cantidad de secciones sugerida (proporcional al tamaño del documento). */
  targetSections?: number
} & DocContext, signal?: AbortSignal): Promise<{ data: ModuleOutline; usage: CacheUsage }> {
  const { data, usage } = await postGenerateModule({ mode: 'outline', esOnly: true, ...opts }, signal)
  return { data: deepFillTranslations(data as ModuleOutline) as ModuleOutline, usage }
}

/**
 * Paso 2 (a prueba de límites): genera los bloques de UNA sección, en español.
 * La traducción va aparte, al final, cuando el capacitador da el curso por listo.
 */
export async function generateModuleSection(opts: {
  description: string
  moduleTitle: string
  moduleSubtitle?: string
  objectives?: string[]
  sectionHeading: string
  sectionIndex: number
  totalSections: number
  allHeadings: string[]
} & DocContext, signal?: AbortSignal): Promise<{ data: { blocks: GeneratedBlock[] }; usage: CacheUsage }> {
  const { data, usage } = await postGenerateModule({ mode: 'section', esOnly: true, ...opts }, signal)
  const blocks = (data as { blocks?: GeneratedBlock[] })?.blocks ?? []
  return { data: { blocks: deepFillTranslations(blocks) as GeneratedBlock[] }, usage }
}

export interface ProposedModule {
  title_es: string
  focus_es: string
  topics: string[]
}

export async function analyzeDocument(opts: {
  documentText: string
  instructions?: string
  campaignName?: string
  images?: DocImage[]
  contextImages?: DocImage[]
}): Promise<{ data: { modules: ProposedModule[] }; usage: CacheUsage }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-document`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(opts),
    },
  )

  const result = await response.json()
  if (!response.ok || result.error) {
    throwAiError(result.error ?? 'Error analizando el documento')
  }

  return {
    data: { modules: (result.data?.modules ?? []) as ProposedModule[] },
    usage: result.usage as CacheUsage,
  }
}

export interface AssistRequest {
  action: 'translate' | 'improve' | 'split_plan' | 'merge_plan' | 'pensum'
  contentType: 'section' | 'meta'
  sourceLang: string
  targetLangs?: string[]
  fields: Record<string, string>
  moduleTitle?: string
  /**
   * Cirugía de módulos (separar/unir). `want` es lo que el capacitador marcó en
   * los interruptores del modal: la IA solo produce lo pedido.
   */
  surgery?: {
    want: Array<'cut' | 'meta' | 'bridge'>
    cutIndex?: number
    /** Qué corregir respecto al intento anterior ("más corto", "sin tecnicismos"). */
    instruction?: string
    modules: Array<{
      title_es: string
      subtitle_es?: string | null
      objectives_es?: string[]
      key_takeaways_es?: string[]
      sections: Array<{ heading_es: string; excerpt_es: string }>
    }>
  }
  /**
   * Pénsum del certificado: los módulos a los que hay que redactarles objetivos
   * y conclusiones. Van TODOS en una sola llamada para que el modelo vea el
   * curso completo y no repita la misma idea en dos módulos.
   */
  pensum?: {
    courseTitle?: string
    modules: Array<{
      title_es: string
      subtitle_es?: string | null
      objectives_es?: string[]
      key_takeaways_es?: string[]
      sections: Array<{ heading_es: string; excerpt_es: string }>
    }>
  }
}

export async function moduleAiAssist(opts: AssistRequest): Promise<{ data: Record<string, unknown>; usage: CacheUsage }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/module-ai-assist`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(opts),
    },
  )

  const result = await response.json()
  if (!response.ok || result.error) {
    throwAiError(result.error ?? 'Error procesando contenido')
  }

  return { data: result.data, usage: result.usage as CacheUsage }
}

/** Obtiene las secciones del módulo y construye el contexto de texto para el prompt de IA. */
export async function getModuleContextText(moduleId: string): Promise<string> {
  const { data, error } = await supabase
    .from('module_sections')
    .select('heading_es, body_es')
    .eq('module_id', moduleId)
    .order('sort_order')

  if (error) throw error

  return (data ?? [])
    .map((s) => {
      const lines = [`## ${s.heading_es}`]
      if (Array.isArray(s.body_es)) lines.push(...(s.body_es as string[]))
      return lines.join('\n')
    })
    .join('\n\n')
}
