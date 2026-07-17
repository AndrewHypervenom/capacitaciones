
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FolderX } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { useHasNoCampaigns } from '@/hooks/useHasNoCampaigns'

import { AdminNav } from './components/AdminNav'
import { ViewPresenceChip } from '@/components/presence/ViewPresenceChip'
import AdminDashboard from './pages/AdminDashboard'
import CampaignList from './pages/CampaignList'
import NewModulePage from './pages/NewModulePage'
import ImportContent from './pages/ImportContent'
import UserList from './pages/UserList'
import UserProfile from './pages/UserProfile'
import AdminOverview from './pages/AdminOverview'
import LiveQuizAdmin from './pages/LiveQuizAdmin'
import ModuleList from './pages/ModuleList'
import ModuleEditor from './pages/ModuleEditor'
import CourseList from './pages/CourseList'
import CourseEditor from './pages/CourseEditor'
import ModulePreview from './pages/ModulePreview'
import SimulationList from './pages/SimulationList'
import SimulationEditor from './pages/SimulationEditor'
import ChoiceSimEditor from './pages/ChoiceSimEditor'
import ProgressHub from './pages/ProgressHub'
import LearningMissions from './pages/LearningMissions'
import Worlds from './pages/Worlds'
import WorldDetail from './pages/WorldDetail'
import ChatLogs from './pages/ChatLogs'
import AiUsage from './pages/AiUsage'
import Gamification from './pages/Gamification'
import ActivityLog from './pages/ActivityLog'
import DeletionApprovals from './pages/DeletionApprovals'
import { HelpWidget } from '@/components/help/HelpWidget'

export default function AdminRouter() {
  const { loading, isAuthenticated, isCapacitador, isSuperAdmin } = useAuth()
  const location = useLocation()
  const profile = useAuthStore((s) => s.profile)
  const { t } = useTranslation()
  const noCampaigns = useHasNoCampaigns()

  // La presencia colaborativa ahora es global (PresenceSync en App.tsx):
  // todos los roles emiten su vista actual desde cualquier parte del sitio.

  if (loading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (!isSuperAdmin && !isCapacitador) return <Navigate to="/dashboard" replace />

  // Sin campañas no hay nada que gestionar: todas las vistas del panel filtran
  // por campaña y quedarían vacías o, peor, invitando a crear contenido sin
  // destino. Mejor decirlo de frente.
  if (noCampaigns) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
          <FolderX className="mx-auto mb-4 h-10 w-10 text-text-subtle" />
          <h1 className="text-[18px] font-bold text-text">{t('admin.no_campaigns.title')}</h1>
          <p className="mt-2 text-[13px] text-text-muted">{t('admin.no_campaigns.desc')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <AdminNav />
      <div className="flex-1 md:ml-56 overflow-auto pt-14 md:pt-0">
        <Routes>
          <Route index element={<AdminDashboard />} />
          <Route path="campaigns" element={<CampaignList />} />
          <Route path="import" element={<ImportContent />} />
          <Route path="courses" element={<CourseList />} />
          <Route path="courses/:courseId" element={<CourseEditor />} />
          <Route path="modules" element={<ModuleList />} />
          <Route path="modules/new" element={<NewModulePage />} />
          <Route path="modules/:moduleId" element={<ModuleEditor />} />
          <Route path="modules/:moduleId/preview" element={<ModulePreview />} />
          {/* Usuarios: superadmin (todo) y capacitador (solo su campaña, lectura + asignar cursos) */}
          <Route path="users" element={isSuperAdmin || isCapacitador ? <UserList /> : <Navigate to="/admin" replace />} />
          <Route path="users/:id" element={isSuperAdmin || isCapacitador ? <UserProfile /> : <Navigate to="/admin" replace />} />
          {/* Panel global (matriz usuarios × cursos): solo superadmin */}
          <Route path="overview" element={isSuperAdmin ? <AdminOverview /> : <Navigate to="/admin" replace />} />
          {/* Gamificación: logros + niveles de XP (solo superadmin) */}
          <Route path="gamification" element={isSuperAdmin ? <Gamification /> : <Navigate to="/admin" replace />} />
          {/* Bitácora de actividad del equipo: solo superadmin */}
          <Route path="activity" element={isSuperAdmin ? <ActivityLog /> : <Navigate to="/admin" replace />} />
          {/* Aprobación de eliminaciones (borrado suave de capacitadores): solo superadmin */}
          <Route path="approvals" element={isSuperAdmin ? <DeletionApprovals /> : <Navigate to="/admin" replace />} />
          <Route path="quiz" element={<LiveQuizAdmin />} />
          {/* Historial del chat de ayuda: solo superadmin */}
          <Route path="chat" element={isSuperAdmin ? <ChatLogs /> : <Navigate to="/admin" replace />} />
          {/* Panel de uso de IA y costos: solo superadmin */}
          <Route path="ai-usage" element={isSuperAdmin ? <AiUsage /> : <Navigate to="/admin" replace />} />
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
