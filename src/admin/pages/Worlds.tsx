import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, X, ChevronDown, ChevronLeft, ChevronRight, Pencil, Trash2, Globe, Map,
  Swords, Check,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { ArenaEditorModal, normalizeArenaRow, type ArenaQuiz } from '@/admin/components/ArenaEditorModal'

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
  const [arenaCounts, setArenaCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filterCampaign, setFilterCampaign] = useState<string>('all')

  const { isSuperAdmin, campaignId, loading: authLoading } = useAuth()
  // El capacitador solo ve/gestiona los mundos de su propia campaña; el superadmin ve todos.
  const scopedToCampaign = !isSuperAdmin

  // ── Asistente de creación / edición del mundo ──
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardMode, setWizardMode] = useState<'new' | 'edit'>('new')
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)
  const [savingWorld, setSavingWorld] = useState(false)
  const [form, setForm] = useState<WorldForm>(emptyForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [wizardArenas, setWizardArenas] = useState<ArenaQuiz[]>([])

  // ── Editor de una arena (sub-modal) ──
  const [arenaEditorOpen, setArenaEditorOpen] = useState(false)
  const [arenaEditing, setArenaEditing] = useState<ArenaQuiz | null>(null)

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
    if (error && error.code !== '42P01') console.error('Error loading worlds:', error)
    setWorlds((data ?? []).map(normalizeRow))

    // Conteo de arenas por mundo, para mostrarlo en cada tarjeta.
    const { data: arenaRows } = await supabase.from('arena_quizzes').select('world_id')
    const counts: Record<string, number> = {}
    for (const r of arenaRows ?? []) {
      const wid = (r as { world_id: string | null }).world_id
      if (wid) counts[wid] = (counts[wid] ?? 0) + 1
    }
    setArenaCounts(counts)
    setLoading(false)
  }

  useEffect(() => {
    if (authLoading) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scopedToCampaign, campaignId])

  // ── Abrir / cerrar asistente ──
  const openWizardNew = () => {
    setWizardMode('new')
    setForm({ ...emptyForm(), campaign_id: scopedToCampaign ? (campaignId ?? '') : '' })
    setEditingId(null)
    setWizardArenas([])
    setWizardStep(1)
    setWizardOpen(true)
  }

  const openWizardEdit = async (w: World) => {
    setWizardMode('edit')
    setForm({
      name: w.name,
      description: w.description,
      campaign_id: w.campaign_id ?? '',
      icon: w.icon,
      color: w.color,
      bg_type: w.bg_type,
    })
    setEditingId(w.id)
    setWizardStep(2)
    setWizardOpen(true)
    await loadWorldArenas(w.id)
  }

  const closeWizard = () => {
    setWizardOpen(false)
    setEditingId(null)
    load() // refresca lista + conteos
  }

  async function loadWorldArenas(worldId: string) {
    const { data } = await supabase
      .from('arena_quizzes')
      .select('*')
      .eq('world_id', worldId)
      .order('created_at')
    setWizardArenas((data ?? []).map(normalizeArenaRow))
  }

  // Inserta (nuevo) o actualiza (edición) el mundo. Devuelve su id o null si falla.
  async function persistWorld(): Promise<string | null> {
    if (!form.name.trim()) return null
    // worlds.campaign_id es NOT NULL: el mundo siempre pertenece a una campaña.
    const campaign = form.campaign_id || (scopedToCampaign ? (campaignId ?? '') : '')
    if (!campaign) {
      toast.error('Elegí una campaña para el mundo')
      return null
    }
    setSavingWorld(true)
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      campaign_id: campaign,
      icon: form.icon || '🌍',
      color: form.color,
      bg_type: form.bg_type,
    }
    try {
      if (editingId) {
        const { data, error } = await supabase.from('worlds').update(payload).eq('id', editingId).select().single()
        if (error || !data) { console.error('Error updating world:', error); toast.error('No se pudo guardar el mundo', error?.message); return null }
        setWorlds(prev => prev.map(x => (x.id === editingId ? normalizeRow(data) : x)))
        return editingId
      } else {
        const { data, error } = await supabase
          .from('worlds')
          .insert({ ...payload, status: 'draft' as WorldStatus })
          .select()
          .single()
        if (error || !data) { console.error('Error saving world:', error); toast.error('No se pudo crear el mundo', error?.message); return null }
        const w = normalizeRow(data)
        setWorlds(prev => [w, ...prev])
        setEditingId(w.id)
        return w.id
      }
    } finally {
      setSavingWorld(false)
    }
  }

  // Navegación entre pasos, persistiendo el mundo al salir del paso 1.
  const goToStep = async (target: 1 | 2 | 3) => {
    if (target > 1 && !editingId) {
      const id = await persistWorld()
      if (!id) return
      await loadWorldArenas(id)
    } else if (target > 1 && editingId && wizardStep === 1) {
      await persistWorld()
    }
    setWizardStep(target)
  }

  // ── Editor de arena ──
  const openArenaNew = () => { setArenaEditing(null); setArenaEditorOpen(true) }
  const openArenaEdit = (q: ArenaQuiz) => { setArenaEditing(q); setArenaEditorOpen(true) }

  const onArenaSaved = (q: ArenaQuiz) => {
    setWizardArenas(prev => {
      const exists = prev.some(x => x.id === q.id)
      return exists ? prev.map(x => (x.id === q.id ? q : x)) : [...prev, q]
    })
  }

  const deleteArena = async (q: ArenaQuiz) => {
    const ok = await confirm({
      title: t('confirm.delete_quiz_title', 'Eliminar arena'),
      description: t('confirm.delete_quiz_desc', '¿Seguro que querés eliminar esta arena? No se puede deshacer.'),
    })
    if (!ok) return
    const { error } = await supabase.from('arena_quizzes').delete().eq('id', q.id)
    if (!error) setWizardArenas(prev => prev.filter(x => x.id !== q.id))
    else console.error('Error deleting arena:', error)
  }

  const handleDelete = async (w: World) => {
    const [regions, levels, progress] = await Promise.all([
      supabase.from('world_regions').select('id', { count: 'exact', head: true }).eq('world_id', w.id),
      supabase.from('world_levels').select('id', { count: 'exact', head: true }).eq('world_id', w.id),
      supabase.from('world_progress').select('id', { count: 'exact', head: true }).eq('world_id', w.id),
    ])
    const regionCount = regions.count ?? 0
    const levelCount = levels.count ?? 0
    const progressCount = progress.count ?? 0
    const arenaCount = arenaCounts[w.id] ?? 0
    const hasContent = regionCount + levelCount + progressCount + arenaCount > 0

    const ok = await confirm({
      title: t('confirm.delete_world_title'),
      description: (
        <div>
          <div>{t('confirm.delete_world_desc', { name: w.name })}</div>
          {hasContent && (
            <ul className="mt-2 space-y-0.5 text-text-muted">
              {arenaCount > 0 && <li>• {t('confirm.delete_world_arenas', { count: arenaCount, defaultValue: `${arenaCount} arena(s)` })}</li>}
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
    const { data, error } = await supabase.from('worlds').update({ status: newStatus }).eq('id', w.id).select().single()
    if (!error && data) setWorlds(prev => prev.map(x => (x.id === w.id ? normalizeRow(data) : x)))
    else console.error('Error toggling publish:', error)
  }

  const filtered = worlds.filter(w => filterCampaign === 'all' || w.campaign_id === filterCampaign)
  const currentWorldCampaign = form.campaign_id || (scopedToCampaign ? (campaignId ?? '') : '')

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

  const steps: { n: 1 | 2 | 3; label: string }[] = [
    { n: 1, label: 'Nombre' },
    { n: 2, label: 'Arenas' },
    { n: 3, label: 'Listo' },
  ]

  return (
    <>
      <style>{`
        @keyframes slideUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
        .worlds-modal { animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>

      <div className="p-4 sm:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-[20px] sm:text-[24px] font-bold text-text">{i18n.t('admin.worlds.title')}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={openWizardNew}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors min-h-[44px]"
              style={{ background: 'rgba(0,194,40,0.12)', color: '#00C228', border: '1px solid rgba(0,194,40,0.25)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.20)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.12)' }}
            >
              <Plus className="h-4 w-4" />
              Nuevo mundo
            </button>
          </div>
        </div>
        <p className="text-text-muted text-[13px] mb-8">
          Creá mundos temáticos y las arenas de competencia que los componen. Todo lo gamificado de tu campaña vive acá.
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
              Creá tu primer mundo y agregale sus arenas de competencia.
            </div>
            <button
              onClick={openWizardNew}
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
              const nArenas = arenaCounts[w.id] ?? 0
              return (
                <div
                  key={w.id}
                  className="group rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 transition-all hover:scale-[1.01] bg-surface border border-line"
                >
                  <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 text-[20px]" style={{ background: `${w.color}18` }}>
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
                        <div className="text-[12px] text-text-muted leading-relaxed line-clamp-2 mb-2">{w.description}</div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${w.color}15`, color: w.color }}>
                          {BG_LABELS[w.bg_type] ?? w.bg_type}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                          <Swords className="h-3 w-3" />
                          {nArenas} arena{nArenas !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 sm:shrink-0 flex-wrap">
                    <button
                      onClick={() => openWizardEdit(w)}
                      title="Editar mundo y arenas"
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

      {/* ── Asistente: crear / editar mundo ── */}
      {wizardOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeWizard() }}
        >
          <div className="worlds-modal w-full max-w-lg rounded-2xl bg-surface border border-line flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[16px] font-semibold text-text">
                {wizardMode === 'new' ? 'Nuevo mundo' : 'Editar mundo'}
              </h2>
              <button onClick={closeWizard} className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Stepper */}
            <div className="flex items-center gap-1.5 px-4 sm:px-6 py-3 border-b border-line shrink-0">
              {steps.map((s, i) => {
                const active = s.n === wizardStep
                const done = s.n < wizardStep
                return (
                  <div key={s.n} className="flex items-center gap-1.5">
                    <button
                      onClick={() => goToStep(s.n)}
                      className="flex items-center gap-2 text-[12px]"
                      style={{ color: active ? 'rgb(var(--text))' : 'rgb(var(--text-subtle))', fontWeight: active ? 600 : 400 }}
                    >
                      <span
                        className="h-[22px] w-[22px] rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 border"
                        style={
                          done
                            ? { background: '#00C228', color: '#fff', borderColor: '#00C228' }
                            : active
                              ? { background: 'rgba(0,194,40,0.15)', color: '#00C228', borderColor: 'rgba(0,194,40,0.4)' }
                              : { background: 'rgb(var(--subtle))', color: 'rgb(var(--text-subtle))', borderColor: 'rgb(var(--line))' }
                        }
                      >
                        {done ? <Check className="h-3 w-3" /> : s.n}
                      </span>
                      <span className="hidden sm:inline">{s.label}</span>
                    </button>
                    {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-text-subtle/50" />}
                  </div>
                )
              })}
            </div>

            {/* Body */}
            <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1">
              {/* Paso 1: nombre */}
              {wizardStep === 1 && (
                <div className="space-y-4">
                  <div className="text-center pt-1 pb-1">
                    <div className="h-14 w-14 rounded-2xl mx-auto mb-3 flex items-center justify-center text-[28px]" style={{ background: 'rgba(0,194,40,0.12)' }}>
                      {form.icon || '🌍'}
                    </div>
                    <h3 className="text-[18px] font-bold text-text mb-1">¿Cómo se llamará tu mundo?</h3>
                    <p className="text-[12.5px] text-text-muted max-w-[42ch] mx-auto">Es el nombre que verán tus aprendices. Podés cambiarlo después.</p>
                  </div>
                  <input
                    autoFocus
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={i18n.t('admin.worlds.ph_world_name')}
                    className="w-full px-4 py-3 rounded-xl text-[16px] font-semibold text-center bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#00C228]/60 transition-colors"
                  />
                  <div className="grid grid-cols-3 gap-3">
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
                    <div>
                      <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.bg_type')}</label>
                      <div className="relative">
                        <select
                          value={form.bg_type}
                          onChange={e => setForm(f => ({ ...f, bg_type: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none focus:border-[#00C228]/50 transition-colors appearance-none min-h-[44px]"
                        >
                          {BG_TYPES.map(bt => <option key={bt} value={bt}>{BG_LABELS[bt]}</option>)}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
                      </div>
                    </div>
                  </div>
                  {!scopedToCampaign && (
                    <div>
                      <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.campaign')} <span className="text-danger">*</span></label>
                      <div className="relative">
                        <select
                          value={form.campaign_id}
                          onChange={e => setForm(f => ({ ...f, campaign_id: e.target.value }))}
                          className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none focus:border-[#00C228]/50 transition-colors appearance-none min-h-[44px]"
                        >
                          <option value="">Elegí una campaña…</option>
                          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.description')} <span className="text-text-subtle font-normal">(opcional)</span></label>
                    <textarea
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      placeholder={i18n.t('admin.worlds.ph_world_desc')}
                      rows={2}
                      className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#00C228]/50 transition-colors resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Paso 2: arenas */}
              {wizardStep === 2 && (
                <div className="space-y-4">
                  <div className="text-center pt-1 pb-1">
                    <div className="h-14 w-14 rounded-2xl mx-auto mb-3 flex items-center justify-center text-[28px]" style={{ background: 'rgba(200,130,0,0.14)' }}>
                      ⚔️
                    </div>
                    <h3 className="text-[18px] font-bold text-text mb-1">
                      Agregá las arenas de {form.name.trim() || 'tu mundo'}
                    </h3>
                    <p className="text-[12.5px] text-text-muted max-w-[42ch] mx-auto">
                      Cada arena es un set de preguntas de competencia. Podés sumar o quitar más adelante.
                    </p>
                  </div>

                  {wizardArenas.length === 0 ? (
                    <div className="rounded-2xl p-7 text-center border border-dashed border-line text-text-muted text-[12.5px]">
                      <div className="text-[26px] mb-2 opacity-70">⚔️</div>
                      Todavía no hay arenas.<br />Agregá la primera para empezar.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {wizardArenas.map(a => (
                        <div key={a.id} className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-bg border border-line">
                          <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 text-[18px]" style={{ background: `${a.theme_color}20` }}>
                            {a.theme_icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13.5px] font-semibold text-text truncate">{a.title || 'Arena sin título'}</div>
                            <div className="text-[11px] text-text-muted">{a.steps.length} pregunta{a.steps.length !== 1 ? 's' : ''}</div>
                          </div>
                          <button
                            onClick={() => openArenaEdit(a)}
                            title="Editar arena"
                            className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors border border-line"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => deleteArena(a)}
                            title="Quitar arena"
                            className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/8 transition-colors border border-line"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={openArenaNew}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-semibold transition-colors"
                    style={{ border: '1.5px dashed rgba(0,194,40,0.4)', background: 'rgba(0,194,40,0.05)', color: '#00C228' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.10)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.05)' }}
                  >
                    <Plus className="h-4 w-4" />
                    Agregar arena
                  </button>
                </div>
              )}

              {/* Paso 3: listo */}
              {wizardStep === 3 && (
                <div className="space-y-4">
                  <div className="text-center pt-1 pb-1">
                    <div className="h-14 w-14 rounded-2xl mx-auto mb-3 flex items-center justify-center text-[28px]" style={{ background: 'rgba(0,194,40,0.12)' }}>
                      <Check className="h-7 w-7" style={{ color: '#00C228' }} />
                    </div>
                    <h3 className="text-[18px] font-bold text-text mb-1">¡Tu mundo está listo!</h3>
                    <p className="text-[12.5px] text-text-muted max-w-[42ch] mx-auto">Todo queda editable después.</p>
                  </div>
                  <div className="flex items-center gap-3.5 rounded-2xl p-4 bg-bg border border-line">
                    <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0 text-[24px]" style={{ background: `${form.color}20` }}>
                      {form.icon || '🌍'}
                    </div>
                    <div>
                      <div className="text-[15px] font-bold text-text">{form.name.trim() || 'Tu mundo'}</div>
                      <div className="text-[12px] text-text-muted">
                        {wizardArenas.length} arena{wizardArenas.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2.5 items-start rounded-xl p-3.5 text-[12px] text-text-muted leading-relaxed" style={{ background: 'rgba(0,194,40,0.06)', border: '1px solid rgba(0,194,40,0.18)' }}>
                    <Pencil className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#00C228' }} />
                    <div><b className="text-text font-semibold">Editar es fácil:</b> tocá el lápiz en la tarjeta del mundo para volver a este asistente y cambiar el nombre, agregar o quitar arenas, o editar sus preguntas cuando quieras.</div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
              {wizardStep > 1 && (
                <button
                  onClick={() => setWizardStep((wizardStep - 1) as 1 | 2 | 3)}
                  className="flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors border border-line"
                >
                  <ChevronLeft className="h-4 w-4" /> Atrás
                </button>
              )}
              <div className="flex-1" />
              <button onClick={closeWizard} className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors border border-line">
                {wizardStep === 3 ? 'Cerrar' : 'Cancelar'}
              </button>
              {wizardStep < 3 ? (
                <button
                  onClick={() => goToStep((wizardStep + 1) as 1 | 2 | 3)}
                  disabled={savingWorld || (wizardStep === 1 && (!form.name.trim() || (!scopedToCampaign && !form.campaign_id)))}
                  className="flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50"
                  style={{ background: 'rgba(0,194,40,0.14)', color: '#00C228', border: '1px solid rgba(0,194,40,0.28)' }}
                >
                  {savingWorld ? 'Guardando…' : 'Continuar'} <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={closeWizard}
                  className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors"
                  style={{ background: 'rgba(0,194,40,0.14)', color: '#00C228', border: '1px solid rgba(0,194,40,0.28)' }}
                >
                  {wizardMode === 'new' ? 'Crear mundo' : 'Guardar cambios'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Editor de una arena (sub-modal) ── */}
      {arenaEditorOpen && (
        <ArenaEditorModal
          editing={arenaEditing}
          defaultCampaignId={currentWorldCampaign}
          worldId={editingId}
          scopedToCampaign={scopedToCampaign}
          campaigns={campaigns}
          crumb={`Mundos › ${form.name.trim() || 'Nuevo mundo'}`}
          onClose={() => setArenaEditorOpen(false)}
          onSaved={onArenaSaved}
        />
      )}

    </>
  )
}
