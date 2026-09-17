import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles/globals.css';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import flagsFontUrl from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url';
import i18n, { ensureLanguage } from './i18n';
import App from './App';
import { ErrorBoundary, reloadForNewVersion } from '@/components/ui/ErrorBoundary';

// Chunk que no cargó al navegar (quedó JS viejo tras un despliegue): recargar
// una vez para traer la versión nueva en lugar de dejar la pantalla vacía.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewVersion()) event.preventDefault();
});

// Windows no trae dibujos para los emojis de bandera: donde Mac y el teléfono
// pintan 🇨🇴, Chrome en Windows escribe «CO». Solo en esos navegadores se carga
// una fuente con las banderas (servida desde el propio sitio, no un CDN) y va
// primera en la pila de `tailwind.config.ts`. Su unicode-range cubre solo las
// letras de bandera: el resto del texto y de los emojis no cambia.
polyfillCountryFlagEmojis('Twemoji Country Flags', flagsFontUrl);

(function applyInitialTheme() {
  try {
    const stored = localStorage.getItem('learningai.theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored === 'dark' || ((stored === null || stored === 'system') && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
  } catch {
    /* ignore */
  }
})();

function montar() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

/* El diccionario del idioma detectado ANTES de pintar.
 *
 * Para quien tiene español —casi todo el mundo— esto resuelve en el mismo
 * instante: su diccionario ya viene en el paquete y `ensureLanguage` devuelve
 * sin pedir nada. Para inglés y portugués cuesta una petición pequeña, y a
 * cambio nadie ve la pantalla en un idioma que no eligió.
 *
 * Si falla, se monta igual en español: quedarse sin pintar por un archivo de
 * traducción sería cambiar un destello por una pantalla en blanco. */
void ensureLanguage(i18n.language).catch(() => {}).finally(montar);
