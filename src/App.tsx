import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { setGlobalNavigate } from '@/lib/nav';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/components/layout/AppShell';
import Welcome from '@/pages/Welcome';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Courses from '@/pages/Courses';
import CoursePage from '@/pages/CoursePage';
import ModulePage from '@/pages/ModulePage';
import MyFeedback from '@/pages/MyFeedback';
import Profile from '@/pages/Profile';
import SimulatorSetup from '@/pages/SimulatorSetup';
import SimulatorRun from '@/pages/SimulatorRun';
import SimulatorResult from '@/pages/SimulatorResult';
import ChoiceSimulatorRun from '@/pages/ChoiceSimulatorRun';
import Certificate from '@/pages/Certificate';
import LiveQuizPlay from '@/pages/LiveQuizPlay';
import MissionPlayer from '@/pages/MissionPlayer';
import ArenaHub from '@/pages/ArenaHub';
import ArenaPlayer from '@/pages/ArenaPlayer';
import WorldMap from '@/pages/WorldMap';
import { useUserStore } from '@/stores/userStore';
import { useAuth } from '@/hooks/useAuth';
import { initAuth } from '@/stores/authStore';
import { Toaster } from '@/components/ui/Toast';
import { UpdatePrompt } from '@/components/ui/UpdatePrompt';
import { BgTaskIndicator } from '@/components/ui/BgTaskIndicator';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';

// Admin CMS — lazy loaded (code-split, no se carga para learners)
const AdminRouter = lazy(() => import('@/admin/AdminRouter'));

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-text/20 border-t-neon-cyan" />
    </div>
  );
}

function AuthInit() {
  useEffect(() => { initAuth() }, []);
  return null;
}

/** Publica el navigate del router para uso desde servicios/tareas en 2º plano. */
function NavigationBridge() {
  const navigate = useNavigate();
  useEffect(() => { setGlobalNavigate((to) => navigate(to)); }, [navigate]);
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
      <NavigationBridge />
      <LanguageSync />
      <ConfirmProvider>
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/login" element={<Login />} />
        <Route element={<AppShell requireAuth />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/courses/:slug" element={<CoursePage />} />
          <Route path="/modules/:id" element={<ModulePage />} />
          <Route path="/feedback" element={<MyFeedback />} />
          <Route path="/simulator" element={<SimulatorSetup />} />
          <Route path="/simulator/run/:id" element={<SimulatorRun />} />
          <Route path="/simulator/result/:id" element={<SimulatorResult />} />
          <Route path="/simulator/choice/:id" element={<ChoiceSimulatorRun />} />
          <Route path="/certificate/:courseId/:userId" element={<Certificate />} />
          <Route path="/certificate/:courseId" element={<Certificate />} />
          <Route path="/certificate" element={<Certificate />} />
          <Route path="/quiz" element={<LiveQuizPlay />} />
        </Route>
        <Route path="/mission/:id" element={<MissionPlayer />} />
        <Route path="/arena" element={<ArenaHub />} />
        <Route path="/arena/:id" element={<ArenaPlayer />} />
        <Route path="/world" element={<WorldMap />} />
        {/* Admin CMS — solo accesible para admin/superadmin (AdminGuard dentro) */}
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AdminRouter />
            </Suspense>
          }
        />
      </Routes>
      <Toaster />
      <BgTaskIndicator />
      <UpdatePrompt />
      </ConfirmProvider>
    </BrowserRouter>
  );
}
