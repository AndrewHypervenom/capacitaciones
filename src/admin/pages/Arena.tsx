import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { Plus, X, Pencil, Trash2, Trophy } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'

type QuizStatus = 'draft' | 'published'
type ThemeType = 'airline' | 'bank' | 'health' | 'corporate' | 'tech'

interface QuizOption {
  id: string
  text: string
  correct: boolean
  explanation: string
}

interface QuizStep {
  id: string
  question: string
  context: string
  options: QuizOption[]
}

interface ArenaQuiz {
  id: string
  title: string
  description: string
  campaign_id: string | null
  theme_icon: string
  theme_color: string
  theme_type: ThemeType
  xp_per_question: number
  status: QuizStatus
  steps: QuizStep[]
}

interface Campaign {
  id: string
  name: string
}

interface QuizForm {
  title: string
  description: string
  campaign_id: string
  theme_icon: string
  theme_color: string
  theme_type: string
  xp_per_question: number
  steps: QuizStep[]
}

const THEME_TYPES: ThemeType[] = ['airline', 'bank', 'health', 'corporate', 'tech']
const THEME_LABELS: Record<ThemeType, string> = {
  airline: 'admin.arena.theme_airline',
  bank: 'admin.arena.theme_bank',
  health: 'admin.arena.theme_health',
  corporate: 'admin.arena.theme_corporate',
  tech: 'admin.arena.theme_tech',
}

const newOption = (): QuizOption => ({
  id: crypto.randomUUID(),
  text: '',
  correct: false,
  explanation: '',
})

const newStep = (): QuizStep => ({
  id: crypto.randomUUID(),
  question: '',
  context: '',
  options: [newOption(), newOption()],
})

const emptyForm = (): QuizForm => ({
  title: '',
  description: '',
  campaign_id: '',
  theme_icon: '⚔️',
  theme_color: '#10D451',
  theme_type: 'corporate',
  xp_per_question: 10,
  steps: [newStep()],
})

function normalizeRow(row: Record<string, unknown>): ArenaQuiz {
  const rawSteps = Array.isArray(row.steps) ? row.steps : []
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? '',
    campaign_id: (row.campaign_id as string | null) ?? null,
    theme_icon: (row.theme_icon as string) ?? '⚔️',
    theme_color: (row.theme_color as string) ?? '#10D451',
    theme_type: (row.theme_type as ThemeType) ?? 'corporate',
    xp_per_question: (row.xp_per_question as number) ?? 10,
    status: (row.status as QuizStatus) ?? 'draft',
    steps: rawSteps.map((s: Record<string, unknown>) => ({
      id: (s.id as string) ?? crypto.randomUUID(),
      question: (s.question as string) ?? '',
      context: (s.context as string) ?? '',
      options: Array.isArray(s.options)
        ? (s.options as Record<string, unknown>[]).map((o) => ({
            id: (o.id as string) ?? crypto.randomUUID(),
            text: (o.text as string) ?? '',
            correct: (o.correct as boolean) ?? false,
            explanation: (o.explanation as string) ?? '',
          }))
        : [newOption(), newOption()],
    })),
  }
}

