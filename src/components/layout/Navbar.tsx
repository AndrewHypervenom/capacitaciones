import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useModuleDone, keyOfModule } from '@/stores/progressStore';
import { useModules } from '@/hooks/useModules';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/services/auth.service';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { ViewSwitcher } from './ViewSwitcher';
import { Avatar } from '@/components/ui/Avatar';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { LearnerPresence } from '@/components/presence/LearnerPresence';
import { cn } from '@/lib/cn';

export function Navbar() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { name, reset } = useUserStore();
  const { isAdminOrCapacitador, avatarUrl } = useAuth();
  const isModuleDone = useModuleDone();
  const { planModules: modules } = useModules();
  // Contra los módulos del plan, no contra el total global de completados: si el
  // aprendiz completó módulos de otros cursos la barra se pasaba de 100%.
  const done = modules.filter((m) => isModuleDone(keyOfModule(m))).length;
  const progress = modules.length > 0 ? done / modules.length : 0;

  const handleLogout = async () => {
    reset();
    try { await signOut() } catch { /* ignore */ }
    nav('/login', { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'inline-flex h-8 items-center whitespace-nowrap px-2 text-[13px] tracking-tight transition-colors sm:px-3',
      isActive ? 'text-text font-medium' : 'text-text-muted hover:text-text',
    );

  return (
    // `overflow-x: clip` y no `hidden`: una caja con `hidden` SIGUE siendo
    // scrolleable por dentro (el navegador la desplaza solo al enfocar algo que
    // queda cortado), y eso es lo que hacía que la barra se moviera de lado a
    // lado "sin que nadie tocara nada". `clip` recorta y punto: no hay scroll.
    // Aun así, la regla de oro es que aquí nada sobre — de eso se encargan los
    // `min-w-0` y los controles que se encogen abajo.
    <header className="sticky top-0 z-40 nav-blur border-b border-line overflow-x-clip">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between gap-2 px-3 sm:px-5">
        <Link to="/dashboard" className="group flex shrink-0 items-center gap-2">
          <img
            src="/logo.jpg"
            alt={t('brand')}
            className="h-6 w-6 rounded-md"
            width={24}
            height={24}
          />
          <span className="hidden text-[14px] font-semibold tracking-tight min-[560px]:inline">{t('brand')}</span>
        </Link>

        {/* El staff navega por el sidebar de gestión; aquí solo el aprendiz necesita
            enlaces. ("Panel | Simulador" era del diseño viejo: el simulador global
            /simulator ya no existe, cada curso trae los suyos.) */}
        {!isAdminOrCapacitador && (
          <nav className="flex items-center gap-1">
            <NavLink to="/dashboard" className={linkClass} end>
              {t('nav.dashboard')}
            </NavLink>
            <NavLink to="/courses" className={linkClass}>
              {t('nav.explore')}
            </NavLink>
          </nav>
        )}

        <div className="flex min-w-0 items-center gap-0.5 sm:gap-1.5 lg:gap-2">
          {/* Compañía: quiénes más están estudiando ahora mismo. Solo para el
              aprendiz (el staff ya tiene su propia barra de presencia, con
              ubicación) y solo aparece si hay alguien más en línea. */}
          {/* En pantallas angostas la compañía cede el sitio a los controles:
              es lo único de la barra que no sirve para hacer nada. */}
          {!isAdminOrCapacitador && <LearnerPresence className="hidden sm:flex" />}
          {/* "Ver como": salto instantáneo a la vista de aprendiz y de vuelta. */}
          {isAdminOrCapacitador && <ViewSwitcher variant="inline" />}
          {/* El nombre y el anillo de progreso son lo primero que sobra cuando
              la ventana se estrecha: son contexto, no controles. */}
          <Link
            to="/profile"
            className="hidden h-8 min-w-0 items-center gap-2 rounded-full pr-1 transition-opacity hover:opacity-80 sm:flex"
            title={t('profile.title', 'Mi perfil')}
          >
            <span className="hidden lg:inline-flex">
              <ProgressRing value={progress} size={20} stroke={2} />
            </span>
            <Avatar src={avatarUrl} name={name} size={24} />
            <span className="hidden max-w-[100px] truncate text-[12px] text-text-muted md:inline">{name}</span>
          </Link>
          <NotificationBell />
          <LanguageSwitcher />
          {/* El tema se cambia también desde el panel del aprendiz y desde el
              perfil; en una ventana angosta, tres botones más no caben. */}
          <span className="hidden min-[480px]:inline-flex">
            <ThemeToggle />
          </span>
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
