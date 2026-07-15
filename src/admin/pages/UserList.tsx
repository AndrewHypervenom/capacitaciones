import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, UserPlus, Shield, Trash2, Copy, Check, Clock, BookOpen, BarChart3, Search, Upload, Pencil, X, RotateCcw, IdCard, ImageDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'

import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'
import { recompressAllAvatars, type RecompressProgress } from '@/services/avatarMaintenance'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { Avatar } from '@/components/ui/Avatar'
import { Select } from '@/components/ui/Select'
import { UserCoursesModal } from '@/admin/components/UserCoursesModal'
import { UserCourseResetModal } from '@/admin/components/UserCourseResetModal'
import { BulkImportUsers } from '@/admin/components/BulkImportUsers'
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
  const { isSuperAdmin, campaignId, user: authUser } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [assignUser, setAssignUser] = useState<ProfileWithEmail | null>(null)
  // Vista superadmin de cursos + restablecer progreso de una persona.
  const [resetUser, setResetUser] = useState<ProfileWithEmail | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')
  const [users, setUsers] = useState<ProfileWithEmail[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
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
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Credenciales temporales pendientes por usuario (solo el superadmin las recibe
  // vía RLS). Permite copiar el bloque de credenciales de cualquier pendiente.
  const [tempCreds, setTempCreds] = useState<Record<string, TempCred>>({})
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
      const matchesCampaign = !campaignFilter || u.campaign_id === campaignFilter
      return matchesQuery && matchesCampaign
    })
  }, [users, search, campaignFilter])

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

      let profilesQuery = supabase.from('profiles').select('*').order('created_at')
      if (!isSuperAdmin) {
        const ids = camps.map((c) => c.id)
        profilesQuery = profilesQuery
          .in('campaign_id', ids.length ? ids : [''])
          .neq('role', 'superadmin')
      }
      const [profiles, creds] = await Promise.all([
        profilesQuery,
        // Solo el superadmin recibe filas (RLS); para el resto vuelve vacío.
        supabase.from('user_temp_credentials').select('user_id, email, temp_password'),
      ])
      setUsers(profiles.data ?? [])
      setTempCreds(mapCreds(creds.data))
      setLoading(false)
    }
    load()
  }, [isSuperAdmin, campaignId, authUser?.id])

  const refreshData = async () => {
    const [{ data: updated }, { data: creds }] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('user_temp_credentials').select('user_id, email, temp_password'),
    ])
    setUsers(updated ?? [])
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

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
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
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u))
  }

  const handleCampaignChange = async (userId: string, newCampaignId: string) => {
    await supabase
      .from('profiles')
      .update({ campaign_id: newCampaignId || null })
      .eq('id', userId)
    setUsers((prev) =>
      prev.map((u) => u.id === userId ? { ...u, campaign_id: newCampaignId || null } : u),
    )
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

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 sm:mb-8">
        <div>
          <h1 className="text-[18px] sm:text-[22px] font-bold text-text">{t('admin.users.title')}</h1>
          <p className="text-text-muted text-[13px] mt-1">
            {isSuperAdmin ? t('admin.users.subtitle') : t('admin.users.subtitle_campaign')}
          </p>
        </div>
        {isSuperAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleRecompress}
              disabled={optimizing}
              title={t('admin.users.optimize_photos_hint')}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-text bg-subtle border border-line min-h-[44px] disabled:opacity-70"
            >
              {optimizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
              {optimizing && optProgress
                ? `${optProgress.done}/${optProgress.total}`
                : t('admin.users.optimize_photos')}
            </button>
            <button
              onClick={() => setBulkOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-text bg-subtle border border-line min-h-[44px]"
            >
              <Upload className="h-4 w-4" />
              {t('admin.users.bulk_import')}
            </button>
            <button
              onClick={() => setInviting(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black min-h-[44px]"
              style={{ background: '#10D451' }}
            >
              <UserPlus className="h-4 w-4" />
              {t('admin.users.create_user')}
            </button>
          </div>
        )}
      </div>

      {inviting && (
        <div className="rounded-2xl p-4 sm:p-5 mb-6 bg-surface border border-line">
          <div className="text-[14px] font-medium text-text mb-4">{i18n.t('admin.users.create_user')}</div>

          {inviteSuccess ? (
            <div className="rounded-xl p-4" style={{ background: 'rgba(16,212,81,0.08)', border: '1px solid rgba(16,212,81,0.2)' }}>
              <div className="text-green-500 text-[13px] font-medium mb-3">{i18n.t('admin.users.created_share')}</div>
              <div className="space-y-2">
                {[
                  { label: i18n.t('admin.users.creds_site'), value: SITE_URL },
                  { label: i18n.t('admin.users.creds_email'), value: createdEmail },
                  { label: i18n.t('admin.users.creds_password'), value: createdPassword },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 bg-subtle">
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase tracking-wider text-text-muted mr-2">{label}</span>
                      <span className="font-mono text-[12px] text-text break-all">{value}</span>
                    </div>
                  </div>
                ))}
              </div>
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
              {isSuperAdmin && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">Rol</label>
                    <Select
                      value={inviteRole}
                      onChange={(v) => setInviteRole(v as Profile['role'])}
                      options={roleOptions}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">{i18n.t('admin.users.col_campaign')}</label>
                    <Select
                      value={inviteCampaign}
                      onChange={setInviteCampaign}
                      options={campaignOptions(i18n.t('admin.worlds.no_campaign'))}
                    />
                  </div>
                </div>
              )}
              {inviteError && <p className="text-red-500 text-[12px]">{inviteError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleInvite}
                  disabled={inviteLoading || !inviteEmail}
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
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : (
        <div className="rounded-2xl border border-line overflow-x-auto">
          <div className="min-w-[640px]">
          <div className="grid gap-4 px-5 py-3 text-[11px] uppercase tracking-wider text-text-muted bg-subtle"
            style={{ gridTemplateColumns: isSuperAdmin ? '1fr auto auto auto auto' : '1fr auto auto' }}
          >
            <span>{t('admin.users.col_user')}</span>
            <span>{t('admin.users.col_role')}</span>
            {isSuperAdmin && <span>{t('admin.users.col_campaign')}</span>}
            <span>{t('admin.users.col_actions')}</span>
            {isSuperAdmin && <span />}
          </div>
          <div className="divide-y divide-line">
            {filteredUsers.map((user) => (
              <div key={user.id} className="grid gap-4 px-5 py-3.5 items-center"
                style={{ gridTemplateColumns: isSuperAdmin ? '1fr auto auto auto auto' : '1fr auto auto' }}
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
                        <button
                          onClick={() => handleSaveName(user.id)}
                          disabled={savingName}
                          className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-green-600 hover:bg-green-500/10 disabled:opacity-50 transition-colors"
                          title={t('admin.courses.save')}
                        >
                          {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                          title={t('admin.courses.cancel')}
                        >
                          <X className="h-4 w-4" />
                        </button>
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
                          <button
                            onClick={() => startEditName(user)}
                            className="shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-text-subtle hover:text-text hover:bg-glass/6 transition-colors sm:opacity-0 sm:group-hover:opacity-100"
                            title={t('admin.users.edit_name')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {!user.onboarded && (
                          <span
                            className="shrink-0 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ background: 'rgba(245,158,11,0.15)', color: '#d97706' }}
                            title={t('admin.users.pending_hint')}
                          >
                            <Clock className="h-3 w-3" />
                            {t('admin.users.pending')}
                          </span>
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
                    className="w-auto shrink-0"
                    value={user.role}
                    onChange={(v) => handleRoleChange(user.id, v as Profile['role'])}
                    options={roleOptions}
                  />
                ) : (
                  <span
                    className="rounded-lg px-2.5 py-1 text-[11px] font-medium"
                    style={{ background: roleColors[user.role], color: roleText[user.role] }}
                  >
                    {roleLabel[user.role]}
                  </span>
                )}
                {isSuperAdmin && (
                  <Select
                    compact
                    className="w-auto shrink-0"
                    value={user.campaign_id ?? ''}
                    onChange={(v) => handleCampaignChange(user.id, v)}
                    options={campaignOptions(i18n.t('admin.worlds.no_campaign'))}
                  />
                )}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => navigate(`/admin/users/${user.id}`)}
                    className="h-9 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors"
                    title={t('admin.users.view_profile')}
                  >
                    <IdCard className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('admin.users.view_profile')}</span>
                  </button>
                  {isSuperAdmin && tempCreds[user.id] && (
                    <button
                      onClick={() => copyCreds(user.id, tempCreds[user.id].email, tempCreds[user.id].temp_password)}
                      className="h-9 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] font-medium transition-colors"
                      style={{ color: copiedId === user.id ? '#16a34a' : '#d97706' }}
                      title={t('admin.users.copy_creds')}
                    >
                      {copiedId === user.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      <span className="hidden sm:inline">{t('admin.users.copy_creds')}</span>
                    </button>
                  )}
                  <button
                    onClick={() => setAssignUser(user)}
                    className="h-9 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors"
                    title={t('admin.users.assign_courses')}
                  >
                    <BookOpen className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('admin.users.assign_courses')}</span>
                  </button>
                  <button
                    onClick={() => navigate(`/admin/progress?view=worlds&user=${user.id}`)}
                    className="h-9 w-9 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                    title={t('admin.users.view_progress')}
                  >
                    <BarChart3 className="h-4 w-4" />
                  </button>
                  {isSuperAdmin && (
                    <button
                      onClick={() => setResetUser(user)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                      title={t('admin.users.manage_courses')}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {isSuperAdmin && (
                  <button
                    onClick={() => handleDelete(user)}
                    disabled={deletingId === user.id}
                    className="h-9 w-9 flex items-center justify-center rounded-lg text-text-subtle hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                    title={i18n.t('admin.users.delete_user')}
                  >
                    {deletingId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
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
      )}

      {assignUser && (
        <UserCoursesModal user={assignUser} onClose={() => setAssignUser(null)} />
      )}

      {resetUser && (
        <UserCourseResetModal user={resetUser} onClose={() => setResetUser(null)} />
      )}

      {bulkOpen && (
        <BulkImportUsers
          isSuperAdmin={isSuperAdmin}
          campaigns={campaigns}
          onClose={() => setBulkOpen(false)}
          onImported={refreshData}
        />
      )}
    </div>
  )
}
