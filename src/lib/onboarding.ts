import type { CourseJourney } from '@/lib/courseJourney'
import type { ModuleKey } from '@/stores/progressStore'
import { courseProgress } from '@/components/course/CourseCard'
import type { LearnerCourse } from '@/services/courses.service'

/**
 * La compuerta del onboarding, en UN solo sitio.
 *
 * Quien llega nuevo con cursos de inducción asignados (`courses.is_onboarding`)
 * ve SOLO esos: ni el resto de lo que le toca ni el catálogo. Al terminarlos
 * todos se le abre lo demás. Lo usan el inicio, /courses y la página de un
 * curso; si cada una decidiera por su cuenta, el aprendiz podría ver en una lo
 * que otra le esconde.
 *
 * "Terminado" es el curso ENTERO (módulos, prácticas, mundo y examen), no solo
 * el temario. Mientras las etapas que no son módulos no han llegado, un curso
 * con el temario completo se da por pendiente: si no, el catálogo se abriría un
 * instante y se volvería a cerrar. Si esa lectura falla, se cae a solo-módulos
 * para no dejar a nadie encerrado para siempre.
 */
export interface OnboardingGate {
  /** Hay onboarding sin terminar: lo demás queda cerrado. */
  active: boolean
  /** Los cursos de onboarding de la persona (asignados), en su orden. */
  courses: LearnerCourse[]
  /** Los que le faltan, en orden: el primero es a donde mandarlo. */
  pending: LearnerCourse[]
  done: number
  total: number
  /** Ya se sabe si está terminado. Mientras no, las pantallas esperan en vez
   *  de enseñar el onboarding un segundo a quien ya lo acabó. */
  settled: boolean
  /** Ids de los cursos de onboarding, para filtrar rápido. */
  ids: Set<string>
}

export function onboardingGate(
  courses: LearnerCourse[],
  journeys: Record<string, CourseJourney>,
  isModuleDone: (key: ModuleKey) => boolean,
  extras: { loaded: boolean; failed: boolean },
): OnboardingGate {
  const mine = courses.filter((c) => c.isAssigned && c.is_onboarding === true)
  const trusted = extras.loaded || extras.failed
  const pending = mine.filter(
    (c) => !(trusted && courseProgress(c, isModuleDone, journeys[c.id]).completed),
  )
  const done = mine.length - pending.length
  return {
    active: mine.length > 0 && done < mine.length,
    courses: mine,
    pending,
    settled: mine.length === 0 || trusted,
    done,
    total: mine.length,
    ids: new Set(mine.map((c) => c.id)),
  }
}
