import i18n from '@/i18n'

/**
 * El tiempo como se lee en una conversación, no como se archiva. "hace 5 min"
 * es lo que hace falta para decidir si alguien acaba de responder; la fecha
 * exacta vive en el `title`, a un segundo de distancia y sin ocupar sitio.
 */
export function fmtRelative(iso: string) {
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return rtf.format(-Math.round(s), 'second')
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  if (s < 2592000) return rtf.format(-Math.round(s / 86400), 'day')
  return rtf.format(-Math.round(s / 2592000), 'month')
}

export function fmtExact(iso: string) {
  return new Date(iso).toLocaleString(i18n.language, {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Minutos transcurridos desde una marca de tiempo. */
export function minutesSince(iso: string) {
  return (Date.now() - new Date(iso).getTime()) / 60000
}
