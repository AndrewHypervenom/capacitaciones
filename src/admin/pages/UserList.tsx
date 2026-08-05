import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, UserPlus, UserRoundPlus, Shield, Trash2, Copy, Check, Clock, BookOpen, BarChart3, Search, Upload, Pencil, X, RotateCcw, IdCard, ImageDown, KeyRound, UserMinus, UserCheck, Users, Fingerprint } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'

import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'
import { recompressAllAvatars, type RecompressProgress } from '@/services/avatarMaintenance'
import { passkeyCounts } from '@/services/passkeys.service'
import {
  getAccessibleCampaigns,
  getAssignableCampaigns,
  getCampaignIdsByUser,
  setUserCampaigns as saveUserCampaigns,
} from '@/services/campaigns.service'
import { Avatar } from '@/components/ui/Avatar'
import { FadeIn } from '@/components/ui/motion'
import { Select } from '@/components/ui/Select'
import { Tooltip } from '@/components/ui/Tooltip'
import { MultiSelect } from '@/components/ui/MultiSelect'
import { UserCoursesModal } from '@/admin/components/UserCoursesModal'
import { UserCourseResetModal } from '@/admin/components/UserCourseResetModal'
import { UserProgressDrawer } from '@/admin/components/UserProgressDrawer'
import { BulkImportUsers } from '@/admin/components/BulkImportUsers'
import { HrRosterSyncModal } from '@/admin/components/HrRosterSyncModal'
import { DefaultPasswordModal } from '@/admin/components/DefaultPasswordModal'
import { getDefaultPassword } from '@/services/appSettings.service'
import { setUsersActive } from '@/services/hrSync.service'
import { resolveCreationCampaignId } from '@/stores/campaignScopeStore'
import type { Profile, Campaign } from '@/types/database'

// URL pública del sitio (la que se entrega al usuario junto a sus credenciales).
const SITE_URL = 'https://capacitaciones-chi.vercel.app/'

type ProfileWithEmail = Profile & { email?: string }

interface TempCred {
  email: string
  temp_password: string
}

// Bloque de texto listo para pegar en un correo/mensaje al usuario.
function buildCredsText(email: string, password: string): string {
  return `${i18n.t('admin.users.creds_site')}: ${SITE_URL}\n${i18n.t('admin.users.creds_email')}: ${email}\n${i18n.t('admin.users.creds_password')}: ${password}`
}

function mapCreds(rows: { user_id: string; email: string; temp_password: string }[] | null): Record<string, TempCred> {
  const m: Record<string, TempCred> = {}
  for (const r of rows ?? []) m[r.user_id] = { email: r.email, temp_password: r.temp_password }
  return m
}

