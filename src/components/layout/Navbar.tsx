import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Settings } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useProgressStore } from '@/stores/progressStore';
import { useModules } from '@/hooks/useModules';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/services/auth.service';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { cn } from '@/lib/cn';

export function Navbar() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { name, reset } = useUserStore();
  const { isAdmin } = useAuth();
  const completedModules = useProgressStore((s) => s.completedModules);
  const { modules } = useModules();
  const progress = modules.length > 0 ? completedModules.length / modules.length : 0;

  const handleLogout = async () => {
    reset();
    try { await signOut() } catch { /* ignore */ }
    nav('/login', { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'px-3 h-8 inline-flex items-center text-[13px] tracking-tight transition-colors',
      isActive ? 'text-text font-medium' : 'text-text-muted hover:text-text',
    );

  return (
    <header className="sticky top-0 z-40 nav-blur border-b border-line">
      <div className="mx-auto max-w-7xl px-5 h-12 flex items-center justify-between">
        <Link to="/dashboard" className="flex items-center gap-2 group">
          <img
            src="/logo.jpg"
            alt={t('brand')}
            className="h-6 w-6 rounded-md"
            width={24}
            height={24}
          />
          <span className="font-semibold tracking-tight text-[14px]">{t('brand')}</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <NavLink to="/dashboard" className={linkClass} end>
            {t('nav.dashboard')}
          </NavLink>
          <NavLink to="/simulator" className={linkClass}>
            {t('nav.simulator')}
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={linkClass}>
              Admin
            </NavLink>
          )}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 h-8 pr-1">
            <ProgressRing value={progress} size={20} stroke={2} />
            <span className="text-[12px] text-text-muted max-w-[100px] truncate">{name}</span>
          </div>
          <LanguageSwitcher />
          <ThemeToggle />
          {isAdmin && (
            <Link
              to="/admin"
              aria-label="Admin"
              className="h-8 w-8 inline-flex items-center justify-center rounded-full text-text-muted hover:text-text hover:bg-subtle transition-colors md:hidden"
            >
              <Settings className="h-3.5 w-3.5" />
            </Link>
          )}
          <button
            onClick={handleLogout}
            aria-label={t('nav.logout')}
            className="h-8 w-8 inline-flex items-center justify-center rounded-full text-text-muted hover:text-text hover:bg-subtle transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
