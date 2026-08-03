import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CloudOff, RefreshCw, WifiOff, X, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useServiceStatus, type ServiceStatus } from '@/lib/serviceHealth'

/**
 * Aviso de "los servicios están fallando / muy lentos".
 *
 * Aparece para cualquier persona (aprendiz, capacitador o superadmin) cuando el
 * detector de lib/serviceHealth ve que las peticiones a Supabase están fallando
 * o tardando de más. Es explicativo, no bloqueante: el sitio sigue usable, solo
 * evita que la lentitud se interprete como "la plataforma está rota".
 *
 * Se apaga solo en cuanto las peticiones vuelven a la normalidad.
 */

const ICONS: Record<Exclude<ServiceStatus, 'ok'>, typeof Zap> = {
  slow: Zap,
  down: CloudOff,
  offline: WifiOff,
}

export function ServiceStatusBanner() {
  const status = useServiceStatus()
  const { t } = useTranslation()
  // Se descarta por nivel: si estaba "lento" y pasa a "caído", vuelve a mostrarse.
  const [dismissed, setDismissed] = useState<ServiceStatus | null>(null)

  useEffect(() => {
    if (status === 'ok') setDismissed(null)
  }, [status])

  const show = status !== 'ok' && dismissed !== status
  const Icon = status === 'ok' ? Zap : ICONS[status]
  // Lento = amarillo de marca (avisa); caído/sin red = rojo (explica el bloqueo).
  const accent = status === 'slow' ? 'text-brand-magenta' : 'text-danger'
  const accentBg = status === 'slow' ? 'bg-brand-magenta' : 'bg-danger'

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          role="status"
          aria-live="polite"
          // La posición la pone el contenedor (BottomBannerStack): así este aviso
          // y el de "hay versión nueva" se apilan en vez de superponerse.
          className="pointer-events-auto w-full"
        >
          <div className="glass-strong relative flex items-center gap-3 overflow-hidden rounded-2xl border border-glass-border/10 px-4 py-3.5 shadow-2xl shadow-black/30">
            <div className={`absolute left-0 top-0 bottom-0 w-0.5 rounded-full ${accentBg}`} />

            <div className={`shrink-0 ${accent}`}>
              <Icon className="h-5 w-5" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold leading-snug text-text">
                {t(`service_status.${status}.title`)}
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-text-muted">
                {t(`service_status.${status}.description`)}
              </p>
            </div>

            {status !== 'slow' && (
              <button
                onClick={() => window.location.reload()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-subtle px-3 py-2 text-[12.5px] font-semibold text-text transition-colors hover:opacity-90"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('service_status.retry')}
              </button>
            )}

            <button
              onClick={() => setDismissed(status)}
              className="shrink-0 text-text-subtle transition-colors hover:text-text"
              aria-label={t('common.close', 'Cerrar')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default ServiceStatusBanner
