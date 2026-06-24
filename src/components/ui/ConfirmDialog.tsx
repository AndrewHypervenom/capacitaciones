import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

export interface ConfirmOptions {
  /** Título del diálogo. Por defecto: confirm.title */
  title?: string
  /** Texto/descripción del cuerpo. */
  description?: ReactNode
  /** Etiqueta del botón de acción. Por defecto: confirm.delete */
  confirmLabel?: string
  /** Etiqueta del botón de cancelar. Por defecto: confirm.cancel */
  cancelLabel?: string
  /** Tono visual: 'danger' (rojo, por defecto) o 'default' (verde neón). */
  tone?: 'danger' | 'default'
}

type ConfirmFn = (opts?: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/**
 * Referencia imperativa al confirm activo. Permite pedir confirmación fuera de
 * un componente con hooks (p. ej. dentro de muchos sub-editores del mismo
 * archivo) sin tener que llamar useConfirm() en cada uno.
 */
let imperativeConfirm: ConfirmFn | null = null

export function confirmDialog(opts?: ConfirmOptions): Promise<boolean> {
  if (imperativeConfirm) return imperativeConfirm(opts)
  // Fallback por si el provider aún no montó (no debería ocurrir en runtime).
  return Promise.resolve(window.confirm(typeof opts?.description === 'string' ? opts.description : '¿Estás seguro?'))
}

/**
 * Hook para pedir confirmación con un modal unificado (tema claro/oscuro + i18n).
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ description: t('confirm.delete_x_desc') })) doDelete()
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>')
  return ctx
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o ?? {})
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  // Exponer la versión imperativa mientras el provider esté montado.
  useEffect(() => {
    imperativeConfirm = confirm
    return () => {
      if (imperativeConfirm === confirm) imperativeConfirm = null
    }
  }, [confirm])

  const close = useCallback((result: boolean) => {
    resolver.current?.(result)
    resolver.current = null
    setOpts(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={!!opts}
        title={opts?.title ?? t('confirm.title')}
        description={opts?.description}
        confirmLabel={opts?.confirmLabel ?? t('confirm.delete')}
        cancelLabel={opts?.cancelLabel ?? t('confirm.cancel')}
        tone={opts?.tone ?? 'danger'}
        onConfirm={() => close(true)}
        onClose={() => close(false)}
      />
    </ConfirmContext.Provider>
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel: string
  cancelLabel: string
  tone: 'danger' | 'default'
  onConfirm: () => void
  onClose: () => void
}

/**
 * Presentación del diálogo. Reutilizable por sí solo si se necesita un modal
 * controlado, aunque lo normal es usar el hook useConfirm().
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, onConfirm])

  const accent =
    tone === 'danger'
      ? { icon: 'text-red-400', ring: 'ring-red-500/20', bg: 'bg-red-500/10' }
      : { icon: 'text-neon-green', ring: 'ring-neon-green/20', bg: 'bg-neon-green/10' }

  const confirmBtn =
    tone === 'danger'
      ? 'bg-red-600 hover:bg-red-700 text-white'
      : 'bg-neon-green hover:brightness-110 text-black'

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md"
          >
            <div className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <div
                  className={`h-11 w-11 rounded-xl ${accent.bg} ring-1 ${accent.ring} flex items-center justify-center shrink-0`}
                >
                  <AlertTriangle className={`h-5 w-5 ${accent.icon}`} />
                </div>
                <div className="min-w-0 pt-0.5">
                  <h3 className="text-[16px] font-semibold text-text">{title}</h3>
                  {description && (
                    <div className="text-[13px] text-text-muted mt-1.5 leading-relaxed">
                      {description}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  {cancelLabel}
                </Button>
                <button
                  autoFocus
                  onClick={onConfirm}
                  className={`h-9 px-4 rounded-full text-[13px] font-medium transition-colors inline-flex items-center gap-2 ${confirmBtn}`}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
