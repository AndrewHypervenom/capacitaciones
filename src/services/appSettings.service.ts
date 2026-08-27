import { supabase } from '@/lib/supabase'

/**
 * Configuración global del sitio (tabla `app_settings`, clave→valor JSON).
 * Hoy guarda `ai_credits_out` y `default_user_password`.
 *
 * Nota: `app_settings` es una tabla nueva que aún no está en los tipos generados
 * (`database.ts`), por eso los accesos van con un cliente sin tipar.
 */

const AI_CREDITS_KEY = 'ai_credits_out'
const DEFAULT_PASSWORD_KEY = 'default_user_password'

/** Mínimo que exige el onboarding para una contraseña. */
export const MIN_DEFAULT_PASSWORD_LENGTH = 8

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/** Resultado de leer el flag global de créditos. */
export interface AiCreditsRead {
  /** `true`/`false` según la base; `null` si el ajuste no existe todavía. */
  value: boolean | null
  /** `true` si la lectura falló (RLS, red, tabla ausente): NO sabemos el estado. */
  failed: boolean
}

/**
 * Lee si la IA está marcada como "sin créditos" en la base.
 *
 * Distingue tres cosas que antes se confundían en un solo `null`:
 * el ajuste dice algo, el ajuste no existe, o no se pudo leer. Sin esa
 * distinción un fallo de RLS parecía "no hay créditos" y el aviso se quedaba
 * pegado para siempre.
 */
export async function getAiCreditsOut(): Promise<AiCreditsRead> {
  const { data, error } = await db
    .from('app_settings')
    .select('value')
    .eq('key', AI_CREDITS_KEY)
    .maybeSingle()

  if (error) {
    console.warn('[app_settings] no se pudo leer ai_credits_out:', error.message ?? error)
    return { value: null, failed: true }
  }
  if (!data) return { value: null, failed: false }
  return { value: data.value === true, failed: false }
}

/** Prende/apaga el flag global (solo superadmin lo logra pasar la RLS). */
export async function setAiCreditsOut(out: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await db
    .from('app_settings')
    .upsert(
      { key: AI_CREDITS_KEY, value: out, updated_at: new Date().toISOString(), updated_by: user?.id ?? null },
      { onConflict: 'key' },
    )
  if (error) throw error
}

/**
 * Marca el flag global como "sin créditos" (solo puede ENCENDERLO). Vía RPC
 * SECURITY DEFINER, así cualquier usuario autenticado que choque con el error de
 * saldo lo puede activar para todos, pero apagarlo sigue siendo del superadmin.
 * Best-effort: si falla (RPC no desplegado, red), no rompe nada.
 */
export async function reportAiCreditsOut(): Promise<void> {
  try {
    await db.rpc('mark_ai_credits_out')
  } catch {
    /* silencioso: el estado local ya muestra el aviso igual */
  }
}

/**
 * Contraseña predeterminada para usuarios nuevos. Si está activada, todos los
 * usuarios que se creen (alta individual y carga masiva) nacen con ella, así no
 * hay que repartir una contraseña temporal distinta por chat. Si se desactiva,
 * cada usuario vuelve a recibir su temporal aleatoria.
 *
 * Quien decide es la Edge Function (lee esta misma clave con service_role); acá
 * solo se administra el ajuste.
 */
export interface DefaultPasswordSetting {
  enabled: boolean
  password: string
}

/** `null` si el ajuste no existe todavía (p. ej. el SQL aún no se corrió). */
export async function getDefaultPassword(): Promise<DefaultPasswordSetting | null> {
  const { data, error } = await db
    .from('app_settings')
    .select('value')
    .eq('key', DEFAULT_PASSWORD_KEY)
    .maybeSingle()

  if (error || !data) return null
  const value = (data.value ?? {}) as Partial<DefaultPasswordSetting>
  return {
    enabled: value.enabled === true,
    password: typeof value.password === 'string' ? value.password : '',
  }
}

/** Guarda el ajuste (solo superadmin lo logra pasar la RLS). */
export async function setDefaultPassword(setting: DefaultPasswordSetting): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await db.from('app_settings').upsert(
    {
      key: DEFAULT_PASSWORD_KEY,
      value: setting,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    },
    { onConflict: 'key' },
  )
  if (error) throw error
}
