
import { lazy, Suspense, useRef, useLayoutEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FolderX, Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { useHasNoCampaigns } from '@/hooks/useHasNoCampaigns'

import { AdminNav } from './components/AdminNav'
import { TestModeBanner } from './components/TestModeSwitch'
import { CampaignWizard } from './components/CampaignWizard'
import { Button } from '@/components/ui/Button'
import { ViewPresenceChip } from '@/components/presence/ViewPresenceChip'
import AdminDashboard from './pages/AdminDashboard'

/* ── Las páginas del panel van en su propio archivo ───────────────────────
 *
 * Antes TODAS se importaban de golpe y Vite las metía en un solo paquete de
 * 2,25 MB: entrar a cualquier pantalla del panel obligaba a descargar y
 * compilar el editor de cursos, el de módulos, los mundos y el tablero de
 * progreso entero — aunque solo se fuera a mirar la lista de usuarios.
 *
 * La regla de rutas perezosas ya estaba puesta en `App.tsx` para el lado del
 * aprendiz; aquí no se había aplicado nunca. El Panel se queda cargado de
 * entrada a propósito: es donde aterriza todo el mundo, y partirlo solo
 * añadiría una espera en el caso más frecuente.
 * ──────────────────────────────────────────────────────────────────────── */
const NewModulePage = lazy(() => import('./pages/NewModulePage'))
const ImportContent = lazy(() => import('./pages/ImportContent'))
const UserList = lazy(() => import('./pages/UserList'))
const RhDashboard = lazy(() => import('./pages/RhDashboard'))
const UserProfile = lazy(() => import('./pages/UserProfile'))
const LiveQuizAdmin = lazy(() => import('./pages/LiveQuizAdmin'))
const ModuleList = lazy(() => import('./pages/ModuleList'))
const ModuleEditor = lazy(() => import('./pages/ModuleEditor'))
const CourseList = lazy(() => import('./pages/CourseList'))
const CourseEditor = lazy(() => import('./pages/CourseEditor'))
const SimulationList = lazy(() => import('./pages/SimulationList'))
const SimulationEditor = lazy(() => import('./pages/SimulationEditor'))
const ChoiceSimEditor = lazy(() => import('./pages/ChoiceSimEditor'))
const ProgressHub = lazy(() => import('./pages/ProgressHub'))
const CertificatesAccess = lazy(() => import('./pages/CertificatesAccess'))
const LearningMissions = lazy(() => import('./pages/LearningMissions'))
const Worlds = lazy(() => import('./pages/Worlds'))
const WorldDetail = lazy(() => import('./pages/WorldDetail'))
const ChatLogs = lazy(() => import('./pages/ChatLogs'))
const AiUsage = lazy(() => import('./pages/AiUsage'))
const Traffic = lazy(() => import('./pages/Traffic'))
const AiLimits = lazy(() => import('./pages/AiLimits'))
const Gamification = lazy(() => import('./pages/Gamification'))
const OrgUnits = lazy(() => import('./pages/OrgUnits'))
const ActivityLog = lazy(() => import('./pages/ActivityLog'))
const DeletionApprovals = lazy(() => import('./pages/DeletionApprovals'))
const PublishApprovals = lazy(() => import('./pages/PublishApprovals'))
const SiteFeedback = lazy(() => import('./pages/SiteFeedback'))

import { usePendingPublicationsSync } from '@/stores/pendingPublicationsStore'
import { HelpWidget } from '@/components/help/HelpWidget'
import { useDeadlineAlertKick } from '@/hooks/useDeadlineAlertKick'

/**
 * Lo que se ve mientras llega el archivo de una pantalla.
 *
 * Un esqueleto tenue y no un spinner: con el archivo en caché esto dura dos
 * fotogramas, y un spinner que aparece y desaparece en 30 ms se percibe como un
 * parpadeo, que es peor que no poner nada.
 */
function RouteFallback() {
  return (
    <div className="p-4 sm:p-8">
      <div className="h-7 w-52 animate-pulse rounded-lg bg-glass/8" />
      <div className="mt-3 h-4 w-80 animate-pulse rounded bg-glass/6" />
      <div className="mt-6 h-28 animate-pulse rounded-2xl bg-glass/5" />
    </div>
  )
}

/** Enlace viejo a la vista previa de página completa → editor del módulo. */
function LegacyPreviewRedirect() {
  const { moduleId } = useParams<{ moduleId: string }>()
  return <Navigate to={`/admin/modules/${moduleId}`} replace />
}

export default function AdminRouter() {
  const { loading, isAuthenticated, isCapacitador, isSuperAdmin, isRh, canAccessAdminPanel, canApproveCourses } = useAuth()

  // Cuenta los cursos en cola mientras el panel esté abierto, para el globo del
  // menú y la tarjeta del tablero. Solo pide si quien mira puede aprobar.
  usePendingPublicationsSync(canApproveCourses)

  // Avisos de plazo de las inducciones: mientras no haya pg_cron, la tarea
  // diaria la dispara el primer miembro del equipo que entra al panel.
  useDeadlineAlertKick()
  const location = useLocation()
  const profile = useAuthStore((s) => s.profile)
  const { t } = useTranslation()
  const noCampaigns = useHasNoCampaigns()
  const [wizardOpen, setWizardOpen] = useState(false)

  // El panel scrollea dentro de este contenedor (no en `window`), y como
  // /admin/* vive fuera de AppShell, nada reseteaba su scroll al navegar. Al
  // pasar de una vista alta (p.ej. el editor de un mundo, scrolleado abajo) a
  // otra más corta, el contenedor quedaba scrolleado más allá del contenido
  // nuevo → se veía en blanco y las entradas `whileInView` no disparaban.
  // Volvemos arriba en cada cambio de ruta, antes del primer pintado.
  const scrollRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [location.pathname])

  // La presencia colaborativa ahora es global (PresenceSync en App.tsx):
  // todos los roles emiten su vista actual desde cualquier parte del sitio.

  if (loading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (!canAccessAdminPanel) return <Navigate to="/dashboard" replace />

  // Sin programa no hay nada que gestionar. El superadmin puede crear uno aquí
  // mismo; el capacitador YA NO, porque crear programas dejó de ser suyo — era
  // la puerta por la que aparecían escritorios personales disfrazados de
  // programa. A él se le dice qué hacer en vez de dejarlo en un callejón: tres
  // cuentas nuevas de agosto se quedaron semanas frente a esta pantalla, y dos
  // ni volvieron a entrar.
  if (noCampaigns) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-bg p-6">
          <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
            <FolderX className="mx-auto mb-4 h-10 w-10 text-text-subtle" />
            <h1 className="text-[18px] font-bold text-text">{t('admin.no_campaigns.title')}</h1>
            <p className="mt-2 text-[13px] text-text-muted">
              {isSuperAdmin
                ? t('admin.no_campaigns.desc')
                : t('admin.no_campaigns.ask_admin', 'Pídele al superadmin que te asigne uno y aparecerá aquí. No hace falta que crees nada.')}
            </p>
            {isSuperAdmin && (
              <Button variant="neon" size="sm" className="mt-6 mx-auto" onClick={() => setWizardOpen(true)}>
                <Plus className="h-4 w-4" />
                {t('admin.no_campaigns.create')}
              </Button>
            )}
          </div>
        </div>
        <CampaignWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          onCreated={() => { /* finalize asigna la campaña casa → el panel se revela solo */ }}
        />
      </>
    )
  }

  // `h-screen` (no `min-h-screen`): con altura mínima el contenedor crecía con
  // el contenido y el `overflow-auto` de abajo nunca llegaba a scrollear
  // —scrolleaba la ventana—, así que ningún `sticky` de las páginas se pegaba
  // (se medía contra un contenedor que nunca se movía). Con altura fija el panel
  // scrollea de verdad dentro del contenedor, como dice el comentario de `scrollRef`.
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <AdminNav />
      <div ref={scrollRef} className="flex-1 md:ml-56 overflow-auto pt-14 md:pt-0">
        {/* Mientras el modo pruebas esté encendido, el panel lo dice arriba de
            todo: sin esto es facilísimo exportar un Excel con data de prueba. */}
        <TestModeBanner />
        {/* Un único Suspense alrededor de las rutas. Dentro y no fuera del
            contenedor con scroll, para que la barra lateral y el aviso de modo
            pruebas no parpadeen al cambiar de pantalla. */}
        <Suspense fallback={<RouteFallback />}>
        {isRh ? (
          /* Recursos Humanos: cargar la base de TH (altas) y ver personas. Las
             estadísticas de formación (avance, notas, bandeja) no son suyas. Árbol de rutas PROPIO y cerrado: esconder el menú no
             bastaba, con escribir /admin/courses en la barra entraba al editor.
             Lo que no está aquí lleva al inicio. */
          <Routes>
            <Route index element={<RhDashboard />} />
            <Route path="users" element={<UserList />} />
            <Route path="users/:id" element={<UserProfile />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        ) : (
        <Routes>
          <Route index element={<AdminDashboard />} />
          {/* Programas retirados: el enlace viejo lleva a CR. */}
          <Route path="campaigns" element={<Navigate to="/admin/units" replace />} />
          <Route path="import" element={<ImportContent />} />
          <Route path="courses" element={<CourseList />} />
          <Route path="courses/:courseId" element={<CourseEditor />} />
          <Route path="modules" element={<ModuleList />} />
          <Route path="modules/new" element={<NewModulePage />} />
          <Route path="modules/:moduleId" element={<ModuleEditor />} />
          {/* La vista previa dejó de ser una página aparte: ahora es un modal con
              la ruta REAL del aprendiz (LearnerPreviewModal). La página anterior
              era una segunda copia del render y se desincronizaba del aprendiz.
              La ruta se conserva para enlaces viejos y lleva al editor. */}
          <Route path="modules/:moduleId/preview" element={<LegacyPreviewRedirect />} />
          {/* Usuarios: superadmin (todo) y capacitador (solo su campaña, lectura + asignar cursos) */}
          <Route path="users" element={canAccessAdminPanel ? <UserList /> : <Navigate to="/admin" replace />} />
          <Route path="users/:id" element={canAccessAdminPanel ? <UserProfile /> : <Navigate to="/admin" replace />} />
          {/* La antigua "Vista global" (matriz usuarios × cursos) se fusionó con
              el Panorama de Progreso: mismos datos y mismos filtros, más KPIs y
              exportación. La ruta se conserva porque hay enlaces viejos. */}
          <Route path="overview" element={<Navigate to="/admin/progress?view=modules&tab=overview" replace />} />
          {/* Gamificación: logros + niveles de XP (solo superadmin) */}
          <Route path="gamification" element={isSuperAdmin ? <Gamification /> : <Navigate to="/admin" replace />} />
          {/* Catálogo cerrado de operaciones y áreas: lo define solo el superadmin. */}
          {/* El catálogo de CR y áreas lo CONSULTA todo el staff: el capacitador lo
              necesita para saber a qué CR puede dirigir un curso. Escribir sigue
              siendo del superadmin, y no por esconder la pantalla sino porque lo
              impone la RLS; la vista se pone de solo lectura para no ofrecer
              botones que van a fallar. */}
          <Route path="units" element={<OrgUnits />} />
          {/* Bitácora de actividad del equipo: solo superadmin */}
          <Route path="activity" element={isSuperAdmin ? <ActivityLog /> : <Navigate to="/admin" replace />} />
          <Route path="traffic" element={isSuperAdmin ? <Traffic /> : <Navigate to="/admin" replace />} />
          {/* Aprobación de eliminaciones (borrado suave de capacitadores): solo superadmin */}
          <Route path="approvals" element={isSuperAdmin ? <DeletionApprovals /> : <Navigate to="/admin" replace />} />
          {/* Aprobación de publicaciones: el superadmin y el capacitador al que
              él le dio el permiso (profiles.can_approve_courses). */}
          <Route path="publish-approvals" element={canApproveCourses ? <PublishApprovals /> : <Navigate to="/admin" replace />} />
          {/* Opiniones del sitio: el capacitador ve las de su campaña (lo acota
              la RLS), el superadmin las ve todas. */}
          <Route path="site-feedback" element={<SiteFeedback />} />
          <Route path="quiz" element={<LiveQuizAdmin />} />
          {/* Historial del chat de ayuda: solo superadmin */}
          <Route path="chat" element={isSuperAdmin ? <ChatLogs /> : <Navigate to="/admin" replace />} />
          {/* Panel de uso de IA y costos: solo superadmin */}
          <Route path="ai-usage" element={isSuperAdmin ? <AiUsage /> : <Navigate to="/admin" replace />} />
          {/* Cupo diario de operaciones con IA (y sus excepciones): solo superadmin */}
          <Route path="limits" element={isSuperAdmin ? <AiLimits /> : <Navigate to="/admin" replace />} />
          {/* Vista unificada de progreso (Mundos + Módulos); las rutas viejas redirigen. */}
          <Route path="evaluaciones" element={<Navigate to="/admin/progress?view=modules" replace />} />
          <Route path="simulations" element={<SimulationList />} />
          <Route path="simulations/new" element={<SimulationEditor />} />
          <Route path="simulations/:id" element={<SimulationEditor />} />
          <Route path="simulations/choice/new" element={<ChoiceSimEditor />} />
          <Route path="simulations/choice/:id" element={<ChoiceSimEditor />} />
          <Route path="missions" element={isSuperAdmin ? <LearningMissions /> : <Navigate to="/admin" replace />} />
          {/* Arena se unificó dentro de Mundos: las arenas viven dentro de cada mundo. */}
          <Route path="arena" element={<Navigate to="/admin/worlds" replace />} />
          <Route path="worlds" element={<Worlds />} />
          <Route path="worlds/:id" element={<WorldDetail />} />
          <Route path="feedback" element={<Navigate to="/admin/progress?view=worlds" replace />} />
          <Route path="progress" element={<ProgressHub />} />
          <Route path="certificates" element={<CertificatesAccess />} />
          {/* Ruta desconocida del panel: sin esto se veía la barra y un área vacía. */}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        )}
        </Suspense>
      </div>
      {/* Vale para CUALQUIER vista del panel: avisa si alguien más está aquí. */}
      <ViewPresenceChip />
      <HelpWidget />
    </div>
  )
}
