import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { supabase } from '@/lib/supabase'
import type { UserPasskey } from '@/types/database'

/**
 * Ingreso biométrico: huella, Face ID, Windows Hello.
 *
 * Los tres son el mismo estándar (WebAuthn) usando el autenticador del propio
 * dispositivo; por eso no hay un método por cada uno. La app nunca ve la huella
 * ni la cara: el sistema operativo desbloquea una clave privada que jamás sale
 * del equipo y firma un reto que emitió nuestro servidor.
 *
 * El flujo replica lo que hace la banca: primero se entra con contraseña, y una
 * vez dentro se ofrece activar la biometría PARA ESE dispositivo. La contraseña
 * nunca deja de funcionar, porque una passkey se puede perder con el equipo.
 */

/* ─────────────────────────── Errores con causa ──────────────────────────── */

/** Motivos que la interfaz necesita distinguir para decir algo útil. */
export type PasskeyErrorCode =
  | 'unsupported'        // el navegador no habla WebAuthn
  | 'cancelled'          // la persona cerró el diálogo del sistema
  | 'already_registered' // este dispositivo ya estaba dado de alta
  | 'no_credential'      // no hay ninguna passkey utilizable aquí
  | 'expired_challenge'  // se demoró demasiado; hay que reintentar
  | 'inactive_account'   // la cuenta fue dada de baja
  | 'rate_limited'
  | 'failed'             // cualquier otra cosa

export class PasskeyError extends Error {
  code: PasskeyErrorCode
  constructor(code: PasskeyErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'PasskeyError'
    this.code = code
  }
}

/**
 * Traduce el error crudo del navegador a una causa nuestra.
 *
 * `NotAllowedError` es el caso importante y el más traicionero: el navegador lo
 * usa TANTO cuando la persona cancela COMO cuando se agota el tiempo, y nunca
 * dice cuál fue —a propósito, para no filtrar si existía una credencial—. Lo
 * tratamos como cancelación porque es lo que ocurre el 99% de las veces, y
 * porque tratarlo como fallo llenaría la pantalla de errores rojos cada vez que
 * alguien se arrepiente.
 */
function classify(err: unknown): PasskeyError {
  if (err instanceof PasskeyError) return err

  if (err instanceof WebAuthnError) {
    if (err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      return new PasskeyError('already_registered')
    }
    if (err.code === 'ERROR_CEREMONY_ABORTED') return new PasskeyError('cancelled')
    // `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY` deja el error real del navegador
    // en `cause`: ahí es donde aparece el NotAllowedError de una cancelación.
    const causeName = (err.cause as { name?: string } | undefined)?.name
    if (causeName === 'NotAllowedError' || causeName === 'AbortError') {
      return new PasskeyError('cancelled')
    }
    return new PasskeyError('failed', err.message)
  }
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'AbortError') return new PasskeyError('cancelled')
  if (name === 'InvalidStateError') return new PasskeyError('already_registered')

  return new PasskeyError('failed', (err as Error)?.message)
}

/**
 * Errores que devuelven nuestras Edge Functions, ya normalizados.
 *
 * Ojo con `functions.invoke`: cuando la respuesta no es 2xx, `data` llega en
 * null y el motivo se queda en el CUERPO de `error.context`, que es un
 * `Response` sin leer. Sin abrirlo, todo fallo se vería igual de mudo —"no se
 * pudo"— y perderíamos justo lo que hace falta decirle a la persona.
 */
async function fromServer(error: unknown, payload: unknown): Promise<PasskeyError> {
  let code = (payload as { error?: string } | null)?.error ?? ''

  const context = (error as { context?: Response & { status?: number } })?.context
  if (!code && context && typeof context.json === 'function') {
    try {
      const body = await context.clone().json()
      code = (body as { error?: string })?.error ?? ''
      // El servidor manda en `detail` el motivo técnico (RP ID que no cuadra,
      // contador que retrocede, fallo de base de datos). Al usuario no le sirve
      // —y no debe verlo—, pero en la consola ahorra horas de adivinanza.
      const detail = (body as { detail?: string })?.detail
      if (detail) console.warn(`[passkey] ${code || context.status}: ${detail}`)
    } catch { /* cuerpo vacío o no-JSON: nos quedamos con el estado HTTP */ }
  }

  if (code === 'rate_limited') return new PasskeyError('rate_limited')
  if (code === 'inactive_account') return new PasskeyError('inactive_account')
  if (code === 'expired_challenge') return new PasskeyError('expired_challenge')
  if (code === 'unknown_credential') return new PasskeyError('no_credential')

  const status = context?.status
  if (status === 429) return new PasskeyError('rate_limited')
  if (status === 403) return new PasskeyError('inactive_account')
  if (status === 404) return new PasskeyError('no_credential')
  return new PasskeyError('failed', code || (error as Error)?.message)
}

