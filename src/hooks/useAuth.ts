import { useAuthStore } from '@/stores/authStore'

export function useAuth() {
  const { session, profile, loading } = useAuthStore()
  const role = profile?.role ?? null

  return {
    user: session?.user ?? null,
    profile,
    loading,
    onboarded: profile?.onboarded ?? true,
    isAuthenticated: !!session,
    role,
    campaignId: profile?.campaign_id ?? null,
    isSuperAdmin: role === 'superadmin',
    isAdmin: role === 'admin' || role === 'superadmin',
    isCapacitador: role === 'capacitador',
    // Puede acceder al panel admin (aunque con permisos restringidos)
    isAdminOrCapacitador: role === 'superadmin' || role === 'admin' || role === 'capacitador',
    displayName: profile?.display_name ?? session?.user?.email ?? '',
    country: profile?.country ?? 'CO',
    language: profile?.language ?? 'es',
  }
}
