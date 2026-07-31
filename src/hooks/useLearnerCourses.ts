import { useCallback, useEffect, useRef, useState } from 'react'
import { getLearnerCourses, type LearnerCourse } from '@/services/courses.service'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'

let cache: { key: string; data: LearnerCourse[] } | null = null

/** Cursos visibles para el usuario actual (asignados + catálogo abierto). */
export function useLearnerCourses() {
  const { user, campaignId, loading: authLoading } = useAuth()
  // Rol REAL: dentro de la vista previa useAuth reporta 'learner' a propósito.
  const realRole = useAuthStore((s) => s.profile?.role ?? null)
  const preview =
    IS_LEARNER_PREVIEW && (realRole === 'superadmin' || realRole === 'capacitador')
  const key = `${user?.id ?? ''}:${campaignId ?? ''}:${preview ? 'preview' : 'live'}`
  const [courses, setCourses] = useState<LearnerCourse[]>(() =>
    cache?.key === key ? cache.data : [],
  )
  const [loading, setLoading] = useState(() => authLoading || cache?.key !== key)
  const [error, setError] = useState<Error | null>(null)

  // Solo la ÚLTIMA petición manda. `authStore` publica la sesión ANTES de tener
  // el perfil, así que el primer render ya tiene `user` pero todavía no rol ni
  // campaña: sin este contador, esa consulta prematura (preview=false,
  // campaignId=null) podía responder DESPUÉS de la buena y pisar el resultado
  // —y la caché— dejando la pantalla del aprendiz sin curso ni módulos hasta
  // que alguien invalidara la caché. Se veía sobre todo en la vista previa de
  // contenido en borrador (manual o con IA), donde la consulta prematura filtra
  // por `is_published` y no devuelve nada.
  const reqRef = useRef(0)

  const fetch = useCallback(
    (force = false) => {
      // Mientras el perfil carga no sabemos rol ni campaña: no consultamos con
      // datos a medias (mismo guarda que `useModules`).
      if (authLoading) {
        setLoading(true)
        return
      }
      if (!user?.id) {
        reqRef.current++
        setCourses([])
        setLoading(false)
        return
      }
      if (!force && cache?.key === key) {
        reqRef.current++
        setCourses(cache.data)
        setLoading(false)
        return
      }
      const seq = ++reqRef.current
      setLoading(true)
      getLearnerCourses(campaignId, user.id, { preview })
        .then((data) => {
          if (seq !== reqRef.current) return
          cache = { key, data }
          setCourses(data)
          setError(null)
        })
        .catch((err: Error) => {
          if (seq !== reqRef.current) return
          setError(err)
          setCourses([])
        })
        .finally(() => {
          if (seq === reqRef.current) setLoading(false)
        })
    },
    [key, user?.id, campaignId, preview, authLoading],
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
