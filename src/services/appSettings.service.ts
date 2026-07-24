import { supabase } from '@/lib/supabase'

/**
 * Configuración global del sitio (tabla `app_settings`, clave→valor JSON).
 * Hoy solo se usa para `ai_credits_out`, pero queda genérica por si suma más.
 *
 * Nota: `app_settings` es una tabla nueva que aún no está en los tipos generados
 * (`database.ts`), por eso los accesos van con un cliente sin tipar.
 */

const AI_CREDITS_KEY = 'ai_credits_out'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/**
 * Lee si la IA está marcada como "sin créditos" en la base.
 * Devuelve `null` si el ajuste no existe todavía (p. ej. el SQL aún no se corrió),
 * para que el llamador decida el valor por defecto.
 */
export async function getAiCreditsOut(): Promise<boolean | null> {
  const { data, error } = await db
    .from('app_settings')
    .select('value')
    .eq('key', AI_CREDITS_KEY)
    .maybeSingle()

  if (error || !data) return null
  return data.value === true
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
