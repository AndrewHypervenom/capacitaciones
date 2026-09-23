import { useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarClock, Loader2, Lock, Monitor, Plus } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useAuthStore } from '@/stores/authStore';
import { useModuleDone, keyOfCourseModule, type ModuleKey } from '@/stores/progressStore';
import { invalidateLearnerCoursesCache } from '@/hooks/useLearnerCourses';
import { selfEnroll, type LearnerCourse } from '@/services/courses.service';
import { toast } from '@/stores/toastStore';
import { Tooltip } from '@/components/ui/Tooltip';
import { CourseCardCover, courseHasCardImage, CARD_COVER_BOX } from '@/components/course/CourseCover';
import { cn } from '@/lib/cn';
import { deadlineInfo, deadlineMode, formatDueDate } from '@/lib/courseDeadline';
import { blockedByDevice } from '@/lib/device';
import { useDeviceKind } from '@/hooks/useDeviceKind';
import { pickLang } from '@/lib/contentLang';
import type { CourseJourney } from '@/lib/courseJourney';

/* ────────────────────────────────────────────────────────────────────────────
   Tarjeta de curso ÚNICA del sitio. La usan el catálogo (/courses) y el panel
   del aprendiz: antes eran dos tarjetas distintas y el mismo curso se veía de
   dos maneras según por dónde llegaras.

   Lenguaje visual («póster + vitrina», 2026-09-22): la imagen 16:9 ES la
   tarjeta y se ve completa —el título ya viene escrito en ella—. El avance
   corre como un hilo por el borde inferior de la imagen y debajo queda una
   sola franja: porcentaje, pasos y acción. Sin descripción ni birrete. Al
   pasar el cursor sube un panel de vidrio con el título y los datos; en
   táctil no hay hover y la tarjeta se queda en su forma de reposo, que ya
   dice todo lo necesario.
   ──────────────────────────────────────────────────────────────────────────── */

/** Curva corporativa (misma que `ease-apple` de Tailwind y el kit de motion). */
export const ease = [0.16, 1, 0.3, 1] as const;

// motion(Link) SIEMPRE a nivel de módulo: crearlo dentro del render devuelve un
// componente nuevo en cada pasada y React remonta la tarjeta (parpadeo eterno).
const MotionLink = motion(Link);

// Cae a CUALQUIER idioma con contenido (antes solo al español), así un curso
// escrito en portugués no sale en blanco para el resto: ver `lib/contentLang`.
export function pickCourseText(
  es: string | null,
  en: string | null,
  pt: string | null,
  lang: string,
): string {
  return pickLang(es, en, pt, lang);
}

/**
 * Avance del curso para la tarjeta y para los filtros del catálogo.
 *
 * `modules` es siempre el temario (es lo que dice el texto "X de Y módulos").
 * `pct` y `completed`, en cambio, miden el CURSO entero cuando el padre pasa su
 * recorrido —prácticas, mundo y examen incluidos—: si no, la tarjeta diría 100%
 * y la página del curso 90% del mismo curso. Sin `journey` se comporta como
 * siempre y solo cuenta módulos.
 */
export function courseProgress(
  course: LearnerCourse,
  isModuleDone: (key: ModuleKey) => boolean,
  journey?: CourseJourney,
) {
  const total = course.modules.length;
  const done = course.modules.filter((m) => isModuleDone(keyOfCourseModule(m))).length;
  if (journey && journey.total > 0) {
    return { total, done, pct: journey.pct, completed: journey.complete, journey };
  }
  return { total, done, pct: total > 0 ? done / total : 0, completed: total > 0 && done === total, journey };
}

export interface CourseCardProps {
  course: LearnerCourse;
  /** Posición en la rejilla: escalona la entrada. */
  index?: number;
  /** Se llama tras auto-inscribirse (para refrescar la lista). */
  onEnrolled?: () => void;
  /** `prefers-reduced-motion` ya resuelto por el padre. */
  reduce: boolean;
  /** Recorrido completo del curso (useCourseJourneys). Sin él, solo módulos. */
  journey?: CourseJourney;
}

