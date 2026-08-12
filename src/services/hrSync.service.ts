import { supabase } from '@/lib/supabase'
import { normalizeNationalId, type ExtractedRow } from '@/lib/parseUsersSheet'

/**
 * Altas y bajas de aprendices contra la base de Talento Humano.
 *
 * **La baja se LEE del archivo, nunca se deduce.** Cada fila trae su estado
 * laboral ("Activo", "Retirado", "Desvinculado"…) y eso es lo único que decide:
 *
 *   · estado retirado + tiene cuenta      → BAJA
 *   · estado activo   + no tiene cuenta   → ALTA
 *   · estado activo   + cuenta de baja    → REACTIVACIÓN
 *   · cualquier otro estado (licencia,
 *     vacaciones, incapacidad…)           → no se toca
 *
 * Deliberadamente NO existe la baja por omisión ("no aparece en el archivo, se
 * apaga"): un reporte incompleto, la hoja equivocada o un filtro mal puesto en
 * Excel apagarían cuentas de gente que sigue trabajando. Como consecuencia
 * tampoco hace falta elegir campañas ni acotar el alcance: quien el archivo no
 * menciona simplemente no se toca, y no existe forma de que salga afectado.
 *
 * La baja tampoco borra: marca `profiles.is_active = false`, bloquea el ingreso
 * y saca a la persona de listados y contadores, conservando su historial. Volver
 * a darla de alta recupera ese historial intacto.
 *
 * Nada se aplica solo: la interfaz muestra el resultado fila por fila —incluida
 * la interpretación de cada valor de estado— y el superadmin confirma.
 */

/* ── Datos ─────────────────────────────────────────────────────────────────── */

/** Persona que ya tiene cuenta en el sitio (aprendiz), según `get_hr_roster`. */
export interface RosterPerson {
  id: string
  email: string | null
  display_name: string | null
  national_id: string | null
  campaign_id: string | null
  is_active: boolean
  deactivated_at: string | null
  hr_last_seen_at: string | null
  created_at: string
}

export type SyncAction = 'create' | 'reactivate' | 'unchanged' | 'deactivate' | 'skipped'

export type SyncReason =
  /** El archivo la marca como retirada. */
  | 'retired_in_file'
  /** Retirada en el archivo y sin cuenta: no hay nada que hacer. */
  | 'retired_no_account'
  /** Ya estaba de baja. */
  | 'already_inactive'
  /** Sin correo no se puede crear la cuenta. */
  | 'no_email'
  /** La misma persona viene dos veces en el archivo. */
  | 'duplicate'
  /** Estado que no es alta ni baja (licencia, vacaciones, incapacidad…). */
  | 'status_ignored'
  /** El archivo no dice el estado de esta fila: nunca se da de baja a ciegas. */
  | 'status_unknown'

export interface SyncEntry {
  /** Clave estable para React y para las exclusiones manuales. */
  key: string
  action: SyncAction
  /** Fila del archivo (1-based). Toda entrada viene de una fila del archivo. */
  sourceLine: number
  email: string
  name: string
  nationalId: string
  nationalIdRaw: string
  /** Estado laboral tal como venía en el archivo. */
  status: string
  /**
   * País en código ISO que trae el archivo ('' si no viene o no se reconoce).
   * Solo se aplica a las altas: a quien ya tiene cuenta no se le pisa el perfil.
   */
  country: string
  matchedBy: 'national_id' | 'email' | null
  /** Cuenta existente que corresponde a esta fila. */
  person?: RosterPerson
  reason?: SyncReason
  /**
   * Campaña donde nacerá la cuenta (solo aplica a las altas). Sale de la columna
   * de campaña del archivo si la hay, o del valor por defecto elegido, y el
   * superadmin la puede cambiar persona por persona.
   */
  campaignId: string | null
  /** Nombre de campaña tal como venía en el archivo ('' si no traía columna). */
  campaignRaw: string
  /**
   * Propuesta de si se aplica esta fila. Las **bajas nacen en `false`**: cada una
   * se confirma a mano, porque apagar la cuenta de quien sigue trabajando es el
   * error caro de esta pantalla. El resto nace marcado y se puede desmarcar.
   */
  include: boolean
}

