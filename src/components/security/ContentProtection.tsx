import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/stores/toastStore';

/**
 * Protección del contenido del curso frente a la copia.
 *
 * Es disuasión, no seguridad: quien abra las herramientas del navegador se lo
 * salta en diez segundos. Sirve para el 95% que solo iba a pegar el módulo en un
 * WhatsApp, y por eso lo que queda en el portapapeles está redactado como una
 * petición y no como una alarma.
 *
 * Lo que NO hace, a propósito: no hay marca de agua. Se probó y estorbaba la
 * lectura del sitio. A cambio, la trazabilidad de una filtración se pierde: si
 * alguien hace una captura de pantalla, esa imagen sale limpia y no hay forma de
 * saber de quién salió. Ninguna web puede impedir la captura —no existe API para
 * ello, y el DRM que usa Netflix solo cubre el `<video>`, nunca el texto ni las
 * imágenes—, así que ese hueco se asume conscientemente.
 *
 * Lo único que viaja firmado es el texto copiado: lleva el nombre de quien lo
 * copió, para que al menos el pegado en otro sitio no sea anónimo.
 *
 * Va en la raíz de `App` y no dentro de una vista para que cubra TODO el sitio
 * del aprendiz —módulos, PDF, examen, simulador, mundos, arena— sin tener que
 * acordarse de envolver cada pantalla nueva.
 */

/**
 * Rutas donde NO se bloquea nada, aunque quien mire sea aprendiz: el certificado
 * es SUYO y está hecho para descargarlo y presumirlo, y `/verify` es la página
 * pública del QR, que abre gente de fuera.
 */
const EXEMPT = [/^\/certificate/, /^\/verify\//];

/** ¿El evento nace de algo donde la persona ESCRIBE? Ahí no se toca nada. */
function isEditable(target: EventTarget | null) {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"]');
}

export function ContentProtection() {
  const { t } = useTranslation();
  const { role, profile, user } = useAuth();
  const { pathname } = useLocation();

  // Solo el aprendiz: el staff necesita copiar el contenido para trabajarlo. En
  // la vista previa `useAuth` ya devuelve 'learner', así que el capacitador ve
  // exactamente lo mismo que verá su gente.
  const active = role === 'learner' && !EXEMPT.some((r) => r.test(pathname));
  const name = profile?.display_name || user?.email || '';
  const email = user?.email ?? '';

  useEffect(() => {
    if (!active) return;

    /**
     * Lo que de verdad acaba en el portapapeles. Lleva la firma de quien copió:
     * si ese texto aparece pegado en otro sitio, ya se sabe por dónde salió.
     */
    const replacement = () => {
      const when = new Date().toLocaleDateString('es-CO', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      const who = `${name}${email && email !== name ? ` (${email})` : ''}`;
      return [
        t('protection.clipboard_title', '— Contenido de Positivos+ —'),
        t(
          'protection.clipboard_body',
          'Este material de capacitación es propiedad de Positivos+ y de su cliente, y no puede reproducirse fuera de la plataforma. Si lo necesitas para tu trabajo, pídeselo a tu capacitador.',
        ),
        `${t('protection.clipboard_by', 'Copiado por')}: ${who} · ${when}`,
      ].join('\n\n');
    };

    const notify = () => {
      toast.info(
        t('protection.blocked_title', 'Contenido de Positivos+'),
        t(
          'protection.blocked_body',
          'Este material es para usarse aquí dentro. Si necesitas guardarlo, pídeselo a tu capacitador.',
        ),
      );
    };

    const onCopy = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      // Sin selección de por medio (Ctrl+C en vacío) no hay nada que sustituir.
      if (!window.getSelection()?.toString()) return;
      e.preventDefault();
      e.clipboardData?.setData('text/plain', replacement());
      notify();
    };

    const onContextMenu = (e: MouseEvent) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
      notify();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isEditable(e.target)) return;
      const key = e.key.toLowerCase();
      // Imprimir y "guardar página" no pasan por el evento `copy`.
      if (key === 'p' || key === 's') {
        e.preventDefault();
        notify();
      }
    };

    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('protected-content');
    // Lo que sale si alguien llega igual al diálogo de imprimir (menú del
    // navegador, Cmd+P del sistema): una hoja con el aviso y nada del módulo.
    // El CSS lo lee con `content: attr(data-print-notice)`.
    document.body.dataset.printNotice = t(
      'protection.print_notice',
      'Este material de capacitación es de Positivos+ y no puede imprimirse. Consúltalo en la plataforma.',
    );

    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('protected-content');
      delete document.body.dataset.printNotice;
    };
  }, [active, name, email, t]);

  return null;
}
