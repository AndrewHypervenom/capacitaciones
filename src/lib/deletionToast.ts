import i18n from '@/i18n'
import { TRASH_DAYS, type DeletionResult } from '@/services/audit.service'

/**
 * Mensaje del aviso después de borrar. Los tres desenlaces posibles dicen cosas
 * muy distintas y conviene que suenen igual en toda la aplicación:
 *
 *  - 'trashed': fue a la papelera del superadmin, se puede restaurar 30 días.
 *  - 'pending': quedó oculto esperando aprobación del superadmin.
 *  - 'deleted': se borró en firme (sólo si aún no se corrió el SQL de papelera).
 *
 * `deletedMsg` es el texto de siempre para el caso 'deleted', que cada pantalla
 * tiene redactado a su manera ("Curso eliminado", "Simulación eliminada"…).
 */
export function deletionToast(
  result: DeletionResult,
  deletedMsg: string,
  name?: string,
): string {
  const t = i18n.t.bind(i18n)
  if (result === 'trashed') {
    return name
      ? t('deletion.trashed_toast', { name, days: TRASH_DAYS })
      : t('deletion.trashed_generic', { days: TRASH_DAYS })
  }
  if (result === 'pending') {
    return name ? t('deletion.pending_toast', { name }) : t('deletion.pending_generic')
  }
  return deletedMsg
}
