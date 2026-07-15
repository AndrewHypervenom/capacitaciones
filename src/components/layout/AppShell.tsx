import { useLayoutEffect } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Navbar } from './Navbar';
import { HelpWidget } from '@/components/help/HelpWidget';
import { useAuth } from '@/hooks/useAuth';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useProgressSync } from '@/hooks/useProgressSync';
import { useResetNotifications } from '@/hooks/useResetNotifications';
import { Onboarding } from '@/pages/Onboarding';

// Al cambiar de ruta, volver arriba antes del primer pintado de la vista nueva.
function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

export function AppShell({ requireAuth = true }: { requireAuth?: boolean }) {
  const location = useLocation();
  const { isAuthenticated, loading, profile } = useAuth();
  const reducedMotion = useReducedMotion();
  useProgressSync();
  useResetNotifications();

  // El panel del aprendiz trae su propio shell (sidebar con idioma, tema y
  // cierre de sesión), así que ahí el Navbar global sobra. También aplica cuando
  // un staff mira "como aprendiz": debe ver el panel idéntico al del aprendiz,
  // sin el Navbar de gestión (el ViewSwitcher para volver vive en ese sidebar).
  const learnerPanel = requireAuth && location.pathname === '/dashboard';

  const blank = <div className="min-h-screen bg-bg" />;

  if (loading) return blank;

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireAuth && isAuthenticated && !profile) return blank;

  if (requireAuth && profile && !profile.onboarded) {
    return <Onboarding />;
  }

  return (
    <div className="min-h-full bg-bg">
      {requireAuth && !learnerPanel && <Navbar />}
      {/* Sin AnimatePresence mode="wait": si la animación de salida se
          interrumpe (navegación rápida, botón atrás), la vista nueva nunca
          se montaba y la página quedaba vacía. La vista nueva monta ya. */}
      <ScrollToTop />
      <motion.main
        key={location.pathname}
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative"
      >
        <Outlet />
      </motion.main>
      <HelpWidget />
    </div>
  );
}
