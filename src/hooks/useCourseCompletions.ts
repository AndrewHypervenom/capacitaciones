import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useModuleDone } from '@/stores/progressStore'
import { courseProgress } from '@/components/course/CourseCard'
import { getCourseCompletions, type CourseCompletion } from '@/services/certification.service'
import type { CourseJourney } from '@/lib/courseJourney'
import type { LearnerCourse } from '@/services/courses.service'

/**
 * Los cursos YA terminados de una lista, con su fecha, nota y certificado.
 *
 * Es lo que separa «Pendientes» de «Completados» en el inicio y en /courses.
 * Un curso terminado VUELVE a pendientes cuando:
 *   · le publican contenido nuevo → el recorrido deja de estar completo solo;
 *   · su certificado venció (`valid_months`) o el capacitador pidió
 *     recertificación (SQL 75) → hay que recertificarse.
 *
 * La caché es de módulo, como la de useCourseJourneys: las dos páginas montan
 * el hook por separado y no deben consultar dos veces lo mismo.
 */
let cache: { key: string; data: Record<string, CourseCompletion> } | null = null

export function useCourseCompletions(
  courses: LearnerCourse[],
  journeys: Record<string, CourseJourney>,
): {
  completions: Record<string, CourseCompletion>
  /** Terminado y con el certificado vigente: va a «Completados». */
  isFinished: (c: LearnerCourse) => boolean
  /** Terminado pero con el certificado vencido: vuelve a pendientes. */
  needsRecert: (c: LearnerCourse) => boolean
} {
  const { user } = useAuth()
  const isModuleDone = useModuleDone()

  const completed = useMemo(
    () => courses.filter((c) => c.isAssigned && courseProgress(c, isModuleDone, journeys[c.id]).completed),
    [courses, isModuleDone, journeys],
  )
  const key = `${user?.id ?? ''}:${completed.map((c) => c.id).sort().join(',')}`

  const [data, setData] = useState<Record<string, CourseCompletion>>(
    () => (cache?.key === key ? cache.data : {}),
  )

  useEffect(() => {
    if (!user?.id || completed.length === 0) { setData({}); return }
    if (cache?.key === key) { setData(cache.data); return }
    let active = true
    getCourseCompletions(
      user.id,
      completed.map((c) => ({
        id: c.id,
        moduleIds: c.modules.map((m) => m.id),
        validMonths: c.cert_conditions?.valid_months ?? null,
      })),
    )
      .then((res) => {
        cache = { key, data: res }
        if (active) setData(res)
      })
      .catch(() => { if (active) setData({}) })
    return () => { active = false }
    // `completed` cambia con `key`; la clave basta para decidir si se consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, user?.id])

  const completedIds = useMemo(() => new Set(completed.map((c) => c.id)), [completed])

  const needsRecert = useCallback(
    (c: LearnerCourse) => completedIds.has(c.id) && !!data[c.id]?.recert,
    [data, completedIds],
  )
  const isFinished = useCallback(
    (c: LearnerCourse) => completedIds.has(c.id) && !needsRecert(c),
    [completedIds, needsRecert],
  )

  return { completions: data, isFinished, needsRecert }
}

/** Descarta la tanda cacheada (tras emitir un certificado, p. ej.). */
export function invalidateCourseCompletionsCache() {
  cache = null
}
