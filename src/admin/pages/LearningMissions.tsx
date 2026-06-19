import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Target, X, ChevronDown, BookOpen, Video, FileText, Zap, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useAuth } from '@/hooks/useAuth'

type StepType = 'intro' | 'video' | 'pdf' | 'quiz'
type MissionStatus = 'draft' | 'active'

interface Step {
  id: string
  title: string
  type: StepType
}

interface Mission {
  id: string
  title: string
  description: string
  category: string | null
  campaign_id: string | null
  status: MissionStatus
  steps: Step[]
}

interface Campaign {
  id: string
  name: string
}

interface MissionForm {
  title: string
  description: string
  category: string
  campaign_id: string
  steps: Step[]
}

const STEP_LABELS: Record<StepType, string> = {
  intro: 'Intro',
  video: 'Video',
  pdf: 'PDF',
  quiz: 'Quiz',
}

const STEP_ICONS: Record<StepType, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  intro: BookOpen,
  video: Video,
  pdf: FileText,
  quiz: Zap,
}

const STEP_COLORS: Record<StepType, string> = {
  intro: '#00C228',
  video: '#3b82f6',
  pdf: '#f59e0b',
  quiz: '#E11D74',
}

const CATEGORIES = ['Onboarding', 'Compliance', 'Producto', 'Habilidades', 'Seguridad', 'Otro']

const newStep = (): Step => ({ id: crypto.randomUUID(), title: '', type: 'intro' })

const emptyForm = (): MissionForm => ({
  title: '',
  description: '',
  category: '',
  campaign_id: '',
  steps: [newStep()],
})

// Normaliza una fila de la DB: garantiza que steps sea Step[] con id
function normalizeRow(row: Record<string, unknown>): Mission {
  const rawSteps = Array.isArray(row.steps) ? row.steps : []
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? '',
    category: (row.category as string | null) ?? null,
    campaign_id: (row.campaign_id as string | null) ?? null,
    status: (row.status as MissionStatus) ?? 'draft',
    steps: rawSteps.map((s: Record<string, unknown>) => ({
      id: (s.id as string) ?? crypto.randomUUID(),
      title: (s.title as string) ?? '',
      type: (s.type as StepType) ?? 'intro',
    })),
  }
}

