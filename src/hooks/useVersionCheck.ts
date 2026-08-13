import { useEffect, useRef, useState } from 'react';

// Cada cuánto se consulta version.json (ms)
const POLL_INTERVAL = 2 * 60 * 1000; // 2 minutos

/**
 * Se trae a la caché del navegador los archivos del despliegue nuevo, mientras
 * el aviso está en pantalla y ANTES de que nadie pulse "Actualizar".
 *
 * Sin esto, actualizar era un arranque en frío: cada build cambia el hash de
 * todos los archivos (`/assets/index-ABC123.js`), así que al recargar no sirve
 * nada de lo cacheado y hay que bajarse el paquete entero con la pantalla en
 * blanco. Ese era el "se demora en actualizar".
 *
 * Cómo: se pide el `index.html` nuevo —que nunca se cachea, así que siempre
 * llega fresco— y se leen de ahí las rutas de sus scripts y hojas de estilo.
 * Pedirlas las deja guardadas: como `/assets/*` se sirve `immutable`, la recarga
 * posterior las toma del disco sin volver a la red.
 *
 * Es del todo opcional: si algo falla —sin conexión, HTML raro, el navegador se
 * niega— no se avisa ni se rompe nada; simplemente la actualización tarda lo que
 * tardaba antes.
 */
async function warmNextBuild(): Promise<void> {
  try {
    const res = await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.text();

    // `<script src>`, `<link href>` (hoja de estilo y modulepreload). Solo se
    // aceptan rutas de /assets/: es lo único con hash e inmutable, y así una
    // respuesta inesperada no puede hacernos pedir cualquier cosa.
    const urls = new Set<string>();
    for (const m of html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)) {
      urls.add(m[1]);
    }
    if (urls.size === 0) return;

    // En serie y sin bloquear: es una descarga de fondo para alguien que sigue
    // trabajando en la página. No debe competir con lo que esté haciendo.
    for (const url of urls) {
      await fetch(url, { cache: 'force-cache' }).catch(() => {});
    }
  } catch {
    /* la actualización seguirá funcionando, solo que sin el adelanto */
  }
}

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
  // Versión cuyos archivos ya se adelantaron (ver `warmNextBuild`).
  const warmedFor = useRef<string | null>(null);

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
          // Una sola vez por despliegue: el aviso ya no se va a repetir, y
          // volver a descargar lo mismo en cada sondeo sería absurdo.
          if (warmedFor.current !== data.version) {
            warmedFor.current = data.version;
            void warmNextBuild();
          }
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
