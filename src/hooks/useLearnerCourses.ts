import { useCallback, useEffect, useRef, useState } from 'react'
import { getLearnerCourses, type LearnerCourse } from '@/services/courses.service'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'

/**
 * Sello de "esto ya no vale", FUERA del módulo.
 *
 * La caché de abajo es una variable de módulo: `cache = null` solo alcanza a la
 * pestaña que lo ejecuta. Con el panel abierto en una pestaña y la vista de
 * aprendiz en otra —lo normal cuando alguien reparte cursos—, asignar en la
 * primera dejaba a la segunda sirviendo su lista vieja hasta recargarla.
 *
 * Con el sello en `localStorage` la caché no se cree a sí misma: se descarta si
 * el sello cambió, lo escribiera la pestaña que sea.
 */
const EPOCH_KEY = 'learningai.learnerCoursesEpoch'

function readEpoch(): string {
  try {
    return localStorage.getItem(EPOCH_KEY) ?? '0'
  } catch {
    // Almacenamiento bloqueado (incógnito estricto): sin sello, la caché de
    // memoria manda como antes. Degrada a lo de siempre, no rompe.
    return '0'
  }
}

let cache: { key: string; epoch: string; data: LearnerCourse[] } | null = null

/** ¿La caché sirve para esta clave y sigue siendo la vigente? */
function cacheHit(key: string): LearnerCourse[] | null {
  if (!cache || cache.key !== key) return null
  return cache.epoch === readEpoch() ? cache.data : null
}

/** Cursos visibles para el usuario actual (asignados + catálogo abierto). */
export function useLearnerCourses() {
  const { user, campaignId, loading: authLoading } = useAuth()
  // Rol REAL: dentro de la vista previa useAuth reporta 'learner' a propósito.
  const realRole = useAuthStore((s) => s.profile?.role ?? null)
  const preview =
    IS_LEARNER_PREVIEW && (realRole === 'superadmin' || realRole === 'capacitador')
  const key = `${user?.id ?? ''}:${campaignId ?? ''}:${preview ? 'preview' : 'live'}`
  const [courses, setCourses] = useState<LearnerCourse[]>(() => cacheHit(key) ?? [])
  const [loading, setLoading] = useState(() => authLoading || !cacheHit(key))
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
      const hit = force ? null : cacheHit(key)
      if (hit) {
        reqRef.current++
        setCourses(hit)
        setLoading(false)
        return
      }
      const seq = ++reqRef.current
      // El sello se lee ANTES de pedir: si alguien invalida mientras la consulta
      // viaja, la respuesta se guarda con el sello viejo y la próxima lectura la
      // descarta, en vez de sellar como fresco un resultado ya caducado.
      const epoch = readEpoch()
      setLoading(true)
      getLearnerCourses(campaignId, user.id, { preview })
        .then((data) => {
          if (seq !== reqRef.current) return
          cache = { key, epoch, data }
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
  // El sello viaja fuera del módulo: alcanza a las otras copias del módulo (HMR)
  // y a las otras pestañas, que es donde el `cache = null` no llegaba.
  try {
    localStorage.setItem(EPOCH_KEY, `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`)
  } catch {
    /* almacenamiento bloqueado: queda solo la invalidación en memoria */
  }
}
