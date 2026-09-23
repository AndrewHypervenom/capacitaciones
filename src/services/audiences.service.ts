import { supabase } from '@/lib/supabase'
import type { CourseAudience } from '@/types/database'

/* ─── A quién le llega un curso ────────────────────────────────────────────
 *
 * La regla vive en `course_audiences`: una fila por curso, con tres ejes que
 * apuntan a los atributos de la persona (país, operación, área).
 *
 * Semántica —conviene tenerla clara antes de tocar nada:
 *   · Dentro de un eje se SUMA:   Colombia o México o Argentina.
 *   · Entre ejes se CRUZA:        Colombia Y Talento Humano.
 *   · Un eje vacío no restringe:  "solo Talento Humano" vale en los 3 países.
 *   · Todo vacío y sin `everyone` → NO LE LLEGA A NADIE.
 *
 * Ese último caso es deliberado: un curso a medio definir no debe salir a 800
 * personas por descuido. Falla cerrado.
 *
 * La misma regla se evalúa en dos sitios: en la base (`audience_matches`, que
 * es lo que manda para la RLS) y aquí en el cliente (`matchesAudience`, solo
 * para PREVISUALIZAR a cuánta gente afectaría antes de guardar). Si alguna vez
 * se cambia la semántica, hay que cambiarla en los dos — por eso está escrita
 * igual en ambos lados, y por eso lo dice este comentario.
 *
 * Degradación: mientras el SQL de la fase 4 no se haya corrido, la tabla no
 * existe y todo devuelve "sin regla" en vez de reventar.
 */

/** Lo que la interfaz edita. Es la fila sin los campos de auditoría. */
export interface AudienceRule {
  everyone: boolean
  countries: string[]
  operationIds: string[]
  areaIds: string[]
  isMandatory: boolean
  /**
   * ¿La regla alcanza también a los CLIENTES (gente de fuera de la compañía)?
   *
   * Apagado por defecto y por encima de todo lo demás: «toda la organización»
   * quiere decir toda la ORGANIZACIÓN, no todo el mundo que tiene cuenta. Un
   * curso interno marcado para todos no puede acabar en la pantalla de un
   * cliente por descuido — ese es justo el caso que hay que hacer imposible.
   */
  includeClients: boolean
}

export const EMPTY_RULE: AudienceRule = {
  everyone: false,
  countries: [],
  operationIds: [],
  areaIds: [],
  isMandatory: false,
  includeClients: false,
}

function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === '42P01' ||
    error.code === '42703' ||
    error.code === 'PGRST205' ||
    error.code === 'PGRST202' || // la función RPC no existe todavía
    /does not exist|schema cache/i.test(error.message ?? '')
  )
}

function toRule(row: CourseAudience): AudienceRule {
  return {
    everyone: row.everyone,
    countries: row.countries ?? [],
    operationIds: row.operation_ids ?? [],
    areaIds: row.area_ids ?? [],
    isMandatory: row.is_mandatory,
    // Si la columna todavía no existe (SQL sin correr) llega `undefined`, que
    // se lee como "no incluye clientes": se cierra, no se abre.
    includeClients: row.include_clients === true,
  }
}

/**
 * ¿La regla no dice nada todavía? Entonces no le llega a nadie.
 *
 * `includeClients` no cuenta como contenido: es un PERMISO sobre los ejes de
 * abajo, no un eje. Marcarlo solo, sin país ni «toda la organización», no le
 * llega a ningún cliente tampoco — igual que no le llega a ningún empleado.
 */
export function ruleIsEmpty(r: AudienceRule): boolean {
  return (
    !r.everyone &&
    r.countries.length === 0 &&
    r.operationIds.length === 0 &&
    r.areaIds.length === 0
  )
}

/**
 * ¿A esta persona le toca?
 *
 * Copia exacta de `audience_matches` en la base. Solo para previsualizar: la
 * autoridad es la de la base, que es la que la RLS consulta.
 */
