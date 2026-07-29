import { supabase } from '@/lib/supabase'

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signUpWithEmail(email: string, password: string, displayName: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data
}

export async function updateProfile(
  userId: string,
  updates: {
    display_name?: string | null
    country?: string | null
    language?: string | null
    avatar_url?: string | null
    phone?: string | null
    national_id?: string | null
    job_title?: string | null
    bio?: string | null
  },
) {
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()
  if (error) throw error
  return data
}

// Un avatar se muestra a lo sumo a ~96px; guardar el original (hasta 3 MB) hace
// que cada carga de la lista de usuarios descargue megas inútiles. Reescalamos a
// 256px y comprimimos a JPEG antes de subir → normalmente 15–40 KB por foto.
export const AVATAR_MAX_PX = 256
const AVATAR_QUALITY = 0.82

/**
 * Reescala una imagen (File o Blob) a 256px máx. y la comprime a JPEG. Devuelve el
 * blob optimizado, o el original si no se puede rasterizar o no se reduce el peso.
 * Se reutiliza tanto en la subida normal como en la recompresión masiva.
 */
export async function downscaleImage(file: Blob): Promise<Blob> {
  // GIF/SVG no conviene rasterizarlos (perderían animación/vector): se dejan igual.
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, AVATAR_MAX_PX / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, 'image/jpeg', AVATAR_QUALITY),
    )
    // Si el reescalado no reduce el peso, nos quedamos con el original.
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file // navegador sin soporte o formato raro (HEIC, etc.) → original
  }
}

// Sube la foto de perfil al bucket `avatars` bajo la carpeta del propio usuario
// (`<uid>/...`, requisito de las políticas RLS) y devuelve la URL pública.
// La imagen se optimiza en el cliente y se cachea 1 año (el nombre es único por
// timestamp, así que es seguro tratarla como inmutable).
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const optimized = await downscaleImage(file)
  const isJpeg = optimized.type === 'image/jpeg'
  const ext = isJpeg ? 'jpg' : (file.name.split('.').pop() ?? 'jpg').toLowerCase()
  const path = `${userId}/avatar-${Date.now()}.${ext}`
  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, optimized, {
      contentType: optimized.type || file.type,
      upsert: true,
      cacheControl: '31536000', // 1 año
    })
  if (error) throw error
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

// Cambia la contraseña del usuario autenticado vía Supabase Auth.
export async function changePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

/* ══════════════ Restablecimiento de contraseña desde el login ══════════════ */

/** Ruta a la que apunta el enlace del correo. Debe estar en la lista blanca de
 *  "Redirect URLs" del proyecto de Supabase, o el enlace rebota al Site URL. */
export const PASSWORD_RESET_PATH = '/reset-password'

export function passwordResetRedirectUrl() {
  return `${window.location.origin}${PASSWORD_RESET_PATH}`
}

/** Motivo por el que un intento de envío no procedió, para traducirlo en la UI. */
export type ResetRequestOutcome = 'sent' | 'rate_limited' | 'not_found'

/**
 * Pide el correo de restablecimiento, pero solo si la cuenta existe.
 *
 * Decisión de producto: antes la respuesta era deliberadamente ambigua ("si
 * existe una cuenta, te llegó un correo") para que nadie pudiera usar esta
 * pantalla como buscador de usuarios registrados. Se cambió a propósito porque
 * dejaba al agente esperando un correo que nunca iba a llegar —normalmente por
 * haber escrito mal su propio correo— sin forma de saberlo.
 *
 * A cambio, la comprobación vive en la Edge Function `check-account-exists`,
 * que limita cuántos correos se pueden consultar por IP y por dirección; esa es
 * ahora la única barrera contra el sondeo masivo.
 */
export async function requestPasswordReset(email: string): Promise<ResetRequestOutcome> {
  const target = email.trim().toLowerCase()

  const { data: check, error: checkError } = await supabase.functions.invoke<{
    exists?: boolean
    error?: string
  }>('check-account-exists', { body: { email: target } })

  // Si el comprobador falla o está limitando, NO seguimos a ciegas: mandar el
  // correo igualmente contradiría lo que la pantalla promete al usuario.
  if (checkError) {
    const status = (checkError as { context?: { status?: number } }).context?.status
    if (status === 429) return 'rate_limited'
    throw checkError
  }
  if (!check?.exists) return 'not_found'

  // El envío se dispara desde el navegador, no desde la Edge Function: PKCE
  // guarda aquí el `code_verifier` que hará falta para canjear el enlace.
  const { error } = await supabase.auth.resetPasswordForEmail(target, {
    redirectTo: passwordResetRedirectUrl(),
  })
  if (!error) return 'sent'

  const status = (error as { status?: number }).status
  const code = (error as { code?: string }).code ?? ''
  if (status === 429 || code.includes('rate_limit') || /rate limit|too many/i.test(error.message)) {
    return 'rate_limited'
  }
  // Cualquier otro fallo (red, proyecto caído) sí es un error real y se propaga.
  throw error
}

/** Por qué falló el canje del enlace, para explicarlo en lenguaje humano. */
export type RecoveryFailure = 'expired' | 'wrong_device' | 'missing'

/**
 * Traduce el error del enlace de recuperación a una de nuestras tres causas.
 * `wrong_device` es específico de PKCE: el `code` es válido pero este navegador
 * no tiene el `code_verifier` porque la solicitud se hizo en otro.
 */
export function classifyRecoveryError(message?: string | null): RecoveryFailure {
  const m = (message ?? '').toLowerCase()
  if (m.includes('code verifier') || m.includes('code_verifier')) return 'wrong_device'
  if (m.includes('expired') || m.includes('invalid') || m.includes('otp')) return 'expired'
  return 'missing'
}

/**
 * Fija la contraseña nueva usando la sesión de recuperación y CIERRA todas las
 * sesiones de la cuenta (`scope: 'global'`).
 *
 * El cierre global es deliberado y es la parte que de verdad protege: si la
 * cuenta estaba comprometida, el atacante pierde su sesión en el mismo instante
 * en que el dueño cambia la contraseña. El precio es que el propio usuario debe
 * volver a entrar —con la contraseña nueva—, lo cual además confirma que la
 * recuerda.
 */
export async function completePasswordReset(newPassword: string) {
  const { data, error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error

  // Si la cuenta aún tenía la contraseña predeterminada, la nueva ya es
  // personal: no tiene sentido volver a mostrar "crea tu contraseña" al entrar.
  // Se hace ANTES de cerrar sesión, que es cuando aún hay permisos para hacerlo,
  // y sin bloquear el éxito del cambio si el update del perfil falla.
  const userId = data.user?.id
  if (userId) {
    try {
      await supabase.from('profiles').update({ onboarded: true }).eq('id', userId)
    } catch { /* el cambio de contraseña ya está hecho: no es motivo de error */ }
  }

  await supabase.auth.signOut({ scope: 'global' })
}
