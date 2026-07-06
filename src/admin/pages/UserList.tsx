import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, UserPlus, Shield, User, Trash2, Mail, BookOpen, BarChart3, Search, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'

import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { UserCoursesModal } from '@/admin/components/UserCoursesModal'
import { BulkImportUsers } from '@/admin/components/BulkImportUsers'
import type { Profile, Campaign } from '@/types/database'

type ProfileWithEmail = Profile & { email?: string }

export default function UserList() {
  const { isSuperAdmin, campaignId } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [assignUser, setAssignUser] = useState<ProfileWithEmail | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')
  const [users, setUsers] = useState<ProfileWithEmail[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'learner' | 'capacitador' | 'superadmin'>('learner')
  const [inviteCampaign, setInviteCampaign] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [createdEmail, setCreatedEmail] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
    // El capacitador solo ve las personas de su propia campaña y NUNCA a los
    // superadmin; el superadmin ve a todos.
    let profilesQuery = supabase.from('profiles').select('*').order('created_at')
    if (!isSuperAdmin) {
      profilesQuery = profilesQuery
        .eq('campaign_id', campaignId ?? '')
        .neq('role', 'superadmin')
    }
    Promise.all([
      profilesQuery,
      supabase.from('campaigns').select('*').order('name'),
    ]).then(([profiles, camps]) => {
      setUsers(profiles.data ?? [])
      setCampaigns(camps.data ?? [])
      setLoading(false)
    })
  }, [isSuperAdmin, campaignId])

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    setInviteLoading(true)
    setInviteError(null)

    try {
      // Enviar invitación vía Edge Function con service_role: Supabase manda un
      // magic link por correo y deja el perfil (rol/campaña) listo, sin tocar la
      // sesión del superadmin. El usuario define su contraseña al aceptar.
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
            role: inviteRole,
            campaignId: inviteCampaign || null,
            redirectTo: window.location.origin,
          }),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al enviar invitación')

      setCreatedEmail(inviteEmail.trim())
      setInviteSuccess(true)
      setInviteEmail('')

      const { data: updated } = await supabase.from('profiles').select('*').order('created_at')
      setUsers(updated ?? [])
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Error al enviar invitación')
    } finally {
      setInviteLoading(false)
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
              onClick={() => setBulkOpen(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-text bg-subtle border border-line min-h-[44px]"
            >
              <Upload className="h-4 w-4" />
              {t('admin.users.bulk_import')}
            </button>
            <button
              onClick={() => setInviting(true)}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black min-h-[44px]"
              style={{ background: '#00C228' }}
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
            <div className="rounded-xl p-4" style={{ background: 'rgba(0,194,40,0.08)', border: '1px solid rgba(0,194,40,0.2)' }}>
              <div className="flex items-start gap-2.5">
                <Mail className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-green-500 text-[13px] font-medium">
                    {i18n.t('admin.users.invite_sent', { email: createdEmail })}
                  </div>
                  <p className="text-[12px] text-text-muted mt-1">{i18n.t('admin.users.invite_sent_hint')}</p>
                </div>
              </div>
              <button
                onClick={() => { setInviting(false); setInviteSuccess(false) }}
                className="mt-4 flex items-center min-h-[44px] text-[12px] text-text-subtle hover:text-text transition-colors"
              >
                {i18n.t('common.close', 'Cerrar')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
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
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as Profile['role'])}
                      className="w-full rounded-xl px-3 py-2.5 text-[13px] text-text bg-subtle border border-line outline-none min-h-[44px]"
                    >
                      <option value="learner">{roleLabel.learner}</option>
                      <option value="capacitador">{roleLabel.capacitador}</option>
                      <option value="superadmin">{roleLabel.superadmin}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">{i18n.t('admin.users.col_campaign')}</label>
                    <select
                      value={inviteCampaign}
                      onChange={(e) => setInviteCampaign(e.target.value)}
                      className="w-full rounded-xl px-3 py-2.5 text-[13px] text-text bg-subtle border border-line outline-none min-h-[44px]"
                    >
                      <option value="">{i18n.t('admin.worlds.no_campaign')}</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              {inviteError && <p className="text-red-500 text-[12px]">{inviteError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleInvite}
                  disabled={inviteLoading || !inviteEmail}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black disabled:opacity-50 min-h-[44px]"
                  style={{ background: '#00C228' }}
                >
                  {inviteLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {i18n.t('admin.users.invite_send')}
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
          {isSuperAdmin && (
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] text-text outline-none focus:border-primary min-h-[44px] sm:w-56"
            >
              <option value="">{t('admin.users.all_campaigns')}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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
                  <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-subtle">
                    {user.role === 'superadmin' ? (
                      <Shield className="h-3.5 w-3.5 text-yellow-400" />
                    ) : (
                      <User className="h-3.5 w-3.5 text-text-muted" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] text-text truncate">{user.display_name ?? 'Sin nombre'}</div>
                    <div className="text-[11px] text-text-subtle truncate">{user.id.slice(0, 8)}…</div>
                  </div>
                </div>
                {isSuperAdmin ? (
                  <select
                    value={user.role}
                    onChange={(e) => handleRoleChange(user.id, e.target.value as Profile['role'])}
                    className="rounded-lg px-2 py-1 text-[11px] font-medium border-0 outline-none min-h-[44px]"
                    style={{
                      background: roleColors[user.role],
                      color: roleText[user.role],
                    }}
                  >
                    <option value="learner">{roleLabel.learner}</option>
                    <option value="capacitador">{roleLabel.capacitador}</option>
                    <option value="superadmin">{roleLabel.superadmin}</option>
                  </select>
                ) : (
                  <span
                    className="rounded-lg px-2.5 py-1 text-[11px] font-medium"
                    style={{ background: roleColors[user.role], color: roleText[user.role] }}
                  >
                    {roleLabel[user.role]}
                  </span>
                )}
                {isSuperAdmin && (
                  <select
                    value={user.campaign_id ?? ''}
                    onChange={(e) => handleCampaignChange(user.id, e.target.value)}
                    className="rounded-lg px-2 py-1 text-[11px] text-text-muted bg-subtle border-0 outline-none min-h-[44px]"
                  >
                    <option value="">{i18n.t('admin.worlds.no_campaign')}</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setAssignUser(user)}
                    className="h-9 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors"
                    title={t('admin.users.assign_courses')}
                  >
                    <BookOpen className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('admin.users.assign_courses')}</span>
                  </button>
                  <button
                    onClick={() => navigate(`/admin/feedback?user=${user.id}`)}
                    className="h-9 w-9 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-glass/6 transition-colors"
                    title={t('admin.users.view_progress')}
                  >
                    <BarChart3 className="h-4 w-4" />
                  </button>
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

      {bulkOpen && (
        <BulkImportUsers
          isSuperAdmin={isSuperAdmin}
          campaigns={campaigns}
          onClose={() => setBulkOpen(false)}
          onImported={async () => {
            const { data: updated } = await supabase.from('profiles').select('*').order('created_at')
            setUsers(updated ?? [])
          }}
        />
      )}
    </div>
  )
}
