import { useState } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, FolderOpen, Users, LogOut, ArrowLeft, BookOpen, BarChart3, Menu, X, ChevronDown, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { signOut } from '@/services/auth.service'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { cn } from '@/lib/cn'

type NeonColor = 'green' | 'violet' | 'cyan' | 'magenta' | 'amber' | 'neutral'

interface MenuItem {
  to: string
  label: string
  end: boolean
}

interface MenuCategory {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  items: MenuItem[]
}

export function AdminNav() {
  const { t } = useTranslation()
  const { displayName, isSuperAdmin, isCapacitador } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)

  const [openCategories, setOpenCategories] = useState<string[]>([])

  const toggleCategory = (title: string) => {
    setOpenCategories(prev =>
      prev.includes(title) 
        ? prev.filter(t => t !== title) 
        : [...prev, title]
    );
  }

  // Links para administradores
  const adminLinks: MenuCategory[] = [
    {
      title: "", 
      items: [
        { to: '/admin', label: t('admin.nav.panel', 'Panel'), end: true }
      ]
    },
    {
      title: "Gestión",
      icon: FolderOpen, 
      items: [
        { to: '/admin/campaigns', label: t('admin.nav.campaigns', 'Campañas'), end: false },
        { to: '/admin/users', label: t('admin.nav.users', 'Usuarios'), end: false }
      ]
    },
    {
      title: "Contenido Teórico",
      icon: BookOpen,
      items: [
        { to: '/admin/courses', label: t('admin.nav.courses', 'Cursos'), end: false },
        { to: '/admin/modules', label: t('admin.nav.modules', 'Módulos'), end: false }
      ]
    },
    {
      title: "Retos y Simulaciones", 
      icon: Trophy, 
      items: [
        { to: '/admin/worlds', label: t('admin.nav.worlds', 'Mundos'), end: false },
        { to: '/admin/missions', label: t('admin.nav.missions', 'Misiones'), end: false },
        { to: '/admin/arena', label: t('admin.nav.arena', 'Arenas de competencia'), end: false },
        { to: '/admin/quiz', label: t('admin.nav.quiz_live', 'Quizzes'), end: false },
        { to: '/admin/simulations', label: t('admin.nav.simulations', 'Simulaciones'), end: false }
      ]
    },
    {
      title: "Seguimiento", 
      icon: BarChart3, 
      items: [
        { to: '/admin/feedback', label: t('admin.nav.feedback', 'Progreso unificado'), end: false },
        { to: '/admin/evaluaciones', label: t('admin.nav.evaluaciones', 'Evaluaciones'), end: false }
      ]
    }
  ];

  const capacitadorLinks = adminLinks.map(category => ({
    ...category,
    items: category.items.filter((item) => item.to !== '/admin/users')
  }))
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
        <img src="/logo.jpg" alt="LearningAI" className="h-7 w-7 rounded-md ring-1 ring-glass-border/10" />
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
        <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-glass-border/15 to-transparent pointer-events-none" aria-hidden />

        {/* Header */}
        <div className="px-4 py-4 border-b border-glass-border/8">
          <div className="flex items-center justify-between gap-2.5 mb-3">
            <div className="flex items-center gap-2.5">
              <img src="/logo.jpg" alt="LearningAI" className="h-7 w-7 rounded-md ring-1 ring-glass-border/10" />
              <div>
                <div className="text-[13px] font-semibold text-text">Admin</div>
                <div className="text-[10px] text-text-subtle">LearningAI CMS</div>
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
        <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto">
          {links.map((category, index) => {
            const isCategoryOpen = openCategories.includes(category.title) || !category.title;
            const CategoryIcon = category.icon;
            const isChildRouteActive = category.items.some(item => location.pathname === item.to);

            return (
              <div key={index} className="space-y-1">          
                {category.title ? (
                  /* Titulos de categorías*/
                  <button
                    onClick={() => toggleCategory(category.title)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 group text-left border",
                      isChildRouteActive
                        ? "bg-glass-border/10 border-glass-border/14 text-text" 
                        : "text-text-muted border-transparent hover:text-text hover:bg-glass-border/10 hover:border-glass-border/14"
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {CategoryIcon && (
                        <CategoryIcon className={cn(
                          "h-4 w-4 shrink-0 transition-colors duration-200",
                          (isCategoryOpen || isChildRouteActive) 
                            ? "text-green-500" 
                            : "text-text-muted group-hover:text-green-500"
                        )} />
                      )}
                      <span>{category.title}</span>
                    </div>                     
                    <ChevronDown 
                      className={cn(
                        "h-3 w-3 text-text-muted/60 transition-transform duration-200 group-hover:text-text",
                        isCategoryOpen ? "rotate-0" : "-rotate-90"
                      )} 
                    />
                  </button>
                ) : (
                  /* PANEL DIRECTO */
                  category.items.map((link) => (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      end={link.end}
                      onClick={() => setIsOpen(false)}
                      className={({ isActive }) => cn(
                        'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] transition-all duration-200 border group',
                        isActive
                          ? 'bg-glass-border/10 border-glass-border/14 text-text font-medium'
                          : 'text-text-muted border-transparent hover:text-text hover:bg-glass-border/10 hover:border-glass-border/14',
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          <LayoutDashboard className={cn(
                            "h-4 w-4 shrink-0 transition-colors duration-200",
                            isActive ? "text-green-500" : "text-text-muted group-hover:text-green-500"
                          )} />
                          <span>{link.label}</span>
                        </>
                      )}
                    </NavLink>
                  ))
                )}

                {/* ELEMENTOS ADENTRO DEL ACORDEÓN */}
                {category.title && isCategoryOpen && (
                  <div className="space-y-0.5 transition-all duration-200">
                    {category.items.map(({ to, label, end }) => (
                      <NavLink
                        key={to}
                        to={to}
                        end={end}
                        onClick={() => setIsOpen(false)}
                        className={({ isActive }) => cn(
                          'flex items-center w-full rounded-xl text-[13px] transition-all duration-200',
                          isActive
                            ? 'text-text font-semibold bg-glass/3'
                            : 'text-text-muted/80 hover:text-text hover:bg-glass/3',
                        )}
                      >
                        <div className="flex items-center w-full pl-9 py-2">
                          <span className="font-medium">{label}</span>
                        </div>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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