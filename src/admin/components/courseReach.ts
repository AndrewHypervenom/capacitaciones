import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  getAudiencePopulation, isLearnerRole, matchesAudience, ruleIsEmpty,
  type AudiencePerson, type AudienceRule,
} from '@/services/audiences.service'
import { getActiveOrgId } from '@/services/org.service'
import type { AdminCourse } from '@/services/courses.service'

/* `nobody`: sin regla y sin nadie marcado a mano. Existe pero no le llega a
 * nadie. Va primero y solo para el superadmin: es el único que ve TODAS las
 * asignaciones; a un capacitador la RLS le esconde las ajenas y el «0» mentiría. */
export type ReachGroup = 'nobody' | 'everyone' | 'country' | 'unit' | 'manual'
export const REACH_GROUPS: ReachGroup[] = ['nobody', 'everyone', 'country', 'unit', 'manual']

export const EMPTY_AUDIENCE: AudienceRule = {
  everyone: false, countries: [], operationIds: [], areaIds: [], isMandatory: false,
  includeClients: false,
}

export interface ReachFilter { country: string; area: string; cr: string }

/**
 * ¿Le llega a alguien de este país / área / CR? Un eje sin elegir no filtra.
 * Misma semántica que la regla: un curso solo por país le llega a todas las
 * áreas y CR de ese país, así que no desaparece al filtrar por CR.
 */
export function reachesFilter(rule: AudienceRule, f: ReachFilter): boolean {
  if (!f.country && !f.area && !f.cr) return true
  if (rule.everyone) return true
  if (ruleIsEmpty(rule)) return false
  if (f.country && rule.countries.length > 0 && !rule.countries.includes(f.country)) return false
  if (f.area && rule.areaIds.length > 0 && !rule.areaIds.includes(f.area)) return false
  if (f.cr && rule.operationIds.length > 0 && !rule.operationIds.includes(f.cr)) return false
  return true
}

/** Asignaciones a mano por curso. Por páginas: PostgREST corta en 1000 filas. */
async function manualCounts(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('course_assignments')
      .select('course_id')
      .order('course_id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const r of data ?? []) out.set(r.course_id, (out.get(r.course_id) ?? 0) + 1)
    if ((data ?? []).length < PAGE) break
  }
  return out
}

/**
 * A cuánta gente le llega cada curso: por regla (sobre el censo de aprendices de
 * la casa, el mismo que usa el editor) y a mano. `null` mientras carga: la
 * pantalla dice «…», no un 0 que parezca verdad.
 *
 * Con `enabled` en false no consulta nada: el censo y las asignaciones son las
 * lecturas más pesadas del panel y no se piden hasta que alguien filtra.
 */
export function useCourseReach(
  courses: AdminCourse[],
  audiences: Map<string, AudienceRule>,
  isSuperAdmin: boolean,
  refreshKey: number,
  enabled = true,
) {
  const [people, setPeople] = useState<AudiencePerson[] | null>(null)
  const [byHand, setByHand] = useState<Map<string, number> | null>(null)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    getActiveOrgId().then((id) => (id ? getAudiencePopulation(id) : []))
      .then((p) => { if (alive) setPeople(p) })
      .catch(() => { if (alive) setPeople([]) })
    manualCounts()
      .then((m) => { if (alive) setByHand(m) })
      .catch(() => { if (alive) setByHand(new Map()) })
    return () => { alive = false }
  }, [refreshKey, enabled])

  return useMemo(() => {
    const learners = (people ?? []).filter((p) => isLearnerRole(p.role) && p.is_client !== true)
    const out = new Map<string, { rule: AudienceRule; group: ReachGroup; byRule: number | null; byHand: number | null }>()
    for (const c of courses) {
      const rule = audiences.get(c.id) ?? EMPTY_AUDIENCE
      const hand = byHand ? byHand.get(c.id) ?? 0 : null
      let group: ReachGroup
      if (rule.everyone) group = 'everyone'
      else if (!ruleIsEmpty(rule)) {
        group = rule.areaIds.length === 0 && rule.operationIds.length === 0 ? 'country' : 'unit'
      } else group = hand === 0 && isSuperAdmin ? 'nobody' : 'manual'
      out.set(c.id, {
        rule,
        group,
        byRule: people ? (ruleIsEmpty(rule) ? 0 : learners.filter((p) => matchesAudience(rule, p)).length) : null,
        byHand: hand,
      })
    }
    return out
  }, [courses, audiences, people, byHand, isSuperAdmin])
}

export type CourseReach = ReturnType<typeof useCourseReach>

