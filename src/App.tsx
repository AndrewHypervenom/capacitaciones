import { lazy, Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { presenceChannelsFor, usePresenceStore } from '@/stores/presenceStore';
import { getAccessibleCampaigns } from '@/services/campaigns.service';
import { startTrafficTracking, stopTrafficTracking, trackRoute } from '@/lib/trafficTracker';
import { useAuthStore } from '@/stores/authStore';
import { setGlobalNavigate } from '@/lib/nav';
import { useTranslation } from 'react-i18next';
import { AppShell } from '@/components/layout/AppShell';
// ─── Qué entra en el paquete inicial y qué no ───────────────────────────────
// Estas cinco pantallas son el camino que TODO el mundo recorre —entrar, ver su
// panel, abrir un curso, leer un módulo—, así que viajan en el paquete principal
// y aparecen sin esperar ni un chunk extra.
import Welcome from '@/pages/Welcome';
import Login from '@/pages/Login';
import Dashboard from '@/pages/Dashboard';
import Courses from '@/pages/Courses';
import CoursePage from '@/pages/CoursePage';
import ModulePage from '@/pages/ModulePage';

// El resto se carga cuando se visita, y no antes. Son pantallas que la mayoría
// de la gente no abre en una sesión cualquiera (el simulador, el examen, el
// certificado con su generador de PDF, los mundos, el quiz en vivo) y que hasta
// hoy pesaban sobre la primera carga de todos, incluido quien solo entra a leer
// un módulo. El `Suspense` que las cubre está más abajo; si un chunk falla por
// un despliegue nuevo, el ErrorBoundary global ya recarga (ver main.tsx).
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const MyFeedback = lazy(() => import('@/pages/MyFeedback'));
const MySuggestions = lazy(() => import('@/pages/MySuggestions'));
const Profile = lazy(() => import('@/pages/Profile'));
const SimulatorRun = lazy(() => import('@/pages/SimulatorRun'));
const SimulatorResult = lazy(() => import('@/pages/SimulatorResult'));
const ChoiceSimulatorRun = lazy(() => import('@/pages/ChoiceSimulatorRun'));
const Certificate = lazy(() => import('@/pages/Certificate'));
const CourseSurvey = lazy(() => import('@/pages/CourseSurvey'));
const ExamLanding = lazy(() => import('@/pages/ExamLanding'));
const ExamRunner = lazy(() => import('@/pages/ExamRunner'));
const ExamResult = lazy(() => import('@/pages/ExamResult'));
const PublicCertificate = lazy(() => import('@/pages/PublicCertificate'));
const LiveQuizPlay = lazy(() => import('@/pages/LiveQuizPlay'));
const MissionPlayer = lazy(() => import('@/pages/MissionPlayer'));
const ArenaHub = lazy(() => import('@/pages/ArenaHub'));
const ArenaPlayer = lazy(() => import('@/pages/ArenaPlayer'));
const WorldMap = lazy(() => import('@/pages/WorldMap'));
import { useUserStore } from '@/stores/userStore';
import { useAuth } from '@/hooks/useAuth';
import { initAuth } from '@/stores/authStore';
import { loadGamification } from '@/services/gamification.service';
import { loadXPEvents } from '@/services/xpEvents.service';
import { XPGainLayer } from '@/components/gamification/XPGainLayer';
import { loadAiCreditsSetting } from '@/lib/aiCredits';
import { initTabSync } from '@/lib/tabSync';
import { Toaster } from '@/components/ui/Toast';
import { UpdatePrompt } from '@/components/ui/UpdatePrompt';
import { ServiceStatusBanner } from '@/components/ui/ServiceStatusBanner';
import { BottomBannerStack } from '@/components/ui/BottomBannerStack';
import { ContentProtection } from '@/components/security/ContentProtection';
import { BgTaskIndicator } from '@/components/ui/BgTaskIndicator';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import { PasskeyInvite } from '@/components/auth/PasskeyInvite';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { CornerDock } from '@/components/ui/CornerDock';
import { NotificationsSync } from '@/components/notifications/NotificationsSync';
import { StaffPings } from '@/components/notifications/StaffPings';
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

/**
 * Sincronía entre pestañas del mismo navegador. Sin esto, dos pestañas abiertas
 * eran dos apps sordas: la última en escribir el localStorage pisaba a la otra
 * con un estado viejo (progreso que "se borraba", cambios que no aparecían).
 * Ver src/lib/tabSync.ts y src/lib/crossTab.ts.
 */
function TabSyncInit() {
  useEffect(() => { initTabSync() }, []);
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

/**
 * Eventos de XP multiplicado. Se recargan cada 10 min además de al entrar: si el
 * superadmin programa un ×2 a media mañana, las pestañas ya abiertas se enteran
 * sin que nadie recargue (el encendido/apagado dentro de la ventana ya lo maneja
 * el reloj del store).
 */
function XPEventsInit() {
  const { isAuthenticated } = useAuth();
  useEffect(() => {
    if (!isAuthenticated) return;
    void loadXPEvents();
    const id = setInterval(() => void loadXPEvents(), 10 * 60_000);
    return () => clearInterval(id);
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
  // La ruta actual en una ref, no como dependencia: si el efecto de abajo se
  // reiniciara en cada navegación tumbaría y reabriría el canal de Realtime en
  // cada clic. Solo se necesita su valor en el instante del arranque.
  // Se inicializa con la ruta de carga (que es la buena en el primer arranque) y
  // se refresca en el efecto de navegación de abajo, nunca durante el render.
  const pathRef = useRef(location.pathname);

  useEffect(() => {
    // La vista previa no es una sesión de verdad: no debe aparecer en "en línea"
    // ni duplicar al capacitador que ya está en el editor (ver previewMode.ts).
    if (IS_LEARNER_PREVIEW) return;
    if (!profile) {
      usePresenceStore.getState().disconnect();
      stopTrafficTracking();
      return;
    }
    // El histórico de tráfico se mide desde aquí mismo: es el único sitio que
    // ya sabe quién entró y por dónde va, y así una vista sin presencia
    // (Realtime caído) igual queda contada. Ver lib/trafficTracker.ts.
    startTrafficTracking({
      userId: profile.id,
      role: profile.role ?? null,
      campaignId: profile.campaign_id ?? null,
      // La ruta va aquí porque el efecto de abajo ya corrió (con el perfil aún
      // en null) y no volverá a hacerlo hasta que se navegue.
      route: pathRef.current,
    });
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
    pathRef.current = location.pathname;
    usePresenceStore.getState().setRoute(location.pathname);
    // Cierra la vista anterior (con su tiempo activo) y abre la nueva.
    if (!IS_LEARNER_PREVIEW) trackRoute(location.pathname);
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
      <TabSyncInit />
      <NavigationBridge />
      <PresenceSync />
      {/* Campana y avisos en vivo para TODOS los roles, dentro y fuera del panel. */}
      <NotificationsSync />
      <LanguageSync />
      <GamificationInit />
      <XPEventsInit />
      <AiCreditsInit />
      <ConfirmProvider>
      {/* Red para las rutas perezosas que NO cuelgan del AppShell (ese trae la
          suya alrededor del Outlet, para no desmontar la barra al navegar). */}
      <Suspense fallback={<RouteFallback />}>
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
          {/* Examen final de certificación. `run` y `result` cuelgan del curso
              para que el aprendiz nunca pueda saltarse la antesala a mano. */}
          <Route path="/exam/:courseId" element={<ExamLanding />} />
          <Route path="/exam/:courseId/run" element={<ExamRunner />} />
          <Route path="/exam/:courseId/result/:attemptId" element={<ExamResult />} />
          {/* Encuesta de satisfacción: el paso de cierre entre aprobar y ver el
              certificado. Cuelga del curso porque no es contenido —no está en
              el pénsum ni suma horas—, es la puerta de salida. */}
          <Route path="/course/:courseId/survey" element={<CourseSurvey />} />
          <Route path="/certificate/:courseId/:userId" element={<Certificate />} />
          <Route path="/certificate/:courseId" element={<Certificate />} />
          <Route path="/certificate" element={<Certificate />} />
          <Route path="/quiz" element={<LiveQuizPlay />} />
        </Route>
        {/* Verificación pública del certificado (LinkedIn) — sin login.
            El id reservado `preview` abre ESTA MISMA página con el borrador que
            el capacitador está editando: la vista previa no puede ser una
            maqueta aparte o dejaría de coincidir con lo que ve quien abre el
            enlace. Ningún cert_id emitido puede llamarse así. */}
        <Route path="/verify/:certId" element={<PublicCertificate />} />
        <Route path="/mission/:id" element={<MissionPlayer />} />
        <Route path="/arena" element={<ArenaHub />} />
        <Route path="/arena/:id" element={<ArenaPlayer />} />
        <Route path="/world" element={<WorldMap />} />
        {/* Admin CMS — solo accesible para admin/superadmin (AdminGuard dentro) */}
        <Route path="/admin/*" element={<AdminRouter />} />
      </Routes>
      </Suspense>
      {/* Opiniones del sitio: vive en la raíz para estar en TODAS las vistas
          (aprendiz, mundos, panel de gestión) y para que lo escrito a medias no
          se pierda al navegar. Él decide dónde no debe aparecer.
          Dentro de la vista previa se ocultan los avisos de plataforma (opiniones,
          tareas en 2º plano, "hay versión nueva"): son del panel, no del curso, y
          en un modal solo estorban. */}
      {!IS_LEARNER_PREVIEW && <FeedbackWidget />}
      {/* Un solo rincón flotante para ayuda, opiniones y "volver arriba": se
          aparta al bajar por la página y se puede mover o esconder, para que
          nunca quede encima de un botón que hay que tocar. */}
      <CornerDock />
      {/* Avisos en vivo del staff: "alguien pide ayuda en el chat" (superadmin) y
          "llegó una opinión del sitio" (superadmin + capacitadores de la campaña). */}
      <StaffPings />
      {/* Portapapeles secuestrado para el rol aprendiz. Vive en la raíz para
          cubrir TODO el sitio (módulos, examen, simulador, mundos, arena) sin
          depender de que cada vista se acuerde de invocarla. No pinta nada. */}
      <ContentProtection />
      <Toaster />
      {/* "+XP" flotante: cada acreditación del store se ve al instante, en
          cualquier vista y para cualquier rol (incluido el staff probando). */}
      <XPGainLayer />
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