export function matchesAudience(
  rule: AudienceRule,
  person: {
    country?: string | null
    operation_id?: string | null
    area_id?: string | null
    is_client?: boolean | null
    role?: string | null
  },
): boolean {
  // Los clientes van ANTES que todo lo demás, incluido `everyone`: son gente de
  // fuera, y el contenido interno solo les llega si alguien lo dijo a propósito.
  if (person.is_client === true && !rule.includeClients) return false
  // Recursos Humanos administra gente, no estudia: ninguna regla le llega, ni
  // `everyone`. Lo mismo hace `audience_matches` en la base (SQL 76).
  if (person.role === 'rh') return false
  // Un APRENDIZ sin área NI CR no está en ningún grupo: no viene de la base de
  // Talento Humano (que siempre trae los dos) ni del alta, que los exige. Es una
  // cuenta de prueba o de paso, y recibe SOLO lo que se le asigne a mano. Sin
  // esto, una regla «solo por país» le entregaba todo el contenido de Colombia a
  // quien se creó para ver un único curso. El staff no entra en este corte.
  if (isLearnerRole(person.role) && !person.area_id && !person.operation_id) return false
  if (rule.everyone) return true
  if (ruleIsEmpty(rule)) return false
  if (rule.countries.length > 0 && !rule.countries.includes(person.country ?? '')) return false
  if (rule.operationIds.length > 0 && !rule.operationIds.includes(person.operation_id ?? '')) return false
  if (rule.areaIds.length > 0 && !rule.areaIds.includes(person.area_id ?? '')) return false
  return true
}

/** La regla de un curso, o `null` si todavía no tiene ninguna. */
export async function getAudience(courseId: string): Promise<AudienceRule | null> {
  const { data, error } = await supabase
    .from('course_audiences')
    .select('*')
    .eq('course_id', courseId)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return data ? toRule(data as CourseAudience) : null
}

/**
 * TODAS las reglas visibles, sin lista de ids: para los tableros que cruzan
 * cada persona con cada curso (una URL con cientos de ids da 400).
 */
export async function getAllAudiences(): Promise<Map<string, AudienceRule>> {
  const out = new Map<string, AudienceRule>()
  const { data, error } = await supabase.from('course_audiences').select('*')
  if (error) {
    if (isMissingSchema(error)) return out
    throw error
  }
  for (const row of (data ?? []) as CourseAudience[]) out.set(row.course_id, toRule(row))
  return out
}

/** Las reglas de varios cursos de una vez, para pintar un listado. */
export async function getAudiences(courseIds: string[]): Promise<Map<string, AudienceRule>> {
  const out = new Map<string, AudienceRule>()
  if (courseIds.length === 0) return out
  const { data, error } = await supabase
    .from('course_audiences')
    .select('*')
    .in('course_id', courseIds)
  if (error) {
    if (isMissingSchema(error)) return out
    throw error
  }
  for (const row of (data ?? []) as CourseAudience[]) out.set(row.course_id, toRule(row))
  return out
}

export async function saveAudience(courseId: string, rule: AudienceRule): Promise<void> {
  const { data: auth } = await supabase.auth.getUser()
  const { error } = await supabase.from('course_audiences').upsert(
    {
      course_id: courseId,
      // `everyone` gana sobre los ejes: si va a todo el mundo, guardar además
      // una lista de países sería contradictorio y confundiría al que lo abra
      // después. Se limpia al guardar, no al pintar.
      everyone: rule.everyone,
      countries: rule.everyone ? [] : rule.countries,
      operation_ids: rule.everyone ? [] : rule.operationIds,
      area_ids: rule.everyone ? [] : rule.areaIds,
      is_mandatory: rule.isMandatory,
      include_clients: rule.includeClients,
      updated_by: auth.user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'course_id' },
  )
  if (error) throw error
}

/** Quita la regla: el curso vuelve a depender solo de campañas y asignaciones. */
export async function clearAudience(courseId: string): Promise<void> {
  const { error } = await supabase.from('course_audiences').delete().eq('course_id', courseId)
  if (error && !isMissingSchema(error)) throw error
}

