import { useAuth } from '@/hooks/useAuth';
import LearnerDashboard from './LearnerDashboard';
import StaffDashboard from './StaffDashboard';

// El panel del aprendiz usa el diseño "panel/"; superadmin y capacitador
// conservan la vista original.
export default function Dashboard() {
  const { isAdminOrCapacitador } = useAuth();
  return isAdminOrCapacitador ? <StaffDashboard /> : <LearnerDashboard />;
}
