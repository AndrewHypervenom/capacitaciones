import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { CollaboratorPicker } from '@/admin/components/CollaboratorPicker'

interface ShareCampaignModalProps {
  campaign: { id: string; name: string }
  onClose: () => void
}

/**
 * Comparte una campaña con otros capacitadores (equipo). Envuelve a
 * CollaboratorPicker en un modal. Los colaboradores pueden ver y editar los
 * cursos/módulos de la campaña (RLS is_campaign_member).
 */
export function ShareCampaignModal({ campaign, onClose }: ShareCampaignModalProps) {
  const { t } = useTranslation()
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
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
          className="relative w-full max-w-lg"
        >
          <div className="relative flex max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                  <Users className="h-4 w-4 text-text-muted" />
                  {t('admin.campaigns.share.title')}
                </h3>
                <p className="text-[12px] text-text-muted mt-0.5 truncate">
                  {t('admin.campaigns.share.subtitle', { name: campaign.name })}
                </p>
              </div>
              <button
                onClick={onClose}
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                aria-label={t('common.close', 'Cerrar')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <CollaboratorPicker campaignId={campaign.id} onCountChange={setCount} />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-line">
              <span className="text-[12px] text-text-muted">
                {count !== null ? t('admin.campaigns.share.count', { n: count }) : ' '}
              </span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
