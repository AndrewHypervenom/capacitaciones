/**
 * El correo de una cuenta: comprobarlo y cambiarlo.
 *
 * El correo NO vive en `public.profiles` (ahí solo hay una copia que mantiene un
 * trigger): vive en `auth.users`, y por eso todo lo que lo toca pasa por una
 * Edge Function con service_role.
 */
import { supabase } from '@/lib/supabase'

/** Lo que la Edge Function averiguó sobre un correo que ya tiene cuenta. */
export interface ExistingAccount {
  known?: boolean
  orphan?: boolean
  /** Tomado sin que ninguna cuenta lo muestre: cambio sin confirmar o correo anterior. */
  ghost?: boolean
  reason?: 'pending_change' | 'old_identity'
  currentEmail?: string | null
  displayName?: string | null
  role?: string | null
  campaignName?: string | null
  isActive?: boolean
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
  }
}

/**
 * ¿Se puede usar ese correo? Va contra `auth.users` —donde vive el correo de
 * verdad— e incluye los casos en que está tomado sin que ninguna cuenta lo
 * muestre: un cambio sin confirmar, o el correo anterior de alguien, que queda
 * guardado en su identidad.
 *
 * `available: null` significa "no se sabe" (sin red, o una Edge Function
 * anterior a este soporte, que ignoraría `mode` y crearía la cuenta): quien
 * llama no debe bloquear nada, el servidor volverá a decidir al guardar.
 */
export async function checkEmailAvailable(
  email: string,
): Promise<{ available: boolean | null; existing?: ExistingAccount }> {
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
      {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ mode: 'check', email: email.trim().toLowerCase() }),
      },
    )
    const json = await res.json()
    if (!res.ok || typeof json.available !== 'boolean') return { available: null }
    return { available: json.available, existing: json.existing }
  } catch {
    return { available: null }
  }
}

/** Un fallo del cambio de correo que el panel sabe explicar mejor que el texto crudo. */
export class EmailChangeError extends Error {
  code: string
  existing?: ExistingAccount
  constructor(code: string, message: string, existing?: ExistingAccount) {
    super(message)
    this.code = code
    this.existing = existing
  }
}

/**
 * Cambia el correo con el que una persona inicia sesión (solo superadmin).
 *
 * Su contraseña no cambia. El correo anterior queda LIBRE: la Edge Function lo
 * mueve en `auth.users` y en la identidad a la vez, que es justo lo que no hace
 * el cambio a mano desde el panel de Supabase.
 */
export async function updateUserEmail(userId: string, email: string): Promise<string> {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-user-email`,
    {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ userId, email: email.trim().toLowerCase() }),
    },
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new EmailChangeError(
      String(json?.error ?? 'error'),
      String(json?.error ?? 'No se pudo cambiar el correo'),
      json?.existing,
    )
  }
  return String(json.email ?? email)
}
