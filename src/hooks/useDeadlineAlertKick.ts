import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'

/**
 * Quien dispara la tarea diaria de avisos de plazo mientras no haya pg_cron.
 *
 * La tarea vive en la base (`notify_course_deadlines`, SQL 42) y es idempotente:
 * calcula quién está a tres días, quién vence hoy y quién ya venció, y solo
 * inserta el aviso que todavía no existe. Aquí solo se le da cuerda una vez al
 * día, cuando alguien del equipo abre el panel de gestión.
 *
 * No es tan bueno como un cron —si nadie del equipo entra en tres días, los
 * avisos salen tarde—, pero no depende de ninguna extensión ni servidor extra.
 * Si algún día se activa pg_cron, esto sigue sin estorbar: la tarea no duplica
 * nada. Ver `supabase/sql/43_avisos_de_plazo_sin_cron.sql`.
 */
const KEY = 'learningai.deadlineKick'

export function useDeadlineAlertKick() {
  const role = useAuthStore((s) => s.profile?.role ?? null)

  useEffect(() => {
    if (role !== 'superadmin' && role !== 'rh' && role !== 'capacitador') return
    const today = new Date().toISOString().slice(0, 10)
    try {
      if (localStorage.getItem(KEY) === today) return
      localStorage.setItem(KEY, today)
    } catch {
      // Sin almacenamiento se llamaría en cada carga; la tarea lo aguanta (no
      // duplica avisos), pero mejor no insistir en el mismo minuto.
    }
    // En segundo plano y en silencio: es mantenimiento, no una acción de nadie.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (supabase as any).rpc('run_course_deadline_alerts').then(() => {}, () => {})
  }, [role])
}
