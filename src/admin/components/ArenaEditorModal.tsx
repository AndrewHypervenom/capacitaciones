import { useEffect, useState } from 'react'
import { X, ChevronRight, Plus, Trash2, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { Select } from '@/components/ui/Select'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'

export type QuizStatus = 'draft' | 'published'
export type ThemeType = 'airline' | 'bank' | 'health' | 'corporate' | 'tech'

export interface QuizOption {
  id: string
  text: string
  correct: boolean
  explanation: string
}

export interface QuizStep {
  id: string
  question: string
  context: string
  options: QuizOption[]
}

export interface ArenaQuiz {
  id: string
  title: string
  description: string
  campaign_id: string | null
  world_id: string | null
  theme_icon: string
  theme_color: string
  theme_type: ThemeType
  xp_per_question: number
  section_size: number
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
  section_size: number
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

// El recorrido del aprendiz agrupa las preguntas en secciones (P1, P2…). Cuántas
// preguntas por sección lo elige el capacitador por quiz (arena_quizzes.section_size);
// el ArenaPlayer respeta el mismo valor. 3 es el default histórico.
const DEFAULT_SECTION_SIZE = 3
const MIN_SECTION_SIZE = 1
const MAX_SECTION_SIZE = 5

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
  section_size: DEFAULT_SECTION_SIZE,
  steps: [newStep()],
})

