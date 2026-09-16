import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, UserPlus, UserRoundPlus, Shield, Trash2, Copy, Check, Clock, BarChart3, Search, Upload, Pencil, X, RotateCcw, IdCard, ImageDown, KeyRound, UserMinus, UserCheck, Users, Fingerprint, BadgeCheck, Replace, PenLine, Briefcase } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'

import { supabase } from '@/lib/supabase'
import { fold } from '@/lib/normalize'
import { getMyPeopleIds, getOrganizations, getOrgUnits } from '@/services/org.service'
import { invalidateAudiencePopulation } from '@/services/audiences.service'
import { cn } from '@/lib/cn'
import { SaveDock } from '@/admin/components/SaveDock'
import { useUndoHistory } from '@/hooks/useUndoHistory'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { TransferContentModal } from '@/admin/components/TransferContentModal'
import { toast } from '@/stores/toastStore'
import { recompressAllAvatars, type RecompressProgress } from '@/services/avatarMaintenance'
import { passkeyCounts } from '@/services/passkeys.service'
import {
  getAccessibleCampaigns,
  getAssignableCampaigns,
  getCampaignIdsByUser,
  setUserCampaigns as saveUserCampaigns,
  isCampaignWriteDenied,
  withoutTestPeople,
  isTestScopeError,
} from '@/services/campaigns.service'
import { Avatar } from '@/components/ui/Avatar'
import { FadeIn } from '@/components/ui/motion'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import { Tooltip } from '@/components/ui/Tooltip'
import { UserCourseResetModal } from '@/admin/components/UserCourseResetModal'
import { UserProgressDrawer } from '@/admin/components/UserProgressDrawer'
import { BulkImportUsers } from '@/admin/components/BulkImportUsers'
import { HrRosterSyncModal } from '@/admin/components/HrRosterSyncModal'
import { DefaultPasswordModal } from '@/admin/components/DefaultPasswordModal'
import { ChangeEmailModal } from '@/admin/components/ChangeEmailModal'
import { getDefaultPassword } from '@/services/appSettings.service'
import { setUsersActive } from '@/services/hrSync.service'
import { logActivity } from '@/services/audit.service'
import { checkEmailAvailable, type ExistingAccount } from '@/services/userEmail.service'
import { COUNTRIES, OPERATION_COUNTRIES } from '@/lib/countries'
import type { Profile, Campaign, OrgUnit } from '@/types/database'

// URL pública del sitio (la que se entrega al usuario junto a sus credenciales).
const SITE_URL = 'https://capacitaciones-chi.vercel.app/'

/** `profiles.email` ya existe en el tipo; el alias se conserva por claridad y
 *  porque la columna puede venir vacía si el SQL del correo no se ha corrido. */
type ProfileWithEmail = Profile

/**
 * Traduce "A user with this email address has already been registered" a algo
 * accionable: quién es, en qué campaña está y si está dada de baja — o el aviso
 * de que la cuenta quedó a medias (existe el acceso pero no el perfil, por eso
 * no sale en esta lista y aun así el alta falla).
 */
function describeTakenEmail(
  existing: ExistingAccount | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (existing?.orphan) return t('admin.users.email_taken_orphan')
  if (existing?.ghost) {
    return existing.reason === 'pending_change'
      ? t('admin.users.email_taken_pending_change')
      : t('admin.users.email_taken_old_identity', {
          email: existing.currentEmail ?? t('admin.users.email_unknown'),
        })
  }
  if (!existing?.known || !existing.displayName) return t('admin.users.email_taken')
  const who = existing.displayName
  const where = existing.campaignName ?? t('admin.users.bulk_campaign_none')
  const base = t('admin.users.email_taken_who', { name: who, campaign: where })
  return existing.isActive === false ? `${base} ${t('admin.users.email_taken_inactive')}` : base
}

interface TempCred {
  email: string
  temp_password: string
  /** Pasada esta fecha la fila se purga sola: la contraseña deja de entregarse. */
  expires_at: string | null
}

// Bloque de texto listo para pegar en un correo/mensaje al usuario.
function buildCredsText(email: string, password: string): string {
  return `${i18n.t('admin.users.creds_site')}: ${SITE_URL}\n${i18n.t('admin.users.creds_email')}: ${email}\n${i18n.t('admin.users.creds_password')}: ${password}`
}

function mapCreds(
  rows: { user_id: string; email: string; temp_password: string; expires_at: string | null }[] | null,
): Record<string, TempCred> {
  const m: Record<string, TempCred> = {}
  const ahora = Date.now()
  for (const r of rows ?? []) {
    // La RLS ya esconde las vencidas, pero un panel abierto desde ayer todavía
    // tiene las de ayer en memoria: no se ofrece una contraseña que ya no sirve.
    if (r.expires_at && new Date(r.expires_at).getTime() <= ahora) continue
    m[r.user_id] = { email: r.email, temp_password: r.temp_password, expires_at: r.expires_at }
  }
  return m
}

/** Días que le quedan a una credencial, para avisarlo antes de que caduque. */
function diasRestantes(expiresAt: string | null): number | null {
  if (!expiresAt) return null
  const ms = new Date(expiresAt).getTime() - Date.now()
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000)
}

