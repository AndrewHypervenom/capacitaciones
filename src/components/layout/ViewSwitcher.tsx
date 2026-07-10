import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { LayoutDashboard, GraduationCap } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'

interface ViewSwitcherProps {
  /** 'inline' = compacto para la barra superior; 'block' = ancho completo para el sidebar. */
  variant?: 'inline' | 'block'
  className?: string
  /** Se dispara tras cambiar de vista (p. ej. para cerrar el drawer móvil). */
  onSwitch?: () => void
}

// Acento por rol para la píldora activa (coincide con el NeonBadge del header).
const ROLE_ACCENT = {
  superadmin: { icon: 'text-amber-500', glow: 'shadow-amber-500/10' },
  capacitador: { icon: 'text-violet-400', glow: 'shadow-violet-500/10' },
} as const

/**
 * "Ver como": alterna rápido entre la vista de gestión (admin/capacitador) y la
 * vista de aprendiz, al estilo del antiguo "cómo te ven las personas" de Facebook.
 * Reemplaza el enlace "Volver a la app" y el enlace "Admin" del navbar por un solo
 * control segmentado, presente en ambas vistas para ida y vuelta instantánea.
 */
export function ViewSwitcher({ variant = 'inline', className, onSwitch }: ViewSwitcherProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { isAdminOrCapacitador, isSuperAdmin } = useAuth()

  // Solo el staff (superadmin/capacitador) tiene doble vista.
  if (!isAdminOrCapacitador) return null

  const inAdmin = location.pathname.startsWith('/admin')
  const manageLabel = isSuperAdmin ? t('nav.admin', 'Admin') : t('nav.manage', 'Gestión')
  const accent = isSuperAdmin ? ROLE_ACCENT.superadmin : ROLE_ACCENT.capacitador

  const segments = [
    { key: 'manage', label: manageLabel, icon: LayoutDashboard, active: inAdmin, to: '/admin' },
    { key: 'learner', label: t('view_switcher.learner', 'Aprendiz'), icon: GraduationCap, active: !inAdmin, to: '/dashboard' },
  ] as const

  const go = (to: string, active: boolean) => {
    if (!active) navigate(to)
    onSwitch?.()
  }

  const block = variant === 'block'

  const control = (
    <div
      role="tablist"
      aria-label={t('view_switcher.aria', 'Cambiar de vista')}
      className={cn(
        'relative items-center rounded-full border border-glass-border/12',
        block
          ? 'flex w-full gap-1 bg-glass/8 pr-2 py-1 shadow-inner'
          : 'inline-flex gap-0.5 bg-glass/6 p-0.5',
        !block && className,
      )}
    >
      {segments.map(({ key, label, icon: Icon, active, to }) => (
        <button
          key={key}
          role="tab"
          aria-selected={active}
          onClick={() => go(to, active)}
          className={cn(
            'relative z-10 inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors duration-200',
            block ? 'flex-1 px-2.5 py-2 text-[12.5px]' : 'px-3 py-1.5 text-[12px]',
            active ? 'text-text' : 'text-text-muted hover:text-text',
          )}
        >
          {active && (
            <motion.span
              layoutId={`view-switcher-pill-${variant}`}
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              className={cn(
                'absolute inset-0 -z-10 rounded-full shadow-sm',
                block
                  ? cn('bg-bg ring-1 ring-glass-border/12', accent.glow)
                  : cn('bg-glass-border/16 ring-1 ring-glass-border/10', accent.glow),
              )}
            />
          )}
          <Icon
            className={cn(
              'shrink-0 transition-colors duration-200',
              block ? 'h-4 w-4' : 'h-3.5 w-3.5',
              active ? accent.icon : 'text-text-muted',
            )}
          />
          <span className="whitespace-nowrap">{label}</span>
        </button>
      ))}
    </div>
  )

  // En el sidebar añadimos un rótulo para que se lea como un ajuste, no un menú más.
  if (block) {
    return (
      <div className={cn('w-full', className)}>
        <div className="mb-1.5 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-text-subtle">
          {t('view_switcher.caption', 'Ver como')}
        </div>
        {control}
      </div>
    )
  }

  return control
}
