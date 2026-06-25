import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, FolderOpen, Users, LogOut, ArrowLeft, Zap, BookOpen, PhoneCall, MessageSquare, Target, Trophy, Globe, BarChart3, Menu, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { signOut } from '@/services/auth.service'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { cn } from '@/lib/cn'

type NeonColor = 'green' | 'violet' | 'cyan' | 'magenta' | 'amber' | 'neutral'

export function AdminNav() {
  const { t } = useTranslation()
  const { displayName, isSuperAdmin, isCapacitador } = useAuth()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)

 const adminLinks = [
    { to: '/admin', label: t('admin.nav.panel'), icon: LayoutDashboard, end: true },
    { to: '/admin/campaigns', label: t('admin.nav.campaigns'), icon: FolderOpen, end: false },
    { to: '/admin/modules', label: t('admin.nav.modules'), icon: BookOpen, end: false },
    { to: '/admin/users', label: t('admin.nav.users'), icon: Users, end: false },
    { to: '/admin/evaluaciones', label: 'Evaluaciones', icon: MessageSquare, end: false },
    { to: '/admin/quiz', label: t('admin.nav.quiz_live'), icon: Zap, end: false },
    { to: '/admin/simulations', label: t('admin.nav.simulations'), icon: PhoneCall, end: false },
    { to: '/admin/missions', label: t('admin.nav.missions'), icon: Target, end: false },
    { to: '/admin/arena', label: t('admin.nav.arena'), icon: Trophy, end: false },
    { to: '/admin/worlds', label: t('admin.nav.worlds'), icon: Globe, end: false },
    { to: '/admin/feedback', label: t('admin.nav.feedback'), icon: BarChart3, end: false },
  ]

  const capacitadorLinks = [
    { to: '/admin/quiz', label: t('admin.nav.quiz_live'), icon: Zap, end: false },
    { to: '/admin/evaluaciones', label: 'Evaluaciones', icon: MessageSquare, end: false },
  ]

  const links = isSuperAdmin ? adminLinks : capacitadorLinks

  const roleColor: NeonColor = isSuperAdmin ? 'amber' : isCapacitador ? 'violet' : 'neutral'
  const roleLabel = isSuperAdmin
    ? t('roles.superadmin')
    : isCapacitador
      ? t('roles.capacitador')
      : t('roles.learner')

  const handleLogout = async () => {
    try { await signOut() } catch { /* ignore */ }
    navigate('/login', { replace: true })
  }

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] transition-all duration-200 border',
      isActive
        ? 'bg-glass-border/10 border-glass-border/14 text-text font-medium'
        : 'text-text-muted hover:text-text hover:bg-glass/6 border-transparent',
    )

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 z-30 flex items-center gap-2 px-3 glass-strong border-b border-glass-border/8">
        <button
          onClick={() => setIsOpen(true)}
          className="h-11 w-11 flex items-center justify-center rounded-xl text-text hover:bg-glass/6 transition-colors"
          aria-label={t('admin.nav.open_menu')}
        >
          <Menu className="h-5 w-5" />
        </button>
        <img src="/logo.jpg" alt="Concepto" className="h-7 w-7 rounded-md ring-1 ring-glass-border/10" />
        <div className="text-[13px] font-semibold text-text">Admin</div>
      </div>

      {/* Overlay (mobile drawer) */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-50"
          onClick={() => setIsOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar / mobile drawer */}
      <div
        className={cn(
          'fixed top-0 left-0 h-full w-64 md:w-56 flex flex-col z-[60] bg-bg text-text border-r border-line transition-transform duration-300 ease-in-out md:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Borde derecho luminoso decorativo */}
        <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-glass-border/15 to-transparent pointer-events-none" aria-hidden />

        {/* Header */}
        <div className="px-4 py-4 border-b border-glass-border/8">
          <div className="flex items-center justify-between gap-2.5 mb-3">
            <div className="flex items-center gap-2.5">
              <img src="/logo.jpg" alt="Concepto" className="h-7 w-7 rounded-md ring-1 ring-glass-border/10" />
              <div>
                <div className="text-[13px] font-semibold text-text">Admin</div>
                <div className="text-[10px] text-text-subtle">Concepto CMS</div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="md:hidden h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors"
              aria-label={t('admin.nav.close_menu')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-1 mb-1.5">
            <div className="text-[12px] text-text truncate font-medium" title={displayName}>
              {displayName}
            </div>
          </div>
          <NeonBadge color={roleColor} className="text-[9px]">
            {roleLabel}
          </NeonBadge>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass} onClick={() => setIsOpen(false)}>
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 pb-4 pt-3 space-y-1.5 border-t border-glass-border/8">
          <div className="flex items-center justify-between px-1 py-1">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
          <Link
            to="/dashboard"
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors border border-transparent"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('admin.nav.back_to_app')}
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] text-text-muted hover:text-danger hover:bg-danger/6 transition-colors border border-transparent"
          >
            <LogOut className="h-4 w-4" />
            {t('nav.logout')}
          </button>
        </div>
      </div>
    </>
  )
}
