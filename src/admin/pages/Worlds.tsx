import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, X, ChevronDown, Pencil, Trash2, Globe, Map } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'

type WorldStatus = 'draft' | 'published'
type BgType = 'airline' | 'bank' | 'health' | 'corporate' | 'tech'

interface World {
  id: string
  name: string
  description: string
  campaign_id: string | null
  icon: string
  color: string
  bg_type: BgType
  status: WorldStatus
}

interface Campaign {
  id: string
  name: string
}

interface WorldForm {
  name: string
  description: string
  campaign_id: string
  icon: string
  color: string
  bg_type: string
}

const BG_TYPES: BgType[] = ['airline', 'bank', 'health', 'corporate', 'tech']
const BG_LABELS: Record<BgType, string> = {
  airline: 'Aerolínea',
  bank: 'Banco',
  health: 'Salud',
  corporate: 'Corporativo',
  tech: 'Tecnología',
}

const emptyForm = (): WorldForm => ({
  name: '',
  description: '',
  campaign_id: '',
  icon: '🌍',
  color: '#00C228',
  bg_type: 'corporate',
})

function normalizeRow(row: Record<string, unknown>): World {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    campaign_id: (row.campaign_id as string | null) ?? null,
    icon: (row.icon as string) ?? '🌍',
    color: (row.color as string) ?? '#00C228',
    bg_type: (row.bg_type as BgType) ?? 'corporate',
    status: (row.status as WorldStatus) ?? 'draft',
  }
}

