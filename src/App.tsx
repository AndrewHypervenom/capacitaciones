import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/components/layout/AppShell';
import Welcome from '@/pages/Welcome';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import ModulePage from '@/pages/ModulePage';
import SimulatorSetup from '@/pages/SimulatorSetup';
import SimulatorRun from '@/pages/SimulatorRun';
import SimulatorResult from '@/pages/SimulatorResult';
import ChoiceSimulatorRun from '@/pages/ChoiceSimulatorRun';
import Certificate from '@/pages/Certificate';
import LiveQuizPlay from '@/pages/LiveQuizPlay';
import { useUserStore } from '@/stores/userStore';
import { useAuth } from '@/hooks/useAuth';
import { initAuth } from '@/stores/authStore';
import { Toaster } from '@/components/ui/Toast';

// Admin CMS — lazy loaded (code-split, no se carga para learners)
const AdminRouter = lazy(() => import('@/admin/AdminRouter'));

function AuthInit() {
  useEffect(() => { initAuth() }, []);
  return null;
}

function LanguageSync() {
  const { profile } = useAuth();
  const syncFromProfile = useUserStore((s) => s.syncFromProfile);
  const language = useUserStore((s) => s.language);
  const { i18n } = useTranslation();

  useEffect(() => {
    if (profile) syncFromProfile(profile);
  }, [profile, syncFromProfile]);

  useEffect(() => {
    if (i18n.resolvedLanguage !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthInit />
      <LanguageSync />
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/login" element={<Login />} />
        <Route element={<AppShell requireAuth />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/modules/:id" element={<ModulePage />} />
          <Route path="/simulator" element={<SimulatorSetup />} />
          <Route path="/simulator/run/:id" element={<SimulatorRun />} />
          <Route path="/simulator/result/:id" element={<SimulatorResult />} />
          <Route path="/simulator/choice/:id" element={<ChoiceSimulatorRun />} />
          <Route path="/certificate" element={<Certificate />} />
          <Route path="/quiz" element={<LiveQuizPlay />} />
        </Route>
        {/* Admin CMS — solo accesible para admin/superadmin (AdminGuard dentro) */}
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={null}>
              <AdminRouter />
            </Suspense>
          }
        />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