/* ─────────────────────── Soporte del dispositivo ────────────────────────── */

/** ¿Este navegador puede siquiera hablar WebAuthn? */
export function supportsPasskeys(): boolean {
  return browserSupportsWebAuthn()
}

/**
 * ¿Hay un autenticador integrado (huella, Face ID, Hello)?
 *
 * Se comprueba antes de OFRECER el registro: proponerle "activa tu huella" a
 * alguien en un equipo sin lector es prometer algo que no va a funcionar.
 */
export async function hasBiometricSensor(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false
  try {
    return await platformAuthenticatorIsAvailable()
  } catch {
    return false
  }
}

/** ¿El navegador soporta el autocompletado con passkeys en el campo de correo? */
export async function supportsAutofill(): Promise<boolean> {
  try {
    return await browserSupportsWebAuthnAutofill()
  } catch {
    return false
  }
}

/* ───────────────────── Pista local: "aquí ya hay huella" ────────────────── */

/**
 * El botón "Entrar con huella" solo tiene sentido si en ESTE dispositivo hay
 * algo registrado, y eso no se puede preguntar al servidor sin sesión. Se deja
 * una pista local con el correo, que además permite precargarlo.
 *
 * No es un dato sensible ni una credencial: es una comodidad. Si se borra, la
 * persona entra con su contraseña y vuelve a aparecer.
 */
const HINT_KEY = 'passkey:this-device'
const INVITE_KEY = 'passkey:invite-dismissed'

export function passkeyHint(): string | null {
  try {
    return localStorage.getItem(HINT_KEY)
  } catch {
    return null
  }
}

export function rememberPasskeyHint(email: string) {
  try {
    localStorage.setItem(HINT_KEY, email)
  } catch { /* modo incógnito con storage bloqueado: se pierde la comodidad, no la función */ }
}

export function forgetPasskeyHint() {
  try {
    localStorage.removeItem(HINT_KEY)
  } catch { /* ídem */ }
}

/** La invitación a activar la biometría se ofrece una vez; si la rechazan, no se insiste. */
export function inviteDismissed(): boolean {
  try {
    return localStorage.getItem(INVITE_KEY) === '1'
  } catch {
    return true
  }
}

export function dismissInvite() {
  try {
    localStorage.setItem(INVITE_KEY, '1')
  } catch { /* ídem */ }
}

/* ─────────────────────────── Registro (alta) ────────────────────────────── */

/**
 * Da de alta la huella de este dispositivo. Requiere sesión iniciada: es lo que
 * demuestra que quien registra es el dueño de la cuenta.
 */
export async function registerPasskey(email?: string | null): Promise<void> {
  if (!browserSupportsWebAuthn()) throw new PasskeyError('unsupported')

  // Le avisamos al servidor si este equipo tiene sensor propio. Con eso pide la
  // credencial directamente al autenticador de plataforma y Windows deja de
  // interponer su menú de "¿celular por QR, llave USB o…?".
  const platform = await hasBiometricSensor()

  const { data: opt, error: optErr } = await supabase.functions.invoke<{
    options: PublicKeyCredentialCreationOptionsJSON
    error?: string
  }>('passkey-register-options', { body: { platform } })
  if (optErr || !opt?.options) throw await fromServer(optErr, opt)

  let attestation
  try {
    attestation = await startRegistration({ optionsJSON: opt.options })
  } catch (err) {
    throw classify(err)
  }

  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string }>(
    'passkey-register-verify',
    { body: { response: attestation } },
  )
  if (error || !data?.ok) {
    // 409 = el servidor ya tenía esta credencial. Para la persona es lo mismo
    // que si el navegador se lo hubiera dicho: su dispositivo ya está listo.
    const status = (error as { context?: { status?: number } })?.context?.status
    if (status === 409) throw new PasskeyError('already_registered')
    throw await fromServer(error, data)
  }

  if (email) rememberPasskeyHint(email)
}

