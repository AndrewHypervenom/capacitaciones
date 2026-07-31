import { create } from 'zustand'
import { isAuthApiError, type Session } from '@supabase/supabase-js'
import type { Profile } from '@/types/database'
import { supabase } from '@/lib/supabase'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /**
   * La cuenta está dada de baja (Talento Humano ya no la reporta). Se expulsa la
   * sesión y el login lo explica en vez de mostrar un genérico "credenciales
   * inválidas": la persona no se equivocó de contraseña.
   */
  inactiveAccount: boolean
  /**
   * HAY sesión válida pero el perfil no se pudo LEER (red caída, 5xx, timeout).
   * Es distinto de "no tiene perfil": aquí la sesión se conserva y la app ofrece
   * reintentar. Antes este caso terminaba en `signOut` y se vivía como "la
   * sesión se expiró sola" — ver `fetchProfile`.
   */
  profileUnavailable: boolean
  setSession: (session: Session | null) => void
  setProfile: (profile: Profile | null) => void
  setLoading: (loading: boolean) => void
  setInactiveAccount: (value: boolean) => void
  /** Vuelve a intentar leer el perfil conservando la sesión. */
  retryProfile: () => void
  reset: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  profile: null,
  loading: true,
  inactiveAccount: false,
  profileUnavailable: false,
  setSession: (session) => set({ session }),
  setProfile: (profile) => set({ profile, profileUnavailable: false }),
  setLoading: (loading) => set({ loading }),
  setInactiveAccount: (value) => set({ inactiveAccount: value }),
  retryProfile: () => {
    const session = useAuthStore.getState().session
    if (!session) return
    set({ profileUnavailable: false, loading: true })
    void fetchProfile(session.user.id)
  },
  reset: () => set({ session: null, profile: null, loading: false, profileUnavailable: false }),
}))

/**
 * ¿El servidor RECHAZÓ la credencial, o simplemente no pudimos hablar con él?
 *
 * Es la distinción que decide si cerrar sesión. Un `AuthApiError` con 400/401/403
 * es el servidor diciendo "este token no vale" (refresh token muerto, cuenta
 * baneada): la sesión está acabada de verdad. Cualquier otra cosa —fallo de
 * fetch, DNS, offline, 502/504 de Supabase, un 5xx del servidor de auth— NO
 * prueba nada sobre la sesión, y borrarla por eso es lo que sacaba a la gente de
 * la app con un simple parpadeo de red.
 */
function isCredentialRejected(error: unknown): boolean {
  if (!isAuthApiError(error)) return false
  const status = error.status ?? 0
  return status === 400 || status === 401 || status === 403
}

/** La sesión está muerta: limpiar local y dejar que el router mande a login. */
async function killSession() {
  await supabase.auth.signOut({ scope: 'local' })
  useAuthStore.getState().reset()
}

// initAuth se llama desde un useEffect: en desarrollo (StrictMode) se monta dos
// veces y duplicaría la suscripción y los listeners.
let started = false

// Inicializa la sesión y escucha cambios de auth
export function initAuth() {
  if (started) return
  started = true

  supabase.auth
    .getSession()
    .then(async ({ data: { session }, error }) => {
      if (error) {
        // Solo un rechazo explícito mata la sesión. Si fue la red, no tocamos el
        // token guardado: al recuperar conexión y recargar, la sesión sigue ahí.
        if (isCredentialRejected(error)) {
          await killSession()
          return
        }
        useAuthStore.getState().setLoading(false)
        return
      }
      if (!session) {
        useAuthStore.getState().setLoading(false)
        return
      }

      // Publicamos la sesión ANTES de validarla: si la validación no se puede
      // hacer por falta de red, la persona sigue dentro (supabase-js reintenta
      // el refresco por su cuenta) en vez de quedar fuera por un fallo ajeno.
      useAuthStore.getState().setSession(session)

      // getSession() devuelve el token guardado aunque esté vencido y su refresh
      // token ya no exista. Validamos contra el servidor: si el token está
      // muerto, toda llamada a la BD fallaría (401/400), así que limpiamos y
      // mandamos a login limpio en lugar de mostrar errores sueltos.
      const { error: userError } = await supabase.auth.getUser()
      if (userError && isCredentialRejected(userError)) {
        await killSession()
        return
      }

      void fetchProfile(session.user.id)
    })
    .catch(() => {
      // Excepción de transporte (offline, CORS, bloqueador): no es motivo para
      // borrar la sesión. Quedamos sin sesión en memoria —el router lleva a
      // login— pero el token sobrevive para el siguiente intento.
      useAuthStore.getState().setLoading(false)
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

    // TOKEN_REFRESHED llega solo, cada ~hora, mientras la app está abierta. El
    // refresco cambia el token, no el perfil: releerlo no aportaba nada y sí
    // añadía —cada hora— una consulta cuyo fallo acababa cerrando la sesión.
    if (event === 'TOKEN_REFRESHED') return

    if (session) {
      // Ya tenemos el perfil de esta misma persona (INITIAL_SESSION y SIGNED_IN
      // se solapan con la carga de initAuth, y volver a la pestaña puede
      // reemitir eventos): no hay nada que releer.
      if (useAuthStore.getState().profile?.id === session.user.id) return
      void fetchProfile(session.user.id)
    } else {
      useAuthStore.getState().setProfile(null)
      useAuthStore.getState().setLoading(false)
    }
  })

  // Si nos quedamos sin perfil por un fallo de red, reintentar solo en cuanto
  // vuelva la conexión o la pestaña, sin esperar a que la persona pulse nada.
  if (typeof window !== 'undefined') {
    window.addEventListener('online', retryIfStuck)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') retryIfStuck()
    })
  }
}

