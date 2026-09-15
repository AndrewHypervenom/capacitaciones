import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';

/**
 * Ruta desconocida.
 *
 * Antes no había comodín: cualquier enlace viejo o mal escrito (p. ej. el
 * antiguo `/simulator`) dejaba la pantalla completamente en negro, sin error
 * en consola ni forma de salir. Se lee como "el sitio se cayó".
 */
export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-line text-text-muted">
        <Compass className="h-6 w-6" />
      </span>
      <h1 className="text-lg font-bold text-text">
        {t('errors.not_found.title', 'Esta página no existe')}
      </h1>
      <p className="max-w-sm text-[13px] leading-relaxed text-text-muted">
        {t('errors.not_found.description', 'Puede que el enlace sea antiguo o esté mal escrito.')}
      </p>
      <Link
        to="/"
        className="inline-flex min-h-[44px] items-center rounded-xl border border-line px-5 text-[13px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
      >
        {t('errors.not_found.home', 'Ir al inicio')}
      </Link>
    </div>
  );
}
