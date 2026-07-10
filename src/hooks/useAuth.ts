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
    isCapacitador: role === 'capacitador',
    // Puede acceder al panel admin (aunque con permisos restringidos)
    isAdminOrCapacitador: role === 'superadmin' || role === 'capacitador',
    displayName: profile?.display_name ?? session?.user?.email ?? '',
    avatarUrl: profile?.avatar_url ?? null,
    country: profile?.country ?? 'CO',
    language: profile?.language ?? 'es',
  }
}