export default function LearningMissions() {
  const navigate = useNavigate()
  const [missions, setMissions] = useState<Mission[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState<MissionForm>(emptyForm())
  const [filterCampaign, setFilterCampaign] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)

  const { isSuperAdmin, isAdmin, campaignId, loading: authLoading } = useAuth()
  const isAdminOnly = isAdmin && !isSuperAdmin

  useEffect(() => {
    if (authLoading) return
    async function load() {
      if (isAdminOnly && !campaignId) {
        setLoading(false)
        return
      }

      const { data: campData } = await supabase
        .from('campaigns')
        .select('id, name')
        .order('created_at')
      setCampaigns(campData ?? [])

      let missionQuery = supabase
        .from('guided_missions')
        .select('*')
        .order('created_at', { ascending: false })
      if (isAdminOnly && campaignId) missionQuery = missionQuery.eq('campaign_id', campaignId)

      const { data, error } = await missionQuery

      if (error && error.code !== '42P01') {
        console.error('Error loading guided_missions:', error)
      }
      setMissions((data ?? []).map(normalizeRow))
      setLoading(false)
    }
    load()
  }, [authLoading, isAdminOnly, campaignId])

  const openModal = () => {
    setForm({ ...emptyForm(), campaign_id: isAdminOnly ? (campaignId ?? '') : '' })
    setIsModalOpen(true)
  }

  const closeModal = () => { setIsModalOpen(false); setEditingId(null) }

  const openEdit = (m: Mission) => {
    setEditingId(m.id)
    setForm({
      title: m.title,
      description: m.description,
      category: m.category ?? '',
      campaign_id: m.campaign_id ?? '',
      steps: m.steps.length > 0 ? m.steps : [newStep()],
    })
    setIsModalOpen(true)
  }

  const handleDelete = async (m: Mission) => {
    if (!window.confirm('¿Eliminar esta misión?')) return
    const { error } = await supabase.from('guided_missions').delete().eq('id', m.id)
    if (!error) setMissions(prev => prev.filter(x => x.id !== m.id))
    else console.error('Error deleting:', error)
  }

  const addStep = () =>
    setForm(f => ({ ...f, steps: [...f.steps, newStep()] }))

  const removeStep = (id: string) =>
    setForm(f => ({ ...f, steps: f.steps.filter(s => s.id !== id) }))

  const updateStep = (id: string, patch: Partial<Step>) =>
    setForm(f => ({ ...f, steps: f.steps.map(s => (s.id === id ? { ...s, ...patch } : s)) }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || saving) return
    setSaving(true)

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category || null,
      campaign_id: form.campaign_id || null,
      steps: form.steps.filter(s => s.title.trim()) as unknown as Json,
    }

    if (editingId) {
      const { data, error } = await supabase
        .from('guided_missions')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()
      if (!error && data) {
        setMissions(m => m.map(x => x.id === editingId ? normalizeRow(data) : x))
        closeModal()
      } else {
        console.error('Error updating mission:', error)
      }
    } else {
      const { data, error } = await supabase
        .from('guided_missions')
        .insert({ ...payload, status: 'draft' as MissionStatus })
        .select()
        .single()
      if (!error && data) {
        setMissions(m => [normalizeRow(data), ...m])
        closeModal()
      } else {
        console.error('Error saving mission:', error)
      }
    }
    setSaving(false)
  }

  if (!authLoading && isAdminOnly && !campaignId) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-[24px] font-bold text-text mb-1">Learning Missions</h1>
        <div
          className="mt-8 rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center"
          style={{ background: 'rgba(239,68,68,0.04)', border: '1px dashed rgba(239,68,68,0.20)' }}
        >
          <div className="text-[15px] font-medium text-text mb-2">Sin campaña asignada</div>
          <div className="text-[13px] text-text-muted">No tienes una campaña asignada. Contacta al superadmin.</div>
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
        .mission-modal { animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>

      <div className="p-4 sm:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
          <h1 className="text-[24px] font-bold text-text">Learning Missions</h1>
          <button
            onClick={openModal}
            className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-xl text-[13px] font-medium transition-colors"
            style={{ background: 'rgba(0,194,40,0.12)', color: '#00C228', border: '1px solid rgba(0,194,40,0.25)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.20)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.12)' }}
          >
            <Plus className="h-4 w-4" />
            Nueva misión
          </button>
        </div>
        <p className="text-text-muted text-[13px] mb-8">
          Diseñá rutas de aprendizaje paso a paso con objetivos claros
        </p>

        {/* Campaign filter — solo para superadmin */}
        {!loading && campaigns.length > 0 && !isAdminOnly && (
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
        ) : missions.length === 0 ? (
          /* Empty state */
          <div
            className="rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center"
            style={{ background: 'rgba(0,194,40,0.04)', border: '1px dashed rgba(0,194,40,0.20)' }}
          >
            <Target className="h-10 w-10 mb-4" style={{ color: '#00C228', opacity: 0.5 }} />
            <div className="text-[15px] font-medium text-text mb-1">Todavía no hay misiones</div>
            <div className="text-[13px] text-text-muted mb-5 max-w-xs">
              Creá tu primera misión para organizar el aprendizaje en pasos claros y medibles
            </div>
            <button
              onClick={openModal}
              className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-xl text-[13px] font-medium transition-colors"
              style={{ background: 'rgba(0,194,40,0.12)', color: '#00C228', border: '1px solid rgba(0,194,40,0.25)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.20)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.12)' }}
            >
              <Plus className="h-4 w-4" />
              Nueva misión
            </button>
          </div>
        ) : (
          /* Mission cards grid */
          <div className="grid md:grid-cols-2 gap-4">
            {missions.filter(m => filterCampaign === 'all' || m.campaign_id === filterCampaign).map(m => {
              const campaignName = campaigns.find(c => c.id === m.campaign_id)?.name
              return (
                <div
                  key={m.id}
                  className="group rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 transition-all hover:scale-[1.01] bg-surface border border-line"
                >
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(0,194,40,0.10)' }}
                  >
                    <Target className="h-5 w-5" style={{ color: '#00C228' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <div className="text-[15px] font-semibold text-text truncate">{m.title}</div>
                      {m.category && (
                        <span
                          className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(0,194,40,0.10)', color: '#00C228' }}
                        >
                          {m.category}
                        </span>
                      )}
                      {campaignName && (
                        <span className="shrink-0 text-[10px] text-text-subtle px-2 py-0.5 rounded-full bg-subtle">
                          {campaignName}
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <div className="text-[12px] text-text-muted leading-relaxed line-clamp-2 mb-2">
                        {m.description}
                      </div>
                    )}
                    {m.steps.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {m.steps.map(s => {
                          const Icon = STEP_ICONS[s.type]
                          return (
                            <span
                              key={s.id}
                              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                              style={{ background: `${STEP_COLORS[s.type]}15`, color: STEP_COLORS[s.type] }}
                            >
                              <Icon className="h-3 w-3" />
                              {s.title || STEP_LABELS[s.type]}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEdit(m)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted transition-colors"
                      style={{ border: '1px solid rgb(var(--glass-border) / 0.08)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--glass-border) / 0.06)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(m) }}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted transition-colors"
                      style={{ border: '1px solid rgb(var(--glass-border) / 0.08)' }}
                      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#ef4444'; el.style.background = 'rgba(239,68,68,0.08)' }}
                      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = ''; el.style.background = 'transparent' }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => navigate(`/mission/${m.id}`)}
                      className="flex items-center justify-center px-3 py-1.5 min-h-[36px] rounded-xl text-[12px] font-medium transition-colors"
                      style={{ background: 'rgba(0,194,40,0.10)', color: '#00C228', border: '1px solid rgba(0,194,40,0.22)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.20)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.10)' }}
                    >
                      Iniciar
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal overlay */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) closeModal() }}
        >
          <div
            className="mission-modal w-full max-w-lg rounded-2xl bg-surface border border-line flex flex-col overflow-hidden"
            style={{ maxHeight: '90vh' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[16px] font-semibold text-text">{editingId ? 'Editar misión' : 'Nueva misión'}</h2>
              <button
                onClick={closeModal}
                className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden min-h-0">
              <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">

                {/* Título */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">Título *</label>
                  <input
                    required
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Ej: Bienvenida al equipo"
                    className="w-full px-3 py-2.5 min-h-[44px] rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#00C228]/50 transition-colors"
                  />
                </div>

                {/* Descripción */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">Descripción</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Describí el objetivo de esta misión..."
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#00C228]/50 transition-colors resize-none"
                  />
                </div>

                {/* Campaña — solo para superadmin */}
                {campaigns.length > 0 && !isAdminOnly && (
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">Campaña</label>
                    <div className="relative">
                      <select
                        value={form.campaign_id}
                        onChange={e => setForm(f => ({ ...f, campaign_id: e.target.value }))}
                        className="w-full px-3 py-2.5 min-h-[44px] rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none focus:border-[#00C228]/50 transition-colors appearance-none"
                      >
                        <option value="">Sin campaña</option>
                        {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
                    </div>
                  </div>
                )}

                {/* Categoría */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">Categoría</label>
                  <div className="relative">
                    <select
                      value={form.category}
                      onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none focus:border-[#00C228]/50 transition-colors appearance-none"
                    >
                      <option value="">Sin categoría</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
                  </div>
                </div>

                {/* Pasos dinámicos */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[12px] font-medium text-text-muted">
                      Pasos <span className="text-text-subtle font-normal">({form.steps.length})</span>
                    </label>
                    <button
                      type="button"
                      onClick={addStep}
                      className="inline-flex items-center min-h-[36px] text-[11px] font-medium transition-opacity hover:opacity-70"
                      style={{ color: '#00C228' }}
                    >
                      + Agregar paso
                    </button>
                  </div>
                  <div className="space-y-2">
                    {form.steps.map((step, i) => {
                      const StepIcon = STEP_ICONS[step.type]
                      return (
                        <div
                          key={step.id}
                          className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-line bg-bg"
                        >
                          <span className="text-[11px] text-text-subtle w-4 shrink-0 text-center select-none">
                            {i + 1}
                          </span>
                          <input
                            value={step.title}
                            onChange={e => updateStep(step.id, { title: e.target.value })}
                            placeholder={`Nombre del paso ${i + 1}`}
                            className="flex-1 min-w-0 text-[13px] bg-transparent text-text placeholder-text-subtle focus:outline-none"
                          />
                          {/* Type selector */}
                          <div className="relative shrink-0">
                            <select
                              value={step.type}
                              onChange={e => updateStep(step.id, { type: e.target.value as StepType })}
                              className="pl-6 pr-2 py-1 min-h-[36px] rounded-lg text-[11px] font-medium border appearance-none focus:outline-none transition-colors cursor-pointer"
                              style={{
                                background: `${STEP_COLORS[step.type]}15`,
                                color: STEP_COLORS[step.type],
                                borderColor: `${STEP_COLORS[step.type]}30`,
                              }}
                            >
                              {(Object.keys(STEP_LABELS) as StepType[]).map(t => (
                                <option key={t} value={t}>{STEP_LABELS[t]}</option>
                              ))}
                            </select>
                            <StepIcon
                              className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none"
                              style={{ color: STEP_COLORS[step.type] }}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeStep(step.id)}
                            disabled={form.steps.length === 1}
                            className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/6 transition-colors disabled:opacity-25 disabled:pointer-events-none shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-line shrink-0">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex items-center justify-center px-4 py-2 min-h-[36px] rounded-xl text-[13px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors border border-line"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center justify-center px-4 py-2 min-h-[36px] rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50"
                  style={{ background: 'rgba(0,194,40,0.14)', color: '#00C228', border: '1px solid rgba(0,194,40,0.28)' }}
                  onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.24)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.14)' }}
                >
                  {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear misión'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
