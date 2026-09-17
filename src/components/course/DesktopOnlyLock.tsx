import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Eye, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useDeviceKind } from '@/hooks/useDeviceKind';
import { useAuthStore } from '@/stores/authStore';
import { blockedByDevice, type DesktopOnlyCourse, type DeviceKind } from '@/lib/device';

/* ────────────────────────────────────────────────────────────────────────────
   «Este curso solo se ve desde el computador» (`courses.desktop_only`).

   Hay contenido que en un celular no se puede hacer bien —simuladores con
   teclado, tablas anchas, material que se trabaja en el puesto—, y hacerlo a
   medias en el bus es peor que no empezarlo. El capacitador lo marca en el
   curso y el aprendiz que llega desde tableta o celular ve esta pantalla en vez
   del contenido.

   La puerta se cierra en TODAS las entradas del curso (curso, módulo, examen),
   no solo en la primera: la URL de un módulo se comparte por WhatsApp y se abre
   desde el celular sin pasar por ningún lado.

   El staff (superadmin y capacitador) puede seguir de largo: necesita poder
   revisar su propio curso desde donde esté, y a él la restricción no le protege
   de nada.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Puerta de entrada: envuelve el contenido y lo reemplaza por la explicación
 * cuando toca. Devuelve `null` como bloqueo solo si de verdad hay que cerrar.
 *
 * Se usa como `if (lock) return lock;` justo antes de pintar, para que ningún
 * dato del curso llegue a la pantalla del celular.
 */
export function useDesktopOnlyLock(
  course: (DesktopOnlyCourse & { title?: string }) | null | undefined,
): ReactNode | null {
  const kind = useDeviceKind();
  const role = useAuthStore((s) => s.profile?.role);
  const isStaff = role === 'superadmin' || role === 'capacitador';
  const [bypassed, setBypassed] = useState(false);

  if (!blockedByDevice(course, kind) || bypassed) return null;
  return <DesktopOnlyLock kind={kind} onBypass={isStaff ? () => setBypassed(true) : undefined} />;
}

export function DesktopOnlyLock({
  kind,
  onBypass,
}: {
  kind: DeviceKind;
  onBypass?: () => void;
}) {
  const { t } = useTranslation();
  const DeviceIcon = kind === 'tablet' ? Tablet : Smartphone;

  return (
    <div className="mx-auto max-w-lg px-5 pb-24 pt-24 text-center">
      {/* El celular tachado y el computador en verde: se entiende antes de leer. */}
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
      <p className="mb-7 text-[13px] leading-relaxed text-text-subtle">
        {t('desktop_only.hint')}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link
          to="/courses"
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13px] text-text-muted transition-colors hover:border-text-subtle hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('courses.back_to_courses')}
        </Link>
        {onBypass && (
          <button
            type="button"
            onClick={onBypass}
            className="inline-flex items-center gap-2 rounded-full border border-dashed border-line px-4 py-2.5 text-[13px] text-text-subtle transition-colors hover:border-text-subtle hover:text-text"
          >
            <Eye className="h-3.5 w-3.5" />
            {t('desktop_only.staff_bypass')}
          </button>
        )}
      </div>
    </div>
  );
}