export interface AudiencePerson {
  id: string
  display_name: string | null
  role: string | null
  country: string | null
  operation_id: string | null
  area_id: string | null
  /** Gente de fuera: no la alcanza ninguna regla salvo que el curso lo diga. */
  is_client: boolean | null
}

/**
 * Todas las personas activas con los datos con los que se resuelve cualquier regla.
 *
 * Se pide UNA vez por organización y se cachea: el selector de audiencia la
 * consulta con cada clic para poder decir, al lado de cada opción, a cuánta
 * gente lleva. Volver al servidor por cada tecla convertiría esa ayuda en una
 * espera.
 *
 * TRES TRAMPAS QUE YA COSTARON UN NÚMERO FALSO (2026-09-16, GOBIERNO LATAM
 * decía 11 y eran 19):
 *   · `org_id` VACÍO. 51 aprendices activos no tienen organización, y
 *     `audience_matches()` en la base NO mira la organización: a ellos el curso
 *     sí les llega. Filtrar por `org_id = X` los borraba del conteo. Se aceptan
 *     los de esa organización y los que no tienen ninguna.
 *   · SOLO APRENDICES. La base le entrega el curso a quien cumpla la regla, sea
 *     del rol que sea; capacitadores y admins también lo tienen. Se traen todos
 *     y se cuentan aparte (`role`), para no mezclarlos con «aprendices».
 *   · EL TOPE DE 1000 FILAS de PostgREST. Con 859 perfiles todavía no mordía,
 *     pero el día que pase de mil el censo se cortaría callado. Se pide por páginas.
 */
let poblacion = new Map<string, Promise<AudiencePerson[]>>()

const PAGE = 1000

export async function getAudiencePopulation(orgId: string): Promise<AudiencePerson[]> {
  if (!orgId) return []
  const hit = poblacion.get(orgId)
  if (hit) return hit
  const pending = (async () => {
    const pedir = (cols: string, from: number) =>
      supabase
        .from('profiles')
        .select(cols)
        .or(`org_id.eq.${orgId},org_id.is.null`)
        .eq('is_active', true)
        .order('id')
        .range(from, from + PAGE - 1)

    let cols = 'id, display_name, role, country, operation_id, area_id, is_client'
    const out: AudiencePerson[] = []
    for (let from = 0; ; from += PAGE) {
      let { data, error } = await pedir(cols, from)
      // Mientras el SQL de clientes no se haya corrido, `is_client` no existe y
      // PostgREST tumba la consulta ENTERA (42703). Sin este reintento el censo
      // llegaría vacío y el editor diría "0 personas" en todos los CR, que es
      // mucho peor que no saber quién es cliente. Se reintenta sin la columna.
      if (error && error.code === '42703' && cols.includes('is_client')) {
        cols = 'id, display_name, role, country, operation_id, area_id'
        ;({ data, error } = await pedir(cols, from))
      }
      if (error) {
        if (isMissingSchema(error)) return []
        throw error
      }
      const rows = (data ?? []) as unknown as AudiencePerson[]
      for (const p of rows) out.push({ ...p, is_client: p.is_client ?? false })
      if (rows.length < PAGE) break
    }
    return out
  })()
  poblacion.set(orgId, pending)
  // Un fallo no se cachea: el siguiente intento tiene que poder funcionar.
  pending.catch(() => poblacion.delete(orgId))
  return pending
}

/** ¿Es aprendiz? Todo lo demás (capacitador, admin, RH…) es «del equipo». */
export function isLearnerRole(role: string | null | undefined): boolean {
  return (role ?? 'learner') === 'learner'
}

/** Tras una carga de nómina la gente cambió de CR: el censo hay que rehacerlo. */
export function invalidateAudiencePopulation(): void {
  poblacion = new Map()
}

/**
 * A cuánta gente le llegaría esta regla, contando de verdad contra los perfiles.
 *
 * Es lo que se enseña ANTES de guardar. Un número concreto —"le llega a 489
 * personas"— es lo único que evita publicar un curso creyendo que va a un área
 * y descubrir después que fue a toda la compañía.
 */
