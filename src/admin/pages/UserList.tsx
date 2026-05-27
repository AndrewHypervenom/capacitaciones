import { useEffect, useState } from 'react'
import { Loader2, UserPlus, Shield, User, RefreshCw, Trash2, Copy, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { createClient } from '@supabase/supabase-js'

function generateTempPassword(): string {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase()
}

// Cliente sin persistencia de sesión para crear usuarios sin afectar la sesión actual
const supabaseAdmin = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Profile, Campaign } from '@/types/database'

type ProfileWithEmail = Profile & { email?: string }

export default function UserList() {
  const { isSuperAdmin } = useAuth()
  const { t } = useTranslation()
  const [users, setUsers] = useState<ProfileWithEmail[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePassword, setInvitePassword] = useState(() => generateTempPassword())
  const [inviteRole, setInviteRole] = useState<'learner' | 'capacitador' | 'admin' | 'superadmin'>('learner')
  const [inviteCampaign, setInviteCampaign] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [createdEmail, setCreatedEmail] = useState('')
  const [createdPassword, setCreatedPassword] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [copied, setCopied] = useState<'email' | 'pass' | 'url' | null>(null)

  const copyToClipboard = (text: string, key: 'email' | 'pass' | 'url') => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('campaigns').select('*').order('name'),
    ]).then(([profiles, camps]) => {
      setUsers(profiles.data ?? [])
      setCampaigns(camps.data ?? [])
      setLoading(false)
    })
  }, [])

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !invitePassword.trim()) return
    setInviteLoading(true)
    setInviteError(null)

    try {
      const { data, error } = await supabaseAdmin.auth.signUp({
        email: inviteEmail.trim(),
        password: invitePassword.trim(),
        options: {
          data: { display_name: inviteEmail.split('@')[0] },
        },
      })

      if (error) throw error

      if (data.user?.id) {
        await supabase
          .from('profiles')
          .update({ role: inviteRole, campaign_id: inviteCampaign || null, onboarded: false })
          .eq('id', data.user.id)
      }

      setCreatedEmail(inviteEmail.trim())
      setCreatedPassword(invitePassword.trim())
      setInviteSuccess(true)
      setInviteEmail('')
      setInvitePassword(generateTempPassword())

      const { data: updated } = await supabase.from('profiles').select('*').order('created_at')
      setUsers(updated ?? [])
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Error al crear usuario')
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

  const handleDelete = async (userId: string) => {
    setDeletingId(userId)
    setConfirmDeleteId(null)
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
    admin: 'rgba(99,102,241,0.15)',
    capacitador: 'rgba(34,197,94,0.15)',
    learner: 'rgba(100,116,139,0.12)',
  }
  const roleText: Record<Profile['role'], string> = {
    superadmin: '#d97706',
    admin: '#4f46e5',
    capacitador: '#16a34a',
    learner: '#64748b',
  }
  const roleLabel: Record<Profile['role'], string> = {
    superadmin: t('roles.superadmin'),
    admin: t('roles.admin'),
    capacitador: t('roles.capacitador'),
    learner: t('roles.learner'),
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[22px] font-bold text-text">{t('admin.users.title')}</h1>
          <p className="text-text-muted text-[13px] mt-1">{t('admin.users.subtitle')}</p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => setInviting(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black"
            style={{ background: '#00C228' }}
          >
            <UserPlus className="h-4 w-4" />
            Crear usuario
          </button>
        )}
      </div>

      {inviting && (
        <div className="rounded-2xl p-5 mb-6 bg-surface border border-line">
          <div className="text-[14px] font-medium text-text mb-4">Crear nuevo usuario</div>

          {inviteSuccess ? (
            <div className="rounded-xl p-4" style={{ background: 'rgba(0,194,40,0.08)', border: '1px solid rgba(0,194,40,0.2)' }}>
              <div className="text-green-500 text-[13px] font-medium mb-3">✓ Usuario creado — comparte estas credenciales</div>
              <div className="space-y-2">
                {[
                  { label: 'Sitio', value: 'https://capacitaciones-chi.vercel.app/', key: 'url' as const },
                  { label: 'Email', value: createdEmail, key: 'email' as const },
                  { label: 'Contraseña', value: createdPassword, key: 'pass' as const },
                ].map(({ label, value, key }) => (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 bg-subtle">
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase tracking-wider text-text-muted mr-2">{label}</span>
                      <span className="font-mono text-[12px] text-text">{value}</span>
                    </div>
                    <button
                      onClick={() => copyToClipboard(value, key)}
                      className="shrink-0 text-text-subtle hover:text-text transition-colors"
                      title="Copiar"
                    >
                      {copied === key ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => { setInviting(false); setInviteSuccess(false) }}
                className="mt-4 text-[12px] text-text-subtle hover:text-text transition-colors"
              >
                Cerrar
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="email"
                placeholder="Email del usuario"
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null) }}
                className="w-full rounded-xl px-4 py-2.5 text-[14px] text-text bg-subtle border border-line outline-none"
              />
              <div className="relative">
                <input
                  type="text"
                  placeholder="Contraseña temporal"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  className="w-full rounded-xl px-4 py-2.5 text-[14px] text-text bg-subtle border border-line outline-none pr-10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setInvitePassword(generateTempPassword())}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text-muted transition-colors"
                  title="Regenerar"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">Rol</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'learner' | 'admin')}
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] text-text bg-subtle border border-line outline-none"
                  >
                    <option value="learner">{roleLabel.learner}</option>
                    <option value="capacitador">{roleLabel.capacitador}</option>
                    <option value="admin">{roleLabel.admin}</option>
                    {isSuperAdmin && <option value="superadmin">{roleLabel.superadmin}</option>}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-text-muted mb-1.5">Campaña</label>
                  <select
                    value={inviteCampaign}
                    onChange={(e) => setInviteCampaign(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-[13px] text-text bg-subtle border border-line outline-none"
                  >
                    <option value="">Sin campaña</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {inviteError && <p className="text-red-500 text-[12px]">{inviteError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleInvite}
                  disabled={inviteLoading || !inviteEmail || !invitePassword}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black disabled:opacity-50"
                  style={{ background: '#00C228' }}
                >
                  {inviteLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Crear
                </button>
                <button
                  onClick={() => setInviting(false)}
                  className="px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden border border-line">
          <div className="grid gap-4 px-5 py-3 text-[11px] uppercase tracking-wider text-text-muted bg-subtle"
            style={{ gridTemplateColumns: isSuperAdmin ? '1fr auto auto auto' : '1fr auto auto' }}
          >
            <span>Usuario</span>
            <span>Rol</span>
            <span>Campaña</span>
            {isSuperAdmin && <span />}
          </div>
          <div className="divide-y divide-line">
            {users.map((user) => (
              <div key={user.id} className="grid gap-4 px-5 py-3.5 items-center"
                style={{ gridTemplateColumns: isSuperAdmin ? '1fr auto auto auto' : '1fr auto auto' }}
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
                <select
                  value={user.role}
                  onChange={(e) => handleRoleChange(user.id, e.target.value as Profile['role'])}
                  className="rounded-lg px-2 py-1 text-[11px] font-medium border-0 outline-none"
                  style={{
                    background: roleColors[user.role],
                    color: roleText[user.role],
                  }}
                >
                  <option value="learner">{roleLabel.learner}</option>
                  <option value="capacitador">{roleLabel.capacitador}</option>
                  <option value="admin">{roleLabel.admin}</option>
                  {isSuperAdmin && <option value="superadmin">{roleLabel.superadmin}</option>}
                </select>
                <select
                  value={user.campaign_id ?? ''}
                  onChange={(e) => handleCampaignChange(user.id, e.target.value)}
                  className="rounded-lg px-2 py-1 text-[11px] text-text-muted bg-subtle border-0 outline-none"
                >
                  <option value="">Sin campaña</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {isSuperAdmin && (
                  confirmDeleteId === user.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDelete(user.id)}
                        disabled={deletingId === user.id}
                        className="px-2 py-1 rounded-lg text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 transition-colors"
                      >
                        {deletingId === user.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirmar'}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 rounded-lg text-[11px] text-text-muted hover:text-text bg-subtle transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(user.id)}
                      className="p-1.5 rounded-lg text-text-subtle hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      title="Eliminar usuario"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )
                )}
              </div>
            ))}
            {users.length === 0 && (
              <div className="py-12 text-center text-text-muted text-[14px]">
                No hay usuarios aún.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