/* ─────────────────────────── Ingreso (login) ────────────────────────────── */

interface AuthVerifyResponse {
  token_hash?: string
  verification_type?: string
  email?: string
  error?: string
}

/**
 * Entra con huella / Face ID / Windows Hello y deja la sesión abierta.
 *
 * `email` es opcional: sin él, el navegador ofrece las passkeys que tenga
 * guardadas para el sitio y no hay que escribir nada.
 *
 * `useAutofill` activa el modo condicional: en vez de abrir un diálogo, la
 * propuesta aparece dentro del autocompletado del campo de correo. Ese es el
 * detalle que hace que en iOS entrar sea literalmente tocar el campo y mirar el
 * teléfono.
 */
export async function signInWithPasskey(
  options: { email?: string | null; useAutofill?: boolean } = {},
): Promise<{ email: string }> {
  const { email, useAutofill = false } = options
  if (!browserSupportsWebAuthn()) throw new PasskeyError('unsupported')

  // Mismo motivo que en el registro: con sensor propio y una credencial local,
  // el servidor marca las opciones para que el navegador vaya derecho al
  // lector, sin el paso intermedio de "elige una clave de paso".
  // En el modo autocompletado no aplica: ahí manda la lista del navegador.
  const platform = useAutofill ? false : await hasBiometricSensor()

  const { data: opt, error: optErr } = await supabase.functions.invoke<{
    options: PublicKeyCredentialRequestOptionsJSON
    error?: string
  }>('passkey-auth-options', { body: { ...(email ? { email } : {}), platform } })
  if (optErr || !opt?.options) throw await fromServer(optErr, opt)

  let assertion
  try {
    assertion = await startAuthentication({
      optionsJSON: opt.options,
      useBrowserAutofill: useAutofill,
    })
  } catch (err) {
    throw classify(err)
  }

  const { data, error } = await supabase.functions.invoke<AuthVerifyResponse>(
    'passkey-auth-verify',
    { body: { response: assertion } },
  )
  if (error || !data?.token_hash) throw await fromServer(error, data)

  // Aquí se convierte la firma en una sesión de verdad. `verifyOtp` devuelve el
  // mismo par de tokens que un inicio de sesión con contraseña, así que a partir
  // de este punto el resto de la app no distingue cómo entró la persona.
  const { error: otpErr } = await supabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: (data.verification_type ?? 'magiclink') as 'magiclink',
  })
  if (otpErr) throw new PasskeyError('failed', otpErr.message)

  if (data.email) rememberPasskeyHint(data.email)
  return { email: data.email ?? email ?? '' }
}

/* ─────────────────────── Gestión de dispositivos ────────────────────────── */

export async function listMyPasskeys(userId: string): Promise<UserPasskey[]> {
  const { data, error } = await supabase
    .from('user_passkeys')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function renamePasskey(id: string, deviceName: string): Promise<void> {
  const { error } = await supabase
    .from('user_passkeys')
    .update({ device_name: deviceName.trim() || null })
    .eq('id', id)
  if (error) throw error
}

/**
 * Quita el acceso biométrico de un dispositivo.
 *
 * Solo borra NUESTRA copia de la clave pública: la credencial sigue existiendo
 * en el llavero del sistema (iCloud, Google, Windows) hasta que la persona la
 * borre allí. Es un detalle que conviene decirle, o se preguntará por qué su
 * iPhone le sigue ofreciendo la passkey.
 */
export async function deletePasskey(id: string): Promise<void> {
  const { error } = await supabase.from('user_passkeys').delete().eq('id', id)
  if (error) throw error
}

/** Dispositivos de otra persona. La RLS solo se lo permite al superadmin. */
export async function listPasskeysOf(userId: string): Promise<UserPasskey[]> {
  return listMyPasskeys(userId)
}

/** Cuántos dispositivos tiene cada usuario, para el listado del panel. */
export async function passkeyCounts(
  userIds: string[],
): Promise<Record<string, { count: number; lastUsedAt: string | null }>> {
  if (!userIds.length) return {}
  const { data, error } = await supabase.rpc('get_passkey_counts', { user_ids: userIds })
  if (error) return {}
  const out: Record<string, { count: number; lastUsedAt: string | null }> = {}
  for (const row of data ?? []) {
    out[row.user_id] = { count: row.passkeys, lastUsedAt: row.last_used_at }
  }
  return out
}
