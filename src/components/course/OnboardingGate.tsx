import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, CalendarClock, Compass, Lock, Rocket } from 'lucide-react';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { ease } from '@/components/course/CourseCard';
import { cn } from '@/lib/cn';
import { formatDueDate } from '@/lib/courseDeadline';
import type { TFunction } from 'i18next';
import type { OnboardingGate } from '@/lib/onboarding';

/* Piezas visuales de la compuerta del onboarding (ver src/lib/onboarding.ts).
   Las tres dicen lo mismo con distinto tamaño: «termina tu inducción y se abre
   lo demás», siempre con cuánto falta. Un candado sin número se lee como un
   castigo; con «2 de 3» se lee como una meta. */

/* El plazo y la inducción son la misma historia: el aro dice cuánto lleva y la
   línea de abajo, hasta cuándo tiene. Cambian juntos de color —verde, ámbar,
   rojo— para que no haya que leer dos veces para saber si va a tiempo. */
type GateTone = 'primary' | 'warn' | 'danger';

function gateTone(gate: OnboardingGate): GateTone {
  if (gate.overdue) return 'danger';
  if (gate.deadline?.state === 'soon') return 'warn';
  return 'primary';
}

const TONE: Record<GateTone, { ring: string; box: string; glow: string; text: string }> = {
  primary: {
    ring: 'rgb(var(--primary))',
    box: 'border-primary/25 bg-primary/[0.05]',
    glow: 'bg-primary/15',
    text: 'text-primary',
  },
  warn: {
    ring: '#f59e0b',
    box: 'border-amber-500/35 bg-amber-500/[0.07]',
    glow: 'bg-amber-500/15',
    text: 'text-amber-600 dark:text-amber-400',
  },
  danger: {
    ring: 'rgb(var(--danger))',
    box: 'border-danger/35 bg-danger/[0.06]',
    glow: 'bg-danger/15',
    text: 'text-danger',
  },
};

/** Qué dice el plazo de la inducción, en una línea. */
function deadlineLine(gate: OnboardingGate, language: string, t: TFunction): string | null {
  const d = gate.deadline;
  if (gate.blocked) {
    return d?.dueMs
      ? t('onboarding_gate.deadline_closed', { date: formatDueDate(d.dueMs, language) })
      : t('onboarding_gate.deadline_closed_nodate');
  }
  if (!d || d.dueMs === null) return null;
  const date = formatDueDate(d.dueMs, language);
  if (d.state === 'overdue') return t('onboarding_gate.deadline_overdue', { date });
  if (d.state === 'soon') {
    return d.daysLeft <= 0
      ? t('onboarding_gate.deadline_today', { date })
      : t('onboarding_gate.deadline_soon', { count: d.daysLeft, date });
  }
  return t('onboarding_gate.deadline_ok', { date });
}

/** Franja de bienvenida: cuántos cursos de onboarding lleva y hasta cuándo tiene. */
export function OnboardingBanner({ gate, reduce, className }: { gate: OnboardingGate; reduce: boolean; className?: string }) {
  const { t, i18n } = useTranslation();
  const pct = gate.total > 0 ? gate.done / gate.total : 0;
  const tone = TONE[gateTone(gate)];
  const line = deadlineLine(gate, i18n.language, t);
  const Badge = gate.overdue ? AlertTriangle : gate.deadline?.state === 'soon' ? CalendarClock : Rocket;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease }}
      className={cn('relative overflow-hidden rounded-3xl border p-5 sm:p-6', tone.box, className)}
    >
      <div
        aria-hidden
        className={cn('pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full blur-3xl', tone.glow)}
      />
      <div className="relative flex items-center gap-4 sm:gap-5">
        <div className="relative shrink-0">
          <ProgressRing value={pct} size={60} stroke={4} color={tone.ring} />
          <span className={cn('absolute inset-0 flex items-center justify-center', tone.text)}>
            <Badge className="h-5 w-5" />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-[11px] font-semibold uppercase tracking-[0.14em]', tone.text)}>
            {t('onboarding_gate.eyebrow')}
          </p>
          <h2 className="mt-0.5 text-[17px] font-semibold tracking-tight text-text sm:text-[19px]">
            {gate.blocked
              ? t('onboarding_gate.title_closed')
              : t('onboarding_gate.title', { done: gate.done, total: gate.total })}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
            {gate.blocked ? t('onboarding_gate.body_closed') : t('onboarding_gate.body')}
          </p>
          {line && (
            <p className={cn('mt-2 flex items-center gap-1.5 text-[12.5px] font-medium', tone.text)}>
              <CalendarClock className="h-3.5 w-3.5 shrink-0" />
              {line}
            </p>
          )}
          {/* Quien no puede seguir necesita saber a quién pedirle el permiso,
              no solo que se le acabó el tiempo. */}
          {gate.blocked && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-text-muted">
              {t('onboarding_gate.ask_extension')}
            </p>
          )}
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
        {gate.blocked
          ? t('onboarding_gate.course_locked_body_closed')
          : t('onboarding_gate.course_locked_body', { done: gate.done, total: gate.total })}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {next && !gate.blocked && (
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
