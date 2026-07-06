import { useEffect, useRef, useState } from 'react';

// Cada cuánto se consulta version.json (ms)
const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutos

/**
 * Detecta si hay un despliegue más reciente del sitio comparando el
 * __BUILD_ID__ embebido en este bundle contra /version.json (regenerado
 * en cada build). Devuelve `true` cuando conviene invitar al usuario a
 * recargar para obtener la última versión.
 */
export function useVersionCheck(): boolean {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  // __BUILD_ID__ solo existe en builds de producción; en dev queda undefined.
  const currentVersion = useRef<string>(
    typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : '',
  );

  useEffect(() => {
    // Sin build id (dev / preview local) no tiene sentido chequear.
    if (!currentVersion.current) return;

    let cancelled = false;

    async function check() {
      // No molestar mientras la pestaña está oculta.
      if (document.hidden) return;
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        if (
          !cancelled &&
          data.version &&
          data.version !== currentVersion.current
        ) {
          setUpdateAvailable(true);
        }
      } catch {
        /* offline o archivo ausente: ignorar */
      }
    }

    void check();
    const interval = setInterval(check, POLL_INTERVAL);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return updateAvailable;
}
