
import { useRef, useLayoutEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FolderX, Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { useHasNoCampaigns } from '@/hooks/useHasNoCampaigns'

import { AdminNav } from './components/AdminNav'
import { CampaignWizard } from './components/CampaignWizard'
import { Button } from '@/components/ui/Button'
import { ViewPresenceChip } from '@/components/presence/ViewPresenceChip'
import AdminDashboard from './pages/AdminDashboard'
import CampaignList from './pages/CampaignList'
import NewModulePage from './pages/NewModulePage'
import ImportContent from './pages/ImportContent'
import UserList from './pages/UserList'
import UserProfile from './pages/UserProfile'
import LiveQuizAdmin from './pages/LiveQuizAdmin'
import ModuleList from './pages/ModuleList'
import ModuleEditor from './pages/ModuleEditor'
import CourseList from './pages/CourseList'
import CourseEditor from './pages/CourseEditor'
import SimulationList from './pages/SimulationList'
import SimulationEditor from './pages/SimulationEditor'
import ChoiceSimEditor from './pages/ChoiceSimEditor'
import ProgressHub from './pages/ProgressHub'
import LearningMissions from './pages/LearningMissions'
import Worlds from './pages/Worlds'
import WorldDetail from './pages/WorldDetail'
import ChatLogs from './pages/ChatLogs'
import AiUsage from './pages/AiUsage'
import AiLimits from './pages/AiLimits'
import Gamification from './pages/Gamification'
import ActivityLog from './pages/ActivityLog'
import DeletionApprovals from './pages/DeletionApprovals'
import SiteFeedback from './pages/SiteFeedback'
import { HelpWidget } from '@/components/help/HelpWidget'

/** Enlace viejo a la vista previa de página completa → editor del módulo. */
function LegacyPreviewRedirect() {
  const { moduleId } = useParams<{ moduleId: string }>()
  return <Navigate to={`/admin/modules/${moduleId}`} replace />
}

export default function AdminRouter() {
  const { loading, isAuthenticated, isCapacitador, isSuperAdmin } = useAuth()
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
  if (!isSuperAdmin && !isCapacitador) return <Navigate to="/dashboard" replace />

  // Sin campañas no hay nada que gestionar, pero tampoco lo bloqueamos: un
  // capacitador nuevo (o al que le quitaron su única campaña) puede crear la
  // suya aquí mismo. CampaignWizard.finalize se la asigna como campaña casa, así
  // que al crearla `useHasNoCampaigns` recalcula a false y aparece el panel.
  if (noCampaigns) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-bg p-6">
          <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
            <FolderX className="mx-auto mb-4 h-10 w-10 text-text-subtle" />
            <h1 className="text-[18px] font-bold text-text">{t('admin.no_campaigns.title')}</h1>
            <p className="mt-2 text-[13px] text-text-muted">{t('admin.no_campaigns.desc')}</p>
            <Button variant="neon" size="sm" className="mt-6 mx-auto" onClick={() => setWizardOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('admin.no_campaigns.create')}
            </Button>
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
        <Routes>
          <Route index element={<AdminDashboard />} />
          <Route path="campaigns" element={<CampaignList />} />
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
          <Route path="users" element={isSuperAdmin || isCapacitador ? <UserList /> : <Navigate to="/admin" replace />} />
          <Route path="users/:id" element={isSuperAdmin || isCapacitador ? <UserProfile /> : <Navigate to="/admin" replace />} />
          {/* La antigua "Vista global" (matriz usuarios × cursos) se fusionó con
              el Panorama de Progreso: mismos datos y mismos filtros, más KPIs y
              exportación. La ruta se conserva porque hay enlaces viejos. */}
          <Route path="overview" element={<Navigate to="/admin/progress?view=modules&tab=overview" replace />} />
          {/* Gamificación: logros + niveles de XP (solo superadmin) */}
          <Route path="gamification" element={isSuperAdmin ? <Gamification /> : <Navigate to="/admin" replace />} />
          {/* Bitácora de actividad del equipo: solo superadmin */}
          <Route path="activity" element={isSuperAdmin ? <ActivityLog /> : <Navigate to="/admin" replace />} />
          {/* Aprobación de eliminaciones (borrado suave de capacitadores): solo superadmin */}
          <Route path="approvals" element={isSuperAdmin ? <DeletionApprovals /> : <Navigate to="/admin" replace />} />
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
        </Routes>
      </div>
      {/* Vale para CUALQUIER vista del panel: avisa si alguien más está aquí. */}
      <ViewPresenceChip />
      <HelpWidget />
    </div>
  )
}
