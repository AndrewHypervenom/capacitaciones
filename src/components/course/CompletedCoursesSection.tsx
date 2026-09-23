import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { CourseGrid, ease } from '@/components/course/CourseCard';
import type { CourseJourney } from '@/lib/courseJourney';
import type { CourseCompletion } from '@/services/certification.service';
import type { LearnerCourse } from '@/services/courses.service';

/* ────────────────────────────────────────────────────────────────────────────
   «Completados (N)», plegable, debajo de los pendientes. La usan el inicio y
   /courses para que lo ya hecho no le robe sitio a lo que falta, sin
   desaparecer: desde aquí se repasa y se abre el certificado.

   Arranca cerrada. Que la persona la abra se recuerda en SU navegador (es una
   comodidad, no un dato): si el almacenamiento falla, vuelve a salir cerrada.
   ──────────────────────────────────────────────────────────────────────────── */

const STORE_KEY = 'courses.completed-open';

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

export function CompletedCoursesSection({
  courses,
  reduce,
  journeys,
  completions,
  forceOpen = false,
  className,
}: {
  courses: LearnerCourse[];
  reduce: boolean;
  journeys?: Record<string, CourseJourney>;
  completions?: Record<string, CourseCompletion>;
  /** Abierta sí o sí (buscando, o con el filtro «Completados»). */
  forceOpen?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [stored, setStored] = useState(readOpen);
  const open = forceOpen || stored;

  if (courses.length === 0) return null;

  const toggle = () => {
    const next = !open;
    setStored(next);
    try {
      localStorage.setItem(STORE_KEY, next ? '1' : '0');
    } catch {
      /* sin almacenamiento: solo dura la visita */
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        disabled={forceOpen}
        aria-expanded={open}
        className="group flex w-full items-center gap-2 border-b border-line/70 pb-2 text-left transition-colors hover:border-text-subtle/40 disabled:cursor-default"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-subtle transition-colors group-hover:text-text-muted">
          {t('courses.completed_section')}
        </span>
        <span className="text-[11px] tabular-nums text-text-subtle/70">{courses.length}</span>
        {!forceOpen && (
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: reduce ? 0 : 0.35, ease }}
            className="ml-auto text-text-subtle"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="completed"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.45, ease }}
            className="overflow-hidden"
          >
            <p className="mb-4 mt-2 text-[12.5px] text-text-muted">{t('courses.completed_section_hint')}</p>
            {/* pb: el hover sube la tarjeta y proyecta sombra; que el recorte no se la coma. */}
            <div className="pb-2">
              <CourseGrid courses={courses} reduce={reduce} journeys={journeys} completions={completions} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
