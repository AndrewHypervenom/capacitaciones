import { supabase } from '@/lib/supabase'
import { fold } from '@/lib/normalize'
import type { Organization, OrgUnit, OrgUnitKind } from '@/types/database'

/* ─── Organizaciones y unidades ────────────────────────────────────────────
 *
 * Las dos capas nuevas de la reestructura:
 *
 *   Organización  → la empresa dueña. Positivos+ es la primera; las que entren
 *                   después quedan aisladas (su gente, su contenido, sus
 *                   reportes). LearningAI las administra todas.
 *   Unidad        → el catálogo CERRADO de operaciones y áreas de una
 *                   organización. Solo el superadmin escribe (lo impone la
 *                   RLS); el resto elige de la lista. Es lo que impide que se
 *                   repita el desorden de las campañas, donde cada quien
 *                   inventaba la suya.
 *
 * El PAÍS no vive aquí: ya está en `profiles.country` y su lista la da
 * `lib/countries.ts`. Un eje menos que mantener.
 *
 * Degradación: mientras el SQL de la fase 2 no se haya corrido, las tablas no
 * existen y todas estas lecturas devuelven vacío en vez de reventar. El sitio
 * se comporta como antes — que es justo lo que la fase 2 promete.
 */

/** ¿El error es "esa tabla/columna todavía no existe"? */
function isMissingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  // 42P01 = undefined_table · 42703 = undefined_column · PGRST205 = no está en el esquema
  return (
    error.code === '42P01' ||
    error.code === '42703' ||
    error.code === 'PGRST205' ||
    /does not exist|schema cache/i.test(error.message ?? '')
  )
}

export function slugifyUnit(s: string): string {
  return fold(s)
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

/* ─── Organizaciones ─────────────────────────────────────────────────────── */

let orgsCache: Promise<Organization[]> | null = null

/** Las organizaciones vivas. Se cachea: cambian una vez al año. */
export async function getOrganizations(): Promise<Organization[]> {
  if (!orgsCache) {
    orgsCache = (async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .is('deleted_at', null)
        .order('name')
      if (error) {
        if (isMissingSchema(error)) return []
        throw error
      }
      return (data ?? []) as Organization[]
    })()
  }
  return orgsCache
}

export function invalidateOrganizations(): void {
  orgsCache = null
}

/* ─── Unidades (operaciones y áreas) ─────────────────────────────────────── */

/**
 * Las unidades de una organización, opcionalmente de un solo tipo.
 *
 * Devuelve solo las vivas y activas: una unidad archivada no debe poder
 * elegirse para clasificar a alguien nuevo, aunque la gente que ya la tenía la
 * conserve (por eso se archiva y no se borra).
 */
export async function getOrgUnits(
  orgId: string,
  kind?: OrgUnitKind,
): Promise<OrgUnit[]> {
  if (!orgId) return []
  let q = supabase
    .from('org_units')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('is_active', true)
  if (kind) q = q.eq('kind', kind)

  const { data, error } = await q.order('sort_order').order('name')
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  return (data ?? []) as OrgUnit[]
}

/**
 * Todas las unidades de una organización, archivadas incluidas. Solo para la
 * pantalla que las administra: ahí hay que poder ver y reactivar lo archivado.
 */
export async function getAllOrgUnits(orgId: string): Promise<OrgUnit[]> {
  if (!orgId) return []
  const { data, error } = await supabase
    .from('org_units')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('kind')
    .order('sort_order')
    .order('name')
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  return (data ?? []) as OrgUnit[]
}

/**
 * Nombres por id, para pintar "Talento Humano" donde solo hay un uuid.
 * Una sola consulta para los dos ejes: se usa en listados largos.
 */
export async function getOrgUnitNames(orgId: string): Promise<Map<string, OrgUnit>> {
  const units = await getAllOrgUnits(orgId)
  return new Map(units.map((u) => [u.id, u]))
}

export async function createOrgUnit(input: {
  orgId: string
  kind: OrgUnitKind
  name: string
}): Promise<OrgUnit> {
  const name = input.name.trim()
  if (!name) throw new Error('La unidad necesita un nombre.')

  const { data, error } = await supabase
    .from('org_units')
    .insert({
      org_id: input.orgId,
      kind: input.kind,
      slug: slugifyUnit(name),
      name,
    })
    .select()
    .single()

  if (error) {
    // El índice único es (org_id, kind, slug) sobre lo no borrado: el choque
    // significa que ya existe con otro nombre que produce el mismo slug.
    if (error.code === '23505') {
      throw new Error(`Ya existe ${input.kind === 'area' ? 'un área' : 'una operación'} con ese nombre.`)
    }
    throw error
  }
  return data as OrgUnit
}

export async function renameOrgUnit(id: string, name: string): Promise<void> {
  const clean = name.trim()
  if (!clean) throw new Error('La unidad necesita un nombre.')
  const { error } = await supabase
    .from('org_units')
    .update({ name: clean, slug: slugifyUnit(clean) })
    .eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error('Ya existe otra unidad con ese nombre.')
    throw error
  }
}

/**
 * Archiva una unidad: deja de poder elegirse, pero quien ya la tenía la
 * conserva. Nunca se borra — borrarla dejaría a esa gente sin clasificación y
 * rompería los reportes históricos.
 */
export async function setOrgUnitActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('org_units').update({ is_active: isActive }).eq('id', id)
  if (error) throw error
}

/**
 * Cuánta gente cuelga de cada unidad. Sirve para dos cosas: avisar antes de
 * archivar una que está en uso, y alimentar el tablero de "sin clasificar".
 */
