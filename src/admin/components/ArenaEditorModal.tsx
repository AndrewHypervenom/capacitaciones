import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
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
  airline: 'Aerolínea',
  bank: 'Banco',
  health: 'Salud',
  corporate: 'Corporativo',
  tech: 'Tecnología',
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
  theme_color: '#00C228',
  theme_type: 'corporate',
  xp_per_question: 10,
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
    theme_color: (row.theme_color as string) ?? '#00C228',
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

  useEffect(() => {
    if (editing) {
      setForm({
        title: editing.title,
        description: editing.description,
        campaign_id: editing.campaign_id ?? '',
        theme_icon: editing.theme_icon,
        theme_color: editing.theme_color,
        theme_type: editing.theme_type,
        xp_per_question: editing.xp_per_question,
        steps: editing.steps.length > 0 ? editing.steps : [newStep()],
      })
    } else {
      setForm({ ...emptyForm(), campaign_id: defaultCampaignId ?? '' })
    }
  }, [editing, defaultCampaignId])

  const addStep = () => setForm(f => ({ ...f, steps: [...f.steps, newStep()] }))

  const removeStep = async (stepId: string) => {
    if (!(await confirm({ title: t('confirm.delete_question_title'), description: t('confirm.delete_question_desc'), confirmLabel: t('confirm.remove') }))) return
    setForm(f => ({ ...f, steps: f.steps.filter(s => s.id !== stepId) }))
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
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <style>{`@keyframes slideUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div
        className="w-full max-w-2xl rounded-2xl bg-surface border border-line flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh', animation: 'slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
          <h2 className="text-[16px] font-semibold text-text">
            {editing ? 'Editar quiz' : 'Nuevo quiz'}
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
                className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#00C228]/50 transition-colors min-h-[44px]"
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
                className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#00C228]/50 transition-colors resize-none"
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
                  options={THEME_TYPES.map(tt => ({ value: tt, label: THEME_LABELS[tt] }))}
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
                  className="w-full px-3 py-2.5 rounded-xl text-[18px] bg-bg border border-line text-text focus:outline-none focus:border-[#00C228]/50 transition-colors text-center min-h-[44px]"
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
                  className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none focus:border-[#00C228]/50 transition-colors min-h-[44px]"
                />
              </div>
            </div>

            {/* Preguntas */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[12px] font-medium text-text-muted">
                  Preguntas <span className="text-text-subtle font-normal">({form.steps.length})</span>
                </label>
                <button
                  type="button"
                  onClick={addStep}
                  className="text-[11px] font-medium transition-opacity hover:opacity-70"
                  style={{ color: '#00C228' }}
                >
                  + Agregar pregunta
                </button>
              </div>

              <div className="space-y-3">
                {form.steps.map((step, si) => (
                  <div key={step.id} className="rounded-xl border border-line bg-bg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
                        Pregunta {si + 1}
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

                    <textarea
                      value={step.question}
                      onChange={e => updateStep(step.id, { question: e.target.value })}
                      placeholder={i18n.t('admin.arena.ph_question')}
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg text-[13px] bg-surface border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#00C228]/40 transition-colors resize-none"
                    />

                    <input
                      value={step.context}
                      onChange={e => updateStep(step.id, { context: e.target.value })}
                      placeholder={i18n.t('admin.arena.ph_hint')}
                      className="w-full px-3 py-2 rounded-lg text-[12px] bg-surface border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#00C228]/40 transition-colors"
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
                            style={{ color: '#00C228' }}
                          >
                            + Opción
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
                                    ? { background: '#00C228', borderColor: '#00C228' }
                                    : { background: 'transparent', borderColor: 'rgb(var(--glass-border) / 0.22)' }
                                }
                              />
                              <input
                                value={opt.text}
                                onChange={e => updateOption(step.id, opt.id, { text: e.target.value })}
                                placeholder={`Opción ${oi + 1}...`}
                                className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg text-[12px] bg-surface text-text placeholder-text-subtle focus:outline-none transition-colors"
                                style={
                                  opt.correct
                                    ? { border: '1px solid rgba(0,194,40,0.35)' }
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
                              className="w-full pl-6 pr-2.5 py-1 rounded-lg text-[11px] bg-surface border border-line text-text-muted placeholder-text-subtle focus:outline-none focus:border-[#00C228]/30 transition-colors"
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

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors border border-line"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50"
              style={{ background: 'rgba(0,194,40,0.14)', color: '#00C228', border: '1px solid rgba(0,194,40,0.28)' }}
            >
              {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear quiz'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