export interface SyncCounts {
  create: number
  reactivate: number
  deactivate: number
  unchanged: number
  skipped: number
}

/* ── Estado laboral del archivo ────────────────────────────────────────────── */

/**
 * Qué hace el sistema con un valor de la columna de estado.
 *
 * `unknown` es el default de todo lo que no reconocemos: no hace nada. Solo un
 * `retired` explícito da de baja, y el superadmin ve y puede corregir cómo se
 * interpretó cada valor antes de aplicar.
 */
export type StatusKind = 'active' | 'retired' | 'ignore' | 'unknown'

/** Ya no está en la empresa. */
const RETIRED_WORDS = [
  'retirado', 'retirada', 'retiro', 'baja', 'inactivo', 'inactiva',
  'desvinculado', 'desvinculada', 'desvinculacion', 'terminado', 'terminada',
  'terminacion', 'cesado', 'egresado', 'liquidado', 'liquidada', 'renuncia',
  'renuncio', 'despido', 'despedido', 'finalizado', 'no activo', 'no vigente',
  'no continua', 'retirado voluntario', 'fin de contrato', 'contrato terminado',
]
/** Sigue en la empresa. */
const ACTIVE_WORDS = [
  'activo', 'activa', 'vigente', 'alta', 'contratado', 'contratada', 'nuevo',
  'nueva', 'ingreso', 'trabajando', 'laborando', 'en nomina', 'planta',
]
/**
 * Ausencias TEMPORALES. Cuentan como "no tocar", nunca como baja: quien está de
 * licencia o incapacidad sigue siendo empleado y al volver debe encontrar su
 * cuenta y su progreso donde los dejó.
 */
const IGNORE_WORDS = [
  'licencia', 'incapacidad', 'incapacitado', 'vacaciones', 'suspendido',
  'suspendida', 'suspension', 'permiso', 'maternidad', 'paternidad', 'luto',
  'comision', 'traslado', 'en proceso', 'pendiente',
]

/** Normaliza un valor de estado para compararlo y para usarlo como llave. */
export function normStatus(value: string): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Interpretación propuesta para un valor de estado. Es solo una propuesta: la
 * interfaz la muestra y deja cambiarla, porque cada empresa nombra distinto sus
 * novedades y adivinar mal una baja es caro.
 */
export function guessStatusKind(value: string): StatusKind {
  const s = normStatus(value)
  if (!s) return 'unknown'
  const hit = (words: string[]) => words.some((w) => s === w || s.includes(w))
  // Las ausencias temporales se revisan primero: "suspensión de contrato" trae
  // la palabra "contrato" y no debe confundirse con "fin de contrato".
  if (hit(IGNORE_WORDS)) return 'ignore'
  if (hit(RETIRED_WORDS)) return 'retired'
  if (hit(ACTIVE_WORDS)) return 'active'
  return 'unknown'
}