export async function countPeopleByUnit(orgId: string): Promise<{
  byOperation: Map<string, number>
  byArea: Map<string, number>
  unclassified: number
  total: number
}> {
  const empty = {
    byOperation: new Map<string, number>(),
    byArea: new Map<string, number>(),
    unclassified: 0,
    total: 0,
  }
  if (!orgId) return empty

  const { data, error } = await supabase
    .from('profiles')
    .select('operation_id, area_id')
    .eq('org_id', orgId)
    .eq('is_active', true)
  if (error) {
    if (isMissingSchema(error)) return empty
    throw error
  }

  const rows = (data ?? []) as Array<{ operation_id: string | null; area_id: string | null }>
  const byOperation = new Map<string, number>()
  const byArea = new Map<string, number>()
  let unclassified = 0
  for (const r of rows) {
    if (r.operation_id) byOperation.set(r.operation_id, (byOperation.get(r.operation_id) ?? 0) + 1)
    if (r.area_id) byArea.set(r.area_id, (byArea.get(r.area_id) ?? 0) + 1)
    // Falta cualquiera de los dos ejes: la persona no está clasificada del todo.
    if (!r.operation_id || !r.area_id) unclassified += 1
  }
  return { byOperation, byArea, unclassified, total: rows.length }
}

/* ─── Casar la nómina con el catálogo ───────────────────────────────────── */

/**
 * Convierte los nombres de operación y área que trae la nómina en unidades del
 * catálogo.
 *
 * Casa ignorando tildes y mayúsculas (`fold`), como todo buscador del sitio:
 * "TALENTO HUMANO", "Talento Humano" y "talento humano" son la misma área, y
 * nadie escribe las tildes igual dos veces.
 *
 * Lo que NO hace, y es la decisión importante: **no crea unidades**. Si la
 * nómina trae "RRHH" y en el catálogo está "Talento Humano", devuelve `null` y
 * la importación lo muestra para que alguien lo resuelva. Crear la unidad sola
 * sería cómodo y sería exactamente cómo se desordenaron las campañas: cada
 * archivo inventando sus propios grupos. El catálogo lo abre el superadmin, a
 * propósito.
 *
 * Devuelve también `unmatched` — los nombres que no casaron, sin repetir — que
 * es lo que hay que enseñar antes de importar nada.
 */
export async function resolveUnitsFromRoster(
  orgId: string,
  rows: Array<{ operationRaw?: string; areaRaw?: string }>,
): Promise<{
  operations: Map<string, OrgUnit>
  areas: Map<string, OrgUnit>
  unmatched: { operations: string[]; areas: string[] }
}> {
  const units = await getOrgUnits(orgId)
  const byKind = (kind: OrgUnitKind) =>
    new Map(units.filter((u) => u.kind === kind).map((u) => [fold(u.name), u]))

  const catalogOps = byKind('operation')
  const catalogAreas = byKind('area')

  const operations = new Map<string, OrgUnit>()
  const areas = new Map<string, OrgUnit>()
  const missOps = new Set<string>()
  const missAreas = new Set<string>()

  for (const r of rows) {
    const op = (r.operationRaw ?? '').trim()
    if (op) {
      const hit = catalogOps.get(fold(op))
      if (hit) operations.set(op, hit)
      else missOps.add(op)
    }
    const ar = (r.areaRaw ?? '').trim()
    if (ar) {
      const hit = catalogAreas.get(fold(ar))
      if (hit) areas.set(ar, hit)
      else missAreas.add(ar)
    }
  }

  return {
    operations,
    areas,
    unmatched: {
      operations: [...missOps].sort((a, b) => a.localeCompare(b, 'es')),
      areas: [...missAreas].sort((a, b) => a.localeCompare(b, 'es')),
    },
  }
}

/* ─── Mi gente ───────────────────────────────────────────────────────────── */

/**
 * Las personas que puede ver quien está mirando.
 *
 * Antes esto era `profiles.campaign_id IN (mis campañas)`, repetido a mano en
 * seis pantallas. Bajo el modelo nuevo un capacitador no es dueño de PERSONAS
 * sino de CONTENIDO, así que su gente es la que estudia ese contenido: los
 * aprendices alcanzados por sus cursos —por regla de audiencia, por campaña o
 * asignados a mano— más el staff de sus campañas. Superadmin y RH ven todo.
 *
 * Se resuelve en la base (`get_my_people_ids`) y no aquí: la misma respuesta
 * alimenta la RLS de `profiles`, y tener dos definiciones de "mi gente" —una
 * en el cliente y otra en las políticas— es justo cómo aparecen las pantallas
 * que muestran filas que luego no se pueden abrir.
 *
 * Devuelve `null` si el SQL todavía no se ha corrido, para que quien llama
 * pueda caer al filtro por campaña de siempre en vez de quedarse sin nadie.
 */
export async function getMyPeopleIds(): Promise<string[] | null> {
  const { data, error } = await supabase.rpc('get_my_people_ids')
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data ?? []) as string[]
}

/**
 * Cuántos cursos usa cada categoría. Es el equivalente, del lado del
 * contenido, a `countPeopleByUnit`: sirve para avisar antes de archivar una
 * categoría que está en uso, y para ver de un vistazo cuáles sobran.
 */
export async function countCoursesByCategory(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const { data, error } = await supabase
    .from('courses')
    .select('category_id')
    .is('deleted_at', null)
  if (error) {
    if (isMissingSchema(error)) return out
    throw error
  }
  for (const r of (data ?? []) as Array<{ category_id: string | null }>) {
    if (r.category_id) out.set(r.category_id, (out.get(r.category_id) ?? 0) + 1)
  }
  return out
}
