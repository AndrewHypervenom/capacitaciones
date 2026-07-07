import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { AdminNav } from './components/AdminNav'
import AdminDashboard from './pages/AdminDashboard'
import CampaignList from './pages/CampaignList'
import NewModulePage from './pages/NewModulePage'
import ImportContent from './pages/ImportContent'
import UserList from './pages/UserList'
import LiveQuizAdmin from './pages/LiveQuizAdmin'
import ModuleList from './pages/ModuleList'
import ModuleEditor from './pages/ModuleEditor'
import CourseList from './pages/CourseList'
import CourseEditor from './pages/CourseEditor'
import ModulePreview from './pages/ModulePreview'
import SimulationList from './pages/SimulationList'
import SimulationEditor from './pages/SimulationEditor'
import ChoiceSimEditor from './pages/ChoiceSimEditor'
import { TrainerFeedbackPanel } from '@/admin/pages/TrainerFeedbackPanel';
import LearningMissions from './pages/LearningMissions'
import Worlds from './pages/Worlds'
import WorldDetail from './pages/WorldDetail'
import FeedbackPanel from './pages/FeedbackPanel'
import ChatLogs from './pages/ChatLogs'
import { HelpWidget } from '@/components/help/HelpWidget'

export default function AdminRouter() {
  const { loading, isAuthenticated, isCapacitador, isSuperAdmin } = useAuth()
  const location = useLocation()

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
          <Route path="quiz" element={<LiveQuizAdmin />} />
          {/* Historial del chat de ayuda: solo superadmin */}
          <Route path="chat" element={isSuperAdmin ? <ChatLogs /> : <Navigate to="/admin" replace />} />
          <Route path="evaluaciones" element={<TrainerFeedbackPanel />} />
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
          <Route path="feedback" element={<FeedbackPanel />} />
        </Routes>
      </div>
      <HelpWidget />
    </div>
  )
}
