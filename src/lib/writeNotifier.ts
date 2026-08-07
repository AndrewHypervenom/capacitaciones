/**
 * Detecta CUALQUIER escritura de contenido contra Supabase y la anuncia al resto
 * de pestañas.
 *
 * La alternativa era llamar a `notifyDataChanged` a mano en cada función de cada
 * servicio (son decenas) y aceptar que la próxima que se escriba se olvide. Como
 * todas las peticiones ya pasan por un `fetch` instrumentado (`healthFetch`),
 * aquí se aprovecha ese mismo punto: se mira el método y la tabla de la URL de
 * PostgREST y, si la escritura salió bien, se avisa.
 *
 * Reglas del mapa de abajo:
 *
 * - Es una lista BLANCA, no negra. Solo se anuncian tablas de contenido que
 *   alguien puede estar mirando en otra pestaña.
 * - Queda fuera a propósito todo lo de alta frecuencia (`user_progress`,
 *   `module_time`, `activity_log`, intentos…): anunciarlo dispararía recargas en
 *   cadena en las demás pestañas cada pocos segundos, que es peor que el
 *   problema original.
 */
import { notifyDataChanged } from '@/lib/crossTab'

/** Tabla o RPC → tema que refresca. Lo que no esté aquí no se anuncia. */
const TOPIC_BY_TABLE: Record<string, string> = {
  scenarios: 'simulations',
  choice_scenarios: 'simulations',

  courses: 'courses',
  course_modules: 'courses',
  course_assignments: 'courses',
  course_campaigns: 'courses',
  certifications: 'courses',

  modules: 'modules',
  module_sections: 'modules',
  section_quizzes: 'modules',

  worlds: 'worlds',
  world_regions: 'worlds',
  world_levels: 'worlds',

  arena_quizzes: 'arena',
  guided_missions: 'missions',
  live_quizzes: 'livequiz',

  profiles: 'users',
  campaigns: 'campaigns',
  campaign_collaborators: 'campaigns',
  achievement_defs: 'gamification',
  xp_levels: 'gamification',
  xp_events: 'gamification',
  deletion_requests: 'approvals',
}

/** RPCs que escriben. El nombre de la función es el que va en la URL. */
const TOPIC_BY_RPC: Record<string, string> = {
  clone_scenario: 'simulations',
  clone_choice_scenario: 'simulations',
  clone_course: 'courses',
  clone_module_to_course: 'modules',
  attach_module_to_course: 'modules',
  move_course_to_campaign: 'courses',
  move_module_to_campaign: 'modules',
  split_module_progress: 'modules',
  merge_module_progress: 'modules',
  issue_certification: 'courses',
  request_course_recertification: 'courses',
  self_enroll_course: 'courses',
  unenroll_self: 'courses',
  request_deletion: 'approvals',
  approve_deletion: 'approvals',
  reject_deletion: 'approvals',
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

/**
 * Los avisos se agrupan: guardar un módulo puede escribir la fila, sus secciones
 * y sus quizzes en ráfaga, y no tiene sentido que la otra pestaña recargue tres
 * veces. Se manda uno por tema al final de la ráfaga.
 */
const COALESCE_MS = 400
const pending = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function queue(topic: string) {
  pending.add(topic)
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    for (const t of pending) notifyDataChanged(t)
    pending.clear()
  }, COALESCE_MS)
}

/** Saca la tabla (o el RPC) de una URL de PostgREST. */
function topicFor(url: string): string | null {
  const rest = url.indexOf('/rest/v1/')
  if (rest === -1) return null
  const tail = url.slice(rest + '/rest/v1/'.length)
  const path = tail.split('?')[0]

  if (path.startsWith('rpc/')) return TOPIC_BY_RPC[path.slice(4)] ?? null
  return TOPIC_BY_TABLE[path] ?? null
}

/**
 * Envuelve un `fetch` para que, además de lo suyo, anuncie las escrituras.
 * No cambia la respuesta ni traga errores: si algo falla aquí, la petición sigue.
 */
export function withWriteNotifier(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await inner(input, init)

    try {
      const method = (
        init?.method
        ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')
      ).toUpperCase()
      if (!WRITE_METHODS.has(method) || !response.ok) return response

      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const topic = topicFor(url)
      if (topic) queue(topic)
    } catch {
      /* el aviso es un extra: nunca puede romper la petición */
    }

    return response
  }
}
