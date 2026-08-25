import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Loader2, Undo2, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { backdropDismiss } from '@/lib/backdropDismiss'

/** 'reject' = devolver una solicitud. 'revoke' = bajar un curso ya publicado. */
export type PublicationDecision = 'reject' | 'revoke'

interface Props {
  kind: PublicationDecision
  /** Título del curso, para que el diálogo diga sobre qué se está decidiendo. */
  courseTitle: string
  onClose: () => void
  /** Recibe el motivo ya recortado. Debe lanzar si falla; el modal lo muestra. */
  onConfirm: (note: string) => Promise<void>
}

/**
 * Pide el motivo antes de devolver o bajar un curso.
 *
 * Rechazar sin decir por qué deja al capacitador adivinando qué corregir, así que
 * en 'reject' el motivo es obligatorio (el RPC lo exige igual). En 'revoke' es
 * opcional: a veces se baja por algo ajeno al contenido.
 *
 * El motivo viaja al autor por la campana y queda escrito en el curso
 * (`approval_note`), donde el editor lo muestra hasta que se vuelve a pedir.
 */
export function PublicationDecisionModal({ kind, courseTitle, onClose, onConfirm }: Props) {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { ref.current?.focus() }, [])

  const isReject = kind === 'reject'
  const canConfirm = !busy && (!isReject || note.trim().length > 0)

  const handleConfirm = async () => {
    if (!canConfirm) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(note.trim())
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[130] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" {...backdropDismiss(onClose)} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-md"
        >
          <div className="relative flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
              <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                {isReject
                  ? <Undo2 className="h-4 w-4 text-amber-500" />
                  : <EyeOff className="h-4 w-4 text-amber-500" />}
                {isReject
                  ? t('admin.publish_approvals.reject_title')
                  : t('admin.publish_approvals.revoke_title')}
              </h3>
              <button
                onClick={onClose}
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <p className="text-[13px] text-text-muted break-words [overflow-wrap:anywhere]">
                {isReject
                  ? t('admin.publish_approvals.reject_desc', { name: courseTitle })
                  : t('admin.publish_approvals.revoke_desc', { name: courseTitle })}
              </p>

              <div>
                <label className="block text-[12px] text-text-muted mb-1.5">
                  {isReject
                    ? t('admin.publish_approvals.reason_label')
                    : t('admin.publish_approvals.reason_label_optional')}
                </label>
                <textarea
                  ref={ref}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={4}
                  maxLength={800}
                  placeholder={t('admin.publish_approvals.reason_ph')}
                  className="w-full resize-y rounded-xl border border-line bg-subtle px-3 py-2.5 text-[13px] text-text placeholder:text-text-subtle"
                />
              </div>

              {error && (
                <p className="text-[12px] text-red-500 break-words [overflow-wrap:anywhere]">{error}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-line">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle min-h-[44px]"
              >
                {t('admin.courses.cancel')}
              </button>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-white disabled:opacity-50 min-h-[44px]"
                style={{ background: '#d97706' }}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isReject
                  ? t('admin.publish_approvals.reject')
                  : t('admin.publish_approvals.revoke')}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
