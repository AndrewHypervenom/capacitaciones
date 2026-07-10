import LearnerDashboard from './LearnerDashboard';

// Todos (aprendiz, capacitador, superadmin) ven el mismo panel de aprendiz, con
// su menú lateral de secciones. Para el staff que mira "como aprendiz" esto es
// clave: la vista debe verse idéntica a la del aprendiz. El botón para volver a
// gestión (ViewSwitcher) vive dentro del propio sidebar del panel.
export default function Dashboard() {
  return <LearnerDashboard />;
}
