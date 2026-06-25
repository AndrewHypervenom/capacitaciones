import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

export default function AdminGuard() {
  const { loading, isAuthenticated, isSuperAdmin } = useAuth()

  if (loading) return null

  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />

  return <Outlet />
}
