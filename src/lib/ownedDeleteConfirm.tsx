import i18n from '@/i18n'
import type { ConfirmOptions } from '@/components/ui/ConfirmDialog'
import { TRASH_DAYS } from '@/services/audit.service'

/**
 * Datos de contexto de lo que se va a borrar. Todo es opcional salvo el título:
 * si no sabemos el autor o la campaña, el diálogo simplemente no lo dice.
 */
export interface OwnedDeleteInfo {
  /** Título de lo que se borra, tal como se ve en la lista. */
  title: string
  /** Nombre de quien lo creó. */
  ownerName?: string | null
  /** Id del autor: si coincide con quien borra, no pedimos escribir nada. */
  ownerId?: string | null
  /** Id de quien está borrando. */
  actorId?: string | null
  /** Campaña dueña del contenido. */
  campaignName?: string | null
  /** Si está publicado, los aprendices lo pierden en el acto. */
  isPublished?: boolean
  /**
   * Qué le pasa de verdad al contenido al confirmar:
   *  - 'trash':     va a la papelera del superadmin, restaurable 30 días.
   *  - 'approval':  se oculta y espera que el superadmin apruebe el borrado.
   *  - 'permanent': se borra físico e inmediato, sin vuelta atrás.
   */
  outcome: 'trash' | 'approval' | 'permanent'
  /** Título del diálogo; por defecto `confirm.title`. */
  title_dialog?: string
}

/**
 * Opciones de confirmación para borrar contenido que pudo crear otra persona.
 *
 * El caso que motivó esto: un superadmin borró dos simulaciones ajenas desde la
 * lista, y como su borrado es físico no hubo nada que restaurar. El diálogo
 * genérico ("¿Seguro?") no dejaba ver de quién era ni que no había vuelta atrás.
 *
 * Ahora el diálogo dice de quién es, de qué campaña, si está publicado y si el
 * borrado es reversible, y SIEMPRE exige escribir el nombre de la campaña —
 * también si el contenido es propio y también si el borrado es reversible: la
 * decisión es que ningún borrado de contenido salga con un solo clic.
 */
export function ownedDeleteConfirm(info: OwnedDeleteInfo): ConfirmOptions {
  const t = i18n.t.bind(i18n)
  const isMine = !!info.ownerId && !!info.actorId && info.ownerId === info.actorId

  const lines: { key: string; text: string; strong?: boolean }[] = []

  if (info.ownerName) {
    lines.push({
      key: 'owner',
      text: isMine
        ? t('confirm.owned.author_you', { name: info.ownerName })
        : t('confirm.owned.author', { name: info.ownerName }),
      strong: !isMine,
    })
  } else {
    lines.push({ key: 'owner', text: t('confirm.owned.author_unknown') })
  }
  if (info.campaignName) {
    lines.push({ key: 'campaign', text: t('confirm.owned.campaign', { name: info.campaignName }) })
  }
  if (info.isPublished) {
    lines.push({ key: 'published', text: t('confirm.owned.published_warning') })
  }
  lines.push({
    key: 'reversibility',
    text: info.outcome === 'permanent'
      ? t('confirm.owned.permanent')
      : info.outcome === 'trash'
        ? t('confirm.owned.trash', { days: TRASH_DAYS })
        : t('confirm.owned.soft'),
    strong: info.outcome === 'permanent',
  })

  // Se escribe el NOMBRE DE LA CAMPAÑA, no una palabra fija: obliga a mirar de
  // quién es lo que se está borrando (una palabra genérica se teclea de memoria,
  // y encima es la misma en todos los diálogos). Si el contenido no tiene
  // campaña, no hay nombre que pedir y se cae a la palabra genérica.
  const campaign = info.campaignName?.trim() || null
  const requireText = campaign ?? t('confirm.owned.require_word')
  // El nombre no va en el rótulo: el diálogo lo pinta aparte y destacado.
  const requireTextLabel = campaign ? t('confirm.owned.require_campaign_label') : undefined

  return {
    title: info.title_dialog ?? t('confirm.delete_simulation_title'),
    description: (
      <span className="block space-y-2">
        <span className="block">{t('confirm.owned.intro', { title: info.title })}</span>
        <span className="block rounded-lg bg-subtle px-3 py-2 text-[12px] space-y-1">
          {lines.map((l) => (
            <span key={l.key} className={`block ${l.strong ? 'text-text font-medium' : ''}`}>
              {l.text}
            </span>
          ))}
        </span>
      </span>
    ),
    requireText,
    requireTextLabel,
  }
}
