import { supabase } from '@/lib/supabase'
import { getAllOrgUnits, getOrganizations } from '@/services/org.service'

/**
 * Directorio de certificados para Admin → Certificados: cada diploma emitido
 * con el nombre, correo, cédula y CR de la persona y el título del curso, listo
 * para buscar por cualquiera de esos datos.
 *
 * Mismo alcance que la pestaña Certificados de Progreso: `get_program_certificates`
 * (la gente del rol, resuelto en la base) y la tabla como respaldo si ese SQL no
 * está. Personas y cursos se leen aparte, por páginas.
 */

export interface CertificateEntry {
  certId: string
  userId: string
  courseId: string
  score: number
  issuedAt: string
  personName: string
  email: string | null
  nationalId: string | null
  avatarUrl: string | null
  crName: string | null
  courseTitle: string
  courseIcon: string | null
}

const PAGE = 1000

async function readAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1)
    if (error) throw error
    const batch = (data ?? []) as unknown as T[]
    out.push(...batch)
    if (batch.length < PAGE) return out
  }
}

type RawCert = { user_id: string; course_id: string; cert_id: string; score: number; issued_at: string }
type RawPerson = {
  id: string; display_name: string | null; email?: string | null; national_id?: string | null
  avatar_url: string | null; operation_id: string | null
}
type RawCourse = { id: string; title_es: string; icon?: string | null }

async function readCertificates(): Promise<RawCert[]> {
  const { data, error } = await supabase.rpc('get_program_certificates')
  if (!error) return (data ?? []) as unknown as RawCert[]
  return readAll<RawCert>('certifications', 'user_id, course_id, cert_id, score, issued_at')
}

/** Personas con los datos por los que se busca. Si alguna columna no existe
 *  todavía en la base, se reintenta sin ella: buscar por menos datos es mejor
 *  que una pantalla en blanco. */
async function readPeople(): Promise<RawPerson[]> {
  const attempts = [
    'id, display_name, email, national_id, avatar_url, operation_id',
    'id, display_name, email, avatar_url, operation_id',
    'id, display_name, avatar_url, operation_id',
  ]
  let last: unknown = null
  for (const cols of attempts) {
    try {
      return await readAll<RawPerson>('profiles', cols)
    } catch (e) {
      last = e
    }
  }
  throw last
}

export async function getCertificateDirectory(): Promise<CertificateEntry[]> {
  const [certs, people, courses, units] = await Promise.all([
    readCertificates(),
    readPeople(),
    readAll<RawCourse>('courses', 'id, title_es, icon').catch(() => readAll<RawCourse>('courses', 'id, title_es')),
    getOrganizations()
      .then((orgs) => (orgs[0] ? getAllOrgUnits(orgs[0].id) : []))
      .catch(() => []),
  ])
  const personById = new Map(people.map((p) => [p.id, p]))
  const courseById = new Map(courses.map((c) => [c.id, c]))
  const unitName = new Map(units.map((u) => [u.id, u.name]))

  return certs
    .map((c) => {
      const p = personById.get(c.user_id)
      const course = courseById.get(c.course_id)
      return {
        certId: c.cert_id,
        userId: c.user_id,
        courseId: c.course_id,
        score: c.score,
        issuedAt: c.issued_at,
        personName: p?.display_name || p?.email || c.user_id.slice(0, 8),
        email: p?.email ?? null,
        nationalId: p?.national_id ?? null,
        avatarUrl: p?.avatar_url ?? null,
        crName: p?.operation_id ? unitName.get(p.operation_id) ?? null : null,
        // Un curso borrado no llega por RLS: el certificado sigue siendo válido.
        courseTitle: course?.title_es ?? '—',
        courseIcon: course?.icon ?? null,
      }
    })
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
}