export default function Arena() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [quizzes, setQuizzes] = useState<ArenaQuiz[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState<QuizForm>(emptyForm())
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

      let quizQuery = supabase
        .from('arena_quizzes')
        .select('*')
        .order('created_at', { ascending: false })
      if (scopedToCampaign && campaignId) quizQuery = quizQuery.eq('campaign_id', campaignId)

      const { data, error } = await quizQuery

      if (error && error.code !== '42P01') {
        console.error('Error loading arena_quizzes:', error)
      }
      setQuizzes((data ?? []).map(normalizeRow))
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

  const openEdit = (q: ArenaQuiz) => {
    setEditingId(q.id)
    setForm({
      title: q.title,
      description: q.description,
      campaign_id: q.campaign_id ?? '',
      theme_icon: q.theme_icon,
      theme_color: q.theme_color,
      theme_type: q.theme_type,
      xp_per_question: q.xp_per_question,
      steps: q.steps.length > 0 ? q.steps : [newStep()],
    })
    setIsModalOpen(true)
  }

  const handleDelete = async (q: ArenaQuiz) => {
    const ok = await confirm({
      title: t('confirm.delete_quiz_title'),
      description: t('confirm.delete_quiz_desc'),
    })
    if (!ok) return
    const { error } = await supabase.from('arena_quizzes').delete().eq('id', q.id)
    if (!error) setQuizzes(prev => prev.filter(x => x.id !== q.id))
    else console.error('Error deleting quiz:', error)
  }

  const handlePublish = async (q: ArenaQuiz) => {
    const newStatus: QuizStatus = q.status === 'published' ? 'draft' : 'published'
    const { data, error } = await supabase
      .from('arena_quizzes')
      .update({ status: newStatus })
      .eq('id', q.id)
      .select()
      .single()
    if (!error && data) {
      setQuizzes(prev => prev.map(x => (x.id === q.id ? normalizeRow(data) : x)))
    } else {
      console.error('Error toggling publish:', error)
    }
  }

  const addStep = () =>
    setForm(f => ({ ...f, steps: [...f.steps, newStep()] }))

  const removeStep = async (stepId: string) => {
    if (!(await confirm({ title: t('confirm.delete_question_title'), description: t('confirm.delete_question_desc'), confirmLabel: t('confirm.remove') }))) return
    setForm(f => ({ ...f, steps: f.steps.filter(s => s.id !== stepId) }))
  }

  const updateStep = (stepId: string, patch: Partial<Omit<QuizStep, 'options'>>) =>
    setForm(f => ({
      ...f,
      steps: f.steps.map(s => (s.id === stepId ? { ...s, ...patch } : s)),
    }))

  const addOption = (stepId: string) =>
    setForm(f => ({
      ...f,
      steps: f.steps.map(s =>
        s.id === stepId && s.options.length < 4
          ? { ...s, options: [...s.options, newOption()] }
          : s,
      ),
    }))

  const removeOption = async (stepId: string, optId: string) => {
    if (!(await confirm({ title: t('confirm.delete_option_title'), description: t('confirm.delete_option_desc'), confirmLabel: t('confirm.remove') }))) return
    setForm(f => ({
      ...f,
      steps: f.steps.map(s =>
        s.id === stepId && s.options.length > 2
          ? { ...s, options: s.options.filter(o => o.id !== optId) }
          : s,
      ),
    }))
  }

  const updateOption = (stepId: string, optId: string, patch: Partial<QuizOption>) =>
    setForm(f => ({
      ...f,
      steps: f.steps.map(s =>
        s.id === stepId
          ? { ...s, options: s.options.map(o => (o.id === optId ? { ...o, ...patch } : o)) }
          : s,
      ),
    }))

  const setCorrect = (stepId: string, optId: string) =>
    setForm(f => ({
      ...f,
      steps: f.steps.map(s =>
        s.id === stepId
          ? { ...s, options: s.options.map(o => ({ ...o, correct: o.id === optId })) }
          : s,
      ),
    }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || saving) return
    setSaving(true)

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      campaign_id: form.campaign_id || null,
      theme_icon: form.theme_icon || '⚔️',
      theme_color: form.theme_color,
      theme_type: form.theme_type,
      xp_per_question: form.xp_per_question,
      steps: form.steps.filter(s => s.question.trim()) as unknown as Json,
    }

    if (editingId) {
      const { data, error } = await supabase
        .from('arena_quizzes')
        .update(payload)
        .eq('id', editingId)
        .select()
        .single()
      if (!error && data) {
        setQuizzes(prev => prev.map(x => (x.id === editingId ? normalizeRow(data) : x)))
        closeModal()
      } else {
        console.error('Error updating quiz:', error)
      }
    } else {
      const { data, error } = await supabase
        .from('arena_quizzes')
        .insert({ ...payload, status: 'draft' as QuizStatus })
        .select()
        .single()
      if (!error && data) {
        setQuizzes(prev => [normalizeRow(data), ...prev])
        closeModal()
      } else {
        console.error('Error saving quiz:', error)
      }
    }
    setSaving(false)
  }

  const filtered = quizzes.filter(
    q => filterCampaign === 'all' || q.campaign_id === filterCampaign,
  )

  if (!authLoading && scopedToCampaign && !campaignId) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">Arena</h1>
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
        .arena-modal { animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
      `}</style>

      <div className="p-4 sm:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-[20px] sm:text-[24px] font-bold text-text">Arena</h1>
          <button
            onClick={openModal}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors min-h-[44px]"
            style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.20)' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.12)' }}
          >
            <Plus className="h-4 w-4" />
            {i18n.t('common.new_quiz')}
          </button>
        </div>
        <p className="text-text-muted text-[13px] mb-8">
          Creá quizzes gamificados con preguntas, opciones y XP por respuesta correcta
        </p>

        {/* Campaign filter — solo para superadmin */}
        {!loading && campaigns.length > 0 && !scopedToCampaign && (
          <FilterDropdown
            value={filterCampaign === 'all' ? '' : filterCampaign}
            onChange={v => setFilterCampaign(v || 'all')}
            options={[{ value: '', label: i18n.t('common.all_campaigns') }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]}
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
            className="rounded-2xl p-10 flex flex-col items-center justify-center text-center"
            style={{ background: 'rgba(16,212,81,0.04)', border: '1px dashed rgba(16,212,81,0.20)' }}
          >
            <Trophy className="h-10 w-10 mb-4" style={{ color: '#10D451', opacity: 0.5 }} />
            <div className="text-[15px] font-medium text-text mb-1">{i18n.t('admin.arena.no_quizzes')}</div>
            <div className="text-[13px] text-text-muted mb-5 max-w-xs">
              Creá tu primer quiz para poner a prueba el conocimiento de los participantes
            </div>
            <button
              onClick={openModal}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors min-h-[44px]"
              style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.20)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.12)' }}
            >
              <Plus className="h-4 w-4" />
              {i18n.t('common.new_quiz')}
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map(q => {
              const campaignName = campaigns.find(c => c.id === q.campaign_id)?.name
              const isPublished = q.status === 'published'
              return (
                <div
                  key={q.id}
                  className="group rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 transition-all hover:scale-[1.01] bg-surface border border-line"
                >
                  <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 text-[20px]"
                      style={{ background: `${q.theme_color}18` }}
                    >
                      {q.theme_icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <div className="text-[15px] font-semibold text-text truncate">{q.title}</div>
                        <span
                          className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={
                            isPublished
                              ? { background: 'rgba(16,212,81,0.10)', color: '#10D451' }
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
                      {q.description && (
                        <div className="text-[12px] text-text-muted leading-relaxed line-clamp-2 mb-2">
                          {q.description}
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                          style={{ background: `${q.theme_color}15`, color: q.theme_color }}
                        >
                          {THEME_LABELS[q.theme_type] ? i18n.t(THEME_LABELS[q.theme_type]) : q.theme_type}
                        </span>
                        <span className="text-[11px] text-text-muted">
                          {q.steps.length} pregunta{q.steps.length !== 1 ? 's' : ''}
                        </span>
                        <span className="text-[11px] text-text-muted">·</span>
                        <span className="text-[11px] text-text-muted">
                          {q.xp_per_question} XP c/u
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 sm:shrink-0 flex-wrap">
                    <button
                      onClick={() => openEdit(q)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted transition-colors"
                      style={{ border: '1px solid rgb(var(--glass-border) / 0.08)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--glass-border) / 0.06)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(q)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted transition-colors"
                      style={{ border: '1px solid rgb(var(--glass-border) / 0.08)' }}
                      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#ef4444'; el.style.background = 'rgba(239,68,68,0.08)' }}
                      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = ''; el.style.background = 'transparent' }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handlePublish(q)}
                      className="flex items-center justify-center min-h-[44px] px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all"
                      style={
                        isPublished
                          ? { background: 'rgb(var(--glass-border) / 0.06)', color: 'rgb(var(--text-muted))', border: '1px solid rgb(var(--glass-border) / 0.10)' }
                          : { background: 'rgba(16,212,81,0.10)', color: '#10D451', border: '1px solid rgba(16,212,81,0.22)' }
                      }
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.70' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                    >
                      {isPublished ? 'Despublicar' : 'Publicar'}
                    </button>
                    <button
                      onClick={() => navigate(`/arena/${q.id}`, { state: { from: 'admin' } })}
                      className="flex items-center justify-center min-h-[44px] px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors"
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
          </div>
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)' }}
          {...backdropDismiss(closeModal)}
        >
          <div
            className="arena-modal w-full max-w-2xl rounded-2xl bg-surface border border-line flex flex-col overflow-hidden"
            style={{ maxHeight: '90vh' }}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[16px] font-semibold text-text">
                {editingId ? i18n.t('common.edit_quiz') : i18n.t('common.new_quiz')}
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

                {/* Título */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.title_required')}</label>
                  <input
                    required
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder={i18n.t('admin.arena.ph_quiz_title')}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#10D451]/50 transition-colors min-h-[44px]"
                  />
                </div>

                {/* Descripción */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.description')}</label>
                  <textarea
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder={i18n.t('admin.arena.ph_quiz_desc')}
                    rows={2}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#10D451]/50 transition-colors resize-none"
                  />
                </div>

                {/* Campaña + Theme type */}
                <div className={scopedToCampaign ? '' : 'grid grid-cols-2 gap-3'}>
                  {!scopedToCampaign && (
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
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.arena.theme_type')}</label>
                    <Select
                      value={form.theme_type}
                      onChange={v => setForm(f => ({ ...f, theme_type: v }))}
                      options={THEME_TYPES.map(tt => ({ value: tt, label: i18n.t(THEME_LABELS[tt]) }))}
                    />
                  </div>
                </div>

                {/* Icono + Color + XP */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.icon_emoji')}</label>
                    <input
                      value={form.theme_icon}
                      onChange={e => setForm(f => ({ ...f, theme_icon: e.target.value }))}
                      placeholder="⚔️"
                      className="w-full px-3 py-2.5 rounded-xl text-[18px] bg-bg border border-line text-text focus:outline-none focus:border-[#10D451]/50 transition-colors text-center min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.arena.theme_color')}</label>
                    <input
                      type="color"
                      value={form.theme_color}
                      onChange={e => setForm(f => ({ ...f, theme_color: e.target.value }))}
                      className="h-11 w-full rounded-xl border border-line bg-bg cursor-pointer p-1"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.arena.xp_per_question')}</label>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={form.xp_per_question}
                      onChange={e => setForm(f => ({ ...f, xp_per_question: Number(e.target.value) }))}
                      className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none focus:border-[#10D451]/50 transition-colors min-h-[44px]"
                    />
                  </div>
                </div>

                {/* Preguntas / Pasos */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[12px] font-medium text-text-muted">
                      Preguntas{' '}
                      <span className="text-text-subtle font-normal">({form.steps.length})</span>
                    </label>
                    <button
                      type="button"
                      onClick={addStep}
                      className="text-[11px] font-medium transition-opacity hover:opacity-70"
                      style={{ color: '#10D451' }}
                    >
                      + {i18n.t('common.add_question')}
                    </button>
                  </div>

                  <div className="space-y-3">
                    {form.steps.map((step, si) => (
                      <div
                        key={step.id}
                        className="rounded-xl border border-line bg-bg p-4 space-y-3"
                      >
                        {/* Step header */}
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
                            {i18n.t('common.question_n', { n: si + 1 })}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeStep(step.id)}
                            disabled={form.steps.length === 1}
                            className="h-6 w-6 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/6 transition-colors disabled:opacity-25 disabled:pointer-events-none"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Question */}
                        <textarea
                          value={step.question}
                          onChange={e => updateStep(step.id, { question: e.target.value })}
                          placeholder={i18n.t('admin.arena.ph_question')}
                          rows={2}
                          className="w-full px-3 py-2 rounded-lg text-[13px] bg-surface border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#10D451]/40 transition-colors resize-none"
                        />

                        {/* Context */}
                        <input
                          value={step.context}
                          onChange={e => updateStep(step.id, { context: e.target.value })}
                          placeholder={i18n.t('admin.arena.ph_hint')}
                          className="w-full px-3 py-2 rounded-lg text-[12px] bg-surface border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#10D451]/40 transition-colors"
                        />

                        {/* Options */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] text-text-subtle">
                              Opciones{' '}
                              <span className="opacity-60">{i18n.t('admin.arena.circle_correct')}</span>
                            </span>
                            {step.options.length < 4 && (
                              <button
                                type="button"
                                onClick={() => addOption(step.id)}
                                className="text-[10px] font-medium hover:opacity-70 transition-opacity"
                                style={{ color: '#10D451' }}
                              >
                                + {i18n.t('common.add_option')}
                              </button>
                            )}
                          </div>
                          <div className="space-y-2">
                            {step.options.map((opt, oi) => (
                              <div key={opt.id} className="space-y-1">
                                <div className="flex items-center gap-2">
                                  {/* Correct toggle (radio-style) */}
                                  <button
                                    type="button"
                                    onClick={() => setCorrect(step.id, opt.id)}
                                    title={i18n.t('admin.arena.mark_correct')}
                                    className="h-4 w-4 rounded-full border-2 shrink-0 transition-all"
                                    style={
                                      opt.correct
                                        ? { background: '#10D451', borderColor: '#10D451' }
                                        : { background: 'transparent', borderColor: 'rgb(var(--glass-border) / 0.22)' }
                                    }
                                  />
                                  <input
                                    value={opt.text}
                                    onChange={e => updateOption(step.id, opt.id, { text: e.target.value })}
                                    placeholder={i18n.t('common.option_n_ph', { n: oi + 1 })}
                                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] bg-surface text-text placeholder-text-subtle focus:outline-none transition-colors"
                                    style={
                                      opt.correct
                                        ? { border: '1px solid rgba(16,212,81,0.35)' }
                                        : { border: '1px solid rgb(var(--glass-border) / 0.08)' }
                                    }
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeOption(step.id, opt.id)}
                                    disabled={step.options.length <= 2}
                                    className="h-5 w-5 flex items-center justify-center rounded text-text-muted hover:text-danger transition-colors disabled:opacity-20 disabled:pointer-events-none shrink-0"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                                {/* Explanation */}
                                <input
                                  value={opt.explanation}
                                  onChange={e => updateOption(step.id, opt.id, { explanation: e.target.value })}
                                  placeholder={i18n.t('admin.arena.ph_explanation')}
                                  className="w-full pl-6 pr-2.5 py-1 rounded-lg text-[11px] bg-surface border border-line text-text-muted placeholder-text-subtle focus:outline-none focus:border-[#10D451]/30 transition-colors"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
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
                  {i18n.t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50"
                  style={{ background: 'rgba(16,212,81,0.14)', color: '#10D451', border: '1px solid rgba(16,212,81,0.28)' }}
                  onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.24)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.14)' }}
                >
                  {saving ? i18n.t('common.saving') : editingId ? i18n.t('common.save_changes') : i18n.t('common.create_quiz')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
