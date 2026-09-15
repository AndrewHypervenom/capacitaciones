import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

/**
 * Aviso al staff: el «programa» se retiró del sitio (2026-09-15).
 *
 * Desde ese día un curso solo le llega a alguien por la regla de país/área/CR,
 * por asignación individual o por estar en el catálogo abierto. Lo asignado
 * únicamente por programa dejó de llegar A PROPÓSITO: la migración no avanzaba
 * mientras el camino viejo siguiera funcionando. Este aviso es lo que evita que
 * eso se lea como "un error de la migración".
 *
 * Se puede cerrar, y se recuerda por navegador. Si el almacenamiento no está
 * disponible (ventana privada) simplemente vuelve a salir: mejor de más que
 * callarlo.
 */
const KEY = 'learningai.programRetiredNotice.v1'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function ProgramRetiredBanner() {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(readDismissed)
  if (dismissed) return null

  const dismiss = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* sin almacenamiento: se cierra solo por esta vez */
    }
    setDismissed(true)
  }

  return (
    <div className="mx-4 mt-4 sm:mx-8 flex items-start gap-3 rounded-2xl border border-red-500/35 bg-red-500/[0.07] px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-red-500">
          {t('admin.courses.program_retired_banner_title')}
        </p>
        <p className="mt-0.5 text-[12px] text-text-muted">
          {t('admin.courses.program_retired_banner_body')}
        </p>
      </div>
      <button
        onClick={dismiss}
        aria-label={t('admin.courses.program_retired_banner_dismiss')}
        className="shrink-0 inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-[12px] text-text-muted transition-colors hover:bg-glass/6 hover:text-text"
      >
        <X className="h-3.5 w-3.5" />
        {t('admin.courses.program_retired_banner_dismiss')}
      </button>
    </div>
  )
}