function retryIfStuck() {
  const { session, profile, profileUnavailable } = useAuthStore.getState()
  if (session && !profile && profileUnavailable) void fetchProfile(session.user.id)
}

// Reintentos escalonados de la lectura del perfil (ms). Cubren el bache típico
// de red o el 502 puntual sin dejar la pantalla en blanco esperando.
const PROFILE_RETRY_DELAYS_MS = [600, 1800, 4000]

// Solo la última carga de perfil manda: evita que una respuesta vieja (o el
// reintento de una sesión anterior) pise el perfil recién cargado.
let profileRequest = 0

/** Se conserva la sesión y la app ofrece reintentar (ver `profileUnavailable`). */
function giveUp(reason: string) {
  console.warn('[auth] no se pudo cargar el perfil:', reason)
  useAuthStore.setState({ profileUnavailable: true, loading: false })
}

async function fetchProfile(userId: string, attempt = 0) {
  const seq = ++profileRequest
  const { data: existing, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (seq !== profileRequest) return // llegó una carga más nueva

  /* Antes este error se IGNORABA: `existing` venía undefined, el código lo leía
   * como "esta cuenta no tiene perfil" y acababa en el signOut del final. Es
   * decir: un parpadeo de red te sacaba de la app. Ahora un error de lectura no
   * concluye nada — se reintenta y, si no hay manera, se conserva la sesión. */
  if (error) {
    if (attempt < PROFILE_RETRY_DELAYS_MS.length) {
      const delay = PROFILE_RETRY_DELAYS_MS[attempt]
      setTimeout(() => {
        if (seq === profileRequest) void fetchProfile(userId, attempt + 1)
      }, delay)
      return
    }
    giveUp(error.message)
    return
  }

  let profile = existing ?? null

  /* Cuenta dada de baja: fuera. El bloqueo real vive en la cuenta de auth (la
   * Edge Function `set-user-status` la banea), pero un token ya emitido sigue
   * siendo válido hasta que expire; este guard cierra esa ventana en el momento
   * en que la app vuelve a leer el perfil. */
  if (profile && profile.is_active === false) {
    useAuthStore.getState().setInactiveAccount(true)
    useAuthStore.getState().setProfile(null)
    useAuthStore.getState().setLoading(false)
    await supabase.auth.signOut({ scope: 'local' })
    return
  }

  // Un perfil SIN campaña se respeta tal cual: significa que el superadmin se la
  // quitó, y quedarse sin campaña es el resultado esperado (panel vacío, sin
  // crear contenido). Antes se auto-asignaba aquí la primera campaña activa, lo
  // que devolvía el acceso en el siguiente inicio de sesión a quien acababa de
  // perderlo — y encima a una campaña arbitraria.
  //
  // La auto-asignación sobrevive solo para el alta nueva (aún sin perfil), que
  // necesita una campaña para aterrizar en algún lado.
  if (!profile) {
    const { data: campaignRows, error: campaignError } = await supabase
      .from('campaigns')
      .select('id')
      .eq('is_active', true)
      .order('created_at')
      .limit(1)

    // Mismo criterio que arriba: si no pudimos consultar, no sabemos si hay que
    // crear perfil. Conservamos la sesión en vez de cerrarla por las dudas.
    if (campaignError) {
      giveUp(campaignError.message)
      return
    }

    const activeCampaign = campaignRows?.[0] ?? null

    if (activeCampaign?.id) {
      const { data: newProfile, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: userId,
          campaign_id: activeCampaign.id,
          role: 'learner',
          language: 'es',
        })
        .select('*')
        .single()
      if (insertError) {
        giveUp(insertError.message)
        return
      }
      profile = newProfile ?? null
    }
  }

  if (seq !== profileRequest) return

  useAuthStore.getState().setProfile(profile)
  useAuthStore.getState().setLoading(false)

  // Aquí sí concluye algo: la lectura FUNCIONÓ y no hay perfil ni campaña donde
  // crearlo (usuario borrado). Limpiamos la sesión para que el router redirija
  // al login limpio en lugar de quedar en pantalla en blanco.
  if (!profile) {
    supabase.auth.signOut({ scope: 'local' })
  }
}
