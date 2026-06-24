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
import ModulePreview from './pages/ModulePreview'
import SimulationList from './pages/SimulationList'
import SimulationEditor from './pages/SimulationEditor'
import ChoiceSimEditor from './pages/ChoiceSimEditor'
import LearningMissions from './pages/LearningMissions'
import Arena from './pages/Arena'
import Worlds from './pages/Worlds'
import WorldDetail from './pages/WorldDetail'
import FeedbackPanel from './pages/FeedbackPanel'

export default function AdminRouter() {
  const { loading, isAuthenticated, isAdmin, isCapacitador, isSuperAdmin } = useAuth()
  const location = useLocation()

  if (loading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />
  if (!isAdmin && !isCapacitador) return <Navigate to="/dashboard" replace />

  // Capacitador: solo accede al módulo de quiz
  const onlyQuiz = isCapacitador && !isAdmin
  const restricted = onlyQuiz ? <Navigate to="/admin/quiz" replace /> : null

  return (
    <div className="flex min-h-screen bg-bg">
      <AdminNav />
      <div className="flex-1 md:ml-56 overflow-auto pt-14 md:pt-0">
        <Routes>
          <Route index element={restricted ?? <AdminDashboard />} />
          <Route path="campaigns" element={restricted ?? <CampaignList />} />
          <Route path="import" element={restricted ?? <ImportContent />} />
          <Route path="modules" element={restricted ?? <ModuleList />} />
          <Route path="modules/new" element={restricted ?? <NewModulePage />} />
          <Route path="modules/:moduleId" element={restricted ?? <ModuleEditor />} />
          <Route path="modules/:moduleId/preview" element={restricted ?? <ModulePreview />} />
          <Route path="users" element={isSuperAdmin ? <UserList /> : <Navigate to="/admin" replace />} />
          <Route path="quiz" element={<LiveQuizAdmin />} />
          <Route path="simulations" element={restricted ?? <SimulationList />} />
          <Route path="simulations/new" element={restricted ?? <SimulationEditor />} />
          <Route path="simulations/:id" element={restricted ?? <SimulationEditor />} />
          <Route path="simulations/choice/new" element={restricted ?? <ChoiceSimEditor />} />
          <Route path="simulations/choice/:id" element={restricted ?? <ChoiceSimEditor />} />
          <Route path="missions" element={restricted ?? <LearningMissions />} />
          <Route path="arena" element={restricted ?? <Arena />} />
          <Route path="worlds" element={restricted ?? <Worlds />} />
          <Route path="worlds/:id" element={restricted ?? <WorldDetail />} />
          <Route path="feedback" element={restricted ?? <FeedbackPanel />} />
        </Routes>
      </div>
    </div>
  )
}
