import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, ShieldCheck } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { RichText } from '@/components/ui/RichText';
import { cn } from '@/lib/cn';

/**
 * Aviso de curso migrado de la plataforma anterior (Sinergy).
 *
 * A quien ya hizo el curso allá no se le pide repetirlo: manda su certificado y
 * se le homologa. Sale como modal al abrir el curso, no como banner en la
 * ficha: es una decisión que se toma ANTES de empezar —"¿hago esto o mando mi
 * certificado?"— y un aviso que convive con el botón de Empezar se lee cuando
 * ya diste el clic.
 *
 * El mismo componente lo usan la ficha del curso y la vista previa del editor,
 * a propósito: quien decide encenderlo tiene que estar viendo exactamente lo
 * que verá el aprendiz, no una aproximación.
 *
 * El correo va entre acentos graves en la traducción para que RichText lo pinte
 * como dato copiable: es lo único que el aprendiz tiene que llevarse de aquí, y
 * transcribirlo a mano es donde se pierde.
 */
/**
 * Segundos que el aviso permanece abierto sin poder cerrarse.
 *
 * El aprendiz cierra los modales por reflejo, y este le puede ahorrar un curso
 * entero: si lo despacha sin leerlo, lo repite para nada. Diez segundos dan
 * para leer las tres líneas sin prisa y hasta para copiar el correo antes de
 * cerrar, que es lo único que se le pide aquí.
 *
 * Para cambiarlo, este número y ya: la cuenta atrás y el bloqueo salen los dos
 * de aquí.
 */
export const LEGACY_NOTICE_LOCK_SECONDS = 10;

export function LegacyCourseNoticeModal({
  email,
  onClose,
}: {
  /** Destino de las homologaciones. Vacío = el de la traducción. */
  email?: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const to = (email ?? '').trim() || t('courses.legacy_notice_email_default');

  // Cuenta atrás visible. Que se VEA es la mitad del asunto: un modal que no
  // cierra y no dice por qué se siente roto, no cuidadoso.
  const [left, setLeft] = useState(LEGACY_NOTICE_LOCK_SECONDS);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const locked = left > 0;

  return (
    <Modal
      onClose={onClose}
      title={t('courses.legacy_notice_title')}
      icon={<ShieldCheck className="h-4 w-4" />}
      accent="green"
      size="md"
      /* Mientras corre la cuenta no se cierra por fondo, ni con Esc, ni con la X. */
      dismissible={!locked}
      footerLeft={
        locked ? (
          <span className="text-[12px] tabular-nums text-text-subtle">
            {t('courses.legacy_notice_wait', { count: left })}
          </span>
        ) : undefined
      }
      footer={
        <button
          type="button"
          onClick={onClose}
          disabled={locked}
          className={cn(
            'rounded-full px-5 py-2 text-[13px] font-medium transition-opacity duration-300',
            locked
              ? 'cursor-not-allowed bg-subtle text-text-subtle'
              : 'bg-primary text-on-primary hover:opacity-90',
          )}
        >
          {locked
            ? `${t('courses.legacy_notice_ack')} (${left})`
            : t('courses.legacy_notice_ack')}
        </button>
      }
    >
      <div className="space-y-5">
        <p className="text-[13.5px] leading-relaxed text-text-muted">
          {t('courses.legacy_notice_lead')}
        </p>

        {/* El correo, en su propia línea. Antes iba dentro del párrafo, y como el
            dato copiable es un bloque con borde, partía la frase en dos y dejaba
            el punto final colgando solo al lado de la caja. Aquí es lo que es:
            la ÚNICA acción que se le pide al aprendiz en este aviso.

            Filo lateral y no tarjeta: el dato copiable ya trae su propio
            recuadro, y meterlo dentro de otro lo dejaría como caja en caja. */}
        <div className="border-l-2 border-primary/40 pl-4">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-text">
            <Mail className="h-3.5 w-3.5 shrink-0 text-primary" />
            {t('courses.legacy_notice_send')}
          </div>
          {/* Por RichText y entre acentos graves: así hereda el botón de copiar
              del sitio en vez de reimplementarlo aquí. */}
          <RichText
            text={`\`${to}\``}
            className="mt-2 text-[13.5px] font-medium text-text [overflow-wrap:anywhere]"
          />
        </div>

        <p className="text-[13.5px] leading-relaxed text-text-muted">
          {t('courses.legacy_notice_after')}
        </p>
      </div>
    </Modal>
  );
}

/** Recuerda a quién ya se le mostró, por curso y por navegador. */
export function legacyNoticeSeenKey(courseId: string) {
  return `learningai.legacyNotice.${courseId}`;
}
