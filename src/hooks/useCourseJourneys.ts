import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useModuleDone, keyOfCourseModule } from '@/stores/progressStore'
import { buildCourseJourney, type CourseJourney } from '@/lib/courseJourney'
import {
  getCourseJourneyExtras,
  EMPTY_EXTRAS,
  type CourseJourneyExtras,
} from '@/services/courseJourney.service'
import type { LearnerCourse } from '@/services/courses.service'

/**
 * El recorrido de VARIOS cursos (catálogo, panel del aprendiz).
 *
 * Los módulos ya vienen en `courses` y salen del progreso local: eso se calcula
 * al instante, sin esperar a nadie. Lo demás —prácticas, mundo, examen— llega
 * en una sola tanda de consultas y, mientras tanto, el recorrido cuenta solo el
 * temario. Es decir: la tarjeta nunca se queda en blanco, solo se corrige hacia
 * abajo cuando aparece lo que faltaba.
 *
 * La caché es de módulo: el catálogo y el panel del aprendiz montan este hook
 * por separado y no deben consultar dos veces lo mismo.
 */
let cache: { key: string; data: Record<string, CourseJourneyExtras> } | null = null

export function useCourseJourneys(courses: LearnerCourse[]): {
  journeys: Record<string, CourseJourney>
  /** Ya llegaron las etapas que no son módulos (antes de esto el % va corto de datos). */
  loaded: boolean
  /** La lectura en lote falló: el recorrido se quedó en solo-módulos. */
  failed: boolean
} {
  const { user } = useAuth()
  const isModuleDone = useModuleDone()

  // Clave estable: los mismos cursos en otro orden no son una consulta nueva.
  const courseKey = useMemo(
    () => courses.map((c) => c.id).sort().join(','),
    [courses],
  )
  const cacheKey = `${user?.id ?? ''}:${courseKey}`

  const [extras, setExtras] = useState<Record<string, CourseJourneyExtras>>(
    () => (cache?.key === cacheKey ? cache.data : {}),
  )
  const [loaded, setLoaded] = useState(() => cache?.key === cacheKey)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!user?.id || courseKey === '') { setExtras({}); setLoaded(false); setFailed(false); return }
    if (cache?.key === cacheKey) { setExtras(cache.data); setLoaded(true); setFailed(false); return }
    let active = true
    getCourseJourneyExtras(courseKey.split(','), user.id)
      .then((data) => {
        cache = { key: cacheKey, data }
        if (!active) return
        setExtras(data)
        setLoaded(true)
        setFailed(false)
      })
      // Un fallo de lectura NO significa "este curso no tiene nada más": deja
      // el recorrido en solo-módulos, que es lo que se veía antes, en vez de
      // dejar la tarjeta sin porcentaje.
      .catch(() => { if (active) { setExtras({}); setLoaded(false); setFailed(true) } })
    return () => { active = false }
  }, [cacheKey, courseKey, user?.id])

  const journeys = useMemo(() => {
    const out: Record<string, CourseJourney> = {}
    for (const c of courses) {
      const ex = extras[c.id] ?? EMPTY_EXTRAS
      out[c.id] = buildCourseJourney({
        modules: {
          total: c.modules.length,
          done: c.modules.filter((m) => isModuleDone(keyOfCourseModule(m))).length,
        },
        practice: ex.practice,
        // El mundo solo es parte del recorrido de quien tiene el curso: al que
        // solo lo ve en el catálogo no le falta nada todavía.
        world: c.isAssigned ? ex.world : { total: 0, done: 0 },
        exam: ex.exam,
      })
    }
    return out
  }, [courses, extras, isModuleDone])

  return { journeys, loaded, failed }
}

/** Descarta la tanda cacheada (tras asignar cursos, practicar, jugar el mundo). */
export function invalidateCourseJourneysCache() {
  cache = null
}
