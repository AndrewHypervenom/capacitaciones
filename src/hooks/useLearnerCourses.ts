import { useEffect, useState } from 'react'
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

  useEffect(() => {
    if (!user?.id) {
      setLoading(false)
      return
    }
    if (cache?.key === key) {
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
  }, [key, user?.id, campaignId])

  return { courses, loading, error }
}

export function invalidateLearnerCoursesCache() {
  cache = null
}
