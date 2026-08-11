import { useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useMotionTemplate, useMotionValue } from 'framer-motion';
import { Building2, CheckCircle2, GraduationCap, Loader2, Plus } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useUserStore } from '@/stores/userStore';
import { useAuthStore } from '@/stores/authStore';
import { useModuleDone, keyOfCourseModule, type ModuleKey } from '@/stores/progressStore';
import { invalidateLearnerCoursesCache } from '@/hooks/useLearnerCourses';
import { selfEnroll, type LearnerCourse } from '@/services/courses.service';
import { toast } from '@/stores/toastStore';
import { Tooltip } from '@/components/ui/Tooltip';
import { stripMarkdown } from '@/components/ui/RichText';
import { CourseCover, courseHasCover, COVER_BOX } from '@/components/course/CourseCover';
import { cn } from '@/lib/cn';

/* ────────────────────────────────────────────────────────────────────────────
   Tarjeta de curso ÚNICA del sitio. La usan el catálogo (/courses) y el panel
   del aprendiz: antes eran dos tarjetas distintas y el mismo curso se veía de
   dos maneras según por dónde llegaras.

   Lenguaje visual: en reposo, minimal — portada, título, una línea de datos en
   texto plano y un hilo de progreso de 3px. Nada de cápsulas de colores
   apiladas. Toda la riqueza vive en la interacción: elevación con resorte,
   reflejo que sigue al cursor, zoom lento de la portada y un destello que la
   barre.
   ──────────────────────────────────────────────────────────────────────────── */

/** Curva corporativa (misma que `ease-apple` de Tailwind y el kit de motion). */
export const ease = [0.16, 1, 0.3, 1] as const;

// motion(Link) SIEMPRE a nivel de módulo: crearlo dentro del render devuelve un
// componente nuevo en cada pasada y React remonta la tarjeta (parpadeo eterno).
const MotionLink = motion(Link);

export function pickCourseText(
  es: string | null,
  en: string | null,
  pt: string | null,
  lang: string,
): string {
  if (lang === 'en') return en || es || '';
  if (lang === 'pt') return pt || es || '';
  return es || '';
}

export function courseProgress(
  course: LearnerCourse,
  isModuleDone: (key: ModuleKey) => boolean,
) {
  const total = course.modules.length;
  const done = course.modules.filter((m) => isModuleDone(keyOfCourseModule(m))).length;
  return { total, done, pct: total > 0 ? done / total : 0 };
}

/* ── Anillo de progreso alrededor del emblema ───────────────────────────────
   Sustituye a la cápsula de estado ("sin empezar / en proceso"): dice lo mismo
   sin una etiqueta más encima de la portada. */
function ProgressRing({ pct, color, children }: { pct: number; color: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const R = 22;
  const C = 2 * Math.PI * R;

  return (
    <div className="relative h-[52px] w-[52px]">
      <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="26" cy="26" r={R} fill="none" stroke="rgb(var(--surface))" strokeWidth="3" />
        <motion.circle
          cx="26"
          cy="26"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: reduce ? C * (1 - pct) : C }}
          animate={{ strokeDashoffset: C * (1 - pct) }}
          transition={{ duration: reduce ? 0 : 1.1, ease, delay: reduce ? 0 : 0.15 }}
        />
      </svg>
      <div
        className="absolute inset-[5px] flex items-center justify-center rounded-2xl text-white shadow-sm"
        style={{ background: color }}
      >
        {children}
      </div>
    </div>
  );
}

export interface CourseCardProps {
  course: LearnerCourse;
  /** Posición en la rejilla: escalona la entrada. */
  index?: number;
  /** Se llama tras auto-inscribirse (para refrescar la lista). */
  onEnrolled?: () => void;
  /** `prefers-reduced-motion` ya resuelto por el padre. */
  reduce: boolean;
}

