import { usePresenceStore, type PresenceResourceType } from '@/stores/presenceStore'

/**
 * Recibe el "foco" que deja la barra de presencia al pulsar a una persona: la
 * vista debe pararse en la campaña de esa persona y resaltar el recurso que
 * tiene abierto, SIN entrar en él (los editores autoguardan).
 *
 * Devuelve:
 *   - `focusId`: recurso a resaltar (null si está en la vista entera).
 *   - `focusCampaignId`: campaña a seleccionar (null si no se sabe).
 *
 * El foco se apaga solo (ver `followPeer`), así que no hay que limpiarlo aquí.
 */
export function usePresenceFocus(type: PresenceResourceType): {
  focusId: string | null
  focusCampaignId: string | null
  peerName: string | null
} {
  const focus = usePresenceStore((s) => s.focus)
  // Un foco de otro tipo (o de vista entera) no le incumbe a esta lista, pero su
  // campaña sí: seguir a alguien hasta "Cursos" debería pararme en SU campaña
  // aunque no haya un curso concreto que señalar.
  const mine = focus?.type === type
  return {
    focusId: mine ? (focus?.id ?? null) : null,
    focusCampaignId: mine || focus?.type === 'view' ? (focus?.campaignId ?? null) : null,
    peerName: mine ? (focus?.peerName ?? null) : null,
  }
}
