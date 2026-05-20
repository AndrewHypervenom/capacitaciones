import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Navbar } from './Navbar';
import { useAuth } from '@/hooks/useAuth';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Onboarding } from '@/pages/Onboarding';

export function AppShell({ requireAuth = true }: { requireAuth?: boolean }) {
  const location = useLocation();
  const { isAuthenticated, loading, profile } = useAuth();
  const reducedMotion = useReducedMotion();

  // Esperar a que se inicialice la sesión antes de redirigir
  if (loading) return null;

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireAuth && profile && profile.onboarded === false) {
    return <Onboarding />;
  }

  return (
    <div className="min-h-full bg-bg">
      {requireAuth && <Navbar />}
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
    </div>
  );
}
