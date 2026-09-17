import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowLeft, Compass, Lock, Rocket } from 'lucide-react';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { ease } from '@/components/course/CourseCard';
import type { OnboardingGate } from '@/lib/onboarding';

/* Piezas visuales de la compuerta del onboarding (ver src/lib/onboarding.ts).
   Las tres dicen lo mismo con distinto tamaño: «termina tu inducción y se abre
   lo demás», siempre con cuánto falta. Un candado sin número se lee como un
   castigo; con «2 de 3» se lee como una meta. */

/** Franja de bienvenida: cuántos cursos de onboarding lleva. */
export function OnboardingBanner({ gate, reduce, className }: { gate: OnboardingGate; reduce: boolean; className?: string }) {
  const { t } = useTranslation();
  const pct = gate.total > 0 ? gate.done / gate.total : 0;
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className={
        'relative overflow-hidden rounded-3xl border border-primary/25 bg-primary/[0.05] p-5 sm:p-6 ' +
        (className ?? '')
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative flex items-center gap-4 sm:gap-5">
        <div className="relative shrink-0">
          <ProgressRing value={pct} size={60} stroke={4} color="rgb(var(--primary))" />
          <span className="absolute inset-0 flex items-center justify-center text-primary">
            <Rocket className="h-5 w-5" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            {t('onboarding_gate.eyebrow')}
          </p>
          <h2 className="mt-0.5 text-[17px] font-semibold tracking-tight text-text sm:text-[19px]">
            {t('onboarding_gate.title', { done: gate.done, total: gate.total })}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
            {t('onboarding_gate.body')}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/** Celda de la rejilla donde iría «Explorar catálogo», con candado. */
export function LockedCatalogCard({ gate }: { gate: OnboardingGate }) {
  const { t } = useTranslation();
  const left = Math.max(0, gate.total - gate.done);
  return (
    <div className="flex h-full min-h-[13rem] flex-col items-center justify-center gap-2.5 rounded-3xl border border-dashed border-line p-6 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-subtle text-text-subtle">
        <Lock className="h-4 w-4" />
      </span>
      <div>
        <p className="text-[15px] font-medium tracking-tight text-text">{t('onboarding_gate.catalog_locked_title')}</p>
        <p className="mt-0.5 text-[13px] text-text-muted">
          {t('onboarding_gate.catalog_locked_body', { count: left })}
        </p>
      </div>
    </div>
  );
}

/** Página del curso cuando todavía no le toca: se dice por qué y a dónde ir. */
export function OnboardingCourseLock({ gate }: { gate: OnboardingGate }) {
  const { t } = useTranslation();
  const next = gate.pending[0];
  return (
    <div className="mx-auto max-w-lg px-5 pb-24 pt-24 text-center">
      <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Lock className="h-6 w-6" />
      </span>
      <h1 className="mb-2 text-[22px] font-semibold tracking-tight text-text">
        {t('onboarding_gate.course_locked_title')}
      </h1>
      <p className="mb-7 text-[14px] leading-relaxed text-text-muted">
        {t('onboarding_gate.course_locked_body', { done: gate.done, total: gate.total })}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {next && (
          <Link
            to={`/courses/${next.slug}`}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90"
          >
            <Compass className="h-4 w-4" />
            {t('onboarding_gate.go_onboarding')}
          </Link>
        )}
        <Link
          to="/courses"
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13px] text-text-muted transition-colors hover:border-text-subtle hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('courses.back_to_courses')}
        </Link>
      </div>
    </div>
  );
}
