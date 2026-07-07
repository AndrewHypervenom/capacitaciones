import LearnerDashboard from './LearnerDashboard';
import { useAuth } from '@/hooks/useAuth';

// Todos (aprendiz, capacitador, superadmin) usan el mismo diseño de panel.
// El aprendiz trae el menú lateral de secciones; superadmin y capacitador lo
// omiten porque navegan desde su Navbar superior de staff.
export default function Dashboard() {
  const { isAdminOrCapacitador } = useAuth();
  return <LearnerDashboard hideSidebar={isAdminOrCapacitador} />;
}