export default function Worlds() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [worlds, setWorlds] = useState<World[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState<WorldForm>(emptyForm())
  const [filterCampaign, setFilterCampaign] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)

  const { isSuperAdmin, campaignId, loading: authLoading } = useAuth()
  // El capacitador solo ve/gestiona los mundos de su propia campaña; el superadmin ve todos.
  const scopedToCampaign = !isSuperAdmin

  useEffect(() => {
    if (authLoading) return
    async function load() {
      if (scopedToCampaign && !campaignId) {
        setLoading(false)
        return
      }

      const { data: campData } = await supabase
        .from('campaigns')
        .select('id, name')
        .order('created_at')
      setCampaigns(campData ?? [])

      let worldQuery = supabase
        .from('worlds')
        .select('*')
        .order('created_at', { ascending: false })
      if (scopedToCampaign && campaignId) worldQuery = worldQuery.eq('campaign_id', campaignId)

      const { data, error } = await worldQuery

      if (error && error.code !== '42P01') {
        console.error('Error loading worlds:', error)
      }
      setWorlds((data ?? []).map(normalizeRow))
      setLoading(false)
    }
    load()
  }, [authLoading, scopedToCampaign, campaignId])

  const openModal = () => {
    setForm({ ...emptyForm(), campaign_id: scopedToCampaign ? (campaignId ?? '') : '' })
    setEditingId(null)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingId(null)
  }

  const openEdit = (w: World) => {
    setEditingId(w.id)
    setForm({
      name: w.name,
      description: w.description,
      campaign_id: w.campaign_id ?? '',
      icon: w.icon,
      color: w.color,
      bg_type: w.bg_type,
    })
    setIsModalOpen(true)
  }

  const handleDelete = async (w: World) => {
    // Contamos el contenido y la telemetría asociada para avisar al superadmin
    // exactamente qué se va a borrar en cascada junto con el mundo.
    const [regions, levels, progress] = await Promise.all([
      supabase.from('world_regions').select('id', { count: 'exact', head: true }).eq('world_id', w.id),
      supabase.from('world_levels').select('id', { count: 'exact', head: true }).eq('world_id', w.id),
      supabase.from('world_progress').select('id', { count: 'exact', head: true }).eq('world_id', w.id),
    ])
    const regionCount = regions.count ?? 0
    const levelCount = levels.count ?? 0
    const progressCount = progress.count ?? 0
    const hasContent = regionCount + levelCount + progressCount > 0

    const ok = await confirm({
      title: t('confirm.delete_world_title'),
      description: (
        <div>
          <div>{t('confirm.delete_world_desc', { name: w.name })}</div>
          {hasContent && (
            <ul className="mt-2 space-y-0.5 text-text-muted">
              {regionCount > 0 && <li>• {t('confirm.delete_world_regions', { count: regionCount })}</li>}
              {levelCount > 0 && <li>• {t('confirm.delete_world_levels', { count: levelCount })}</li>}
              {progressCount > 0 && (
                <li className="text-red-400">• {t('confirm.delete_world_progress', { count: progressCount })}</li>
              )}
            </ul>
          )}
        </div>
      ),
    })
    if (!ok) return

    const { error } = await supabase.from('worlds').delete().eq('id', w.id)
    if (!error) {
      setWorlds(prev => prev.filter(x => x.id !== w.id))
      toast.success(t('confirm.delete_world_ok', { name: w.name }))
    } else {
      console.error('Error deleting world:', error)
      toast.error(t('confirm.delete_world_error'), error.message)
    }
  }

  const handlePublish = async (w: World) => {
    const newStatus: WorldStatus = w.status === 'published' ? 'draft' : 'published'
    const { data, error } = await supabase
      .from('worlds')
      .update({ status: newStatus })
      .eq('id', w.id)
      .select()
      .single()
    if (!error && data) {
      setWorlds(prev => prev.map(x => (x.id === w.id ? normalizeRow(data) : x)))
    } else {
      console.error('Error toggling publish:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || saving) return
    setSaving(true)

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      campaign_id: (form.campaign_id || null) as string,
      icon: form.icon || '🌍',
      color: form.color,
      bg_type: form.bg_type,
    }

    if (editingId) {
      const { data, error } = await supabase
        .from('worlds')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()
      if (!error && data) {
        setWorlds(prev => prev.map(x => (x.id === editingId ? normalizeRow(data) : x)))
        closeModal()
      } else {
        console.error('Error updating world:', error)
      }
    } else {
      const { data, error } = await supabase
        .from('worlds')
        .insert({ ...payload, status: 'draft' as WorldStatus })
        .select()
        .single()
      if (!error && data) {
        setWorlds(prev => [normalizeRow(data), ...prev])
        closeModal()
      } else {
        console.error('Error saving world:', error)
      }
    }
    setSaving(false)
  }

  const filtered = worlds.filter(
    w => filterCampaign === 'all' || w.campaign_id === filterCampaign,
  )

  if (!authLoading && scopedToCampaign && !campaignId) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">{i18n.t('admin.worlds.title')}</h1>
        <div
          className="mt-8 rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center"
          style={{ background: 'rgba(239,68,68,0.04)', border: '1px dashed rgba(239,68,68,0.20)' }}
        >
          <div className="text-[15px] font-medium text-text mb-2">{i18n.t('admin.worlds.no_campaign_title')}</div>
          <div className="text-[13px] text-text-muted">{i18n.t('admin.worlds.no_campaign_desc')}</div>
        </div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .worlds-modal { animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>

      <div className="p-4 sm:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-[20px] sm:text-[24px] font-bold text-text">{i18n.t('admin.worlds.title')}</h1>
          <button
            onClick={openModal}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors min-h-[44px]"
            style={{ background: 'rgba(0,194,40,0.12)', color: '#00C228', border: '1px solid rgba(0,194,40,0.25)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.20)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.12)' }}
          >
            <Plus className="h-4 w-4" />
            Nuevo mundo
          </button>
        </div>
        <p className="text-text-muted text-[13px] mb-8">
          Configurá los mundos temáticos que agrupan misiones y contenido por contexto de negocio
        </p>

        {/* Campaign filter — solo para superadmin */}
        {!loading && campaigns.length > 0 && !scopedToCampaign && (
          <FilterDropdown
            value={filterCampaign === 'all' ? '' : filterCampaign}
            onChange={v => setFilterCampaign(v || 'all')}
            options={[{ value: '', label: 'Todas las campañas' }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]}
            className="mb-5 max-w-xs"
          />
        )}

        {/* Loading skeleton */}
        {loading ? (
          <div className="grid md:grid-cols-2 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl animate-pulse bg-subtle" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center"
            style={{ background: 'rgba(0,194,40,0.04)', border: '1px dashed rgba(0,194,40,0.20)' }}
          >
            <Globe className="h-10 w-10 mb-4" style={{ color: '#00C228', opacity: 0.5 }} />
            <div className="text-[15px] font-medium text-text mb-1">{i18n.t('admin.worlds.no_worlds')}</div>
            <div className="text-[13px] text-text-muted mb-5 max-w-xs">
              Creá tu primer mundo para organizar el contenido por contexto temático
            </div>
            <button
              onClick={openModal}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors min-h-[44px]"
              style={{ background: 'rgba(0,194,40,0.12)', color: '#00C228', border: '1px solid rgba(0,194,40,0.25)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.20)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.12)' }}
            >
              <Plus className="h-4 w-4" />
              Nuevo mundo
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map(w => {
              const campaignName = campaigns.find(c => c.id === w.campaign_id)?.name
              const isPublished = w.status === 'published'
              return (
                <div
                  key={w.id}
                  className="group rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 transition-all hover:scale-[1.01] bg-surface border border-line"
                >
                  <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 text-[20px]"
                    style={{ background: `${w.color}18` }}
                  >
                    {w.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <div className="text-[15px] font-semibold text-text truncate">{w.name}</div>
                      <span
                        className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={
                          isPublished
                            ? { background: 'rgba(0,194,40,0.10)', color: '#00C228' }
                            : { background: 'rgb(var(--glass-border) / 0.07)', color: 'rgb(var(--text-muted))' }
                        }
                      >
                        {isPublished ? 'Publicado' : 'Borrador'}
                      </span>
                      {campaignName && (
                        <span className="shrink-0 text-[10px] text-text-subtle px-2 py-0.5 rounded-full bg-subtle">
                          {campaignName}
                        </span>
                      )}
                    </div>
                    {w.description && (
                      <div className="text-[12px] text-text-muted leading-relaxed line-clamp-2 mb-2">
                        {w.description}
                      </div>
                    )}
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{ background: `${w.color}15`, color: w.color }}
                    >
                      {BG_LABELS[w.bg_type] ?? w.bg_type}
                    </span>
                  </div>
                  </div>
                  <div className="flex items-center gap-1.5 sm:shrink-0 flex-wrap">
                    <button
                      onClick={() => openEdit(w)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted transition-colors"
                      style={{ border: '1px solid rgb(var(--glass-border) / 0.08)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--glass-border) / 0.06)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(w)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted transition-colors"
                      style={{ border: '1px solid rgb(var(--glass-border) / 0.08)' }}
                      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#ef4444'; el.style.background = 'rgba(239,68,68,0.08)' }}
                      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = ''; el.style.background = 'transparent' }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handlePublish(w)}
                      className="flex items-center justify-center min-h-[44px] px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all"
                      style={
                        isPublished
                          ? { background: 'rgb(var(--glass-border) / 0.06)', color: 'rgb(var(--text-muted))', border: '1px solid rgb(var(--glass-border) / 0.10)' }
                          : { background: 'rgba(0,194,40,0.10)', color: '#00C228', border: '1px solid rgba(0,194,40,0.22)' }
                      }
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.70' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                    >
                      {isPublished ? 'Despublicar' : 'Publicar'}
                    </button>
                    <button
                      onClick={() => navigate(`/admin/worlds/${w.id}`)}
                      className="flex items-center justify-center min-h-[44px] gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors"
                      style={{ background: 'rgba(0,194,40,0.10)', color: '#00C228', border: '1px solid rgba(0,194,40,0.22)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.20)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.10)' }}
                    >
                      <Map className="h-3.5 w-3.5" />
                      Ver regiones
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div
            className="worlds-modal w-full max-w-lg rounded-2xl bg-surface border border-line flex flex-col overflow-hidden"
            style={{ maxHeight: '90vh' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[16px] font-semibold text-text">
                {editingId ? 'Editar mundo' : 'Nuevo mundo'}
              </h2>
              <button
                onClick={closeModal}
                className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden min-h-0">
              <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">

                {/* Nombre */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.name_required')}</label>
                  <input
                    required
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={i18n.t('admin.worlds.ph_world_name')}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#00C228]/50 transition-colors min-h-[44px]"
                  />
                </div>

                {/* Descripción */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.description')}</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder={i18n.t('admin.worlds.ph_world_desc')}
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#00C228]/50 transition-colors resize-none"
                  />
                </div>

                {/* Campaña — solo para superadmin */}
                {!scopedToCampaign && (
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.campaign')}</label>
                    <div className="relative">
                      <select
                        value={form.campaign_id}
                        onChange={e => setForm(f => ({ ...f, campaign_id: e.target.value }))}
                        className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none focus:border-[#00C228]/50 transition-colors appearance-none min-h-[44px]"
                      >
                        <option value="">{i18n.t('admin.worlds.no_campaign')}</option>
                        {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
                    </div>
                  </div>
                )}

                {/* Tipo de fondo */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.bg_type')}</label>
                  <div className="relative">
                    <select
                      value={form.bg_type}
                      onChange={e => setForm(f => ({ ...f, bg_type: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none focus:border-[#00C228]/50 transition-colors appearance-none min-h-[44px]"
                    >
                      {BG_TYPES.map(t => (
                        <option key={t} value={t}>{BG_LABELS[t]}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
                  </div>
                </div>

                {/* Icono + Color */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.icon_emoji')}</label>
                    <input
                      value={form.icon}
                      onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                      placeholder="🌍"
                      className="w-full px-3 py-2.5 rounded-xl text-[18px] bg-bg border border-line text-text focus:outline-none focus:border-[#00C228]/50 transition-colors text-center min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.color')}</label>
                    <input
                      type="color"
                      value={form.color}
                      onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                      className="h-11 w-full rounded-xl border border-line bg-bg cursor-pointer p-1"
                    />
                  </div>
                </div>

              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors border border-line"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50"
                  style={{ background: 'rgba(0,194,40,0.14)', color: '#00C228', border: '1px solid rgba(0,194,40,0.28)' }}
                  onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.24)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.14)' }}
                >
                  {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear mundo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
