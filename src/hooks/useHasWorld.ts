import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * ¿El aprendiz tiene algún mundo disponible? Los mundos van ligados a cursos
 * (`worlds.course_id`), y no todos los cursos tienen mundo. Por eso "tiene mundo"
 * = alguno de SUS cursos tiene un mundo publicado. Sirve para mostrar/ocultar la
 * sección "Mi Mundo" y su logro.
 *
 * Se re-analiza en cada carga de la vista (sin caché) para reflejar mundos
 * recién publicados/despublicados en los cursos del aprendiz.
 *
 * @param courseIds IDs de los cursos que ve en su vista principal (los asignados).
 */
export function useHasWorld(courseIds: string[]) {
  const key = [...courseIds].sort().join(',')
  const [hasWorld, setHasWorld] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Sin cursos → no puede tener mundo.
    if (courseIds.length === 0) {
      setHasWorld(false)
      setLoading(false)
      return
    }

    let active = true
    setLoading(true)
    supabase
      .from('worlds')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .in('course_id', courseIds)
      .then(({ count }) => {
        if (!active) return
        setHasWorld((count ?? 0) > 0)
        setLoading(false)
      })

    return () => {
      active = false
    }
    // key resume courseIds de forma estable; evita reconsultas por identidad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { hasWorld, loading }
}