export function CourseCard({ course, index = 0, onEnrolled, reduce }: CourseCardProps) {
  const { t } = useTranslation();
  const language = useUserStore((s) => s.language);
  // Rol REAL (no el de useAuth, que en la vista previa finge ser aprendiz): al
  // capacitador/superadmin le sirve saber de qué campaña es cada curso incluso
  // mirando el panel del aprendiz, donde el catálogo mezcla varias campañas.
  const realRole = useAuthStore((s) => s.profile?.role);
  const isStaff = realRole === 'superadmin' || realRole === 'capacitador';
  const isModuleDone = useModuleDone();
  const { total, done, pct } = courseProgress(course, isModuleDone);
  const totalMin = course.modules.reduce((acc, m) => acc + m.duration_min, 0);
  const completed = total > 0 && done === total;
  const [enrolling, setEnrolling] = useState(false);

  // Reflejo que sigue al cursor, por debajo del contenido: da profundidad sin
  // teñir el texto.
  const mx = useMotionValue(-300);
  const my = useMotionValue(-300);
  const halo = useMotionTemplate`radial-gradient(320px circle at ${mx}px ${my}px, ${course.color}1F, transparent 70%)`;

  const onMove = (e: MouseEvent<HTMLElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(e.clientX - r.left);
    my.set(e.clientY - r.top);
  };

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

  // Una sola etiqueta sobre la portada, y solo cuando dice algo que no se ve en
  // otro lado: obligatorio PENDIENTE, o curso ya completado.
  const badge = course.isMandatory && !completed
    ? { text: t('courses.mandatory'), tone: 'danger' as const }
    : completed
      ? { text: t('courses.status_completed'), tone: 'primary' as const }
      : null;

  const meta = [
    t('courses.modules_count', { n: total }),
    totalMin > 0 ? `${totalMin} min` : null,
    t(`courses.level_${course.level}`),
  ].filter(Boolean) as string[];

  return (
    <MotionLink
      to={`/courses/${course.slug}`}
      state={{ from: 'courses' }}
      layout={reduce ? undefined : 'position'}
      initial={reduce ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ duration: 0.5, ease, delay: reduce ? 0 : Math.min(index * 0.04, 0.24) }}
      whileHover={reduce ? undefined : { y: -5 }}
      onMouseMove={onMove}
      className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-line bg-surface transition-shadow duration-500 ease-apple hover:shadow-card-hover"
    >
      {!reduce && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          style={{ background: halo }}
        />
      )}

      {/* Portada. El recorte (overflow-hidden) va en una capa interna: si lo
          ponemos aquí, el emblema que sobresale por abajo queda cortado. */}
      <div className={`relative shrink-0 ${COVER_BOX}`}>
        <div
          className="absolute inset-0 overflow-hidden"
          style={{
            background: courseHasCover(course)
              ? course.cover_fit === 'contain'
                ? `linear-gradient(120deg, ${course.color}1F, ${course.color}08)`
                : undefined
              : `linear-gradient(120deg, ${course.color}33, ${course.color}0A)`,
          }}
        >
          <CourseCover
            course={course}
            alt={pickCourseText(course.title_es, course.title_en, course.title_pt, language)}
            className={`h-full w-full transition-transform duration-[900ms] ease-apple group-hover:scale-[1.06] ${course.cover_fit === 'contain' ? 'object-contain' : 'object-cover'}`}
            loading="lazy"
          />
          {/* Destello que barre la portada al pasar el cursor */}
          {!reduce && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/15 to-transparent opacity-0 transition-all duration-[900ms] ease-apple group-hover:left-[110%] group-hover:opacity-100"
            />
          )}
        </div>

        <div className="absolute -bottom-6 left-4 z-10">
          <ProgressRing pct={course.isAssigned ? pct : 0} color={course.color}>
            {completed ? <CheckCircle2 className="h-5 w-5" /> : <GraduationCap className="h-5 w-5" />}
          </ProgressRing>
        </div>

        {badge && (
          <span
            className={cn(
              'absolute top-3 right-3 z-10 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm',
              badge.tone === 'danger'
                ? 'bg-danger/15 ring-1 ring-inset ring-danger/50'
                : 'bg-primary/15 ring-1 ring-inset ring-primary/50',
            )}
          >
            {badge.text}
          </span>
        )}
      </div>

      <div className="relative z-10 flex flex-1 flex-col px-5 pt-9 pb-5">
        <h3 className="mb-1.5 text-[16px] font-semibold leading-snug tracking-tight text-text">
          {pickCourseText(course.title_es, course.title_en, course.title_pt, language)}
        </h3>
        <p className="mb-4 line-clamp-2 text-[13px] leading-relaxed text-text-muted">
          {stripMarkdown(
            pickCourseText(course.description_es, course.description_en, course.description_pt, language),
          )}
        </p>

        <div className="mt-auto">
          {/* Datos en texto plano separados por puntos: la misma información que
              tres cápsulas de colores, sin el ruido. */}
          <div className="mb-3 flex flex-wrap items-center gap-x-1.5 text-[12px] text-text-subtle">
            {meta.map((m, i) => (
              <span key={m} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="text-text-subtle/50">·</span>}
                {m}
              </span>
            ))}
            {/* La campaña dueña: en el catálogo la ve todo el mundo y el staff la
                ve también en "Mis cursos". El Tooltip vive en un portal, así que
                el nombre completo no lo recorta nada. */}
            {course.campaign_name && (!course.isAssigned || isStaff) && (
              <Tooltip label={course.campaign_name}>
                <span className="ml-auto inline-flex max-w-[9rem] items-center gap-1 text-text-subtle">
                  <Building2 className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{course.campaign_name}</span>
                </span>
              </Tooltip>
            )}
          </div>

          <div className="mb-2.5 h-[3px] w-full overflow-hidden rounded-full bg-subtle">
            <motion.div
              className="h-full rounded-full"
              style={{ background: course.color }}
              initial={{ width: reduce ? `${Math.round(pct * 100)}%` : 0 }}
              animate={{ width: `${Math.round(pct * 100)}%` }}
              transition={{ duration: reduce ? 0 : 0.9, ease, delay: reduce ? 0 : 0.2 }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] tabular-nums text-text-subtle">
              {t('courses.progress', { done, total })}
            </span>
            {course.isAssigned ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[13px] font-medium',
                  completed ? 'text-primary' : 'text-text',
                )}
              >
                {completed
                  ? t('courses.cta_review')
                  : done > 0
                    ? t('courses.cta_continue')
                    : t('courses.cta_start')}
                <span className="transition-transform duration-500 ease-apple group-hover:translate-x-1">→</span>
              </span>
            ) : (
              <motion.button
                onClick={handleEnroll}
                disabled={enrolling}
                whileTap={reduce ? undefined : { scale: 0.94 }}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary disabled:opacity-60"
              >
                {enrolling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {t('courses.enroll')}
              </motion.button>
            )}
          </div>
        </div>
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
}: {
  courses: LearnerCourse[];
  onEnrolled?: () => void;
  reduce: boolean;
  /** Celda extra al final de la rejilla (p. ej. "Explorar catálogo"). */
  trailing?: ReactNode;
}) {
  return (
    <motion.div
      layout={reduce ? undefined : 'position'}
      className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
    >
      <AnimatePresence initial={false}>
        {courses.map((c, i) => (
          <CourseCard key={c.id} course={c} index={i} onEnrolled={onEnrolled} reduce={reduce} />
        ))}
      </AnimatePresence>
      {trailing}
    </motion.div>
  );
}