/** Valores distintos que trae la columna de estado, con su conteo de filas. */
export function distinctStatusValues(rows: ExtractedRow[]): { value: string; count: number }[] {
  const map = new Map<string, { value: string; count: number }>()
  for (const r of rows) {
    const key = normStatus(r.status)
    if (!key) continue
    const found = map.get(key)
    if (found) found.count++
    else map.set(key, { value: r.status.trim(), count: 1 })
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

/** Interpretación inicial de cada valor del archivo (llave = valor normalizado). */
export function guessStatusKinds(rows: ExtractedRow[]): Record<string, StatusKind> {
  const out: Record<string, StatusKind> = {}
  for (const { value } of distinctStatusValues(rows)) {
    out[normStatus(value)] = guessStatusKind(value)
  }
  return out
}

/* ── Nómina actual del sitio ───────────────────────────────────────────────── */

/**
 * Todos los aprendices con cuenta (activos e inactivos), de todas las campañas.
 * Sirve **solo para reconocer a quién menciona el archivo**: como no hay bajas
 * por omisión, traer a todo el mundo no expone a nadie — al contrario, evita el
 * error de no encontrar a una persona por haber acotado mal el alcance y crearle
 * una cuenta duplicada.
 *
 * El RPC es SECURITY DEFINER y solo responde al superadmin: el correo vive en
 * `auth.users` y no es accesible de otra forma.
 */
export async function getRoster(campaignIds: string[] = []): Promise<RosterPerson[]> {
  const { data, error } = await supabase.rpc('get_hr_roster', {
    p_campaign_ids: campaignIds.length ? campaignIds : null,
  })
  if (error) throw error
  return (data ?? []) as RosterPerson[]
}

/* ── El cruce ──────────────────────────────────────────────────────────────── */

export interface DiffOptions {
  /** Filas del archivo ya interpretadas por `extractRows`. */
  fileRows: ExtractedRow[]
  /** Cuentas que existen hoy, solo para reconocer a quién menciona el archivo. */
  roster: RosterPerson[]
  /**
   * Qué significa cada valor de la columna de estado (llave = valor normalizado
   * con `normStatus`). Lo propone `guessStatusKinds` y lo puede corregir el
   * superadmin. Un valor ausente de este mapa no hace nada.
   */
  statusKinds: Record<string, StatusKind>
  /**
   * Cómo tratar las filas sin estado legible (celda vacía, o archivo sin columna
   * de estado). `'active'` permite altas y reactivaciones; `'unknown'` no hace
   * nada. **Nunca** puede valer `'retired'`: no se da de baja a ciegas.
   */
  missingStatusAs: 'active' | 'unknown'
  /**
   * Campañas por nombre en minúsculas → id, para resolver la columna de campaña
   * del archivo cuando la trae.
   */
  campaignByName?: Map<string, string>
  /** Campaña que reciben las altas cuyo nombre no salió del archivo. */
  defaultCampaignId?: string | null
}

/**
 * Interpreta el archivo y devuelve **una entrada por fila**, con la acción que
 * le corresponde. No escribe nada.
 *
 * Solo el archivo manda: cada fila se procesa por lo que dice su estado. Nadie
 * que el archivo no mencione aparece aquí, así que es imposible que un reporte
 * incompleto dé de baja a quien sigue trabajando.
 *
 * El cruce con las cuentas existentes es por cédula y, si la fila no la trae, por
 * correo: los reportes de TH identifican por documento y el correo corporativo
 * cambia (matrimonios, homónimos, correcciones), así que cruzar solo por correo
 * crearía una cuenta nueva vacía al lado de la que ya existe.
 */
export function diffNovelties({
  fileRows,
  roster,
  statusKinds,
  missingStatusAs,
  campaignByName,
  defaultCampaignId = null,
}: DiffOptions): SyncEntry[] {
  const byNationalId = new Map<string, RosterPerson>()
  const byEmail = new Map<string, RosterPerson>()
  for (const p of roster) {
    const nid = normalizeNationalId(p.national_id ?? '')
    // La primera gana: si dos cuentas comparten cédula (un duplicado viejo), la
    // segunda no se pierde — cae en las bajas por omisión y queda a la vista.
    if (nid && !byNationalId.has(nid)) byNationalId.set(nid, p)
    const mail = (p.email ?? '').trim().toLowerCase()
    if (mail && !byEmail.has(mail)) byEmail.set(mail, p)
  }

  const entries: SyncEntry[] = []
  /** Filas ya vistas (cédula o correo) para detectar repetidos en el archivo. */
  const seenKeys = new Set<string>()

  fileRows.forEach((row, i) => {
    const email = row.email.trim().toLowerCase()
    const nid = row.nationalId
    const dedupeKey = nid ? `n:${nid}` : email ? `e:${email}` : ''
    const key = `f${row.sourceLine}:${i}`
    const campaignRaw = row.campaign.trim()
    const base = {
      key,
      sourceLine: row.sourceLine,
      email,
      name: row.name.trim(),
      nationalId: nid,
      nationalIdRaw: row.nationalIdRaw,
      status: row.status,
      country: row.country,
      campaignRaw,
      // La campaña del archivo manda sobre el valor por defecto; si el nombre no
      // corresponde a ninguna campaña del sitio se usa el default y la interfaz
      // deja corregirlo fila por fila.
      campaignId:
        (campaignRaw ? campaignByName?.get(campaignRaw.toLowerCase()) : undefined) ?? defaultCampaignId,
    }

    // Fila sin nada con lo que identificar a nadie.
    if (!dedupeKey) {
      entries.push({ ...base, action: 'skipped', matchedBy: null, reason: 'no_email', include: false })
      return
    }
    if (seenKeys.has(dedupeKey)) {
      entries.push({ ...base, action: 'skipped', matchedBy: null, reason: 'duplicate', include: false })
      return
    }
    seenKeys.add(dedupeKey)

    const matched = (nid ? byNationalId.get(nid) : undefined) ?? (email ? byEmail.get(email) : undefined)
    const matchedBy: SyncEntry['matchedBy'] = !matched
      ? null
      : nid && byNationalId.get(nid) === matched ? 'national_id' : 'email'

    // Qué dice el archivo de esta persona. Sin estado legible se usa el default
    // elegido, que jamás puede ser "retirada".
    const statusKey = normStatus(row.status)
    const kind: StatusKind = statusKey ? (statusKinds[statusKey] ?? 'unknown') : missingStatusAs

    if (kind === 'retired') {
      if (!matched) {
        entries.push({ ...base, action: 'skipped', matchedBy: null, reason: 'retired_no_account', include: false })
        return
      }
      entries.push(
        matched.is_active
          // `include: false` a propósito: la baja se confirma una por una.
          ? { ...base, action: 'deactivate', matchedBy, person: matched, reason: 'retired_in_file', include: false }
          : { ...base, action: 'skipped', matchedBy, person: matched, reason: 'already_inactive', include: false },
      )
      return
    }

    // Novedad que no es alta ni baja (licencia, vacaciones) o estado que no
    // reconocemos: se muestra, pero no se toca nada.
    if (kind === 'ignore' || kind === 'unknown') {
      entries.push({
        ...base,
        action: 'skipped',
        matchedBy,
        person: matched,
        reason: kind === 'ignore' ? 'status_ignored' : 'status_unknown',
        include: false,
      })
      return
    }

    // Activa según el archivo.
    if (matched) {
      entries.push(
        matched.is_active
          ? { ...base, action: 'unchanged', matchedBy, person: matched, include: true }
          : { ...base, action: 'reactivate', matchedBy, person: matched, include: true },
      )
      return
    }

    // Nadie con esa cédula ni ese correo: es un alta. Sin correo no hay cuenta
    // posible, así que queda a la vista como pendiente de completar.
    entries.push(
      email
        ? { ...base, action: 'create', matchedBy: null, include: true }
        : { ...base, action: 'skipped', matchedBy: null, reason: 'no_email', include: false },
    )
  })

  return entries
}

export function countByAction(entries: SyncEntry[], onlyIncluded = false): SyncCounts {
  const c: SyncCounts = { create: 0, reactivate: 0, deactivate: 0, unchanged: 0, skipped: 0 }
  for (const e of entries) {
    if (onlyIncluded && !e.include) continue
    c[e.action]++
  }
  return c
}

/**
 * A partir de estas bajas en una sola carga, la interfaz pide una confirmación
 * extra. Con las bajas leídas del archivo un número alto puede ser legítimo (un
 * cierre de operación), pero también es la pista de que se mapeó como "estado"
 * una columna que no lo es.
 */
export const CONFIRM_DEACTIVATIONS_OVER = 20

/* ── Aplicar ───────────────────────────────────────────────────────────────── */

const CREATE_CHUNK = 100
const STATUS_CHUNK = 200

export interface ApplyOptions {
  /**
   * Entradas ya resueltas por el superadmin: qué se aplica (`include`) y, en las
   * altas, en qué campaña nace cada persona (`campaignId`).
   */
  entries: SyncEntry[]
  fileName: string
  /** Periodo que representa la nómina, "2026-07". */
  period: string
  reason: string
  onProgress?: (done: number, total: number, phase: 'create' | 'deactivate' | 'reactivate' | 'finish') => void
}

export interface ApplyResult {
  created: { email: string; status: 'created' | 'error'; password?: string; reason?: string }[]
  deactivated: number
  reactivated: number
  unchanged: number
  errors: string[]
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token}`,
  }
}

/**
 * Da de baja (o vuelve a dar de alta) a un grupo de aprendices.
 *
 * Vive en una Edge Function porque además de `profiles` hay que tocar la cuenta
 * de autenticación: sin bloquearla ahí, una persona dada de baja seguiría
 * pudiendo iniciar sesión.
 */
export async function setUsersActive(
  userIds: string[],
  active: boolean,
  reason = '',
): Promise<{ updated: number; skipped: { id: string; reason: string }[] }> {
  if (userIds.length === 0) return { updated: 0, skipped: [] }
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/set-user-status`,
    {
      method: 'POST',
      headers: await authHeader(),
      body: JSON.stringify({ userIds, active, reason }),
    },
  )
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error ?? 'No se pudo cambiar el estado')
  return { updated: json.updated ?? 0, skipped: json.skipped ?? [] }
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * Aplica la sincronización en tandas: primero las altas, luego las bajas y
 * reactivaciones. Cada tanda es independiente, así un archivo de miles de
 * personas no depende de que una sola llamada aguante.
 */
