import { useEffect, useMemo, useState } from 'react'
import { getActiveOrgUnits } from '@/services/org.service'
import { getAudiences, type AudienceRule } from '@/services/audiences.service'
import type { OrgUnit } from '@/types/database'

/**
 * Filtro por CR de las listas de contenido (mundos, arenas, misiones, quiz en
 * vivo…). Reemplaza al filtro por programa, que se retiró del sitio.
 *
 * Un contenido "le llega" a un CR cuando cuelga de un curso cuya regla alcanza
 * ese CR, o que va a toda la organización. El contenido suelto (sin curso) no le
 * llega a nadie por regla, así que con un CR elegido no se lista.
 *
 * `courseIds` son los cursos de los que cuelga lo que hay en pantalla: las
 * reglas se piden en UNA consulta para todos.
 */
export function useCrFilter(courseIds: (string | null | undefined)[]) {
  const [cr, setCr] = useState('')
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [audiences, setAudiences] = useState<Map<string, AudienceRule>>(new Map())

  useEffect(() => {
    let alive = true
    void getActiveOrgUnits()
      .then((list) => { if (alive) setUnits(list) })
      .catch(() => { if (alive) setUnits([]) })
    return () => { alive = false }
  }, [])

  const key = useMemo(
    () => [...new Set(courseIds.filter((x): x is string => !!x))].sort().join(','),
    [courseIds],
  )
  useEffect(() => {
    if (!key) return
    let alive = true
    getAudiences(key.split(','))
      .then((m) => { if (alive) setAudiences(m) })
      .catch(() => { if (alive) setAudiences(new Map()) })
    return () => { alive = false }
  }, [key])

  const operations = useMemo(() => units.filter((u) => u.kind === 'operation'), [units])

  /** ¿El contenido que cuelga de `courseId` pasa el filtro de CR elegido? */
  const passes = (courseId: string | null | undefined): boolean => {
    if (!cr) return true
    const rule = courseId ? audiences.get(courseId) : undefined
    return !!rule && (rule.everyone || rule.operationIds.includes(cr))
  }

  return { cr, setCr, operations, passes }
}
