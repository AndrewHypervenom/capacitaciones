import { AnimatePresence, motion } from 'framer-motion'
import { Users } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import type { Peer } from '@/stores/presenceStore'
import { PresenceStack } from './PresenceStack'

interface EditingBannerProps {
  /** Compañeros que están en el MISMO recurso que yo. */
  coeditors: Peer[]
}

/**
 * Aviso de coedición estilo SharePoint: cuando otra persona tiene abierto el
 * mismo módulo/curso, se muestra una barra para prevenir que dos capacitadores
 * guarden cambios distintos y se pisen. Aparece/desaparece con animación.
 */
export function EditingBanner({ coeditors }: EditingBannerProps) {
  const { t } = useTranslation()
  const active = coeditors.length > 0
  const someoneWriting = coeditors.some((p) => p.activity?.dirty)
  const names = coeditors.map((p) => p.name)
  const first = names[0] ?? ''
  const extra = names.length - 1

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0, height: 0, marginTop: 0 }}
          animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
          exit={{ opacity: 0, height: 0, marginTop: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          className="mx-3 md:mx-5 overflow-hidden"
        >
          <div
            className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 glass border"
            style={{
              borderColor: someoneWriting ? 'rgba(245,158,11,0.35)' : 'rgba(179,61,158,0.30)',
              background: someoneWriting ? 'rgba(245,158,11,0.06)' : 'rgba(179,61,158,0.05)',
            }}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: someoneWriting ? 'rgba(245,158,11,0.14)' : 'rgba(179,61,158,0.12)',
                color: someoneWriting ? '#F59E0B' : '#B33D9E',
              }}
            >
              <Users className="h-4 w-4" />
            </span>

            <PresenceStack peers={coeditors} size={28} max={6} showActivity={false} />

            <p className="text-[12.5px] text-text leading-snug flex-1 min-w-0">
              {someoneWriting ? (
                <Trans
                  i18nKey={extra > 0 ? 'presence.banner_writing_multi' : 'presence.banner_writing_one'}
                  values={{ name: first, count: extra }}
                  components={{ b: <span className="font-semibold" /> }}
                />
              ) : (
                <Trans
                  i18nKey={extra > 0 ? 'presence.banner_here_multi' : 'presence.banner_here_one'}
                  values={{ name: first, count: extra }}
                  components={{ b: <span className="font-semibold" /> }}
                />
              )}{' '}
              <span className="text-text-muted">{t('presence.banner_hint')}</span>
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
