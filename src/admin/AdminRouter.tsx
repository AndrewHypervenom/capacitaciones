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
          <Route path="modules/new" element={restricted ?? <NewModulePage />} />
          <Route path="modules/:moduleId" element={restricted ?? <ModuleEditor />} />
          <Route path="modules/:moduleId/preview" element={restricted ?? <ModulePreview />} />
          <Route path="users" element={restricted ?? <UserList />} />
          <Route path="quiz" element={<LiveQuizAdmin />} />
        </Routes>
      </div>
    </div>
  )
}