export default function UserList() {
  const { isSuperAdmin, canCreateLearners, campaignId, user: authUser } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [assignUser, setAssignUser] = useState<ProfileWithEmail | null>(null)
  // Vista superadmin de cursos + restablecer progreso de una persona.
  const [resetUser, setResetUser] = useState<ProfileWithEmail | null>(null)
  // Panel lateral con el avance (cursos → módulos → actividades) sin salir de la lista.
  const [progressUser, setProgressUser] = useState<ProfileWithEmail | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  // Sincronización de altas y bajas contra la base de Talento Humano.
  const [hrOpen, setHrOpen] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  // Permiso de "puede crear aprendices" guardándose para un capacitador.
  const [togglingPermFor, setTogglingPermFor] = useState<string | null>(null)
  // Contraseña predeterminada para usuarios nuevos (ajuste global de superadmin).
  const [pwdOpen, setPwdOpen] = useState(false)
  const [defaultPwdOn, setDefaultPwdOn] = useState(false)
  const [search, setSearch] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')
  // Las cuentas dadas de baja no estorban el día a día: se ven si se piden.
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [users, setUsers] = useState<ProfileWithEmail[]>([])
  // Campañas de cada usuario: casa + colaboraciones. El capacitador puede tener
  // varias (equipos compartidos), así que no basta con profiles.campaign_id.
  const [userCampaigns, setUserCampaigns] = useState<Record<string, string[]>>({})
  const [savingCampaignsFor, setSavingCampaignsFor] = useState<string | null>(null)
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
  const [savingName, setSavingName] = useState(false)
  const [inviteRole, setInviteRole] = useState<'learner' | 'capacitador' | 'superadmin'>('learner')
  const [inviteCampaign, setInviteCampaign] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [createdEmail, setCreatedEmail] = useState('')
  const [createdPassword, setCreatedPassword] = useState('')
  const [createdWithDefaultPwd, setCreatedWithDefaultPwd] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [resettingPwdFor, setResettingPwdFor] = useState<string | null>(null)
  // Credenciales temporales pendientes por usuario (solo el superadmin las recibe
  // vía RLS). Permite copiar el bloque de credenciales de cualquier pendiente.
  const [tempCreds, setTempCreds] = useState<Record<string, TempCred>>({})
  // Dispositivos con ingreso biométrico por persona (solo informativo).
  const [passkeys, setPasskeys] = useState<Record<string, { count: number; lastUsedAt: string | null }>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // Recompresión masiva de avatares existentes (mantenimiento superadmin).
  const [optimizing, setOptimizing] = useState(false)
  const [optProgress, setOptProgress] = useState<RecompressProgress | null>(null)

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      const matchesQuery =
        !q ||
        (u.display_name ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q)
      // Filtra por pertenencia real (casa o colaboración), no solo por la casa:
      // si no, un capacitador con campaña casa A no aparecería al filtrar por B
      // aunque trabaje en B.
      const matchesCampaign =
        !campaignFilter || (userCampaigns[u.id] ?? []).includes(campaignFilter)
      // `is_active` puede venir undefined si el SQL de altas/bajas aún no se
      // corrió: sin la columna, todas las cuentas cuentan como activas.
      const active = u.is_active !== false
      const matchesStatus =
        statusFilter === 'all' || (statusFilter === 'active' ? active : !active)
      return matchesQuery && matchesCampaign && matchesStatus
    })
  }, [users, search, campaignFilter, statusFilter, userCampaigns])

  const inactiveCount = useMemo(() => users.filter((u) => u.is_active === false).length, [users])

  // El capacitador da de alta aprendices (nada más) en sus propias campañas, y
  // SOLO si el superadmin lo habilitó: el permiso se concede uno por uno, no
  // viene con el rol. Las BAJAS siguen siendo solo del superadmin: ese es el
  // punto de control del proceso de Talento Humano y no se delega.
  const canCreateUsers = isSuperAdmin || (canCreateLearners && assignableCampaigns.length > 0)
  // Capacitador sin el permiso: se le explica por qué no ve los botones, en vez
  // de dejar la pantalla muda.
  const showNoPermissionHint = !isSuperAdmin && !canCreateLearners
  // Sin campaña elegida el servidor rechaza el alta, así que el formulario la
  // exige antes de dejar crear.
  const needsCampaign = !isSuperAdmin
  const missingCampaign = needsCampaign && !inviteCampaign

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
        isSuperAdmin,
        homeCampaignId: campaignId,
        userId: authUser?.id ?? null,
      })
        .then(setAssignableCampaigns)
        .catch(() => setAssignableCampaigns(camps))

      let profilesQuery = supabase.from('profiles').select('*').order('created_at')
      if (!isSuperAdmin) {
        const ids = camps.map((c) => c.id)
        profilesQuery = profilesQuery
          .in('campaign_id', ids.length ? ids : [''])
          .neq('role', 'superadmin')
      }
      const [profiles, creds] = await Promise.all([
        profilesQuery,
        // La RLS decide qué filas llegan: el superadmin las ve todas y el
        // capacitador solo las de la gente de sus campañas.
        supabase.from('user_temp_credentials').select('user_id, email, temp_password'),
      ])
      const rows = profiles.data ?? []
      setUsers(rows)
      setUserCampaigns(await getCampaignIdsByUser(rows))
      setTempCreds(mapCreds(creds.data))
      setLoading(false)
      // Quién entra con huella. Va después de pintar la lista y en una sola
      // consulta agregada: es un adorno informativo, no debe retrasar nada.
      passkeyCounts(rows.map((r) => r.id)).then(setPasskeys).catch(() => {})
    }
    load()
  }, [isSuperAdmin, campaignId, authUser?.id])

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
      const ids = campaigns.map((c) => c.id)
      profilesQuery = profilesQuery
        .in('campaign_id', ids.length ? ids : [''])
        .neq('role', 'superadmin')
    }
    const [{ data: updated }, { data: creds }] = await Promise.all([
      profilesQuery,
      supabase.from('user_temp_credentials').select('user_id, email, temp_password'),
    ])
    const rows = updated ?? []
    setUsers(rows)
    setUserCampaigns(await getCampaignIdsByUser(rows))
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

  const copyCreds = (userId: string, email: string, password: string) => {
    navigator.clipboard.writeText(buildCredsText(email, password))
    setCopiedId(userId)
    setTimeout(() => setCopiedId((k) => (k === userId ? null : k)), 2000)
  }

  /**
   * Abre el formulario de alta arrancando en la campaña donde el panel está
   * parado: un capacitador con varias campañas crea en la que está mirando, no
   * en su casa. Sigue pudiendo cambiarla antes de crear.
   */
  const openInvite = () => {
    if (!isSuperAdmin) {
      // El capacitador no elige rol: siempre crea aprendices.
      setInviteRole('learner')
      setInviteCampaign((current) =>
        current || resolveCreationCampaignId(null, campaigns.map((c) => c.id)),
      )
    }
    setInviteSuccess(false)
    setInviteError(null)
    setInviting(true)
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || missingCampaign) return
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
            campaignId: inviteCampaign || null,
          }),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al crear usuario')

      setCreatedEmail(json.email ?? inviteEmail.trim())
      setCreatedPassword(json.password ?? '')
      setCreatedWithDefaultPwd(json.defaultPassword === true)
      setInviteSuccess(true)
      setInviteEmail('')
      setInviteName('')

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

  const handleSaveName = async (userId: string) => {
    const name = editName.trim()
    setSavingName(true)
    try {
      await supabase.from('profiles').update({ display_name: name || null }).eq('id', userId)
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, display_name: name || null } : u))
      setEditingId(null)
    } finally {
      setSavingName(false)
    }
  }

  const handleRoleChange = async (userId: string, newRole: Profile['role']) => {
    // Al dejar de ser capacitador se retira el permiso de altas: si mañana
    // vuelve a serlo, no debe recuperarlo solo por un permiso viejo colgado.
    const patch = newRole === 'capacitador'
      ? { role: newRole }
      : { role: newRole, can_create_learners: false }
    await supabase.from('profiles').update(patch).eq('id', userId)
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, ...patch } : u))
  }

  /**
   * Concede (o retira) a un capacitador el permiso de dar de alta aprendices en
   * sus campañas. Solo el superadmin lo mueve: la interfaz lo esconde y un
   * trigger en la base impide que nadie más lo cambie por su cuenta.
   */
  const handleToggleCanCreate = async (user: ProfileWithEmail) => {
    const next = user.can_create_learners !== true
    const name = user.display_name ?? user.email ?? user.id.slice(0, 8)
    // Optimista: el interruptor responde ya y se revierte si la BD rechaza.
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, can_create_learners: next } : u)))
    setTogglingPermFor(user.id)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ can_create_learners: next })
        .eq('id', user.id)
      if (error) throw error
      toast.success(
        next ? t('admin.users.can_create_granted', { name }) : t('admin.users.can_create_revoked', { name }),
      )
    } catch (err) {
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, can_create_learners: !next } : u)),
      )
      toast.error(t('admin.users.can_create_error'), (err as Error).message)
    } finally {
      setTogglingPermFor(null)
    }
  }

  /**
   * Guarda el conjunto EXACTO de campañas del usuario. Las que se quitan dejan
   * de verse de inmediato (la RLS deriva el acceso de esta pertenencia), y sin
   * ninguna el usuario queda sin campaña: no ve ni crea contenido.
   */
  const handleCampaignsChange = async (user: ProfileWithEmail, ids: string[]) => {
    const previous = userCampaigns[user.id] ?? []
    // Optimista: el select responde ya y revertimos si la BD rechaza.
    setUserCampaigns((prev) => ({ ...prev, [user.id]: ids }))
    setSavingCampaignsFor(user.id)
    try {
      const home = await saveUserCampaigns(user.id, ids, user.campaign_id ?? null)
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, campaign_id: home } : u)))
    } catch (err) {
      setUserCampaigns((prev) => ({ ...prev, [user.id]: previous }))
      toast.error(t('admin.users.campaigns_save_error'), (err as Error).message)
    } finally {
      setSavingCampaignsFor(null)
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
   * Da de baja (o vuelve a dar de alta) a una persona. La baja NO borra: bloquea
   * el ingreso y la saca de listados y contadores, conservando su historial, así
   * que reactivarla la devuelve exactamente donde estaba.
   */
  const handleToggleActive = async (user: ProfileWithEmail) => {
    const name = user.display_name ?? user.email ?? user.id.slice(0, 8)
    const deactivating = user.is_active !== false
    const ok = await confirm({
      title: deactivating ? t('admin.users.deactivate') : t('admin.users.reactivate'),
      description: deactivating
        ? t('admin.users.deactivate_confirm', { name })
        : t('admin.users.reactivate_confirm', { name }),
      confirmLabel: deactivating ? t('admin.users.deactivate') : t('admin.users.reactivate'),
      tone: deactivating ? 'danger' : 'default',
    })
    if (!ok) return

    setTogglingId(user.id)
    try {
      const { updated, skipped } = await setUsersActive([user.id], !deactivating)
      if (updated === 0) {
        throw new Error(skipped[0]?.reason ?? t('admin.users.status_no_change'))
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_active: !deactivating } : u)),
      )
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
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al eliminar usuario')
    } finally {
      setDeletingId(null)
    }
  }

  // Colores del badge de rol — tonos medios que funcionan en temas claro y oscuro
  const roleColors: Record<Profile['role'], string> = {
    superadmin: 'rgba(245,158,11,0.15)',
    capacitador: 'rgba(34,197,94,0.15)',
    learner: 'rgba(100,116,139,0.12)',
  }
  const roleText: Record<Profile['role'], string> = {
    superadmin: '#d97706',
    capacitador: '#16a34a',
    learner: '#64748b',
  }
  const roleLabel: Record<Profile['role'], string> = {
    superadmin: t('roles.superadmin'),
    capacitador: t('roles.capacitador'),
    learner: t('roles.learner'),
  }
  const roleOptions = (['learner', 'capacitador', 'superadmin'] as const).map((r) => ({
    value: r,
    label: roleLabel[r],
    color: roleText[r],
  }))
  const campaignOptions = (empty: string) => [
    { value: '', label: empty },
    ...campaigns.map((c) => ({ value: c.id, label: c.name })),
  ]

  // La tabla NO se colapsa en pantallas chicas: mantiene sus columnas a un ancho
  // legible y el contenedor hace scroll horizontal. Columnas fijas (no `auto`)
  // para que encabezado y filas queden siempre alineados aunque una fila tenga
  // más botones que otra (p. ej. "copiar credenciales").
  const gridCols = isSuperAdmin
    // 589px = 549 de antes + 40 del interruptor de "puede crear aprendices"
    // (solo aparece en filas de capacitador, pero la columna es fija para que
    // encabezado y filas queden alineados).
    ? 'minmax(280px,1fr) 150px 210px 589px 48px'
    // El capacitador también puede copiar credenciales de su gente: la columna
    // de acciones necesita espacio para ese botón.
    : 'minmax(280px,1fr) 150px 490px'
  const tableMinWidth = isSuperAdmin ? 1329 : 940

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
            <Tooltip label={t('admin.hr.button_hint')} maxWidth={260}>
            <button
              onClick={() => setHrOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-text bg-subtle border border-line min-h-[44px]"
            >
              <Users className="h-4 w-4" />
              {t('admin.hr.button')}
            </button>
            </Tooltip>
            </>
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
              <input
                type="email"
                placeholder={i18n.t('admin.users.ph_email')}
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null) }}
                className="w-full rounded-xl px-4 py-2.5 text-[14px] text-text bg-subtle border border-line outline-none min-h-[44px]"
              />
              <div className="grid grid-cols-2 gap-3">
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
                    {i18n.t('admin.users.col_campaign')}
                    {needsCampaign && <span className="ml-0.5 text-[#10D451]">*</span>}
                  </label>
                  <Select
                    value={inviteCampaign}
                    onChange={setInviteCampaign}
                    options={
                      needsCampaign
                        ? assignableCampaigns.map((c) => ({ value: c.id, label: c.name }))
                        : campaignOptions(i18n.t('admin.worlds.no_campaign'))
                    }
                    placeholder={t('admin.users.pick_campaign')}
                  />
                </div>
              </div>
              {missingCampaign && (
                <p className="text-[12px] text-text-muted">{t('admin.users.pick_campaign_hint')}</p>
              )}
              {inviteError && <p className="text-red-500 text-[12px]">{inviteError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleInvite}
                  disabled={inviteLoading || !inviteEmail || missingCampaign}
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
          {(isSuperAdmin || campaigns.length > 1) && (
            <Select
              className="sm:w-56"
              value={campaignFilter}
              onChange={setCampaignFilter}
              options={campaignOptions(t('admin.users.all_campaigns'))}
            />
          )}
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
        <FadeIn className="rounded-2xl border border-line overflow-x-auto overscroll-x-contain" y={14}>
          <div style={{ minWidth: tableMinWidth }}>
          <div className="grid gap-4 px-5 py-3 text-[11px] uppercase tracking-wider text-text-muted bg-subtle"
            style={{ gridTemplateColumns: gridCols }}
          >
            <span>{t('admin.users.col_user')}</span>
            <span>{t('admin.users.col_role')}</span>
            {isSuperAdmin && <span>{t('admin.users.col_campaign')}</span>}
            <span>{t('admin.users.col_actions')}</span>
            {isSuperAdmin && <span />}
          </div>
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
                          disabled={savingName}
                          className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-green-600 hover:bg-green-500/10 disabled:opacity-50 transition-colors"
                          aria-label={t('admin.courses.save')}
                        >
                          {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
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
                    <div className="text-[11px] text-text-subtle truncate">
                      {tempCreds[user.id]?.email ?? `${user.id.slice(0, 8)}…`}
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
                {isSuperAdmin && (
                  <div className="flex items-center gap-1.5 min-w-0">
                    {user.role === 'learner' ? (
                      // El aprendiz vive en UNA campaña: su progreso, inscripciones
                      // y certificados cuelgan de ella.
                      <Select
                        compact
                        className="w-full min-w-0"
                        value={user.campaign_id ?? ''}
                        onChange={(v) => handleCampaignsChange(user, v ? [v] : [])}
                        options={campaignOptions(i18n.t('admin.worlds.no_campaign'))}
                      />
                    ) : (
                      <MultiSelect
                        compact
                        className="w-full min-w-0"
                        values={userCampaigns[user.id] ?? []}
                        onChange={(ids) => handleCampaignsChange(user, ids)}
                        options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
                        placeholder={i18n.t('admin.worlds.no_campaign')}
                        summary={(n) => t('admin.users.campaigns_count', { count: n })}
                        aria-label={t('admin.users.col_campaign')}
                      />
                    )}
                    {savingCampaignsFor === user.id && (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-subtle" />
                    )}
                  </div>
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
                    <Tooltip label={t('admin.users.copy_creds_hint')} className="min-w-0" maxWidth={240}>
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
                  <Tooltip label={t('admin.users.assign_courses_hint')} className="min-w-0" maxWidth={240}>
                    <button
                      onClick={() => setAssignUser(user)}
                      className="h-9 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors min-w-0"
                    >
                      <BookOpen className="h-4 w-4 shrink-0" />
                      <span className="truncate">{t('admin.users.assign_courses')}</span>
                    </button>
                  </Tooltip>
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
                        disabled={togglingPermFor === user.id}
                        className={`h-10 w-10 shrink-0 flex items-center justify-center rounded-lg transition-colors disabled:opacity-50 ${
                          user.can_create_learners
                            ? 'text-green-600 hover:bg-green-500/10'
                            : 'text-text-subtle hover:text-text hover:bg-glass/6'
                        }`}
                        aria-label={t('admin.users.can_create_label')}
                        aria-pressed={user.can_create_learners === true}
                      >
                        {togglingPermFor === user.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <UserRoundPlus className="h-4 w-4" />}
                      </button>
                    </Tooltip>
                  )}
                  {isSuperAdmin && user.role === 'learner' && (
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
        </FadeIn>
      )}

      {assignUser && (
        <UserCoursesModal user={assignUser} onClose={() => setAssignUser(null)} />
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
          onClose={() => setHrOpen(false)}
          onApplied={refreshData}
        />
      )}

      {pwdOpen && (
        <DefaultPasswordModal onClose={() => setPwdOpen(false)} onSaved={setDefaultPwdOn} />
      )}
    </div>
  )
}
