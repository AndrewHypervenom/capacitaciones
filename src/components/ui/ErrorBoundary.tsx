import { Component, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import i18n from '@/i18n';

const RELOAD_KEY = 'learningai.chunk-reload-at';

/** Detecta fallos de carga de chunks (típico tras un despliegue: el JS viejo ya no existe). */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\d]+ failed/i.test(
    message,
  );
}

/**
 * Recarga la página una sola vez (guard de 30s en sessionStorage) para
 * traer la versión nueva del sitio. Devuelve true si disparó la recarga.
 */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage no disponible: recargar igual */
  }
  window.location.reload();
  return true;
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  reloading: boolean;
}

/**
 * Barrera global de errores: evita que un error de render deje la pantalla
 * en negro. Si el error es un chunk que no cargó (despliegue nuevo), recarga
 * automáticamente; si no, muestra una pantalla de recuperación.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, reloading: false };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (isChunkLoadError(error) && reloadForNewVersion()) {
      this.setState({ reloading: true });
      return;
    }
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.state.reloading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-bg">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-text/20 border-t-neon-cyan" />
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-6">
        <div className="text-center max-w-sm">
          <p className="text-lg font-semibold text-text">{i18n.t('errors.boundary.title')}</p>
          <p className="mt-2 text-sm text-text-muted leading-relaxed">
            {i18n.t('errors.boundary.description')}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-neon-cyan/15 hover:bg-neon-cyan/25 text-neon-cyan text-sm font-semibold px-4 py-2.5 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            {i18n.t('errors.boundary.reload')}
          </button>
        </div>
      </div>
    );
  }
}
