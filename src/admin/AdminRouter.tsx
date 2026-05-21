import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { AdminNav } from './components/AdminNav'
import AdminDashboard from './pages/AdminDashboard'
import CampaignList from './pages/CampaignList'
import NewModulePage from './pages/NewModulePage'
import UserList from './pages/UserList'
import LiveQuizAdmin from './pages/LiveQuizAdmin'
import ModuleList from './pages/ModuleList'
import ModuleEditor from './pages/ModuleEditor'
import ModulePreview from './pages/ModulePreview'
import SimulationList from './pages/SimulationList'
import SimulationEditor from './pages/SimulationEditor'
import ChoiceSimEditor from './pages/ChoiceSimEditor'
import ModuleGenerator from './pages/ModuleGenerator'

export default function AdminRouter() {
  const { loading, isAuthenticated, isAdmin, isCapacitador } = useAuth()
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
      <div className="flex-1 ml-56 overflow-auto">
        <Routes>
          <Route index element={restricted ?? <AdminDashboard />} />
          <Route path="campaigns" element={restricted ?? <CampaignList />} />
          <Route path="modules" element={restricted ?? <ModuleList />} />
          <Route path="modules/generate" element={restricted ?? <ModuleGenerator />} />
          <Route path="modules/new" element={restricted ?? <NewModulePage />} />
          <Route path="modules/:moduleId" element={restricted ?? <ModuleEditor />} />
          <Route path="modules/:moduleId/preview" element={restricted ?? <ModulePreview />} />
          <Route path="users" element={restricted ?? <UserList />} />
          <Route path="quiz" element={<LiveQuizAdmin />} />
          <Route path="simulations" element={restricted ?? <SimulationList />} />
          <Route path="simulations/new" element={restricted ?? <SimulationEditor />} />
          <Route path="simulations/:id" element={restricted ?? <SimulationEditor />} />
          <Route path="simulations/choice/new" element={restricted ?? <ChoiceSimEditor />} />
          <Route path="simulations/choice/:id" element={restricted ?? <ChoiceSimEditor />} />
        </Routes>
      </div>
    </div>
  )
}
