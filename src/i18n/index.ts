import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import es from './locales/es.json';

/* ── Solo el español viaja en el paquete inicial ───────────────────────────
 *
 * Los tres diccionarios juntos pesan 1,18 MB y estaban TODOS dentro del bundle
 * principal: cada persona se descargaba español, inglés y portugués para usar
 * uno. Era más de la mitad del archivo que bloquea la primera pintura.
 *
 * El español se queda dentro porque es el `fallbackLng` y el idioma de casi
 * todo el mundo: sacarlo cambiaría una descarga de más por una espera de más en
 * el caso normal. Los otros dos se piden solo cuando hacen falta.
 *
 * Y se piden ANTES de pintar (`ensureLanguage` en main.tsx): cargarlos
 * después dejaría a quien tiene inglés viendo un destello en español, que es
 * peor que el cuarto de segundo que cuesta traerlos.
 * ──────────────────────────────────────────────────────────────────────── */

const CARGADORES: Record<string, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./locales/en.json'),
  pt: () => import('./locales/pt.json'),
};

/** Deja listo el diccionario de un idioma. Idempotente y a prueba de fallos. */
export async function ensureLanguage(lng: string): Promise<void> {
  const base = (lng || '').split('-')[0];
  if (base === 'es' || !CARGADORES[base]) return;
  if (i18n.hasResourceBundle(base, 'translation')) return;
  try {
    const mod = await CARGADORES[base]();
    i18n.addResourceBundle(base, 'translation', mod.default, true, true);
    /* `resolvedLanguage` se calcula SOLO dentro de `changeLanguage`, y se queda
     * con el primer idioma que ya tenga textos. Si se cambió a 'pt' antes de que
     * llegara este diccionario —pulsar PT en el selector, o entrar con un perfil
     * en portugués desde un navegador que recordaba otro idioma— quedó en 'es'
     * y así se quedaba: la pantalla en portugués, pero el certificado, la
     * encuesta (guardaba lang: 'es') y el botón del selector en español.
     * Volver a pedir el idioma activo lo recalcula ya con el diccionario aquí;
     * la segunda vuelta de `ensureLanguage` sale en la línea de arriba. */
    if ((i18n.language || '').split('-')[0] === base && i18n.resolvedLanguage !== base) {
      await i18n.changeLanguage(i18n.language);
    }
  } catch {
    /* Sin red o archivo caído: se queda en español. Un idioma que no llega no
       puede dejar la aplicación en blanco. */
  }
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      es: { translation: es },
    },
    fallbackLng: 'es',
    supportedLngs: ['es', 'en', 'pt'],
    // Los navegadores reportan la región ('pt-BR', 'en-US', 'es-CO'), que no
    // está en supportedLngs: sin esto un visitante de Brasil no resolvía a 'pt'
    // sino al fallback 'es'.
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    /* `bindI18nStore: 'added'` es OBLIGATORIO aquí y su default es ''.
     *
     * Con los diccionarios cargándose aparte, el de inglés llega DESPUÉS de que
     * React ya pintó. Sin esto, react-i18next no se entera de que llegó —solo
     * escucha cambios de idioma, no de recursos— y la pantalla se queda en
     * español hasta que algo la repinte por otro motivo. Es decir: el selector
     * de idioma parecería no funcionar la primera vez. */
    react: { bindI18nStore: 'added' },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'learningai.lang',
    },
  });

/* Cambiar de idioma en caliente (el selector) también tiene que traerse su
   diccionario. Se engancha aquí y no en el componente para que valga desde
   cualquier sitio que llame a `changeLanguage`. */
i18n.on('languageChanged', (lng) => { void ensureLanguage(lng); });

export default i18n;