export function CourseCard({ course, index = 0, onEnrolled, reduce, journey }: CourseCardProps) {
  const { t } = useTranslation();
  const language = useUserStore((s) => s.language);
  // Rol REAL (no el de useAuth, que en la vista previa finge ser aprendiz): al
  // capacitador/superadmin le sirve saber de qué campaña es cada curso incluso
  // mirando el panel del aprendiz, donde el catálogo mezcla varias campañas.
  const realRole = useAuthStore((s) => s.profile?.role);
  const isStaff = realRole === 'superadmin' || realRole === 'capacitador';
  const isModuleDone = useModuleDone();
  // Curso «solo desde el computador»: se avisa en la tarjeta, no al entrar. Si
  // ya está en el celular, la nota se vuelve advertencia: así no abre el curso
  // para encontrarse con una puerta cerrada.
  const deviceKind = useDeviceKind();
  const deviceBlocked = blockedByDevice(course, deviceKind);
  const { total, done, pct, completed } = courseProgress(course, isModuleDone, journey);
  const totalMin = course.modules.reduce((acc, m) => acc + m.duration_min, 0);
  const [enrolling, setEnrolling] = useState(false);

  const handleEnroll = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEnrolling(true);
    try {
      await selfEnroll(course.id);
      invalidateLearnerCoursesCache();
      toast.success(t('courses.enrolled_ok'));
      onEnrolled?.();
    } catch {
      toast.error(t('courses.enroll_error'));
    } finally {
      setEnrolling(false);
    }
  };

  // Límite de tiempo para terminarlo. A quien ya lo completó no se le dice
  // nada (deadlineInfo devuelve 'none'): el plazo era para que lo hiciera.
  const deadline = deadlineInfo(course, {
    assignedAt: course.assignedAt,
    completed,
  });
  // Curso de catálogo con plazo por días: todavía no hay fecha (se cuenta desde
  // que se inscriba), así que se anuncia el plazo en crudo.
  const daysFromEnroll =
    deadline.state === 'none' && !completed && deadlineMode(course) === 'days'
      ? (course.deadline_days ?? 0)
      : 0;

  // Una sola etiqueta sobre la portada, y solo cuando dice algo que no se ve en
  // otro lado. El plazo vencido/a punto manda sobre "obligatorio": es lo que de
  // verdad necesita saber ahora.
  // Curso en construccion: el capacitador todavia va a publicar mas contenido y
  // el certificado esta retenido. Se dice ANTES de entrar, para que nadie lo
  // termine creyendo que ya sale el diploma. Ver Curso -> Certificacion.
  const comingSoon = !!course.cert_conditions?.coming_soon;

  const badge = deadline.state === 'overdue'
    ? { text: t('courses.deadline_expired'), tone: 'danger' as const }
    : deadline.state === 'soon'
      ? { text: t('courses.deadline_soon_badge'), tone: 'danger' as const }
      : comingSoon
        ? { text: t('course_cert.coming_soon_badge'), tone: 'warn' as const }
        : course.isMandatory && !completed
          ? { text: t('courses.mandatory'), tone: 'danger' as const }
          : completed
            ? { text: t('courses.status_completed'), tone: 'primary' as const }
            : null;

  const deadlineText =
    deadline.dueMs === null
      ? daysFromEnroll > 0
        ? t('courses.deadline_from_enroll', { count: daysFromEnroll })
        : null
      : deadline.state === 'overdue'
        ? t('courses.deadline_overdue', { count: Math.abs(deadline.daysLeft) })
        : deadline.daysLeft === 0
          ? t('courses.deadline_today')
          : t('courses.deadline_left', { count: deadline.daysLeft });


  const title = pickCourseText(course.title_es, course.title_en, course.title_pt, language);
  const pctLabel = `${Math.round(pct * 100)}%`;
  // Con más de una etapa el texto habla de PASOS, no de módulos: si no, el
  // porcentaje de al lado (que ya cuenta el curso entero) y esta frase
  // contarían cosas distintas.
  const stepsText =
    journey && journey.present.length > 1
      ? t('courses.journey_steps', { done: journey.done, count: journey.total })
      : t('courses.progress', { done, count: total });

  // Franja de abajo: lo mínimo para decidir sin abrir el curso. El panel de
  // vidrio repite los datos completos al pasar el cursor.
  const stripMeta = [totalMin > 0 ? `${totalMin} min` : null, t(`courses.level_${course.level}`)].filter(
    Boolean,
  ) as string[];
  const panelMeta = [
    t('courses.modules_count', { count: total }),
    totalMin > 0 ? `${totalMin} min` : null,
    t(`courses.level_${course.level}`),
  ].filter(Boolean) as string[];
  // Al APRENDIZ le mostramos la CATEGORÍA —de qué trata el curso—. Al staff no
  // en sus propios cursos asignados: el programa se retiró del sitio (09-16).
  const category = course.category_name && !(isStaff && course.isAssigned) ? course.category_name : null;
  const hasImage = courseHasCardImage(course);

  return (
    <MotionLink
      to={`/courses/${course.slug}`}
      state={{ from: 'courses' }}
      aria-label={title}
      layout={reduce ? undefined : 'position'}
      initial={reduce ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ duration: 0.5, ease, delay: reduce ? 0 : Math.min(index * 0.04, 0.24) }}
      whileHover={reduce ? undefined : { y: -5 }}
      className="group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-line bg-surface transition-shadow duration-500 ease-apple hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/* Imagen 16:9 completa: ver CourseCardCover para el respaldo cuando el
          curso todavía no tiene imagen de tarjeta. */}
      <div
        className={`relative shrink-0 overflow-hidden ${CARD_COVER_BOX}`}
        style={{
          background: hasImage
            ? `linear-gradient(120deg, ${course.color}1F, ${course.color}08)`
            : `linear-gradient(135deg, ${course.color}40, ${course.color}0D)`,
        }}
      >
        {hasImage ? (
          <CourseCardCover
            course={course}
            alt={title}
            fit={course.cover_fit}
            loading="lazy"
            className="transition-transform duration-[900ms] ease-apple group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          // Sin ninguna imagen: el título va sobre el degradado del curso, porque
          // la tarjeta no lo repite en texto en reposo.
          <div className="absolute inset-0 flex items-center px-6">
            <span className="line-clamp-3 text-balance text-[20px] font-semibold leading-tight tracking-tight text-text">
              {title}
            </span>
          </div>
        )}

        {/* Destello que barre la imagen al pasar el cursor */}
        {!reduce && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 transition-all duration-[900ms] ease-apple group-hover:left-[110%] group-hover:opacity-100"
          />
        )}

        {badge && (
          <span
            className={cn(
              'absolute top-3 right-3 z-10 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm',
              badge.tone === 'danger'
                ? 'bg-danger/35 ring-1 ring-inset ring-danger/70'
                : badge.tone === 'warn'
                  ? 'bg-amber-500/35 ring-1 ring-inset ring-amber-500/70'
                  : 'bg-primary/30 ring-1 ring-inset ring-primary/70',
            )}
          >
            {badge.text}
          </span>
        )}

        {/* Hilo de avance por el borde de la imagen. Se atenúa cuando sube el
            panel para no competir con él. */}
        {course.isAssigned && (
          <div className="absolute inset-x-0 bottom-0 z-10 h-1 bg-black/25 transition-opacity duration-500 group-hover:opacity-[.35]">
            <motion.div
              className="h-full bg-primary shadow-[0_0_10px_rgba(16,212,81,0.7)]"
              initial={{ width: reduce ? pctLabel : 0 }}
              animate={{ width: pctLabel }}
              transition={{ duration: reduce ? 0 : 0.9, ease, delay: reduce ? 0 : 0.2 }}
            />
          </div>
        )}

        {/* Panel de vidrio: título y datos al pasar el cursor (o al llegar con
            el teclado). Vive dentro del overflow-hidden, que lo esconde abajo. */}
        <div className="pointer-events-none absolute inset-x-2.5 bottom-3.5 z-20 grid translate-y-[calc(100%+20px)] gap-1 rounded-[14px] bg-black/60 px-3 py-2.5 text-white backdrop-blur-md transition-transform duration-[550ms] ease-apple group-hover:translate-y-0 group-focus-visible:translate-y-0 motion-reduce:transition-none">
          <span className="truncate text-[13px] font-semibold leading-snug">{title}</span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-white/80">
            {panelMeta.map((m, i) => (
              <span key={m} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="text-white/40">·</span>}
                {m}
              </span>
            ))}
            {category && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="text-white/40">·</span>
                <span className="truncate">{category}</span>
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Franja: avance y acción */}
      <div className="flex flex-1 flex-col justify-center gap-2 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            {course.isAssigned ? (
              <span className="flex items-baseline gap-1.5 text-[13px] font-bold tabular-nums text-text">
                {pctLabel}
                <span className="truncate text-[12px] font-medium text-text-subtle">{stepsText}</span>
              </span>
            ) : (
              <span className="text-[13px] font-semibold text-text">
                {t('courses.modules_count', { count: total })}
              </span>
            )}
            <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-text-subtle">
              {stripMeta.map((m, i) => (
                <span key={m} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span className="text-text-subtle/50">·</span>}
                  {m}
                </span>
              ))}
            </span>
          </div>

          {course.isAssigned ? (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1 text-[13px] font-semibold',
                completed ? 'text-primary' : 'text-text',
              )}
            >
              {completed ? t('courses.cta_review') : done > 0 ? t('courses.cta_continue') : t('courses.cta_start')}
              <span className="transition-transform duration-500 ease-apple group-hover:translate-x-1">→</span>
            </span>
          ) : (
            <motion.button
              onClick={handleEnroll}
              disabled={enrolling}
              whileTap={reduce ? undefined : { scale: 0.94 }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary disabled:opacity-60"
            >
              {enrolling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {t('courses.enroll')}
            </motion.button>
          )}
        </div>

        {deadlineText && (
          <div
            className={cn(
              'inline-flex items-center gap-1.5 text-[11.5px] font-medium',
              deadline.state === 'overdue' || deadline.state === 'soon' ? 'text-danger' : 'text-text-subtle',
            )}
          >
            {deadline.blocked ? (
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            {deadline.dueMs !== null ? (
              <Tooltip label={formatDueDate(deadline.dueMs, language)}>
                <span>{deadlineText}</span>
              </Tooltip>
            ) : (
              <span>{deadlineText}</span>
            )}
          </div>
        )}

        {course.desktop_only === true && (
          <div
            className={cn(
              'inline-flex items-center gap-1.5 text-[11.5px] font-medium',
              deviceBlocked ? 'text-amber-600 dark:text-amber-400' : 'text-text-subtle',
            )}
          >
            <Monitor className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {deviceBlocked ? t('courses.desktop_only_blocked') : t('courses.desktop_only_note')}
          </div>
        )}
      </div>
    </MotionLink>
  );
}

/* ── Rejilla animada de tarjetas ─────────────────────────────────────────── */
export function CourseGrid({
  courses,
  onEnrolled,
  reduce,
  trailing,
  journeys,
}: {
  courses: LearnerCourse[];
  onEnrolled?: () => void;
  reduce: boolean;
  /** Celda extra al final de la rejilla (p. ej. "Explorar catálogo"). */
  trailing?: ReactNode;
  /** Recorridos por id de curso (useCourseJourneys). */
  journeys?: Record<string, CourseJourney>;
}) {
  return (
    <motion.div
      layout={reduce ? undefined : 'position'}
      className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
    >
      <AnimatePresence initial={false}>
        {courses.map((c, i) => (
          <CourseCard
            key={c.id}
            course={c}
            index={i}
            onEnrolled={onEnrolled}
            reduce={reduce}
            journey={journeys?.[c.id]}
          />
        ))}
      </AnimatePresence>
      {trailing}
    </motion.div>
  );
}
