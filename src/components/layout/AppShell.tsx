import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Navbar } from './Navbar';
import { HelpWidget } from '@/components/help/HelpWidget';
import { useAuth } from '@/hooks/useAuth';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Onboarding } from '@/pages/Onboarding';

export function AppShell({ requireAuth = true }: { requireAuth?: boolean }) {
  const location = useLocation();
  const { isAuthenticated, loading, profile, isAdminOrCapacitador } = useAuth();
  const reducedMotion = useReducedMotion();

  // El panel del aprendiz trae su propio shell (sidebar con idioma, tema y
  // cierre de sesión), así que ahí el Navbar global sobra.
  const learnerPanel = requireAuth && !isAdminOrCapacitador && location.pathname === '/dashboard';

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
      <AnimatePresence mode="wait" onExitComplete={() => window.scrollTo({ top: 0, behavior: 'instant' })}>
        <motion.main
          key={location.pathname}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>
      <HelpWidget />
    </div>
  );
}
