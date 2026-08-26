/**
 * El saludo y la frase que acompañan la foto de perfil, dentro de su globo.
 *
 * Dos decisiones que dan el tono:
 *
 *  ─ La frase se sortea UNA vez por visita y se guarda en el módulo, no en el
 *    componente. Así no cambia mientras navegas entre pestañas del perfil (que
 *    remontan el encabezado y harían parpadear el texto), pero sí te recibe con
 *    otra frase la próxima vez que entres al sitio.
 *  ─ El saludo es para QUIEN MIRA, no para el perfil que está en pantalla: por
 *    eso también aparece cuando el staff consulta la ficha de otra persona.
 */
import i18n from '@/i18n'

/** Cuántas frases hay en `profile.daily.note_N` de cada idioma. */
const NOTE_COUNT = 12

/** La frase de ESTA visita. Se sortea al cargar el sitio y no se mueve más. */
const VISIT_NOTE = Math.floor(Math.random() * NOTE_COUNT) + 1

export function greetingFor(name?: string | null, now = new Date()): string {
  const h = now.getHours()
  const key = h < 12 ? 'greet_morning' : h < 19 ? 'greet_afternoon' : 'greet_evening'
  const hello = i18n.t(`profile.daily.${key}`)
  // Solo el primer nombre: "Buenos días, Andrés" suena a persona; con los cuatro
  // apellidos del documento suena a carta del banco.
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? `${hello}, ${first}` : hello
}

export function visitNote(): string {
  return i18n.t(`profile.daily.note_${VISIT_NOTE}`)
}