export async function countAudience(
  orgId: string,
  rule: AudienceRule,
): Promise<{ matched: number; staff: number; total: number; clients: number } | null> {
  if (!orgId) return null
  const people = await getAudiencePopulation(orgId)
  const alcanzados = people.filter((p) => matchesAudience(rule, p))
  const aprendices = alcanzados.filter((p) => isLearnerRole(p.role))
  return {
    // Aprendices a los que llega. El equipo va aparte: también lo recibe, pero
    // «12 de 786 aprendices» no puede contar a un capacitador.
    matched: aprendices.length,
    staff: alcanzados.length - aprendices.length,
    // El total son los aprendices de CASA. Los clientes no entran en el
    // denominador: decir "12 de 830" cuando 8 de esos 12 son de un cliente
    // mezcla dos poblaciones que no se comparan.
    total: people.filter((p) => isLearnerRole(p.role) && p.is_client !== true).length,
    // Cuántos de los alcanzados son de fuera. Es el número que hay que poder
    // ver ANTES de publicar cuando se abre un curso a clientes.
    clients: alcanzados.filter((p) => p.is_client === true).length,
  }
}

/** Cuántos clientes activos hay en la organización (para explicar el interruptor). */
export async function countClients(orgId: string): Promise<number> {
  if (!orgId) return 0
  const people = await getAudiencePopulation(orgId)
  return people.filter((p) => p.is_client === true).length
}

/**
 * Los cursos que me tocan por regla. Va por RPC a propósito: a quién le llega
 * cada curso es información de gestión, y el aprendiz no tiene por qué poder
 * leer las reglas de todos los cursos para saber cuáles son los suyos.
 */
export interface MyAudienceCourse {
  isMandatory: boolean
  /**
   * ¿La regla apunta a ÁREA o CR? Una regla solo por país (o la vieja «toda la
   * organización») es amplia: le da acceso, pero el curso vive en el catálogo y
   * no en el inicio del aprendiz, salvo que sea obligatorio.
   */
  isTargeted: boolean
}

/**
 * Desde cuándo tiene la persona cada curso que le llega POR REGLA (RPC del SQL
 * 42). Es lo que permite fechar el plazo "N días desde la asignación" de quien
 * no tiene asignación a mano: la gente nueva recibe su inducción por la regla de
 * país/área/CR, no a dedo. Cuenta desde lo más tardío entre que entró la persona
 * y la última vez que se tocó la regla.
 *
 * Si el SQL 42 no se ha corrido devuelve un mapa vacío: esos cursos se quedan
 * sin fecha, exactamente como antes.
 */
export async function getMyAudienceRuleDates(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_my_audience_rule_dates')
  if (error) {
    if (isMissingSchema(error)) return out
    throw error
  }
  for (const r of (data ?? []) as Array<{ course_id: string; rule_at: string | null }>) {
    if (r.rule_at) out.set(r.course_id, r.rule_at)
  }
  return out
}

export async function getMyAudienceCourses(): Promise<Map<string, MyAudienceCourse>> {
  const out = new Map<string, MyAudienceCourse>()
  const detail = await supabase.rpc('get_my_audience_courses_detail')
  if (!detail.error) {
    for (const r of detail.data ?? []) {
      out.set(r.course_id, { isMandatory: r.is_mandatory, isTargeted: r.is_targeted })
    }
    return out
  }
  if (!isMissingSchema(detail.error)) throw detail.error
  // SQL 40 sin correr: el RPC viejo no dice cómo es la regla. Se trata todo como
  // dirigido, que es exactamente como se comportaba antes.
  const { data, error } = await supabase.rpc('get_my_audience_courses')
  if (error) {
    if (isMissingSchema(error)) return out
    throw error
  }
  for (const r of data ?? []) {
    out.set(r.course_id, { isMandatory: r.is_mandatory, isTargeted: true })
  }
  return out
}
