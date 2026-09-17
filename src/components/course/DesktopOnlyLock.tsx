import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useDeviceKind } from '@/hooks/useDeviceKind';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { supabase } from '@/lib/supabase';
import { blockedByDevice, type DesktopOnlyCourse, type DeviceKind } from '@/lib/device';

/* ────────────────────────────────────────────────────────────────────────────
   «Este curso solo se ve desde el computador» (`courses.desktop_only`).

   Hay contenido que en un celular no se puede hacer bien —simuladores con
   teclado, tablas anchas, material que se trabaja en el puesto—, y hacerlo a
   medias en el bus es peor que no empezarlo. El capacitador lo marca en el
   curso y quien llegue desde tableta o celular ve esta pantalla en vez del
   contenido.

   La puerta se cierra en TODAS las entradas del curso (curso, módulo, examen),
   no solo en la primera: la URL de un módulo se comparte por WhatsApp y se abre
   desde el celular sin pasar por ningún lado.

   NO hay forma de seguir de largo, para nadie: es una restricción, no una
   advertencia. Quien tenga que revisar el curso lo abre desde un computador.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Puerta de entrada: devuelve la pantalla de bloqueo cuando toca y `null`
 * cuando se puede pasar.
 *
 * Se usa como `if (lock) return lock;` justo antes de pintar, para que ningún
 * dato del curso llegue a la pantalla del celular.
 */
export function useDesktopOnlyLock(course: DesktopOnlyCourse | null | undefined): ReactNode | null {
  const kind = useDeviceKind();
  if (!blockedByDevice(course, kind)) return null;
  return <DesktopOnlyLock kind={kind} />;
}

export function DesktopOnlyLock({ kind }: { kind: DeviceKind }) {
  const { t } = useTranslation();
  const DeviceIcon = kind === 'tablet' ? Tablet : Smartphone;

  return (
    <div className="mx-auto max-w-lg px-5 pb-24 pt-24 text-center">
      {/* El aparato tachado y el computador en verde: se entiende antes de leer. */}
      <span className="mx-auto mb-5 flex items-center justify-center gap-3">
        <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-subtle text-text-subtle">
          <DeviceIcon className="h-5 w-5" />
          <span aria-hidden className="absolute h-px w-8 -rotate-45 bg-text-subtle" />
        </span>
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Monitor className="h-6 w-6" />
        </span>
      </span>
      <h1 className="mb-2 text-[22px] font-semibold tracking-tight text-text">
        {t('desktop_only.title')}
      </h1>
      <p className="mb-2 text-[14px] leading-relaxed text-text-muted">
        {kind === 'tablet' ? t('desktop_only.body_tablet') : t('desktop_only.body_phone')}
      </p>
      <p className="mb-7 text-[13px] leading-relaxed text-text-subtle">{t('desktop_only.hint')}</p>
      <Link
        to="/courses"
        className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13px] text-text-muted transition-colors hover:border-text-subtle hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {t('courses.back_to_courses')}
      </Link>
    </div>
  );
}

/**
 * Lo mismo para una simulación, que se abre por su propia dirección y no sabe
 * de qué curso es: se pregunta a la base a qué curso pertenece y se cierra si
 * ese curso es «solo desde el computador».
 *
 * En un computador no se consulta nada: la puerta nunca se cierra ahí, así que
 * no se le hace pagar una consulta a quien sí puede pasar.
 */
export function useDesktopOnlyLockForScenario(
  table: 'scenarios' | 'choice_scenarios',
  slug: string | undefined,
): ReactNode | null {
  const kind = useDeviceKind();
  const onDesktop = kind === 'desktop';
  const { courses } = useLearnerCourses();
  // `undefined` = todavía no se sabe; `null` = suelta, sin curso dueño.
  const [courseId, setCourseId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (onDesktop || !slug) return;
    let alive = true;
    supabase
      .from(table)
      .select('course_id')
      .eq('slug', slug)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setCourseId((data as { course_id?: string | null } | null)?.course_id ?? null);
      });
    return () => {
      alive = false;
    };
  }, [table, slug, onDesktop]);

  const course = useMemo(
    () => (courseId ? courses.find((c) => c.id === courseId) : undefined),
    [courses, courseId],
  );

  if (onDesktop) return null;
  // Mientras no se sepa de qué curso es, no se pinta nada: si no, la simulación
  // asomaría medio segundo justo en la pantalla donde se quería tapar.
  if (courseId === undefined) return <div className="min-h-[60vh]" />;
  if (!blockedByDevice(course, kind)) return null;
  return <DesktopOnlyLock kind={kind} />;
}
