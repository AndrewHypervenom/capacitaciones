import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { presenceChannelsFor, usePresenceStore } from '@/stores/presenceStore';
import { getAccessibleCampaigns } from '@/services/campaigns.service';
import { useAuthStore } from '@/stores/authStore';
import { setGlobalNavigate } from '@/lib/nav';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/components/layout/AppShell';
import Welcome from '@/pages/Welcome';
import Login from '@/pages/Login';
import ResetPassword from '@/pages/ResetPassword';
import Dashboard from '@/pages/Dashboard';
import Courses from '@/pages/Courses';
import CoursePage from '@/pages/CoursePage';
import ModulePage from '@/pages/ModulePage';
import MyFeedback from '@/pages/MyFeedback';
import MySuggestions from '@/pages/MySuggestions';
import Profile from '@/pages/Profile';
import SimulatorRun from '@/pages/SimulatorRun';
import SimulatorResult from '@/pages/SimulatorResult';
import ChoiceSimulatorRun from '@/pages/ChoiceSimulatorRun';
import Certificate from '@/pages/Certificate';
import PublicCertificate from '@/pages/PublicCertificate';
import LiveQuizPlay from '@/pages/LiveQuizPlay';
import MissionPlayer from '@/pages/MissionPlayer';
import ArenaHub from '@/pages/ArenaHub';
import ArenaPlayer from '@/pages/ArenaPlayer';
import WorldMap from '@/pages/WorldMap';
import { useUserStore } from '@/stores/userStore';
import { useAuth } from '@/hooks/useAuth';
import { initAuth } from '@/stores/authStore';
import { loadGamification } from '@/services/gamification.service';
import { loadAiCreditsSetting } from '@/lib/aiCredits';
import { Toaster } from '@/components/ui/Toast';
import { UpdatePrompt } from '@/components/ui/UpdatePrompt';
import { ServiceStatusBanner } from '@/components/ui/ServiceStatusBanner';
import { BottomBannerStack } from '@/components/ui/BottomBannerStack';
import { BgTaskIndicator } from '@/components/ui/BgTaskIndicator';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import { PasskeyInvite } from '@/components/auth/PasskeyInvite';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { NotificationsSync } from '@/components/notifications/NotificationsSync';
import { HelpChatPing } from '@/components/notifications/HelpChatPing';
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode';

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

/** Carga la configuración de gamificación (logros + niveles XP) una sola vez. */
function GamificationInit() {
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (isAuthenticated) void loadGamification();
  }, [isAuthenticated]);
  return null;
}

/** Carga el flag global de "IA sin créditos" desde la base al iniciar sesión. */
function AiCreditsInit() {
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (isAuthenticated) void loadAiCreditsSetting();
  }, [isAuthenticated]);
  return null;
}

/**
 * Presencia global: TODO usuario autenticado (aprendiz, capacitador o
 * superadmin) emite en qué vista está, desde cualquier parte del sitio.
 * Al cerrar sesión (profile → null) se desconecta y desaparece de la lista.
 *
 * A qué canales se conecta cada quien lo decide `presenceChannelsFor` según su
 * rol y sus campañas: es lo que hace que un capacitador solo coincida con
 * capacitadores de sus campañas y que el superadmin vea a todos sin ser visto.
 */
