import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles/globals.css';
import './i18n';
import App from './App';
import { ErrorBoundary, reloadForNewVersion } from '@/components/ui/ErrorBoundary';

// Chunk que no cargó al navegar (quedó JS viejo tras un despliegue): recargar
// una vez para traer la versión nueva en lugar de dejar la pantalla vacía.
window.addEventListener('vite:preloadError', (event) => {
  if (reloadForNewVersion()) event.preventDefault();
});

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
