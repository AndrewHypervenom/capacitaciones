import { useEffect } from 'react';
import { Outlet, useLocation, Navigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Navbar } from './Navbar';
import { useAuth } from '@/hooks/useAuth';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Onboarding } from '@/pages/Onboarding';
import { signOut } from '@/services/auth.service';

export function AppShell({ requireAuth = true }: { requireAuth?: boolean }) {
  const location = useLocation();
  const { isAuthenticated, loading, profile } = useAuth();
  const reducedMotion = useReducedMotion();

  // Sesión válida pero sin perfil → limpiar sesión para forzar login limpio
  const orphanSession = !loading && requireAuth && isAuthenticated && !profile;
  useEffect(() => {
    if (orphanSession) signOut().catch(() => {});
  }, [orphanSession]);

  const blank = <div className="min-h-screen bg-bg" />;

  if (loading) return blank;

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Sesión sin perfil: redirigir al login (signOut corre en el efecto de arriba)
  if (orphanSession) return <Navigate to="/login" replace />;

  if (requireAuth && profile && !profile.onboarded) {
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