function PresenceSync() {
  const profile = useAuthStore((s) => s.profile);
  const location = useLocation();

  useEffect(() => {
    // La vista previa no es una sesión de verdad: no debe aparecer en "en línea"
    // ni duplicar al capacitador que ya está en el editor (ver previewMode.ts).
    if (IS_LEARNER_PREVIEW) return;
    if (!profile) {
      usePresenceStore.getState().disconnect();
      return;
    }
    let alive = true;
    void (async () => {
      // Si las campañas no se pueden resolver, no conectamos a ciegas: sin
      // canales correctos la única alternativa sería emitir donde no toca.
      let campaignIds: string[] = [];
      try {
        const campaigns = await getAccessibleCampaigns({
          isSuperAdmin: profile.role === 'superadmin',
          homeCampaignId: profile.campaign_id ?? null,
          userId: profile.id,
        });
        campaignIds = campaigns.map((c) => c.id);
      } catch {
        return;
      }
      if (!alive) return;
      usePresenceStore.getState().connect(
        presenceChannelsFor({ role: profile.role, campaignIds }),
        {
          user_id: profile.id,
          name: profile.display_name ?? profile.id.slice(0, 8),
          avatar_url: profile.avatar_url ?? null,
          role: profile.role ?? undefined,
        },
      );
    })();
    return () => {
      alive = false;
      usePresenceStore.getState().disconnect();
    };
  }, [
    profile?.id,
    profile?.display_name,
    profile?.avatar_url,
    profile?.role,
    profile?.campaign_id,
  ]);

  useEffect(() => {
    usePresenceStore.getState().setRoute(location.pathname);
  }, [location.pathname]);

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
  const languageChosen = useUserStore((s) => s.languageChosen);
  const { i18n } = useTranslation();

  useEffect(() => {
    if (profile) syncFromProfile(profile);
  }, [profile, syncFromProfile]);

  useEffect(() => {
    // Sin sesión y sin elección explícita en el switcher, `language` no es un
    // idioma que nadie haya pedido: es el default del store ('es'). Aplicarlo
    // pisaba la detección del navegador y dejaba a TODO visitante anónimo en
    // español —un enlace compartido a alguien de Brasil se veía en español—.
    // Callados aquí, manda i18next: localStorage → navegador.
    if (!profile && !languageChosen) return;
    if (i18n.resolvedLanguage !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language, languageChosen, profile, i18n]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthInit />
      <NavigationBridge />
      <PresenceSync />
      {/* Campana y avisos en vivo para TODOS los roles, dentro y fuera del panel. */}
      <NotificationsSync />
      <LanguageSync />
      <GamificationInit />
      <AiCreditsInit />
      <ConfirmProvider>
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="/login" element={<Login />} />
        {/* Restablecer contraseña desde el enlace del correo — sin sesión previa */}
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<AppShell requireAuth />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/courses/:slug" element={<CoursePage />} />
          <Route path="/modules/:id" element={<ModulePage />} />
          <Route path="/feedback" element={<MyFeedback />} />
          {/* Buzón permanente: lo que cada quien ha propuesto o reportado */}
          <Route path="/suggestions" element={<MySuggestions />} />
          <Route path="/simulator/run/:id" element={<SimulatorRun />} />
          <Route path="/simulator/result/:id" element={<SimulatorResult />} />
          <Route path="/simulator/choice/:id" element={<ChoiceSimulatorRun />} />
          <Route path="/certificate/:courseId/:userId" element={<Certificate />} />
          <Route path="/certificate/:courseId" element={<Certificate />} />
          <Route path="/certificate" element={<Certificate />} />
          <Route path="/quiz" element={<LiveQuizPlay />} />
        </Route>
        {/* Verificación pública del certificado (LinkedIn) — sin login */}
        <Route path="/verify/:certId" element={<PublicCertificate />} />
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
      {/* Opiniones del sitio: vive en la raíz para estar en TODAS las vistas
          (aprendiz, mundos, panel de gestión) y para que lo escrito a medias no
          se pierda al navegar. Él decide dónde no debe aparecer.
          Dentro de la vista previa se ocultan los avisos de plataforma (opiniones,
          tareas en 2º plano, "hay versión nueva"): son del panel, no del curso, y
          en un modal solo estorban. */}
      {!IS_LEARNER_PREVIEW && <FeedbackWidget />}
      {/* "Alguien está pidiendo ayuda": aviso en vivo del chat, solo superadmin. */}
      <HelpChatPing />
      <Toaster />
      {!IS_LEARNER_PREVIEW && <BgTaskIndicator />}
      {/* Avisos flotantes de abajo, apilados en una sola columna para que no se
          tapen entre sí. El de servicio va último (más cerca del borde) porque
          es el urgente. Vive en la raíz porque la degradación se nota en
          cualquier vista y aplica a todos los roles (incluido el aprendiz, que
          es quien más la sufre sin saber por qué). */}
      {!IS_LEARNER_PREVIEW && (
        <BottomBannerStack>
          <UpdatePrompt />
          <ServiceStatusBanner />
        </BottomBannerStack>
      )}
      {/* "¿Quieres entrar con tu huella la próxima vez?" — se ofrece una sola
          vez, ya con la sesión abierta y solo si el equipo tiene sensor. */}
      {!IS_LEARNER_PREVIEW && <PasskeyInvite />}
      </ConfirmProvider>
    </BrowserRouter>
  );
}
