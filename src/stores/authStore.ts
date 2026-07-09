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
  supabase.auth
    .getSession()
    .then(async ({ data: { session }, error }) => {
      // Refresh token inválido/ausente (sesión muerta en el servidor): limpiar la
      // sesión local en vez de quedar en un estado roto reintentando renovar.
      if (error) {
        await supabase.auth.signOut({ scope: 'local' })
        useAuthStore.getState().reset()
        return
      }
      if (!session) {
        useAuthStore.getState().setLoading(false)
        return
      }
      // getSession() devuelve el token guardado aunque esté vencido y su refresh
      // token ya no exista. Validamos contra el servidor: si no se puede renovar,
      // la sesión está muerta y toda llamada a la BD fallaría (401/400). En ese
      // caso limpiamos y mandamos a login limpio en vez de mostrar errores sueltos.
      const { error: userError } = await supabase.auth.getUser()
      if (userError) {
        await supabase.auth.signOut({ scope: 'local' })
        useAuthStore.getState().reset()
        return
      }
      useAuthStore.getState().setSession(session)
      fetchProfile(session.user.id)
    })
    .catch(() => {
      void supabase.auth.signOut({ scope: 'local' })
      useAuthStore.getState().reset()
    })

  supabase.auth.onAuthStateChange((event, session) => {
    // Fallo al renovar el token: Supabase emite SIGNED_OUT con session=null.
    // Dejamos que el flujo de "sin sesión" de abajo limpie el perfil y redirija.
    useAuthStore.getState().setSession(session)
    // USER_UPDATED se dispara al cambiar la contraseña (onboarding). Re-leer el
    // perfil aquí provoca una carrera que pisa el onboarded=true recién marcado,
    // haciendo que la pantalla de "Crea tu contraseña" reaparezca un instante.
    // El cambio de contraseña no altera el perfil, así que no hace falta releerlo.
    if (event === 'USER_UPDATED') return
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

  // Sesión sin perfil (usuario borrado o sin campaña activa): limpiar sesión localmente
  // para que el router redirija al login limpio en lugar de quedar en pantalla en blanco.
  if (!profile) {
    supabase.auth.signOut({ scope: 'local' })
  }
}
