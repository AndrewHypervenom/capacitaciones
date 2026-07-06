import { useCallback, useEffect, useState } from 'react'
import { getLearnerCourses, type LearnerCourse } from '@/services/courses.service'
import { useAuth } from '@/hooks/useAuth'

let cache: { key: string; data: LearnerCourse[] } | null = null

/** Cursos visibles para el usuario actual (asignados + catálogo abierto). */
export function useLearnerCourses() {
  const { user, campaignId } = useAuth()
  const key = `${user?.id ?? ''}:${campaignId ?? ''}`
  const [courses, setCourses] = useState<LearnerCourse[]>(() =>
    cache?.key === key ? cache.data : [],
  )
  const [loading, setLoading] = useState(() => cache?.key !== key)
  const [error, setError] = useState<Error | null>(null)

  const fetch = useCallback(
    (force = false) => {
      if (!user?.id) {
        setLoading(false)
        return
      }
      if (!force && cache?.key === key) {
        setCourses(cache.data)
        setLoading(false)
        return
      }
      setLoading(true)
      getLearnerCourses(campaignId, user.id)
        .then((data) => {
          cache = { key, data }
          setCourses(data)
          setError(null)
        })
        .catch((err: Error) => {
          setError(err)
          setCourses([])
        })
        .finally(() => setLoading(false))
    },
    [key, user?.id, campaignId],
  )

  useEffect(() => {
    fetch()
  }, [fetch])

  /** Re-consulta forzando saltear caché (tras auto-inscribirse/salir). */
  const reload = useCallback(() => fetch(true), [fetch])

  return { courses, loading, error, reload }
}

export function invalidateLearnerCoursesCache() {
  cache = null
}
