import { useTranslation } from 'react-i18next'
import { FlaskConical } from 'lucide-react'
import { Toggle } from '@/components/ui/Toggle'
import { Tooltip } from '@/components/ui/Tooltip'
import { useTestMode } from '@/stores/testModeStore'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'

/**
 * Interruptor del entorno de pruebas (solo superadmin), en el pie del panel.
 *
 * Apagado: las campañas marcadas como prueba no existen para el panel — ni sus
 * cursos, ni su gente, ni su progreso en KPIs y Excel. Encendido: se suman a lo
 * que ya se ve, siempre marcadas, y el panel se pone una franja arriba para que
 * nadie exporte un reporte creyendo que es la data real.
 *
 * Al cambiar se recarga la vista: media docena de pantallas ya trajo sus datos
 * con el filtro anterior y no tiene sentido enseñarlas a medias.
 */
export function TestModeSwitch({ className }: { className?: string }) {
  const { isSuperAdmin } = useAuth()
  const { enabled, setEnabled } = useTestMode()
  const { t } = useTranslation()

  if (!isSuperAdmin) return null

  const toggle = () => {
    setEnabled(!enabled)
    // Recarga simple y honesta: cambia el alcance de TODO lo que está en
    // pantalla, y así ninguna vista queda con datos del alcance anterior.
    setTimeout(() => window.location.reload(), 120)
  }

  return (
    <Tooltip
      maxWidth={260}
      label={
        enabled
          ? t('admin.test_mode.tip_on', 'Estás viendo también las campañas de prueba. Los reportes y Excel incluyen datos de prueba.')
          : t('admin.test_mode.tip_off', 'Las campañas de prueba están ocultas: nada de prueba entra en KPIs, reportes ni Excel.')
      }
    >
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors',
          enabled ? 'border-amber-500/30 bg-amber-500/8' : 'border-transparent',
          className,
        )}
      >
        <FlaskConical className={cn('h-4 w-4 shrink-0', enabled ? 'text-amber-600 dark:text-amber-400' : 'text-text-subtle')} />
        <span className={cn('flex-1 text-[12px]', enabled ? 'text-amber-700 dark:text-amber-300' : 'text-text-muted')}>
          {t('admin.test_mode.label', 'Modo pruebas')}
        </span>
        <Toggle on={enabled} onClick={toggle} label={t('admin.test_mode.label', 'Modo pruebas')} />
      </div>
    </Tooltip>
  )
}

/**
 * Insignia para marcar una campaña, un curso o una persona del entorno de
 * pruebas. Lleva tooltip a propósito: la palabra "Prueba" sola no dice qué
 * implica, y de eso depende que nadie lea un reporte creyendo que es real.
 */
export function TestBadge({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <Tooltip label={t('admin.test_mode.badge_hint')} maxWidth={280} className={cn('shrink-0', className)}>
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
        <FlaskConical className="h-3 w-3" />
        {t('admin.test_mode.badge', 'Prueba')}
      </span>
    </Tooltip>
  )
}

/**
 * Franja permanente arriba del panel mientras el modo pruebas está encendido.
 * Es la respuesta a "¿esto que estoy viendo es de verdad?": si hay franja, no.
 */
export function TestModeBanner() {
  const { isSuperAdmin } = useAuth()
  const enabled = useTestMode((s) => s.enabled)
  const setEnabled = useTestMode((s) => s.setEnabled)
  const { t } = useTranslation()

  if (!isSuperAdmin || !enabled) return null

  return (
    <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-amber-500/25 bg-amber-500/12 px-4 py-1.5 text-[12px] text-amber-700 dark:text-amber-300 backdrop-blur">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {t('admin.test_mode.banner', 'Modo pruebas activo: estás viendo también las campañas de prueba. Los reportes y Excel incluyen datos de prueba.')}
      </span>
      <button
        onClick={() => { setEnabled(false); setTimeout(() => window.location.reload(), 120) }}
        className="shrink-0 rounded-lg px-2 py-1 font-medium underline-offset-2 hover:bg-amber-500/15 hover:underline"
      >
        {t('admin.test_mode.exit', 'Salir')}
      </button>
    </div>
  )
}