export async function applySync(opts: ApplyOptions): Promise<ApplyResult> {
  const { entries, fileName, period, reason, onProgress } = opts
  const included = entries.filter((e) => e.include)
  const toCreate = included.filter((e) => e.action === 'create')
  const toDeactivate = included.filter((e) => e.action === 'deactivate')
  const toReactivate = included.filter((e) => e.action === 'reactivate')
  const unchanged = included.filter((e) => e.action === 'unchanged')

  const total = toCreate.length + toDeactivate.length + toReactivate.length
  let done = 0
  const result: ApplyResult = { created: [], deactivated: 0, reactivated: 0, unchanged: unchanged.length, errors: [] }

  /* Altas — agrupadas por campaña, porque cada persona puede ir a la suya. Cada
   * grupo reutiliza la carga masiva ya probada (contraseña inicial, credencial
   * temporal y bitácora incluidas). */
  const createByCampaign = new Map<string, SyncEntry[]>()
  for (const e of toCreate) {
    const k = e.campaignId ?? ''
    const list = createByCampaign.get(k) ?? []
    list.push(e)
    createByCampaign.set(k, list)
  }

  for (const [campaign, list] of createByCampaign) {
    for (const group of chunk(list, CREATE_CHUNK)) {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-users-bulk`,
          {
            method: 'POST',
            headers: await authHeader(),
            body: JSON.stringify({
              rows: group.map((e) => ({
                email: e.email,
                display_name: e.name || undefined,
                role: 'learner',
                campaign: campaign || undefined,
                national_id: e.nationalId || undefined,
                country: e.country || undefined,
              })),
            }),
          },
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error ?? 'Error creando usuarios')
        result.created.push(...(json.results ?? []))
      } catch (err) {
        result.errors.push((err as Error).message)
        result.created.push(
          ...group.map((e) => ({ email: e.email, status: 'error' as const, reason: (err as Error).message })),
        )
      }
      done += group.length
      onProgress?.(done, total, 'create')
    }
  }

  /* Bajas */
  for (const group of chunk(toDeactivate, STATUS_CHUNK)) {
    try {
      const { updated } = await setUsersActive(
        group.map((e) => e.person!.id),
        false,
        reason,
      )
      result.deactivated += updated
    } catch (err) {
      result.errors.push((err as Error).message)
    }
    done += group.length
    onProgress?.(done, total, 'deactivate')
  }

  /* Reactivaciones */
  for (const group of chunk(toReactivate, STATUS_CHUNK)) {
    try {
      const { updated } = await setUsersActive(group.map((e) => e.person!.id), true, reason)
      result.reactivated += updated
    } catch (err) {
      result.errors.push((err as Error).message)
    }
    done += group.length
    onProgress?.(done, total, 'reactivate')
  }

  onProgress?.(total, total, 'finish')

  /* Rastro en las cuentas confirmadas: en qué nómina se las vio por última vez,
   * y la cédula del archivo cuando el perfil todavía no la tenía. */
  const confirmed = [...unchanged, ...toReactivate]
  const seenIds = confirmed.map((e) => e.person!.id)
  const nowIso = new Date().toISOString()
  for (const group of chunk(seenIds, 200)) {
    await supabase.from('profiles').update({ hr_last_seen_at: nowIso }).in('id', group)
  }
  const missingNid = confirmed.filter((e) => e.nationalId && !e.person!.national_id)
  for (const e of missingNid) {
    await supabase.from('profiles').update({ national_id: e.nationalIdRaw.trim() }).eq('id', e.person!.id)
  }

  /* Historial de la carga: permite reconstruir cualquier mes y explicar por qué
   * una persona quedó inactiva. No es crítico, así que no rompe la operación. */
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = user
    ? await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
    : { data: null }
  await supabase.from('hr_sync_runs').insert({
    actor_id: user?.id ?? null,
    actor_name: me?.display_name ?? null,
    file_name: fileName,
    // Las campañas donde nacieron las altas. NO es un alcance: esta
    // sincronización no da de baja a nadie por campaña.
    campaign_ids: [...new Set(toCreate.map((e) => e.campaignId).filter((id): id is string => !!id))],
    period,
    created_count: result.created.filter((r) => r.status === 'created').length,
    deactivated_count: result.deactivated,
    reactivated_count: result.reactivated,
    unchanged_count: result.unchanged,
    skipped_count: entries.filter((e) => e.action === 'skipped' || !e.include).length,
    detail: {
      reason,
      created: result.created.map((r) => ({ email: r.email, status: r.status })),
      deactivated: toDeactivate.map((e) => ({
        id: e.person!.id,
        email: e.email,
        national_id: e.nationalIdRaw || null,
        why: e.reason ?? null,
      })),
      reactivated: toReactivate.map((e) => ({ id: e.person!.id, email: e.email })),
      errors: result.errors,
    },
  })

  return result
}

/* ── Historial ─────────────────────────────────────────────────────────────── */

export interface HrSyncRun {
  id: string
  actor_name: string | null
  file_name: string | null
  period: string | null
  campaign_ids: string[]
  created_count: number
  deactivated_count: number
  reactivated_count: number
  unchanged_count: number
  skipped_count: number
  created_at: string
}

/** Últimas sincronizaciones aplicadas (para el panel de superadmin). */
export async function getSyncRuns(limit = 12): Promise<HrSyncRun[]> {
  const { data, error } = await supabase
    .from('hr_sync_runs')
    .select('id, actor_name, file_name, period, campaign_ids, created_count, deactivated_count, reactivated_count, unchanged_count, skipped_count, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as HrSyncRun[]
}