export function normalizeArenaRow(row: Record<string, unknown>): ArenaQuiz {
  const rawSteps = Array.isArray(row.steps) ? row.steps : []
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? '',
    campaign_id: (row.campaign_id as string | null) ?? null,
    world_id: (row.world_id as string | null) ?? null,
    theme_icon: (row.theme_icon as string) ?? '⚔️',
    theme_color: (row.theme_color as string) ?? '#10D451',
    theme_type: (row.theme_type as ThemeType) ?? 'corporate',
    xp_per_question: (row.xp_per_question as number) ?? 10,
    section_size: (row.section_size as number) ?? DEFAULT_SECTION_SIZE,
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

interface Props {
  /** Arena existente a editar; null para crear una nueva. */
  editing: ArenaQuiz | null
  /** Campaña por defecto (se preselecciona al crear). */
  defaultCampaignId?: string | null
  /** Mundo al que pertenece la arena (null = arena suelta). */
  worldId?: string | null
  /** Si el usuario está acotado a su campaña (capacitador). */
  scopedToCampaign: boolean
  /** Lista de campañas para el selector (solo superadmin). */
  campaigns: Campaign[]
  /** Contexto opcional que se muestra como migaja arriba (ej. nombre del mundo). */
  crumb?: string
  onClose: () => void
  onSaved: (quiz: ArenaQuiz) => void
}

/**
 * Editor completo de una arena (quiz de competencia): datos, tema y preguntas.
 * Extraído de la página Arena para poder abrirse también dentro de Mundos.
 */
export function ArenaEditorModal({
  editing,
  defaultCampaignId,
  worldId,
  scopedToCampaign,
  campaigns,
  crumb,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<QuizForm>(emptyForm())
  // Acordeón: qué preguntas están desplegadas (por id). Al editar un quiz existente
  // arrancan colapsadas para manejar bancos largos; las nuevas se abren solas.
  const [openSteps, setOpenSteps] = useState<Record<string, boolean>>({})

  // Tamaño de sección efectivo (nunca 0 para no dividir por cero al agrupar).
  const sectionSize = Math.max(MIN_SECTION_SIZE, form.section_size || DEFAULT_SECTION_SIZE)

  useEffect(() => {
    if (editing) {
      const steps = editing.steps.length > 0 ? editing.steps : [newStep()]
      setForm({
        title: editing.title,
        description: editing.description,
        campaign_id: editing.campaign_id ?? '',
        theme_icon: editing.theme_icon,
        theme_color: editing.theme_color,
        theme_type: editing.theme_type,
        xp_per_question: editing.xp_per_question,
        section_size: editing.section_size || DEFAULT_SECTION_SIZE,
        steps,
      })
      // Quiz existente: todas colapsadas (excepto la 1ª) para no abrumar.
      setOpenSteps(steps.length > 0 ? { [steps[0].id]: true } : {})
    } else {
      const fresh = { ...emptyForm(), campaign_id: defaultCampaignId ?? '' }
      setForm(fresh)
      // Quiz nuevo: la única pregunta arranca abierta.
      setOpenSteps(fresh.steps.length > 0 ? { [fresh.steps[0].id]: true } : {})
    }
  }, [editing, defaultCampaignId])

  const toggleStep = (stepId: string) =>
    setOpenSteps(o => ({ ...o, [stepId]: !o[stepId] }))

  // ¿Están todas desplegadas? (para el botón "colapsar/expandir todo").
  const allOpen = form.steps.length > 0 && form.steps.every(s => openSteps[s.id])
  const setAllOpen = (open: boolean) =>
    setOpenSteps(open ? Object.fromEntries(form.steps.map(s => [s.id, true])) : {})

  const addStep = () => {
    const s = newStep()
    setForm(f => ({ ...f, steps: [...f.steps, s] }))
    setOpenSteps(o => ({ ...o, [s.id]: true }))
  }

  // Agrega una sección completa (sectionSize preguntas), como una parada nueva
  // del recorrido. Espeja lo que hace la IA (preguntas por nivel = secciones × tamaño).
  const addSection = () => {
    const nuevas = Array.from({ length: sectionSize }, newStep)
    setForm(f => ({ ...f, steps: [...f.steps, ...nuevas] }))
    setOpenSteps(o => ({ ...o, ...Object.fromEntries(nuevas.map(s => [s.id, true])) }))
  }

  const removeStep = async (stepId: string) => {
    if (!(await confirm({ title: t('confirm.delete_question_title'), description: t('confirm.delete_question_desc'), confirmLabel: t('confirm.remove') }))) return
    setForm(f => ({ ...f, steps: f.steps.filter(s => s.id !== stepId) }))
    setOpenSteps(o => { const { [stepId]: _drop, ...rest } = o; return rest })
  }

  const updateStep = (stepId: string, patch: Partial<Omit<QuizStep, 'options'>>) =>
    setForm(f => ({ ...f, steps: f.steps.map(s => (s.id === stepId ? { ...s, ...patch } : s)) }))

  const addOption = (stepId: string) =>
    setForm(f => ({
      ...f,
      steps: f.steps.map(s =>
        s.id === stepId && s.options.length < 4 ? { ...s, options: [...s.options, newOption()] } : s,
      ),
    }))

  const removeOption = async (stepId: string, optId: string) => {
    if (!(await confirm({ title: t('confirm.delete_option_title'), description: t('confirm.delete_option_desc'), confirmLabel: t('confirm.remove') }))) return
    setForm(f => ({
      ...f,
      steps: f.steps.map(s =>
        s.id === stepId && s.options.length > 2 ? { ...s, options: s.options.filter(o => o.id !== optId) } : s,
      ),
    }))
  }

  const updateOption = (stepId: string, optId: string, patch: Partial<QuizOption>) =>
    setForm(f => ({
      ...f,
      steps: f.steps.map(s =>
        s.id === stepId ? { ...s, options: s.options.map(o => (o.id === optId ? { ...o, ...patch } : o)) } : s,
      ),
    }))

  const setCorrect = (stepId: string, optId: string) =>
    setForm(f => ({
      ...f,
      steps: f.steps.map(s =>
        s.id === stepId ? { ...s, options: s.options.map(o => ({ ...o, correct: o.id === optId })) } : s,
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
      world_id: worldId ?? null,
      theme_icon: form.theme_icon || '⚔️',
      theme_color: form.theme_color,
      theme_type: form.theme_type,
      xp_per_question: form.xp_per_question,
      section_size: sectionSize,
      steps: form.steps.filter(s => s.question.trim()) as unknown as Json,
    }

    if (editing) {
      const { data, error } = await supabase
        .from('arena_quizzes')
        .update(payload)
        .eq('id', editing.id)
        .select()
        .single()
      if (!error && data) {
        onSaved(normalizeArenaRow(data))
        onClose()
      } else {
        console.error('Error updating arena:', error)
      }
    } else {
      const { data, error } = await supabase
        .from('arena_quizzes')
        .insert({ ...payload, status: 'draft' as QuizStatus })
        .select()
        .single()
      if (!error && data) {
        onSaved(normalizeArenaRow(data))
        onClose()
      } else {
        console.error('Error saving arena:', error)
      }
    }
    setSaving(false)
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)' }}
      {...backdropDismiss(onClose)}
    >
      <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div
        className="w-full max-w-2xl rounded-2xl bg-surface border border-line flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh', animation: 'slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
          <h2 className="text-[16px] font-semibold text-text">
            {editing ? i18n.t('common.edit_quiz') : i18n.t('common.new_quiz')}
          </h2>
          <button
            onClick={onClose}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {crumb && (
          <div className="px-4 sm:px-6 py-2 text-[11.5px] text-text-muted border-b border-line bg-green-500/[0.04] shrink-0">
            <span className="text-green-600 dark:text-green-400 font-medium">{crumb}</span> · este quiz vive dentro del mundo
          </div>
        )}

        {/* Body */}
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

            {/* Preguntas */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <label className="text-[12px] font-medium text-text-muted">
                  {i18n.t('admin.arena.questions_label', { defaultValue: 'Preguntas' })}{' '}
                  <span className="text-text-subtle font-normal">
                    ({form.steps.length} · {Math.ceil(form.steps.length / sectionSize)} {Math.ceil(form.steps.length / sectionSize) === 1
                      ? i18n.t('admin.arena.section_one', { defaultValue: 'sección' })
                      : i18n.t('admin.arena.section_many', { defaultValue: 'secciones' })})
                  </span>
                </label>
                {/* Colapsar / expandir todas las preguntas del banco. */}
                {form.steps.length > 1 && (
                  <button type="button" onClick={() => setAllOpen(!allOpen)}
                    className="flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-text transition-colors">
                    {allOpen
                      ? <><ChevronsDownUp className="h-3.5 w-3.5" /> {i18n.t('admin.arena.collapse_all', { defaultValue: 'Colapsar todas' })}</>
                      : <><ChevronsUpDown className="h-3.5 w-3.5" /> {i18n.t('admin.arena.expand_all', { defaultValue: 'Expandir todas' })}</>}
                  </button>
                )}
              </div>

              {/* Control: cuántas preguntas agrupa cada sección (parada del mapa). */}
              <div className="mb-3 rounded-xl border border-line bg-bg/50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-text">
                      {i18n.t('admin.arena.section_size_label', { defaultValue: 'Preguntas por sección' })}
                    </div>
                    <p className="text-[11px] text-text-muted leading-relaxed mt-0.5">
                      {i18n.t('admin.arena.section_size_hint', { size: sectionSize, defaultValue: `Cada sección (P1, P2…) es una parada en el mapa del aprendiz. Ahora agrupa ${sectionSize} pregunta(s).` })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" aria-label={i18n.t('common.decrease', { defaultValue: 'Disminuir' })}
                      onClick={() => setForm(f => ({ ...f, section_size: Math.max(MIN_SECTION_SIZE, (f.section_size || DEFAULT_SECTION_SIZE) - 1) }))}
                      disabled={sectionSize <= MIN_SECTION_SIZE}
                      className="h-9 w-9 flex items-center justify-center rounded-lg border border-line text-text-muted hover:text-text hover:bg-bg transition-colors disabled:opacity-30 disabled:pointer-events-none text-[16px] leading-none">−</button>
                    <input
                      type="number" min={MIN_SECTION_SIZE} max={MAX_SECTION_SIZE}
                      value={form.section_size}
                      onChange={e => {
                        const v = e.target.value === '' ? MIN_SECTION_SIZE : Number(e.target.value)
                        setForm(f => ({ ...f, section_size: Math.max(MIN_SECTION_SIZE, Math.min(MAX_SECTION_SIZE, v)) }))
                      }}
                      className="w-12 h-9 px-2 rounded-lg text-[13px] text-center bg-bg border border-line text-text focus:outline-none focus:border-[#10D451]/50"
                    />
                    <button type="button" aria-label={i18n.t('common.increase', { defaultValue: 'Aumentar' })}
                      onClick={() => setForm(f => ({ ...f, section_size: Math.min(MAX_SECTION_SIZE, (f.section_size || DEFAULT_SECTION_SIZE) + 1) }))}
                      disabled={sectionSize >= MAX_SECTION_SIZE}
                      className="h-9 w-9 flex items-center justify-center rounded-lg border border-line text-text-muted hover:text-text hover:bg-bg transition-colors disabled:opacity-30 disabled:pointer-events-none text-[16px] leading-none">+</button>
                  </div>
                </div>
                {/* Mini-mapa de secciones. */}
                <div className="flex items-center gap-1 overflow-x-auto mt-2.5">
                  {Array.from({ length: Math.max(1, Math.ceil(form.steps.length / sectionSize)) }).map((_, i) => (
                    <div key={i} className="flex items-center gap-1 shrink-0">
                      {i > 0 && <span className="h-px w-4" style={{ background:`${form.theme_color}40` }} />}
                      <span className="h-6 min-w-[28px] px-1.5 rounded-full text-[10.5px] font-bold flex items-center justify-center"
                        style={{ background:`${form.theme_color}18`, color:form.theme_color, border:`1px solid ${form.theme_color}33` }}>
                        P{i + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {form.steps.map((step, si) => {
                  const isOpen = openSteps[step.id] ?? false
                  const preview = step.question.trim()
                  return (
                  <div key={step.id}>
                    {/* Encabezado de sección antes de la 1ª pregunta de cada grupo. */}
                    {si % sectionSize === 0 && (
                      <div className={`flex items-center gap-2 mb-2 ${si > 0 ? 'mt-4 pt-4 border-t border-line/60' : ''}`}>
                        <span className="h-6 min-w-[28px] px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center"
                          style={{ background:`${form.theme_color}18`, color:form.theme_color, border:`1px solid ${form.theme_color}33` }}>
                          P{Math.floor(si / sectionSize) + 1}
                        </span>
                        <span className="text-[12px] font-semibold text-text">
                          {i18n.t('admin.arena.section_n', { n: Math.floor(si / sectionSize) + 1, defaultValue: `Sección ${Math.floor(si / sectionSize) + 1}` })}
                        </span>
                        <span className="text-[11px] text-text-muted">· {i18n.t('admin.arena.section_stop', { defaultValue: 'una parada del recorrido' })}</span>
                      </div>
                    )}
                    <div className="rounded-xl border border-line bg-bg overflow-hidden">
                    {/* Cabecera del acordeón: clic para plegar/desplegar. */}
                    <div className="flex items-center gap-2 px-3 sm:px-4 py-3 cursor-pointer select-none hover:bg-surface/40 transition-colors"
                      onClick={() => toggleStep(step.id)}>
                      <ChevronRight className={`h-4 w-4 text-text-muted shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide shrink-0">
                        {i18n.t('common.question_n', { n: si + 1 })}
                      </span>
                      {!isOpen && (
                        <span className={`text-[12px] truncate flex-1 min-w-0 ${preview ? 'text-text' : 'text-text-subtle italic'}`}>
                          {preview || i18n.t('admin.arena.empty_question', { defaultValue: 'Sin enunciado…' })}
                        </span>
                      )}
                      {isOpen && <span className="flex-1" />}
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); removeStep(step.id) }}
                        disabled={form.steps.length === 1}
                        className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/6 transition-colors disabled:opacity-25 disabled:pointer-events-none shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {isOpen && (
                    <div className="px-3 sm:px-4 pb-4 space-y-3 border-t border-line/50 pt-3">
                    <textarea
                      value={step.question}
                      onChange={e => updateStep(step.id, { question: e.target.value })}
                      placeholder={i18n.t('admin.arena.ph_question')}
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg text-[13px] bg-surface border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#10D451]/40 transition-colors resize-none"
                    />

                    <input
                      value={step.context}
                      onChange={e => updateStep(step.id, { context: e.target.value })}
                      placeholder={i18n.t('admin.arena.ph_hint')}
                      className="w-full px-3 py-2 rounded-lg text-[12px] bg-surface border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#10D451]/40 transition-colors"
                    />

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] text-text-subtle">
                          Opciones <span className="opacity-60">{i18n.t('admin.arena.circle_correct')}</span>
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
                    )}
                  </div>
                  </div>
                  )
                })}
              </div>

              {/* Agregar preguntas ABAJO (no arriba): agregar sin tener que subir. */}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button type="button" onClick={addStep}
                  className="flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl text-[12px] font-medium transition-colors"
                  style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}>
                  <Plus className="h-3.5 w-3.5" /> {i18n.t('common.add_question')}
                </button>
                <button type="button" onClick={addSection}
                  className="flex items-center justify-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-xl text-[12px] font-medium transition-colors"
                  style={{ background: `${form.theme_color}14`, color: form.theme_color, border: `1px solid ${form.theme_color}33` }}>
                  <Plus className="h-3.5 w-3.5" /> {i18n.t('admin.arena.add_section_full', { size: sectionSize, defaultValue: `Sección (${sectionSize} preguntas)` })}
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors border border-line"
            >
              {i18n.t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50"
              style={{ background: 'rgba(16,212,81,0.14)', color: '#10D451', border: '1px solid rgba(16,212,81,0.28)' }}
            >
              {saving ? i18n.t('common.saving') : editing ? i18n.t('common.save_changes') : i18n.t('common.create_quiz')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
