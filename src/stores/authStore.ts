import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import type { Profile } from '@/types/database'
import { supabase } from '@/lib/supabase'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  setSession: (session: Session | null) => void
  setProfile: (profile: Profile | null) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  profile: null,
  loading: true,
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile }),
  setLoading: (loading) => set({ loading }),
  reset: () => set({ session: null, profile: null, loading: false }),
}))

// Inicializa la sesión y escucha cambios de auth
export function initAuth() {
  supabase.auth.getSession().then(({ data: { session } }) => {
    useAuthStore.getState().setSession(session)
    if (session) {
      fetchProfile(session.user.id)
    } else {
      useAuthStore.getState().setLoading(false)
    }
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    useAuthStore.getState().setSession(session)
    if (session) {
      fetchProfile(session.user.id)
    } else {
      useAuthStore.getState().setProfile(null)
      useAuthStore.getState().setLoading(false)
    }
  })
}

async function fetchProfile(userId: string) {
  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  let profile = existing ?? null

  // Si no tiene campaña asignada, auto-asignar la primera campaña activa
  const needsCampaign = !profile?.campaign_id && profile?.role !== 'superadmin'

  if (needsCampaign) {
    const { data: campaignRows } = await supabase
      .from('campaigns')
      .select('id')
      .eq('is_active', true)
      .order('created_at')
      .limit(1)

    const activeCampaign = campaignRows?.[0] ?? null

    if (activeCampaign?.id) {
      if (profile) {
        // Perfil existe pero sin campaña → asignar
        await supabase
          .from('profiles')
          .update({ campaign_id: activeCampaign.id })
          .eq('id', userId)
        profile = { ...profile, campaign_id: activeCampaign.id }
      } else {
        // No existe perfil → crear uno como learner con la campaña activa
        const { data: newProfile } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            campaign_id: activeCampaign.id,
            role: 'learner',
            language: 'es',
          })
          .select('*')
          .single()
        profile = newProfile ?? null
      }
    }
  }

  useAuthStore.getState().setProfile(profile)
  useAuthStore.getState().setLoading(false)
}