export default function UserList() {
  const { isSuperAdmin, isRh, canCreateLearners, campaignId, user: authUser } = useAuth()
  /* Cargar CLIENTES es un permiso más estrecho que cargar aprendices: el
   * superadmin, y el capacitador al que se le concedió el alta. RH queda fuera
   * a propósito —su fuente de verdad es la nómina, y un cliente no está en la
   * nómina—. El servidor comprueba lo mismo (`callerScope.canCreateClients`). */
  const canCreateClients = isSuperAdmin || (canCreateLearners && !isRh)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  // La tabla es ancha y hay que moverse a los lados: además de la barra del
  // propio contenedor (abajo del todo) ponemos una ARRIBA, para no tener que
  // bajar hasta el final de la lista solo para desplazarse en horizontal.
  const topScrollRef = useRef<HTMLDivElement>(null)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  // El encabezado no tiene barra propia (overflow oculto): lo movemos nosotros.
  const headScrollRef = useRef<HTMLDivElement>(null)
  // Sin este cerrojo las barras se empujan entre sí (una mueve a la otra, que
  // dispara su propio onScroll y devuelve el movimiento).
  const syncingRef = useRef(false)
  const syncScroll = (from: 'top' | 'table') => {
    if (syncingRef.current) return
    const src = from === 'top' ? topScrollRef.current : tableScrollRef.current
    if (!src) return
    const others = [topScrollRef, tableScrollRef, headScrollRef]
      .map((r) => r.current)
      .filter((el): el is HTMLDivElement => !!el && el !== src)
    syncingRef.current = true
    for (const el of others) el.scrollLeft = src.scrollLeft
    requestAnimationFrame(() => { syncingRef.current = false })
  }
  // Vista superadmin de cursos + restablecer progreso de una persona.
  const [resetUser, setResetUser] = useState<ProfileWithEmail | null>(null)
  // Panel lateral con el avance (cursos → módulos → actividades) sin salir de la lista.
  const [progressUser, setProgressUser] = useState<ProfileWithEmail | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  // Sincronización de altas y bajas contra la base de Talento Humano.
  const [hrOpen, setHrOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  // Permiso de "puede crear aprendices" guardándose para un capacitador.
  // Contraseña predeterminada para usuarios nuevos (ajuste global de superadmin).
  const [pwdOpen, setPwdOpen] = useState(false)
  const [defaultPwdOn, setDefaultPwdOn] = useState(false)
  const [search, setSearch] = useState('')
  // Las cuentas dadas de baja no estorban el día a día: se ven si se piden.
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [users, setUsers] = useState<ProfileWithEmail[]>([])
  /* Lo que hay en la base. Editar aquí es borrador: nombre, rol, permiso de
     altas y campañas se acumulan en la barra del pie y se guardan de una vez.
     Dar de baja o eliminar NO son ediciones (son órdenes) y siguen al momento. */
  const [savedUsers, setSavedUsers] = useState<ProfileWithEmail[]>([])
  // Campañas de cada usuario: casa + colaboraciones. El capacitador puede tener
  // varias (equipos compartidos), así que no basta con profiles.campaign_id.
  const [userCampaigns, setUserCampaigns] = useState<Record<string, string[]>>({})
  const [savedUserCampaigns, setSavedUserCampaigns] = useState<Record<string, string[]>>({})
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  // Campañas a las que se puede ASIGNAR a alguien recién creado. Para el
  // capacitador habilitado son TODAS (no solo las suyas): da de alta gente que
  // luego trabaja en otra campaña. Se mantiene aparte de `campaigns` a
  // propósito: la lista, el filtro y la edición de campañas siguen acotados a
  // lo suyo.
  const [assignableCampaigns, setAssignableCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  // Edición inline del nombre de un usuario existente
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [inviteRole, setInviteRole] = useState<Profile['role']>('learner')
  // País opcional: si se deja vacío, la persona lo elige en su onboarding.
  const [inviteCountry, setInviteCountry] = useState('')
  const [countryIgnored, setCountryIgnored] = useState(false)
  /** Se pidió crear un cliente y el servidor no lo confirmó (despliegue viejo). */
  const [clientIgnored, setClientIgnored] = useState(false)
  // CR y área: con el país deciden a quién le llega un curso (regla de
  // audiencia país → área → CR). Una cuenta sin ellos entra sin los cursos de su
  // operación y no sale en los filtros de progreso por CR/área.
  const [inviteOperation, setInviteOperation] = useState('')
  const [inviteArea, setInviteArea] = useState('')
  /* Alta de CLIENTE: gente de FUERA de la compañía. No es un rol, es una marca
   * sobre el aprendiz. Cambia el formulario entero —no tiene área ni CR, porque
   * no pertenece a la estructura interna— y sobre todo cambia lo que recibe:
   * ningún curso le llega por regla salvo que el curso diga «incluye clientes»,
   * y no ve el catálogo abierto. */
  const [inviteIsClient, setInviteIsClient] = useState(false)
  const [inviteClientName, setInviteClientName] = useState('')
  const [units, setUnits] = useState<OrgUnit[] | null>(null)
  const [unitsIgnored, setUnitsIgnored] = useState(false)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  // Comprobación del CORREO contra auth.users: es lo único que decide si se
  // puede dar de alta. Se resuelve antes de crear nada, para no llenar el
  // formulario entero y estrellarse al final.
  const [emailCheck, setEmailCheck] = useState<
    { state: 'checking' } | { state: 'free' } | { state: 'taken'; message: string } | null
  >(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [createdEmail, setCreatedEmail] = useState('')
  const [createdPassword, setCreatedPassword] = useState('')
  const [createdWithDefaultPwd, setCreatedWithDefaultPwd] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [resettingPwdFor, setResettingPwdFor] = useState<string | null>(null)
  // Credenciales temporales pendientes por usuario (solo el superadmin las recibe
  // vía RLS). Permite copiar el bloque de credenciales de cualquier pendiente.
  const [tempCreds, setTempCreds] = useState<Record<string, TempCred>>({})
  // Cambio del correo de ingreso de una persona (solo superadmin). Se hace al
  // momento, como la baja o el restablecimiento: no es un borrador.
  const [emailUser, setEmailUser] = useState<ProfileWithEmail | null>(null)
  // Dispositivos con ingreso biométrico por persona (solo informativo).
  const [passkeys, setPasskeys] = useState<Record<string, { count: number; lastUsedAt: string | null }>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // Recompresión masiva de avatares existentes (mantenimiento superadmin).
  const [optimizing, setOptimizing] = useState(false)
  const [optProgress, setOptProgress] = useState<RecompressProgress | null>(null)

  const filteredUsers = useMemo(() => {
    // Búsqueda insensible a tildes: nadie escribe "Rocío" con tilde.
    const q = fold(search)
    return users.filter((u) => {
      // El correo vive en `auth.users`, pero `profiles.email` lo copia (trigger
      // `sync_profile_email`). Si ese SQL aún no se corrió, `u.email` viene
      // vacío y queda el respaldo de la credencial temporal — que el trigger
      // borra al onboardear, así que solo sirve para pendientes.
      const matchesQuery =
        !q ||
        fold(u.display_name ?? '').includes(q) ||
        fold(u.email ?? '').includes(q) ||
        fold(tempCreds[u.id]?.email ?? '').includes(q) ||
        u.id.toLowerCase().includes(q)
      // Filtra por pertenencia real (casa o colaboración), no solo por la casa:
      // si no, un capacitador con campaña casa A no aparecería al filtrar por B
      // aunque trabaje en B.
      const matchesCampaign =
        true
      // `is_active` puede venir undefined si el SQL de altas/bajas aún no se
      // corrió: sin la columna, todas las cuentas cuentan como activas.
      const active = u.is_active !== false
      const matchesStatus =
        statusFilter === 'all' || (statusFilter === 'active' ? active : !active)
      return matchesQuery && matchesCampaign && matchesStatus
    })
  }, [users, search, statusFilter, tempCreds])

  const inactiveCount = useMemo(() => users.filter((u) => u.is_active === false).length, [users])

  // El capacitador da de alta aprendices (nada más) en sus propias campañas, y
  // SOLO si el superadmin lo habilitó: el permiso se concede uno por uno, no
  // viene con el rol. Las BAJAS siguen siendo solo del superadmin: ese es el
  // punto de control del proceso de Talento Humano y no se delega.
  const canCreateUsers = isSuperAdmin || (canCreateLearners && assignableCampaigns.length > 0)
  /* Recursos Humanos SI carga la base maestra: dar de alta y mantener los datos
   * de la gente es literalmente su trabajo. Lo que no puede es dar de baja — eso
   * se queda en el superadmin, y el asistente lo esconde y `applySync` lo vuelve
   * a filtrar. */
  const canSyncRoster = isSuperAdmin || isRh
  // Capacitador sin el permiso: se le explica por qué no ve los botones, en vez
  // de dejar la pantalla muda.
  const showNoPermissionHint = !isSuperAdmin && !canCreateLearners
  // Sin campaña elegida el servidor rechaza el alta, así que el formulario la
  // exige antes de dejar crear.
  // El programa ya no se elige al crear: con la migración a CR la audiencia la
  // deciden país/área/CR. El servidor deja al aprendiz en Piloto, porque el
  // progreso todavía exige campaign_id (ver create-user).
  // Y sin país la regla de audiencia no lo alcanza: no le aparece ningún curso
  // que no sea para «toda la organización».
  // Al CLIENTE no se le exige nada de esto: área y CR son la estructura interna
  // y él no está en ella. Pedírselos obligaría a inventarle un CR, y un CR
  // inventado acaba metiéndolo en la audiencia de un curso interno — justo lo
  // que esta función viene a impedir.
  const needsCountry = inviteRole === 'learner' && !inviteIsClient
  // Área y CR también: un aprendiz sin ellos queda "en el aire" — no le llegan
  // los cursos de su área ni de su CR, ni sale al filtrar por ellos.
  const missingCountry = needsCountry && (!inviteCountry || !inviteArea || !inviteOperation)
  /** Un cliente sin nombre de cliente no se distingue del siguiente. */
  const missingClientName = inviteIsClient && !inviteClientName.trim()
  const operationOptions = useMemo(
    () => (units ?? []).filter((u) => u.kind === 'operation').map((u) => ({ value: u.id, label: u.name })),
    [units],
  )
  const areaOptions = useMemo(
    () => (units ?? []).filter((u) => u.kind === 'area').map((u) => ({ value: u.id, label: u.name })),
    [units],
  )

  useEffect(() => {
    async function load() {
      // El capacitador ve las personas de sus campañas (casa + colaboraciones) y
      // NUNCA a los superadmin; el superadmin ve a todos.
      const camps = await getAccessibleCampaigns({
        isSuperAdmin,
        homeCampaignId: campaignId,
        userId: authUser?.id ?? null,
      }).catch(() => [] as Campaign[])
      setCampaigns(camps)

      // Las campañas del selector de alta van por su propio camino: el
      // capacitador habilitado puede asignar a cualquiera. Se arranca con las
      // suyas (así los botones no parpadean) y se amplía al llegar el RPC.
      setAssignableCampaigns(camps)
      getAssignableCampaigns({
        // RH no tiene campaña propia: da de alta en cualquiera, como el superadmin.
        isSuperAdmin: isSuperAdmin || isRh,
        homeCampaignId: campaignId,
        userId: authUser?.id ?? null,
      })
        .then(setAssignableCampaigns)
        .catch(() => setAssignableCampaigns(camps))

      let profilesQuery = supabase.from('profiles').select('*').order('created_at')
      if (!isSuperAdmin) {
        // "Mi gente" ya no es "los de mi campaña": son los aprendices alcanzados
        // por mis cursos más el staff de mis campañas. Lo resuelve la base, que
        // es la misma respuesta que usa la RLS — dos definiciones distintas
        // producirían filas visibles que luego no se pueden abrir.
        const people = await getMyPeopleIds()
        const ids = camps.map((c) => c.id)
        profilesQuery = (people
          ? profilesQuery.in('id', people.length ? people : [''])
          // Sin el RPC (SQL sin correr) se cae al filtro de siempre: es más
          // estrecho, nunca más ancho.
          : profilesQuery.in('campaign_id', ids.length ? ids : ['']))
          .neq('role', 'superadmin')
      }
      const [profiles, creds] = await Promise.all([
        profilesQuery,
        // La RLS decide qué filas llegan: el superadmin las ve todas y el
        // capacitador solo las de la gente de sus campañas.
        supabase.from('user_temp_credentials').select('user_id, email, temp_password, expires_at'),
      ])
      // La gente del entorno de pruebas no aparece mientras el Modo pruebas
      // esté apagado (el superadmin lee TODOS los perfiles, sin acotar).
      const rows = await withoutTestPeople(profiles.data ?? [], isSuperAdmin)
      setUsers(rows)
      setSavedUsers(rows)
      const byUser = await getCampaignIdsByUser(rows)
      setUserCampaigns(byUser)
      setSavedUserCampaigns(byUser)
      setTempCreds(mapCreds(creds.data))
      setLoading(false)
      // Quién entra con huella. Va después de pintar la lista y en una sola
      // consulta agregada: es un adorno informativo, no debe retrasar nada.
      passkeyCounts(rows.map((r) => r.id)).then(setPasskeys).catch(() => {})
    }
    load()
  }, [isSuperAdmin, isRh, campaignId, authUser?.id])

  // Estado del ajuste global, para avisar en el encabezado con qué contraseña
  // nacerán los usuarios nuevos. Solo el superadmin lo administra.
  useEffect(() => {
    if (!isSuperAdmin) return
    getDefaultPassword()
      .then((s) => setDefaultPwdOn(s?.enabled === true))
      .catch(() => setDefaultPwdOn(false))
  }, [isSuperAdmin])

  const refreshData = async () => {
    // Mismo alcance que la carga inicial: el capacitador ve solo su gente y
    // nunca a los superadmin (si no, tras crear un usuario la lista se le
    // ensancharía sola con lo que la RLS deje pasar).
    let profilesQuery = supabase.from('profiles').select('*').order('created_at')
    if (!isSuperAdmin) {
      const people = await getMyPeopleIds()
      const ids = campaigns.map((c) => c.id)
      profilesQuery = (people
        ? profilesQuery.in('id', people.length ? people : [''])
        : profilesQuery.in('campaign_id', ids.length ? ids : ['']))
        .neq('role', 'superadmin')
    }
    const [{ data: updated }, { data: creds }] = await Promise.all([
      profilesQuery,
      supabase.from('user_temp_credentials').select('user_id, email, temp_password, expires_at'),
    ])
    const rows = await withoutTestPeople(updated ?? [], isSuperAdmin)
    setUsers(rows)
    setSavedUsers(rows)
    const byUser = await getCampaignIdsByUser(rows)
    setUserCampaigns(byUser)
    setSavedUserCampaigns(byUser)
    setTempCreds(mapCreds(creds))
  }

  const handleRecompress = async () => {
    const ok = await confirm({
      title: t('admin.users.optimize_photos'),
      description: t('admin.users.optimize_photos_confirm'),
      confirmLabel: t('admin.users.optimize_photos'),
      tone: 'default',
    })
    if (!ok) return
    setOptimizing(true)
    setOptProgress(null)
    try {
      const result = await recompressAllAvatars(setOptProgress)
      await refreshData()
      toast.success(
        t('admin.users.optimize_done', {
          n: result.optimized,
          mb: (result.bytesSaved / (1024 * 1024)).toFixed(1),
        }),
      )
      if (result.failed > 0) toast.error(t('admin.users.optimize_failed', { n: result.failed }))
    } catch (err) {
      toast.error(t('profile.save_error', 'No se pudo guardar'), (err as Error).message)
    } finally {
      setOptimizing(false)
      setOptProgress(null)
    }
  }

  /**
   * Copiar la credencial es SACAR una contraseña en claro de la base, así que
   * queda registrado quién la entregó y de quién era. Es no-fatal a propósito:
   * si la bitácora falla, la persona igual recibe su acceso.
   */
  const copyCreds = (userId: string, email: string, password: string) => {
    navigator.clipboard.writeText(buildCredsText(email, password))
    setCopiedId(userId)
    setTimeout(() => setCopiedId((k) => (k === userId ? null : k)), 2000)
    if (userId === '__new__') return // el alta ya se registró en la Edge Function
    const target = users.find((u) => u.id === userId)
    logActivity({
      action: 'view_credentials',
      entityType: 'profiles',
      entityId: userId,
      entityLabel: target?.display_name ?? email,
      campaignId: target?.campaign_id ?? null,
      detail: { email },
    }).catch(() => {})
  }

  /**
   * El correo que se le ve a alguien: el del perfil (copia de `auth.users` que
   * mantiene un trigger) y, si esa columna aún viene vacía, el de la credencial
   * temporal — que solo existe mientras la persona no haya entrado nunca.
   */
  const emailOf = (u: ProfileWithEmail): string | null =>
    u.email ?? tempCreds[u.id]?.email ?? null

  /**
   * Refleja el correo recién cambiado sin recargar la lista. Se toca también
   * `savedUsers` a propósito: el cambio ya está en la base, así que no debe
   * contar como una edición pendiente en la barra de guardado.
   */
  const applyNewEmail = (userId: string, email: string) => {
    const setEmail = (list: ProfileWithEmail[]) =>
      list.map((u) => (u.id === userId ? { ...u, email } : u))
    setUsers(setEmail)
    setSavedUsers(setEmail)
    setTempCreds((prev) => (prev[userId] ? { ...prev, [userId]: { ...prev[userId], email } } : prev))
  }

  /**
   * Abre el formulario de alta. El programa ya no se elige: pasó a ser CR.
   */
  const openInvite = () => {
    if (!isSuperAdmin) {
      // El capacitador no elige rol: siempre crea aprendices.
      setInviteRole('learner')
    }
    setInviteSuccess(false)
    setInviteError(null)
    setInviting(true)
    // El catálogo de CR y áreas se pide solo al abrir el alta, y una vez.
    if (units === null) {
      getOrganizations()
        .then((orgs) => (orgs[0] ? getOrgUnits(orgs[0].id) : []))
        .then(setUnits)
        .catch(() => setUnits([]))
    }
  }

  /**
   * Pregunta al servidor si ese correo se puede usar. Va contra `auth.users`
   * —donde vive el correo de verdad— e incluye los casos en que está tomado sin
   * que ninguna cuenta lo muestre: un cambio de correo sin confirmar, o el
   * correo anterior de alguien, que queda guardado en su identidad.
   */
  const checkEmailAvailability = async (raw: string) => {
    const email = raw.trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailCheck(null)
      return
    }
    setEmailCheck({ state: 'checking' })
    const { available, existing } = await checkEmailAvailable(email)
    // Sin respuesta clara no se bloquea el alta: el servidor volverá a decidir
    // al crear (una Edge Function anterior a este soporte ignoraría `mode`).
    setEmailCheck(
      available === null
        ? null
        : available
          ? { state: 'free' }
          : { state: 'taken', message: describeTakenEmail(existing, t) },
    )
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || missingCountry || missingClientName) return
    setInviteLoading(true)
    setInviteError(null)

    try {
      // Crear el usuario vía Edge Function con service_role: queda confirmado con
      // una contraseña temporal (generada en el servidor) y su perfil listo, sin
      // tocar la sesión del superadmin. El usuario la cambia en el onboarding.
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            email: inviteEmail.trim(),
            name: inviteName.trim(),
            role: inviteRole,
            country: inviteCountry || null,
            operationId: inviteIsClient ? null : inviteOperation || null,
            areaId: inviteIsClient ? null : inviteArea || null,
            isClient: inviteIsClient,
            clientName: inviteIsClient ? inviteClientName.trim() : null,
          }),
        },
      )
      const json = await res.json()
      // El correo ya tiene cuenta: el servidor devuelve dónde está esa persona,
      // porque el buscador de esta pantalla no puede encontrarla por correo
      // (public.profiles no guarda el email, vive en auth.users).
      if (res.status === 409 && json.error === 'email_exists') {
        setInviteError(describeTakenEmail(json.existing, t))
        return
      }
      if (!res.ok) throw new Error(json.error ?? 'Error al crear usuario')

      setCreatedEmail(json.email ?? inviteEmail.trim())
      setCreatedPassword(json.password ?? '')
      setCreatedWithDefaultPwd(json.defaultPassword === true)
      // Se pidió país y el servidor no lo confirma: la Edge Function desplegada
      // es anterior a este soporte. Mejor decirlo que dar por hecho que se guardó.
      setCountryIgnored(!!inviteCountry && json.country !== inviteCountry)
      setUnitsIgnored(
        (!inviteIsClient && !!inviteOperation && json.operationId !== inviteOperation) ||
        (!inviteIsClient && !!inviteArea && json.areaId !== inviteArea),
      )
      // Si se pidió un cliente y el servidor no lo confirma, el despliegue de la
      // Edge Function es anterior a este soporte y la persona entró como
      // empleado interno: le llegarían los cursos de «toda la organización».
      // Es el fallo silencioso que hay que poder ver.
      setClientIgnored(inviteIsClient && json.isClient !== true)
      // Hay una persona más en el censo con el que el editor de cursos cuenta
      // a cuánta gente le llega cada CR.
      invalidateAudiencePopulation()
      setInviteSuccess(true)
      setInviteEmail('')
      setInviteName('')
      setInviteClientName('')

      await refreshData()
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Error al crear usuario')
    } finally {
      setInviteLoading(false)
    }
  }

  const startEditName = (user: ProfileWithEmail) => {
    setEditingId(user.id)
    setEditName(user.display_name ?? '')
  }

  const handleSaveName = (userId: string) => {
    const name = editName.trim()
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, display_name: name || null } : u))
    setEditingId(null)
  }

  const handleRoleChange = async (userId: string, newRole: Profile['role']) => {
    // Al dejar de ser capacitador se retiran los permisos concedidos a mano
    // (altas y aprobación de cursos): si mañana vuelve a serlo, no debe
    // recuperarlos solo por un permiso viejo colgado.
    const patch = newRole === 'capacitador'
      ? { role: newRole }
      : { role: newRole, can_create_learners: false, can_approve_courses: false, is_guest_author: false }
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, ...patch } : u))
  }

  /**
   * Concede (o retira) a un capacitador el permiso de dar de alta aprendices en
   * sus campañas. Solo el superadmin lo mueve: la interfaz lo esconde y un
   * trigger en la base impide que nadie más lo cambie por su cuenta.
   */
  /**
   * Marca a un capacitador como AUTOR TEMPORAL: prepara contenido en su
   * programa pero no reparte formación ni publica. Es para el gerente o el
   * especialista que viene a traer su curso y se va; cuando pasa a ser de
   * planta se desmarca y recupera todo, sin perder lo que creó.
   */
  const handleToggleGuestAuthor = (user: ProfileWithEmail) => {
    const next = user.is_guest_author !== true
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, is_guest_author: next } : u)))
  }

  const handleToggleCanCreate = (user: ProfileWithEmail) => {
    const next = user.can_create_learners !== true
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, can_create_learners: next } : u)))
  }

  /**
   * Concede (o retira) a un capacitador el permiso de aprobar QUÉ CURSOS SE
   * PUBLICAN. Es la otra mitad de la puerta: sin él, un capacitador solo puede
   * pedir la publicación de lo suyo. Solo el superadmin lo mueve; la base lo
   * respalda (courses_publication_guard + los RPC de aprobación).
   */
  const handleToggleCanApprove = (user: ProfileWithEmail) => {
    const next = user.can_approve_courses !== true
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, can_approve_courses: next } : u)))
  }

  // Deshacer (Ctrl+Z) del borrador: nombre, rol, permiso y campañas.
  const undoState = useMemo(() => ({ users, userCampaigns }), [users, userCampaigns])
  const { undo, canUndo } = useUndoHistory({
    state: undoState,
    apply: useCallback(
      (snap: { users: ProfileWithEmail[]; userCampaigns: Record<string, string[]> }) => {
        setUsers(snap.users)
        setUserCampaigns(snap.userCampaigns)
      },
      [],
    ),
    enabled: !loading,
  })

  /* ── Lo que está sin guardar ── */
  const dirtyUsers = users.filter((u) => {
    const before = savedUsers.find((x) => x.id === u.id)
    if (!before) return false
    return (
      before.display_name !== u.display_name ||
      before.role !== u.role ||
      before.can_create_learners !== u.can_create_learners ||
      before.is_guest_author !== u.is_guest_author ||
      before.can_approve_courses !== u.can_approve_courses
    )
  })
  const dirtyCampaignUsers = users.filter((u) => {
    const before = savedUserCampaigns[u.id] ?? []
    const now = userCampaigns[u.id] ?? []
    return JSON.stringify([...before].sort()) !== JSON.stringify([...now].sort())
  })
  const pendingCount = new Set([
    ...dirtyUsers.map((u) => u.id),
    ...dirtyCampaignUsers.map((u) => u.id),
  ]).size

  const saveUsers = async (): Promise<boolean> => {
    try {
      for (const u of dirtyUsers) {
        const { error } = await supabase
          .from('profiles')
          .update({
            display_name: u.display_name,
            role: u.role,
            can_create_learners: u.can_create_learners,
            is_guest_author: u.is_guest_author,
            can_approve_courses: u.can_approve_courses,
          })
          .eq('id', u.id)
        if (error) throw error
      }
      // La campaña "de casa" la decide el servidor, así que el resultado se
      // aplica sobre una sola lista final: si no, la línea base se quedaría con
      // la versión de antes y la barra volvería a decir que hay algo pendiente.
      let after = users
      for (const u of dirtyCampaignUsers) {
        const home = await saveUserCampaigns(
          u.id,
          userCampaigns[u.id] ?? [],
          u.campaign_id ?? null,
        )
        after = after.map((x) => (x.id === u.id ? { ...x, campaign_id: home } : x))
      }
      setUsers(after)
      setSavedUsers(after)
      setSavedUserCampaigns(userCampaigns)
      toast.success(t('admin.users.saved_all', { defaultValue: 'Cambios guardados' }))
      return true
    } catch (err) {
      // Mezclar campañas de prueba con campañas reales está prohibido: el
      // progreso de una cuenta de prueba acabaría en los reportes de verdad.
      // La base aceptó la petición pero no escribió (política RLS que falta).
      // Antes esto salía como "Cambios guardados" y el superadmin descubría el
      // engaño al recargar.
      if (isCampaignWriteDenied(err)) {
        toast.error(
          t('admin.users.campaigns_save_error'),
          t('admin.users.campaigns_save_denied', {
            defaultValue:
              'La base de datos rechazó el cambio en silencio (falta la política de permisos sobre {{table}}). No se guardó nada.',
            table: (err as { table?: string }).table ?? 'campaign_collaborators',
          }),
        )
        return false
      }
      if (isTestScopeError(err)) {
        toast.error(
          t('admin.users.campaigns_save_error'),
          t('test_mode.mix_users', {
            defaultValue:
              'No se pueden mezclar programas de prueba con programas reales en la misma persona. Déjale solo unas o solo otras.',
          }),
        )
        return false
      }
      toast.error(t('admin.users.campaigns_save_error'), (err as Error).message)
      return false
    }
  }

  /**
   * Devuelve al usuario a su contraseña inicial (la predeterminada del sitio si
   * está activada, o una temporal aleatoria si no) y lo deja sin onboardear, así
   * al entrar con ella tiene que definir una nueva. Copia las credenciales al
   * portapapeles para entregarlas de una vez.
   */
  const handleResetPassword = async (user: ProfileWithEmail) => {
    const name = user.display_name ?? user.email ?? user.id.slice(0, 8)
    const ok = await confirm({
      title: t('admin.users.reset_pwd'),
      description: defaultPwdOn
        ? t('admin.users.reset_pwd_confirm_default', { name })
        : t('admin.users.reset_pwd_confirm_temp', { name }),
      confirmLabel: t('admin.users.reset_pwd'),
      tone: 'default',
    })
    if (!ok) return

    setResettingPwdFor(user.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-user-password`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ userId: user.id }),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')

      await refreshData()
      copyCreds(user.id, json.email ?? user.email ?? '', json.password ?? '')
      toast.success(t('admin.users.reset_pwd_done', { name }), t('admin.users.reset_pwd_copied'))
    } catch (err) {
      toast.error(t('admin.users.reset_pwd_error'), (err as Error).message)
    } finally {
      setResettingPwdFor(null)
    }
  }

  /**
   * Traduce el código que devuelve la función de borde cuando no cambió nada.
   * Sin esto el aviso de error mostraba el código crudo ("eres_tu").
   */
  const skipReason = (code?: string) => {
    if (code === 'eres_tu') {
      return t('admin.users.status_skip_self', 'No puedes darte de baja a ti mismo.')
    }
    if (code === 'no_existe') {
      return t('admin.users.status_skip_missing', 'La cuenta ya no existe.')
    }
    /* El servidor todavía es el viejo: rechaza dar de baja a alguien del equipo.
       Sin este caso el aviso decía "ya estaba así", que es mentira. */
    if (code === 'no_es_aprendiz') {
      return t(
        'admin.users.status_skip_staff_old_server',
        'El servidor todavía no acepta dar de baja al equipo: falta desplegar la función set-user-status.',
      )
    }
    return t('admin.users.status_no_change')
  }

  /**
   * Da de baja (o vuelve a dar de alta) a una persona —de cualquier rol. La baja
   * NO borra: bloquea el ingreso y la saca de listados y contadores, conservando
   * su historial, así que reactivarla la devuelve exactamente donde estaba.
   *
   * En staff se avisa aparte de lo que NO arregla la baja: el contenido que creó
   * sigue publicado y sigue siendo suyo. Para eso está "Cambiar de dueño", y hay
   * que pasarlo ANTES, porque después la persona ya no aparece en los listados.
   */
  const handleToggleActive = async (user: ProfileWithEmail) => {
    const name = user.display_name ?? user.email ?? user.id.slice(0, 8)
    const deactivating = user.is_active !== false
    const isStaff = user.role !== 'learner'
    const ok = await confirm({
      title: deactivating ? t('admin.users.deactivate') : t('admin.users.reactivate'),
      description: deactivating
        ? t('admin.users.deactivate_confirm', { name }) +
          (isStaff
            ? '\n\n' +
              t(
                'admin.users.deactivate_staff_note',
                'Ojo: es parte del equipo. El contenido que creó sigue publicado y a su nombre; si hay que traspasarlo, usa "Cambiar de dueño" antes de darle de baja.',
              )
            : '')
        : t('admin.users.reactivate_confirm', { name }),
      confirmLabel: deactivating ? t('admin.users.deactivate') : t('admin.users.reactivate'),
      tone: deactivating ? 'danger' : 'default',
    })
    if (!ok) return

    setTogglingId(user.id)
    try {
      const { updated, skipped } = await setUsersActive([user.id], !deactivating, '', true)
      if (updated === 0) {
        throw new Error(skipReason(skipped[0]?.reason))
      }
      const setActive = (list: ProfileWithEmail[]) =>
        list.map((u) => (u.id === user.id ? { ...u, is_active: !deactivating } : u))
      setUsers(setActive)
      setSavedUsers(setActive)
      toast.success(
        deactivating
          ? t('admin.users.deactivate_done', { name })
          : t('admin.users.reactivate_done', { name }),
      )
    } catch (err) {
      toast.error(t('admin.users.status_error'), (err as Error).message)
    } finally {
      setTogglingId(null)
    }
  }

  /**
   * A quién le estamos pasando el contenido. Solo superadmin, y solo sobre
   * staff: un aprendiz no crea contenido que haya que heredar.
   */
  const [transferFor, setTransferFor] = useState<ProfileWithEmail | null>(null)

  const handleDelete = async (user: ProfileWithEmail) => {
    const ok = await confirm({
      title: t('confirm.delete_user_title'),
      description: t('confirm.delete_user_desc', { name: user.display_name ?? user.email ?? user.id.slice(0, 8) }),
    })
    if (!ok) return
    const userId = user.id
    setDeletingId(userId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ userId }),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al eliminar usuario')
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      setSavedUsers((prev) => prev.filter((u) => u.id !== userId))
      toast.success(t('admin.users.delete_done', { name: user.display_name ?? user.email ?? '' }))
    } catch (err) {
      /* Con el aviso del sitio, no con `alert()`: el nativo bloquea la pestaña,
       * no se puede copiar y, sobre todo, aparecía con el mensaje crudo de
       * Postgres. Lo más común aquí es intentar borrar a alguien con historial,
       * y para eso la respuesta ya viene explicada. */
      toast.error(
        t('admin.users.delete_error', 'No se pudo eliminar'),
        err instanceof Error ? err.message : undefined,
      )
    } finally {
      setDeletingId(null)
    }
  }

  // Colores del badge de rol — tonos medios que funcionan en temas claro y oscuro
  const roleColors: Record<Profile['role'], string> = {
    superadmin: 'rgba(245,158,11,0.15)',
    capacitador: 'rgba(34,197,94,0.15)',
    // Violeta para RH: administra gente, no contenido. Se distingue de un
    // vistazo del verde del capacitador, que es justo la confusión a evitar.
    rh: 'rgba(139,92,246,0.15)',
    learner: 'rgba(100,116,139,0.12)',
  }
  const roleText: Record<Profile['role'], string> = {
    superadmin: '#d97706',
    capacitador: '#16a34a',
    rh: '#7c3aed',
    learner: '#64748b',
  }
  const roleLabel: Record<Profile['role'], string> = {
    superadmin: t('roles.superadmin'),
    capacitador: t('roles.capacitador'),
    rh: t('roles.rh', 'Recursos Humanos'),
    learner: t('roles.learner'),
  }
  const roleOptions = (['learner', 'capacitador', 'rh', 'superadmin'] as const).map((r) => ({
    value: r,
    label: roleLabel[r],
    color: roleText[r],
  }))

  // La tabla NO se colapsa en pantallas chicas: mantiene sus columnas a un ancho
  // legible y el contenedor hace scroll horizontal. Columnas fijas (no `auto`)
  // para que encabezado y filas queden siempre alineados aunque una fila tenga
  // más botones que otra (p. ej. "copiar credenciales").
  const gridCols = isSuperAdmin
    // 589px = 549 de antes + 40 del interruptor de "puede crear aprendices"
    // (solo aparece en filas de capacitador, pero la columna es fija para que
    // encabezado y filas queden alineados).
    // Sin columna de programa: se retiró del sitio (2026-09-15). Las personas
    // se clasifican por país, área y CR; los equipos de contenido del staff se
    // gestionan en la pantalla de programas (campaign_collaborators).
    ? 'minmax(280px,1fr) 150px 455px 48px'
    // El capacitador también puede copiar credenciales de su gente: la columna
    // de acciones necesita espacio para ese botón.
    : 'minmax(280px,1fr) 150px 356px'
  const tableMinWidth = isSuperAdmin ? 969 : 806

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-8">
        <div>
          <h1 className="text-[18px] sm:text-[22px] font-bold text-text">{t('admin.users.title')}</h1>
          <p className="text-text-muted text-[13px] mt-1">
            {isSuperAdmin ? t('admin.users.subtitle') : t('admin.users.subtitle_campaign')}
          </p>
          {showNoPermissionHint && (
            <p className="text-text-subtle text-[12px] mt-1">
              {t('admin.users.no_create_permission')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <>
            <Tooltip label={t('admin.users.optimize_photos_hint')} maxWidth={260}>
            <button
              onClick={handleRecompress}
              disabled={optimizing}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-text bg-subtle border border-line min-h-[44px] disabled:opacity-70"
            >
              {optimizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
              {optimizing && optProgress
                ? `${optProgress.done}/${optProgress.total}`
                : t('admin.users.optimize_photos')}
            </button>
            </Tooltip>
            <Tooltip label={t('admin.users.default_pwd_hint')} maxWidth={260}>
            <button
              onClick={() => setPwdOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-text bg-subtle border border-line min-h-[44px]"
            >
              <KeyRound className="h-4 w-4" />
              {t('admin.users.default_pwd_button')}
              <span
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
                style={
                  defaultPwdOn
                    ? { background: 'rgba(16,212,81,0.15)', color: '#16a34a' }
                    : { background: 'rgba(100,116,139,0.12)', color: '#64748b' }
                }
              >
                {defaultPwdOn ? t('admin.users.default_pwd_on') : t('admin.users.default_pwd_off')}
              </span>
            </button>
            </Tooltip>
            </>
          )}
          {canSyncRoster && (
            <Tooltip label={t('admin.hr.button_hint')} maxWidth={260}>
            <button
              onClick={() => setHrOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-text bg-subtle border border-line min-h-[44px]"
            >
              <Users className="h-4 w-4" />
              {t('admin.hr.button')}
            </button>
            </Tooltip>
          )}
          {canCreateUsers && (
            <>
              <button
                onClick={() => setBulkOpen(true)}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-text bg-subtle border border-line min-h-[44px]"
              >
                <Upload className="h-4 w-4" />
                {t('admin.users.bulk_import')}
              </button>
              <button
                onClick={openInvite}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black min-h-[44px]"
                style={{ background: '#10D451' }}
              >
                <UserPlus className="h-4 w-4" />
                {isSuperAdmin ? t('admin.users.create_user') : t('admin.users.create_learner')}
              </button>
            </>
          )}
        </div>
      </div>

      {inviting && (
        <div className="rounded-2xl p-4 sm:p-5 mb-6 bg-surface border border-line">
          <div className="text-[14px] font-medium text-text mb-4">{i18n.t('admin.users.create_user')}</div>

          {inviteSuccess ? (
            <div className="rounded-xl p-4" style={{ background: 'rgba(16,212,81,0.08)', border: '1px solid rgba(16,212,81,0.2)' }}>
              <div className="text-green-500 text-[13px] font-medium mb-3">{i18n.t('admin.users.created_share')}</div>
              <div className="space-y-2">
                {[
                  { id: 'site', label: i18n.t('admin.users.creds_site'), value: SITE_URL },
                  { id: 'email', label: i18n.t('admin.users.creds_email'), value: createdEmail },
                  { id: 'password', label: i18n.t('admin.users.creds_password'), value: createdPassword },
                ].map(({ id, label, value }) => (
                  <div key={id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 bg-subtle">
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase tracking-wider text-text-muted mr-2">{label}</span>
                      <span className="font-mono text-[12px] text-text break-all">{value}</span>
                    </div>
                  </div>
                ))}
              </div>
              {createdWithDefaultPwd && (
                <p className="text-[12px] text-text-muted mt-2">
                  {t('admin.users.created_with_default_pwd')}
                </p>
              )}
              {/* El ajuste está activado pero el servidor devolvió una temporal
                  aleatoria (típicamente: la Edge Function desplegada es anterior
                  al soporte de contraseña predeterminada). Antes esto fallaba en
                  SILENCIO y se repartía la predeterminada a gente que nunca la
                  tuvo: 50 personas sin poder entrar. */}
              {defaultPwdOn && !createdWithDefaultPwd && (
                <p className="text-[12px] text-amber-500 mt-2">
                  {t('admin.users.default_pwd_ignored')}
                </p>
              )}
              {countryIgnored && (
                <p className="text-[12px] text-amber-500 mt-2">
                  {t('admin.users.country_ignored')}
                </p>
              )}
              {unitsIgnored && (
                <p className="text-[12px] text-amber-500 mt-2">
                  {t('admin.users.units_ignored')}
                </p>
              )}
              {/* Se pidió un cliente y entró como empleado interno: hay que
                  decirlo, porque la diferencia es qué contenido va a ver. */}
              {clientIgnored && (
                <p className="text-[12px] text-red-500 mt-2">
                  {t('admin.users.client_ignored')}
                </p>
              )}
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => copyCreds('__new__', createdEmail, createdPassword)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium text-black min-h-[40px]"
                  style={{ background: '#10D451' }}
                >
                  {copiedId === '__new__' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {i18n.t('admin.users.copy_creds')}
                </button>
                <button
                  onClick={() => { setInviting(false); setInviteSuccess(false) }}
                  className="flex items-center min-h-[40px] px-3 text-[12px] text-text-subtle hover:text-text transition-colors"
                >
                  {i18n.t('common.close', 'Cerrar')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                placeholder={i18n.t('admin.users.ph_name')}
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                className="w-full rounded-xl px-4 py-2.5 text-[14px] text-text bg-subtle border border-line outline-none min-h-[44px]"
              />
              <div>
                <input
                  type="email"
                  placeholder={i18n.t('admin.users.ph_email')}
                  value={inviteEmail}
                  onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null); setEmailCheck(null) }}
                  onBlur={() => checkEmailAvailability(inviteEmail)}
                  className={cn(
                    'w-full rounded-xl px-4 py-2.5 text-[14px] text-text bg-subtle border outline-none min-h-[44px]',
                    emailCheck?.state === 'taken' ? 'border-red-500/60' : 'border-line',
                  )}
                />
                {/* Lo que decide si se puede dar de alta es el CORREO, no el
                    nombre: se comprueba contra auth.users antes de crear nada. */}
                {emailCheck?.state === 'checking' && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-text-muted">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('admin.users.email_checking')}
                  </p>
                )}
                {emailCheck?.state === 'free' && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: '#16a34a' }}>
                    <Check className="h-3 w-3" />
                    {t('admin.users.email_free')}
                  </p>
                )}
                {emailCheck?.state === 'taken' && (
                  <p className="mt-1.5 text-[11.5px] text-red-500">{emailCheck.message}</p>
                )}
              </div>
              {/* ¿ES DE UN CLIENTE?
                  Va arriba del todo porque cambia el resto del formulario: un
                  cliente no tiene área ni CR, y su país no se limita a los
                  cuatro con operación. Solo lo ofrece el panel a quien de verdad
                  puede (superadmin o capacitador con permiso de altas); el
                  servidor lo vuelve a comprobar, que es donde manda. */}
              {canCreateClients && inviteRole === 'learner' && (
                <div className={cn(
                  'flex items-start gap-3 rounded-xl border p-3',
                  inviteIsClient ? 'border-sky-500/45 bg-sky-500/[0.06]' : 'border-line',
                )}>
                  <span className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    inviteIsClient ? 'bg-sky-500/12 text-sky-500' : 'bg-subtle text-text-muted',
                  )}>
                    <Briefcase className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-text">{t('admin.users.is_client_title')}</p>
                    <p className="text-[12px] text-text-muted leading-relaxed mt-0.5">
                      {inviteIsClient
                        ? t('admin.users.is_client_on')
                        : t('admin.users.is_client_off')}
                    </p>
                    {inviteIsClient && (
                      <input
                        type="text"
                        placeholder={t('admin.users.client_name_ph')}
                        value={inviteClientName}
                        onChange={(e) => setInviteClientName(e.target.value)}
                        className="mt-2.5 w-full rounded-xl px-3 py-2 text-[13px] text-text bg-subtle border border-line outline-none min-h-[40px]"
                      />
                    )}
                  </div>
                  <Toggle
                    on={inviteIsClient}
                    onClick={() => setInviteIsClient((v) => !v)}
                    label={t('admin.users.is_client_title')}
                  />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">Rol</label>
                  {isSuperAdmin ? (
                    <Select
                      value={inviteRole}
                      onChange={(v) => setInviteRole(v as Profile['role'])}
                      options={roleOptions}
                    />
                  ) : (
                    // El capacitador solo da de alta aprendices: se muestra el rol
                    // resultante en vez de un selector con una sola opción.
                    <div className="flex items-center gap-2 min-h-[44px]">
                      <span
                        className="rounded-lg px-2.5 py-1 text-[12px] font-medium"
                        style={{ background: roleColors.learner, color: roleText.learner }}
                      >
                        {roleLabel.learner}
                      </span>
                      <span className="text-[11px] text-text-subtle">
                        {t('admin.users.role_locked_learner')}
                      </span>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">
                    {i18n.t('profile.country')}
                    {needsCountry && <span className="ml-0.5 text-[#10D451]">*</span>}
                  </label>
                  <Select
                    value={inviteCountry}
                    onChange={setInviteCountry}
                    placeholder={needsCountry ? t('admin.users.pick_country') : t('admin.users.country_optional')}
                    searchable={inviteIsClient}
                    options={[
                      ...(needsCountry ? [] : [{ value: '', label: t('admin.users.country_optional') }]),
                      // Solo los países donde hay operación (los mismos del paso 1
                      // de la audiencia del curso): otro país no casaría con ningún curso.
                      // Al CLIENTE sí se le ofrece la lista entera: es de fuera y
                      // puede estar donde sea, y su país no decide ninguna audiencia.
                      ...[...(inviteIsClient ? COUNTRIES : OPERATION_COUNTRIES)]
                        .sort((a, b) => a.name.localeCompare(b.name, 'es'))
                        .map((c) => ({ value: c.code, label: `${c.flag} ${c.name}` })),
                    ]}
                  />
                </div>
                {/* Área y CR son la estructura INTERNA: el cliente no está en
                    ella, así que no se le piden. Un CR inventado para pasar el
                    formulario es lo que acabaría metiéndolo en la audiencia de un
                    curso de la casa. */}
                {!inviteIsClient && (
                <>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">
                    {t('admin.users.area_label')}
                    {needsCountry && <span className="ml-0.5 text-[#10D451]">*</span>}
                  </label>
                  <Select
                    value={inviteArea}
                    onChange={setInviteArea}
                    placeholder={needsCountry ? t('admin.users.pick_area') : t('admin.users.area_optional')}
                    disabled={units === null}
                    options={[
                      ...(needsCountry ? [] : [{ value: '', label: t('admin.users.area_optional') }]),
                      ...areaOptions,
                    ]}
                  />
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">
                    {t('admin.users.cr_label')}
                    {needsCountry && <span className="ml-0.5 text-[#10D451]">*</span>}
                  </label>
                  <Select
                    value={inviteOperation}
                    onChange={setInviteOperation}
                    placeholder={needsCountry ? t('admin.users.pick_cr') : t('admin.users.cr_optional')}
                    disabled={units === null}
                    searchable
                    searchPlaceholder={t('admin.users.cr_search')}
                    options={[
                      ...(needsCountry ? [] : [{ value: '', label: t('admin.users.cr_optional') }]),
                      ...operationOptions,
                    ]}
                  />
                </div>
                </>
                )}
              </div>
              {missingCountry && (
                <p className="text-[12px] text-text-muted">{t('admin.users.country_required_hint')}</p>
              )}
              {inviteError && <p className="text-red-500 text-[12px]">{inviteError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleInvite}
                  disabled={inviteLoading || !inviteEmail || missingCountry || missingClientName || emailCheck?.state === 'taken' || emailCheck?.state === 'checking'}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black disabled:opacity-50 min-h-[44px]"
                  style={{ background: '#10D451' }}
                >
                  {inviteLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {i18n.t('admin.users.create_submit')}
                </button>
                <button
                  onClick={() => setInviting(false)}
                  className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle transition-colors"
                >
                  {i18n.t('admin.courses.cancel')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && (
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('admin.users.search_ph')}
              className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2.5 text-[14px] text-text outline-none focus:border-primary min-h-[44px]"
            />
          </div>
          <Select
            className="sm:w-52"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[
              { value: 'active', label: t('admin.users.filter_active') },
              {
                value: 'inactive',
                label: inactiveCount > 0
                  ? t('admin.users.filter_inactive_n', { n: inactiveCount })
                  : t('admin.users.filter_inactive'),
              },
              { value: 'all', label: t('admin.users.filter_all') },
            ]}
          />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : (
        <FadeIn y={14}>
          {/* Barra de scroll horizontal + encabezado FIJOS arriba: al bajar por
              la lista siguen a la vista, así el scroll de arriba se puede usar
              siempre y las columnas nunca quedan sin título. El encabezado vive
              fuera del contenedor con scroll (si viviera dentro, `sticky` se
              mediría contra ese contenedor y no contra la página) y se desplaza
              por código, sincronizado con el cuerpo. */}
          {/* En móvil la barra superior del panel (fija, 56px) tapa el borde de
              arriba del área con scroll: por eso el encabezado se pega a 14. */}
          <div className="sticky top-14 md:top-0 z-20 bg-bg">
            <div
              ref={topScrollRef}
              onScroll={() => syncScroll('top')}
              className="h-3 overflow-x-auto overscroll-x-contain"
              aria-hidden
            >
              {/* Altura fija arriba (12px = alto del scrollbar en globals.css):
                  con `height:auto` la caja mide lo que su contenido (1px) y el
                  navegador no deja sitio para pintar la barra. */}
              <div style={{ minWidth: tableMinWidth, height: 1 }} />
            </div>
            <div ref={headScrollRef} className="mt-1 overflow-hidden rounded-t-2xl border border-b-0 border-line">
              <div style={{ minWidth: tableMinWidth }}>
                <div className="grid gap-4 px-5 py-3 text-[11px] uppercase tracking-wider text-text-muted bg-subtle"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <span>{t('admin.users.col_user')}</span>
                  <span>{t('admin.users.col_role')}</span>
                  <span>{t('admin.users.col_actions')}</span>
                  {isSuperAdmin && <span />}
                </div>
              </div>
            </div>
          </div>
          <div
            ref={tableScrollRef}
            onScroll={() => syncScroll('table')}
            className="rounded-b-2xl border border-t-0 border-line overflow-x-auto overscroll-x-contain"
          >
          <div style={{ minWidth: tableMinWidth }}>
          <div className="divide-y divide-line">
            {filteredUsers.map((user) => (
              <div key={user.id} className="grid gap-4 px-5 py-3.5 items-center transition-colors hover:bg-subtle/40"
                style={{ gridTemplateColumns: gridCols }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative shrink-0">
                    <Avatar src={user.avatar_url} name={user.display_name} size={32} />
                    {user.role === 'superadmin' && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface ring-1 ring-line">
                        <Shield className="h-2.5 w-2.5 text-yellow-500" />
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    {editingId === user.id ? (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <input
                          autoFocus
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveName(user.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          placeholder={t('admin.users.ph_name')}
                          className="min-w-0 flex-1 rounded-lg px-2 py-1 text-[13px] text-text bg-subtle border border-line outline-none focus:border-primary"
                        />
                        <Tooltip label={t('admin.courses.save')} className="shrink-0">
                        <button
                          onClick={() => handleSaveName(user.id)}
                          className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-green-600 hover:bg-green-500/10 transition-colors"
                          aria-label={t('admin.courses.save')}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        </Tooltip>
                        <Tooltip label={t('admin.courses.cancel')} className="shrink-0">
                        <button
                          onClick={() => setEditingId(null)}
                          className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                          aria-label={t('admin.courses.cancel')}
                        >
                          <X className="h-4 w-4" />
                        </button>
                        </Tooltip>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0 group">
                        <button
                          onClick={() => navigate(`/admin/users/${user.id}`)}
                          className="text-[13px] text-text truncate text-left hover:text-primary hover:underline transition-colors"
                          title={t('admin.users.view_profile')}
                        >
                          {user.display_name ?? 'Sin nombre'}
                        </button>
                        {isSuperAdmin && (
                          <Tooltip label={t('admin.users.edit_name')} className="shrink-0">
                            <button
                              onClick={() => startEditName(user)}
                              className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-text-subtle hover:text-text hover:bg-glass/6 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                              aria-label={t('admin.users.edit_name')}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </Tooltip>
                        )}
                        {(passkeys[user.id]?.count ?? 0) > 0 && (
                          <Tooltip
                            label={t('passkey.admin_count', { count: passkeys[user.id].count })}
                            className="shrink-0"
                            maxWidth={240}
                          >
                            <span
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: 'rgba(16,212,81,0.14)', color: '#0ca23e' }}
                            >
                              <Fingerprint className="h-3 w-3" />
                              {passkeys[user.id].count}
                            </span>
                          </Tooltip>
                        )}
                        {/* CLIENTE. Se marca en la lista porque de un vistazo
                            no hay forma de distinguirlo de un empleado, y lo que
                            ve uno y otro no es lo mismo: al cliente no le llega
                            nada por regla ni ve el catálogo. */}
                        {user.is_client && (
                          <Tooltip
                            label={t('admin.users.client_badge_tip', {
                              name: user.client_name ?? '—',
                            })}
                            className="shrink-0"
                            maxWidth={260}
                          >
                            <span
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: 'rgba(14,165,233,0.14)', color: '#0284c7' }}
                            >
                              <Briefcase className="h-3 w-3" />
                              {user.client_name || t('admin.users.client_badge')}
                            </span>
                          </Tooltip>
                        )}
                        {/* De un vistazo: a quiénes escogió el superadmin.
                            Sin esto el permiso solo se ve entrando al icono. */}
                        {isSuperAdmin && user.role === 'capacitador' && user.is_guest_author && (
                          <Tooltip
                            label={t('admin.users.guest_author_hint', 'Autor temporal: prepara contenido en su programa, pero no asigna formación ni publica.')}
                            className="shrink-0"
                            maxWidth={260}
                          >
                            <span
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: 'rgba(179,61,158,0.14)', color: '#9B2E88' }}
                            >
                              <PenLine className="h-3 w-3" />
                              {t('admin.users.guest_author_badge', 'Autor temporal')}
                            </span>
                          </Tooltip>
                        )}
                        {isSuperAdmin && user.role === 'capacitador' && user.can_create_learners && (
                          <Tooltip
                            label={t('admin.users.can_create_badge_hint')}
                            className="shrink-0"
                            maxWidth={250}
                          >
                            <span
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: 'rgba(16,212,81,0.14)', color: '#0ca23e' }}
                            >
                              <UserRoundPlus className="h-3 w-3" />
                              {t('admin.users.can_create_badge')}
                            </span>
                          </Tooltip>
                        )}
                        {isSuperAdmin && user.role === 'capacitador' && user.can_approve_courses && (
                          <Tooltip
                            label={t('admin.users.can_approve_badge_hint')}
                            className="shrink-0"
                            maxWidth={250}
                          >
                            <span
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: 'rgba(179,61,158,0.14)', color: '#B33D9E' }}
                            >
                              <BadgeCheck className="h-3 w-3" />
                              {t('admin.users.can_approve_badge')}
                            </span>
                          </Tooltip>
                        )}
                        {user.is_active === false && (
                          <Tooltip
                            label={
                              user.deactivated_at
                                ? t('admin.users.inactive_since', {
                                    date: new Date(user.deactivated_at).toLocaleDateString(),
                                    reason: user.deactivation_reason ?? '—',
                                  })
                                : t('admin.users.inactive_hint')
                            }
                            className="shrink-0"
                            maxWidth={260}
                          >
                            <span
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: 'rgba(239,68,68,0.15)', color: '#dc2626' }}
                            >
                              <UserMinus className="h-3 w-3" />
                              {t('admin.users.inactive')}
                            </span>
                          </Tooltip>
                        )}
                        {!user.onboarded && (
                          <Tooltip label={t('admin.users.pending_hint')} className="shrink-0" maxWidth={240}>
                            <span
                              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: 'rgba(245,158,11,0.15)', color: '#d97706' }}
                            >
                              <Clock className="h-3 w-3" />
                              {t('admin.users.pending')}
                            </span>
                          </Tooltip>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-1 min-w-0 group">
                      <div className="text-[11px] text-text-subtle truncate">
                        {/* `profiles.email` primero; la credencial temporal solo
                            cubre a quien no ha entrado nunca, y el id es el
                            último recurso si el SQL del correo no se ha corrido. */}
                        {emailOf(user) ?? `${user.id.slice(0, 8)}…`}
                      </div>
                      {isSuperAdmin && (
                        <Tooltip label={t('admin.users.edit_email_hint')} className="shrink-0" maxWidth={260}>
                          <button
                            onClick={() => setEmailUser(user)}
                            className="h-6 w-6 shrink-0 flex items-center justify-center rounded-md text-text-subtle hover:text-text hover:bg-glass/6 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                            aria-label={t('admin.users.edit_email')}
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                    {(user.job_title || user.national_id || user.phone) && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-text-muted">
                        {user.job_title && <span className="truncate">{user.job_title}</span>}
                        {user.national_id && (
                          <>
                            {user.job_title && <span className="text-text-subtle">·</span>}
                            <span className="truncate">{t('profile.national_id')}: {user.national_id}</span>
                          </>
                        )}
                        {user.phone && (
                          <>
                            {(user.job_title || user.national_id) && <span className="text-text-subtle">·</span>}
                            <span className="truncate">{user.phone}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {isSuperAdmin ? (
                  <Select
                    compact
                    tinted
                    className="w-full min-w-0"
                    value={user.role}
                    onChange={(v) => handleRoleChange(user.id, v as Profile['role'])}
                    options={roleOptions}
                  />
                ) : (
                  <span
                    className="justify-self-start rounded-lg px-2.5 py-1 text-[11px] font-medium"
                    style={{ background: roleColors[user.role], color: roleText[user.role] }}
                  >
                    {roleLabel[user.role]}
                  </span>
                )}
                {/* Cada acción explica QUÉ hace al pasar el mouse: los iconos
                    solos no se adivinan, y el `title` del navegador tarda un
                    segundo largo en salir y se ve distinto en cada sistema. */}
                <div className="flex items-center gap-1 min-w-0">
                  {/* `min-w-0` en el envoltorio: ahora el elemento flex es él, y
                      sin eso el botón deja de encogerse y desborda la columna. */}
                  <Tooltip label={t('admin.users.view_profile_hint')} className="min-w-0" maxWidth={240}>
                    <button
                      onClick={() => navigate(`/admin/users/${user.id}`)}
                      className="h-9 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors min-w-0"
                    >
                      <IdCard className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t('admin.users.view_profile')}</span>
                    </button>
                  </Tooltip>
                  {tempCreds[user.id] && (
                    <Tooltip
                      label={
                        (() => {
                          const d = diasRestantes(tempCreds[user.id].expires_at)
                          return d == null
                            ? t('admin.users.copy_creds_hint')
                            : `${t('admin.users.copy_creds_hint')} ${t('admin.users.creds_expire_in', { count: d })}`
                        })()
                      }
                      className="min-w-0"
                      maxWidth={280}
                    >
                      <button
                        onClick={() => copyCreds(user.id, tempCreds[user.id].email, tempCreds[user.id].temp_password)}
                        className="h-9 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] font-medium transition-colors min-w-0"
                        style={{ color: copiedId === user.id ? '#16a34a' : '#d97706' }}
                      >
                        {copiedId === user.id ? <Check className="h-4 w-4 shrink-0" /> : <Copy className="h-4 w-4 shrink-0" />}
                        <span className="truncate">{t('admin.users.copy_creds')}</span>
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label={t('admin.users.view_progress_hint')} className="shrink-0" maxWidth={240}>
                    <button
                      onClick={() => setProgressUser(user)}
                      className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                      aria-label={t('admin.users.view_progress')}
                    >
                      <BarChart3 className="h-4 w-4" />
                    </button>
                  </Tooltip>
                  {isSuperAdmin && (
                    <Tooltip label={t('admin.users.manage_courses_hint')} className="shrink-0" maxWidth={240}>
                      <button
                        onClick={() => setResetUser(user)}
                        className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                        aria-label={t('admin.users.manage_courses')}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  )}
                  {/* Permiso de altas: solo tiene sentido en un capacitador
                      (el superadmin ya puede y el aprendiz nunca podrá). */}
                  {isSuperAdmin && user.role === 'capacitador' && (
                    <Tooltip
                      label={
                        user.can_create_learners
                          ? t('admin.users.can_create_on_hint')
                          : t('admin.users.can_create_off_hint')
                      }
                      className="shrink-0"
                      maxWidth={250}
                    >
                      <button
                        onClick={() => handleToggleCanCreate(user)}
                        className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-colors ${
                          user.can_create_learners
                            ? 'text-green-600 hover:bg-green-500/10'
                            : 'text-text-subtle hover:text-text hover:bg-glass/6'
                        }`}
                        aria-label={t('admin.users.can_create_label')}
                        aria-pressed={user.can_create_learners === true}
                      >
                        <UserRoundPlus className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  )}
                  {/* Permiso de aprobar publicaciones: la otra puerta que el
                      superadmin abre persona por persona. Solo en capacitadores
                      (el superadmin ya aprueba y el aprendiz nunca lo hará). */}
                  {isSuperAdmin && user.role === 'capacitador' && (
                    <Tooltip
                      label={
                        user.can_approve_courses
                          ? t('admin.users.can_approve_on_hint')
                          : t('admin.users.can_approve_off_hint')
                      }
                      className="shrink-0"
                      maxWidth={260}
                    >
                      <button
                        onClick={() => handleToggleCanApprove(user)}
                        className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-colors ${
                          user.can_approve_courses
                            ? 'text-[#B33D9E] hover:bg-[#B33D9E]/10'
                            : 'text-text-subtle hover:text-text hover:bg-glass/6'
                        }`}
                        aria-label={t('admin.users.can_approve_label')}
                        aria-pressed={user.can_approve_courses === true}
                      >
                        <BadgeCheck className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  )}
                  {/* Autor temporal: la tercera puerta. A diferencia de las dos
                      de arriba, esta QUITA permisos en vez de darlos — por eso
                      el candado de verdad está en la base (políticas
                      restrictivas y un trigger), no en este botón. */}
                  {isSuperAdmin && user.role === 'capacitador' && (
                    <Tooltip
                      label={
                        user.is_guest_author
                          ? t('admin.users.guest_author_on_hint', 'Es autor temporal: prepara contenido, pero no asigna formación ni publica. Toca para devolverle todo.')
                          : t('admin.users.guest_author_off_hint', 'Marcar como autor temporal: podrá crear contenido en su programa, pero no asignar formación ni publicar.')
                      }
                      className="shrink-0"
                      maxWidth={280}
                    >
                      <button
                        onClick={() => handleToggleGuestAuthor(user)}
                        className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-colors ${
                          user.is_guest_author
                            ? 'text-[#B33D9E] hover:bg-[#B33D9E]/10'
                            : 'text-text-subtle hover:text-text hover:bg-glass/6'
                        }`}
                        aria-label={t('admin.users.guest_author_label', 'Autor temporal')}
                        aria-pressed={user.is_guest_author === true}
                      >
                        <PenLine className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  )}
                  {/* Dar de baja: cualquier rol menos uno mismo. El staff también
                      se va de la empresa, y hasta ahora la única salida era
                      borrarlo —que sí pierde el rastro. La baja conserva todo. */}
                  {isSuperAdmin && user.id !== authUser?.id && (
                    <Tooltip
                      label={user.is_active === false ? t('admin.users.reactivate_hint') : t('admin.users.deactivate_hint')}
                      className="shrink-0"
                      maxWidth={250}
                    >
                      <button
                        onClick={() => handleToggleActive(user)}
                        disabled={togglingId === user.id}
                        className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
                          user.is_active === false
                            ? 'text-green-600 hover:bg-green-500/10'
                            : 'text-text-subtle hover:text-amber-600 hover:bg-amber-500/10'
                        }`}
                        aria-label={user.is_active === false ? t('admin.users.reactivate') : t('admin.users.deactivate')}
                      >
                        {togglingId === user.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : user.is_active === false
                            ? <UserCheck className="h-4 w-4" />
                            : <UserMinus className="h-4 w-4" />}
                      </button>
                    </Tooltip>
                  )}
                  {isSuperAdmin && (
                    <Tooltip label={t('admin.users.reset_pwd_hint')} className="shrink-0" maxWidth={250}>
                      <button
                        onClick={() => handleResetPassword(user)}
                        disabled={resettingPwdFor === user.id}
                        className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 disabled:opacity-50 transition-colors"
                        aria-label={t('admin.users.reset_pwd')}
                      >
                        {resettingPwdFor === user.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <KeyRound className="h-4 w-4" />}
                      </button>
                    </Tooltip>
                  )}
                  {isSuperAdmin && (user.role === 'capacitador' || user.role === 'superadmin') && (
                    <Tooltip label={t('admin.transfer.hint')} className="shrink-0" maxWidth={260}>
                      <button
                        onClick={() => setTransferFor(user)}
                        className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                        aria-label={t('admin.transfer.title')}
                      >
                        <Replace className="h-4 w-4" />
                      </button>
                    </Tooltip>
                  )}
                </div>
                {isSuperAdmin && (
                  <Tooltip label={t('admin.users.delete_user_hint')} maxWidth={240}>
                    <button
                      onClick={() => handleDelete(user)}
                      disabled={deletingId === user.id}
                      className="h-10 w-10 flex items-center justify-center rounded-lg text-text-subtle hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                      aria-label={i18n.t('admin.users.delete_user')}
                    >
                      {deletingId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </Tooltip>
                )}
              </div>
            ))}
            {filteredUsers.length === 0 && (
              <div className="py-12 text-center text-text-muted text-[14px]">
                {users.length === 0 ? t('admin.users.empty') : t('admin.users.no_results')}
              </div>
            )}
          </div>
          </div>
          </div>
        </FadeIn>
      )}

      {progressUser && (
        <UserProgressDrawer
          user={progressUser}
          campaignName={campaigns.find((c) => c.id === progressUser.campaign_id)?.name ?? null}
          onClose={() => setProgressUser(null)}
        />
      )}

      {resetUser && (
        <UserCourseResetModal user={resetUser} onClose={() => setResetUser(null)} />
      )}

      {bulkOpen && (
        <BulkImportUsers
          isSuperAdmin={isSuperAdmin}
          campaigns={assignableCampaigns}
          defaultPasswordOn={defaultPwdOn}
          onClose={() => setBulkOpen(false)}
          onImported={refreshData}
        />
      )}

      {hrOpen && (
        <HrRosterSyncModal
          campaigns={campaigns}
          canDeactivate={isSuperAdmin}
          onClose={() => setHrOpen(false)}
          onApplied={refreshData}
        />
      )}

      {pwdOpen && (
        <DefaultPasswordModal onClose={() => setPwdOpen(false)} onSaved={setDefaultPwdOn} />
      )}

      {emailUser && (
        <ChangeEmailModal
          user={emailUser}
          currentEmail={emailOf(emailUser)}
          isSelf={emailUser.id === authUser?.id}
          onClose={() => setEmailUser(null)}
          onSaved={(email) => applyNewEmail(emailUser.id, email)}
          describeTaken={(existing) => describeTakenEmail(existing, t)}
        />
      )}

      {transferFor && (
        <TransferContentModal
          user={transferFor}
          candidates={users.filter((u) => u.role === 'capacitador' || u.role === 'superadmin')}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
          onClose={() => setTransferFor(null)}
          onDone={() => { /* el contenido cambió de dueño; la lista de gente no. */ }}
        />
      )}

      {/* Una sola barra para toda la pantalla, como en los editores. */}
      <SaveDock
        pending={
          pendingCount > 0
            ? [{ id: 'users', label: t('admin.users.title', { defaultValue: 'Usuarios' }) }]
            : []
        }
        onSave={saveUsers}
        onUndo={undo}
        canUndo={canUndo}
      />
    </div>
  )
}
