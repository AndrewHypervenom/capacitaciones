import { useAuthStore } from '@/stores/authStore'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'

export function useAuth() {
  const { session, profile, loading } = useAuthStore()
  // Dentro de la vista previa la app trata a quien mira como aprendiz: si no,
  // las pantallas del aprendiz muestran sus atajos de staff (el mundo del CMS,
  // el ViewSwitcher…) y la "vista previa" no sería lo que ve el aprendiz.
  // El rol REAL sigue disponible en useAuthStore para quien lo necesite
  // (p. ej. `useModules`, que solo al staff le muestra borradores).
  const role = IS_LEARNER_PREVIEW ? 'learner' : (profile?.role ?? null)

  return {
    user: session?.user ?? null,
    profile,
    loading,
    onboarded: profile?.onboarded ?? true,
    isAuthenticated: !!session,
    role,
    campaignId: profile?.campaign_id ?? null,
    isSuperAdmin: role === 'superadmin',
    isCapacitador: role === 'capacitador',
    // Dar de alta aprendices NO viene con el rol de capacitador: el superadmin
    // lo concede persona por persona. Sin el permiso, el panel no ofrece los
    // botones de alta (y las Edge Functions rechazan igual a quien insista).
    canCreateLearners:
      role === 'superadmin' || (role === 'capacitador' && profile?.can_create_learners === true),
    // Aprobar la publicación de un curso tampoco viene con el rol: el
    // superadmin siempre puede, y designa a mano qué capacitador más puede
    // (profiles.can_approve_courses, desde /admin/users). Sin el permiso, el
    // editor solo ofrece "Solicitar aprobación" y un trigger de la base
    // rechaza a quien lo intente por otra vía.
    canApproveCourses:
      role === 'superadmin' || (role === 'capacitador' && profile?.can_approve_courses === true),
    // Puede acceder al panel admin (aunque con permisos restringidos)
    isAdminOrCapacitador: role === 'superadmin' || role === 'capacitador',
    displayName: profile?.display_name ?? session?.user?.email ?? '',
    avatarUrl: profile?.avatar_url ?? null,
    country: profile?.country ?? 'CO',
    language: profile?.language ?? 'es',
  }
}
