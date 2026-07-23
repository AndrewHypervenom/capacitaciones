import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { Plus, Target, X, BookOpen, Video, FileText, Zap, Pencil, Trash2 } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { RichTextArea } from '@/components/ui/RichTextArea'
import { stripMarkdown } from '@/components/ui/RichText'
import { supabase } from '@/lib/supabase'
import { requestDeletion } from '@/services/audit.service'
import type { Json } from '@/types/database'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { FadeIn } from '@/components/ui/motion'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'

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
  intro: '#10D451',
  video: '#3b82f6',
  pdf: '#f59e0b',
  quiz: '#B33D9E',
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
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [missions, setMissions] = useState<Mission[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState<MissionForm>(emptyForm())
  const [filterCampaign, setFilterCampaign] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)

  const { isSuperAdmin, campaignId, loading: authLoading } = useAuth()
  // El capacitador solo ve/gestiona su propia campaña; el superadmin ve todas.
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

      let missionQuery = supabase
        .from('guided_missions')
        .select('*')
        .order('created_at', { ascending: false })
      if (scopedToCampaign && campaignId) missionQuery = missionQuery.eq('campaign_id', campaignId)

      const { data, error } = await missionQuery

      if (error && error.code !== '42P01') {
        console.error('Error loading guided_missions:', error)
      }
      setMissions((data ?? []).map(normalizeRow))
      setLoading(false)
    }
    load()
  }, [authLoading, scopedToCampaign, campaignId])

  const openModal = () => {
    setForm({ ...emptyForm(), campaign_id: scopedToCampaign ? (campaignId ?? '') : '' })
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
    const ok = await confirm({
      title: t('confirm.delete_mission_title'),
      description: t('confirm.delete_mission_desc'),
    })
    if (!ok) return
    try {
      await requestDeletion('guided_missions', m.id)
      setMissions(prev => prev.filter(x => x.id !== m.id))
    } catch (error) {
      console.error('Error deleting mission:', error)
    }
  }

  const addStep = () =>
    setForm(f => ({ ...f, steps: [...f.steps, newStep()] }))

  const removeStep = async (id: string) => {
    if (!(await confirm({ title: t('confirm.delete_block_title'), description: t('confirm.delete_block_desc'), confirmLabel: t('confirm.remove') }))) return
    setForm(f => ({ ...f, steps: f.steps.filter(s => s.id !== id) }))
  }

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

  if (!authLoading && scopedToCampaign && !campaignId) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-[24px] font-bold text-text mb-1">{i18n.t('admin.worlds.lm_title')}</h1>
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
        .mission-modal { animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>

      <div className="p-4 sm:p-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-1">
          <h1 className="text-[24px] font-bold text-text">{i18n.t('admin.worlds.lm_title')}</h1>
          <button
            onClick={openModal}
            className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-xl text-[13px] font-medium transition-colors"
            style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.20)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.12)' }}
          >
            <Plus className="h-4 w-4" />
            Nueva misión
          </button>
        </div>
        <p className="text-text-muted text-[13px] mb-8">
          Diseñá rutas de aprendizaje paso a paso con objetivos claros
        </p>

        {/* Campaign filter — solo para superadmin */}
        {!loading && campaigns.length > 0 && !scopedToCampaign && (
          <FilterDropdown
            value={filterCampaign === 'all' ? '' : filterCampaign}
            onChange={v => setFilterCampaign(v || 'all')}
            options={[{ value: '', label: t('common.all_campaigns') }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]}
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
            style={{ background: 'rgba(16,212,81,0.04)', border: '1px dashed rgba(16,212,81,0.20)' }}
          >
            <Target className="h-10 w-10 mb-4" style={{ color: '#10D451', opacity: 0.5 }} />
            <div className="text-[15px] font-medium text-text mb-1">{i18n.t('admin.worlds.no_missions')}</div>
            <div className="text-[13px] text-text-muted mb-5 max-w-xs">
              Creá tu primera misión para organizar el aprendizaje en pasos claros y medibles
            </div>
            <button
              onClick={openModal}
              className="flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-xl text-[13px] font-medium transition-colors"
              style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.20)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.12)' }}
            >
              <Plus className="h-4 w-4" />
              Nueva misión
            </button>
          </div>
        ) : (
          /* Mission cards grid */
          <FadeIn className="grid md:grid-cols-2 gap-4" y={16}>
            {missions.filter(m => filterCampaign === 'all' || m.campaign_id === filterCampaign).map(m => {
              const campaignName = campaigns.find(c => c.id === m.campaign_id)?.name
              return (
                <div
                  key={m.id}
                  className="group rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover hover:border-primary/40 bg-surface border border-line"
                >
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(16,212,81,0.10)' }}
                  >
                    <Target className="h-5 w-5" style={{ color: '#10D451' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <div className="text-[15px] font-semibold text-text truncate">{m.title}</div>
                      {m.category && (
                        <span
                          className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(16,212,81,0.10)', color: '#10D451' }}
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
                        {stripMarkdown(m.description)}
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
                      className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted transition-colors"
                      style={{ border: '1px solid rgb(var(--glass-border) / 0.08)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--glass-border) / 0.06)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); handleDelete(m) }}
                      className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted transition-colors"
                      style={{ border: '1px solid rgb(var(--glass-border) / 0.08)' }}
                      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#ef4444'; el.style.background = 'rgba(239,68,68,0.08)' }}
                      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = ''; el.style.background = 'transparent' }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => navigate(`/mission/${m.id}`)}
                      className="flex items-center justify-center px-3 py-1.5 min-h-[36px] rounded-xl text-[12px] font-medium transition-colors"
                      style={{ background: 'rgba(16,212,81,0.10)', color: '#10D451', border: '1px solid rgba(16,212,81,0.22)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.20)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.10)' }}
                    >
                      Iniciar
                    </button>
                  </div>
                </div>
              )
            })}
          </FadeIn>
        )}
      </div>

      {/* Modal overlay */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)' }}
          {...backdropDismiss(closeModal)}
        >
          <div
            className="mission-modal w-full max-w-lg rounded-2xl bg-surface border border-line flex flex-col overflow-hidden"
            style={{ maxHeight: '90vh' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[16px] font-semibold text-text">{editingId ? t('admin.worlds.lm_edit_mission') : t('admin.worlds.lm_new_mission')}</h2>
              <button
                onClick={closeModal}
                className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden min-h-0">
              <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">

                {/* Título */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.title_required')}</label>
                  <input
                    required
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder={i18n.t('admin.worlds.ph_mission_title')}
                    className="w-full px-3 py-2.5 min-h-[44px] rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#10D451]/50 transition-colors"
                  />
                </div>

                {/* Descripción */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.description')}</label>
                  <RichTextArea
                    value={form.description}
                    onChange={v => setForm(f => ({ ...f, description: v }))}
                    placeholder={i18n.t('admin.worlds.ph_mission_desc')}
                    rows={3}
                  />
                </div>

                {/* Campaña — solo para superadmin */}
                {campaigns.length > 0 && !scopedToCampaign && (
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.campaign')}</label>
                    <Select
                      value={form.campaign_id}
                      onChange={v => setForm(f => ({ ...f, campaign_id: v }))}
                      options={[
                        { value: '', label: i18n.t('admin.worlds.no_campaign') },
                        ...campaigns.map(c => ({ value: c.id, label: c.name })),
                      ]}
                    />
                  </div>
                )}

                {/* Categoría */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.category')}</label>
                  <Select
                    value={form.category}
                    onChange={v => setForm(f => ({ ...f, category: v }))}
                    options={[
                      { value: '', label: i18n.t('admin.worlds.no_category') },
                      ...CATEGORIES.map(c => ({ value: c, label: c })),
                    ]}
                  />
                </div>

                {/* Pasos dinámicos */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[12px] font-medium text-text-muted">
                      {t('common.steps')} <span className="text-text-subtle font-normal">({form.steps.length})</span>
                    </label>
                    <button
                      type="button"
                      onClick={addStep}
                      className="inline-flex items-center min-h-[36px] text-[11px] font-medium transition-opacity hover:opacity-70"
                      style={{ color: '#10D451' }}
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
                            placeholder={t('admin.worlds.lm_ph_step_name', { n: i + 1 })}
                            className="flex-1 min-w-0 text-[13px] bg-transparent text-text placeholder-text-subtle focus:outline-none"
                          />
                          {/* Type selector */}
                          <Select
                            compact
                            tinted
                            className="w-auto shrink-0"
                            leadingIcon={<StepIcon className="h-3 w-3" style={{ color: STEP_COLORS[step.type] }} />}
                            value={step.type}
                            onChange={v => updateStep(step.id, { type: v as StepType })}
                            options={(Object.keys(STEP_LABELS) as StepType[]).map(t => ({
                              value: t,
                              label: STEP_LABELS[t],
                              color: STEP_COLORS[t],
                            }))}
                          />
                          <button
                            type="button"
                            onClick={() => removeStep(step.id)}
                            disabled={form.steps.length === 1}
                            className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/6 transition-colors disabled:opacity-25 disabled:pointer-events-none shrink-0"
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
                  style={{ background: 'rgba(16,212,81,0.14)', color: '#10D451', border: '1px solid rgba(16,212,81,0.28)' }}
                  onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.24)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.14)' }}
                >
                  {saving ? t('common.saving') : editingId ? t('common.save_changes') : t('admin.worlds.lm_create_mission')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
