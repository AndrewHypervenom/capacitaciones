import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles/globals.css';
import './i18n';
import App from './App';

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
    <App />
  </React.StrictMode>,
);
