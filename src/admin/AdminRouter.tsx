import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { usePresenceStore } from '@/stores/presenceStore'
import { AdminNav } from './components/AdminNav'
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

  // Presencia colaborativa en vivo (estilo Google Docs / SharePoint): mientras
  // un miembro del staff esté en el panel, emite su presencia a un canal común
  // para que todos vean quién edita qué. Se desconecta al salir del panel.
  const staff = (isSuperAdmin || isCapacitador) && !!profile
  useEffect(() => {
    if (!staff || !profile) return
    const { connect, disconnect } = usePresenceStore.getState()
    connect('global', {
      user_id: profile.id,
      name: profile.display_name ?? profile.id.slice(0, 8),
      avatar_url: profile.avatar_url ?? null,
    })
    return () => disconnect()
  }, [staff, profile?.id, profile?.display_name, profile?.avatar_url])

  // Mantiene actualizada la "ruta actual" del usuario para el contexto.
  const setRoute = usePresenceStore((s) => s.setRoute)
  useEffect(() => {
    setRoute(location.pathname)
  }, [location.pathname, setRoute])

  if (loading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (!isSuperAdmin && !isCapacitador) return <Navigate to="/dashboard" replace />

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
      <HelpWidget />
    </div>
  )
}
