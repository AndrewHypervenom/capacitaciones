import { useCallback, useEffect, useState } from 'react'
import { getLearnerCourses, type LearnerCourse } from '@/services/courses.service'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'

let cache: { key: string; data: LearnerCourse[] } | null = null

/** Cursos visibles para el usuario actual (asignados + catálogo abierto). */
export function useLearnerCourses() {
  const { user, campaignId } = useAuth()
  // Rol REAL: dentro de la vista previa useAuth reporta 'learner' a propósito.
  const realRole = useAuthStore((s) => s.profile?.role ?? null)
  const preview =
    IS_LEARNER_PREVIEW && (realRole === 'superadmin' || realRole === 'capacitador')
  const key = `${user?.id ?? ''}:${campaignId ?? ''}:${preview ? 'preview' : 'live'}`
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
      getLearnerCourses(campaignId, user.id, { preview })
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
    [key, user?.id, campaignId, preview],
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
