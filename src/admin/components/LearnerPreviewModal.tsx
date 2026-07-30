import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Eye, Loader2, RefreshCw, X } from 'lucide-react'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { learnerPreviewUrl } from '@/lib/previewMode'

interface Props {
  /** Ruta REAL del aprendiz. Ej: `/modules/mi-modulo#section-2`, `/courses/mi-curso`. */
  path: string
  /** Contexto que se muestra en la cabecera (módulo, sección, curso…). */
  context?: string
  onClose: () => void
}

/**
 * Vista previa del aprendiz dentro de un modal, sin salir del editor.
 *
 * Carga la ruta real del aprendiz en un <iframe> marcado como vista previa
 * (`?preview=1`, ver `src/lib/previewMode.ts`). Es la MISMA página que ve el
 * aprendiz —mismos bloques, mismos juegos, mismos candados—, no una copia del
 * editor que se pueda desincronizar. Dentro de la vista previa la app no guarda
 * nada: se puede responder un quiz o jugar sin ensuciar el progreso de nadie.
 */
export function LearnerPreviewModal({ path, context, onClose }: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  // Cambiar esta llave remonta el iframe = recargar la vista previa.
  const [reloadKey, setReloadKey] = useState(0)
  const src = useMemo(() => learnerPreviewUrl(path), [path])

  // Esc cierra, como en cualquier modal. En captura para ganarle a atajos de la
  // página de abajo (el editor escucha Ctrl+S y compañía).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Mientras el modal está abierto, la página de abajo no debe hacer scroll.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const iconBtn =
    'h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/10 transition-colors'

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4"
      {...backdropDismiss(onClose)}
    >
      <div
        className="flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-none border-0 bg-bg sm:h-[94vh] sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Eye className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold leading-tight text-text">
              {t('admin.preview.title')}
              {context && <span className="font-normal text-text-muted"> · {context}</span>}
            </p>
            <p className="truncate text-[11px] leading-tight text-text-subtle">
              {t('admin.preview.nothing_saved')}
            </p>
          </div>

          <button
            onClick={() => { setLoading(true); setReloadKey((k) => k + 1) }}
            title={t('admin.preview.reload')}
            aria-label={t('admin.preview.reload')}
            className={iconBtn}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            title={t('admin.preview.open_tab')}
            aria-label={t('admin.preview.open_tab')}
            className={iconBtn}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            onClick={onClose}
            title={t('admin.preview.close')}
            aria-label={t('admin.preview.close')}
            className="ml-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Lienzo */}
        <div className="relative min-h-0 flex-1">
          {loading && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 bg-bg text-[13px] text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('admin.preview.loading')}
            </div>
          )}
          <iframe
            key={reloadKey}
            src={src}
            title={t('admin.preview.title')}
            onLoad={() => setLoading(false)}
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
            allowFullScreen
            className="h-full w-full border-0 bg-bg"
          />
        </div>
      </div>
    </div>
  )
}

export default LearnerPreviewModal
