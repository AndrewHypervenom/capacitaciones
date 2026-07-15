import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/cn'

type Lang = 'es' | 'en' | 'pt'

export interface ChoiceOptionData {
  text: Record<Lang, string>
  nextId: string
  points: number
  feedback?: string
}

export interface ChoiceNodeData {
  message: Record<Lang, string>
  speaker: 'client' | 'agent'
  options?: ChoiceOptionData[]
  isEnd?: boolean
  endType?: 'excellent' | 'good' | 'poor'
  endMessage?: Record<Lang, string>
}

interface Props {
  nodeId: string
  data: ChoiceNodeData
  nodeOptions: { value: string; label: string }[]
  onCreateNode?: () => string
  onChange: (nodeId: string, data: ChoiceNodeData) => void
}

const NEW_NODE = '__new__'

function LangTabs({ active, onChange }: { active: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex gap-0.5 p-0.5 rounded-lg glass w-fit mb-2">
      {(['es', 'en', 'pt'] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={cn(
            'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors uppercase tracking-wide',
            active === l ? 'bg-neon-green/12 text-neon-green' : 'text-text-subtle hover:text-text-muted',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

const textareaClass = 'w-full glass border border-glass-border/20 rounded-xl px-3 py-2.5 text-sm text-text bg-transparent resize-none focus:outline-none focus:border-neon-green/40 placeholder:text-text-subtle'
const inputClass = 'glass border border-glass-border/20 rounded-lg px-2.5 py-1.5 text-sm text-text bg-transparent focus:outline-none focus:border-neon-green/40 placeholder:text-text-subtle'
const END_TYPE_ACTIVE_CLASSES: Record<string, string> = {
  'brand-green': 'border-brand-green/40 bg-brand-green/8 text-brand-green',
  'neon-cyan': 'border-neon-cyan/40 bg-neon-cyan/8 text-neon-cyan',
  'brand-magenta': 'border-brand-magenta/40 bg-brand-magenta/8 text-brand-magenta',
}

export function ChoiceNodeForm({ nodeId, data, nodeOptions, onCreateNode, onChange }: Props) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [lang, setLang] = useState<Lang>('es')

  const update = (patch: Partial<ChoiceNodeData>) => onChange(nodeId, { ...data, ...patch })

  const updateMessage = (value: string) =>
    update({ message: { ...data.message, [lang]: value } })

  const updateEndMessage = (value: string) =>
    update({ endMessage: { ...(data.endMessage ?? { es: '', en: '', pt: '' }), [lang]: value } })

  const updateOption = (idx: number, patch: Partial<ChoiceOptionData>) => {
    const options = (data.options ?? []).map((o, i) => i === idx ? { ...o, ...patch } : o)
    update({ options })
  }

  const updateOptionText = (idx: number, value: string) => {
    const options = (data.options ?? []).map((o, i) =>
      i === idx ? { ...o, text: { ...o.text, [lang]: value } } : o,
    )
    update({ options })
  }

  const addOption = () => update({
    options: [
      ...(data.options ?? []),
      { text: { es: '', en: '', pt: '' }, nextId: '', points: 5, feedback: '' },
    ],
  })

  const removeOption = async (idx: number) => {
    const ok = await confirm({
      title: t('confirm.delete_option_title'),
      description: t('confirm.delete_option_desc'),
      confirmLabel: t('confirm.remove'),
    })
    if (!ok) return
    update({ options: (data.options ?? []).filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-5">
      {/* Speaker */}
      <div>
        <label className="text-xs text-text-muted mb-1.5 block font-medium">{t('admin.simulations.choice.speaker')}</label>
        <div className="flex gap-2">
          {(['client', 'agent'] as const).map((s) => (
            <button
              key={s}
              onClick={() => update({ speaker: s })}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm border transition-all',
                data.speaker === s
                  ? 'border-neon-green/40 bg-neon-green/8 text-neon-green'
                  : 'border-glass-border/15 text-text-muted hover:text-text',
              )}
            >
              {s === 'client' ? '👤 Cliente' : '🎧 Agente'}
            </button>
          ))}
        </div>
      </div>

      {/* Message */}
      <div>
        <label className="text-xs text-text-muted mb-2 block font-medium">{t('admin.simulations.choice.message')}</label>
        <LangTabs active={lang} onChange={setLang} />
        <textarea
          rows={3}
          value={data.message[lang] ?? ''}
          onChange={(e) => updateMessage(e.target.value)}
          placeholder={t('admin.simulations.choice.ph_message')}
          className={textareaClass}
        />
      </div>

      {/* Is End */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-text-muted font-medium">{t('admin.simulations.choice.is_final')}</label>
        <button
          onClick={() => update({ isEnd: !data.isEnd, options: data.isEnd ? data.options : [] })}
          className={cn(
            'relative w-10 h-5 rounded-full transition-colors',
            data.isEnd ? 'bg-brand-green' : 'bg-glass-border/20',
          )}
        >
          <span className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
            data.isEnd && 'translate-x-5',
          )} />
        </button>
      </div>

      {data.isEnd && (
        <div className="space-y-3 p-4 rounded-xl bg-glass/4 border border-glass-border/8">
          <div>
            <label className="text-xs text-text-muted mb-1.5 block font-medium">{t('admin.simulations.choice.close_type')}</label>
            <div className="flex gap-2">
              {([
                ['excellent', '⭐ Excelente', 'brand-green'],
                ['good', '👍 Bueno', 'neon-cyan'],
                ['poor', '👎 Malo', 'brand-magenta'],
              ] as const).map(([val, label, color]) => (
                <button
                  key={val}
                  onClick={() => update({ endType: val })}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs border transition-all',
                    data.endType === val
                      ? END_TYPE_ACTIVE_CLASSES[color]
                      : 'border-glass-border/15 text-text-muted hover:text-text',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-text-muted mb-2 block">{t('admin.simulations.choice.close_message')}</label>
            <LangTabs active={lang} onChange={setLang} />
            <textarea
              rows={2}
              value={data.endMessage?.[lang] ?? ''}
              onChange={(e) => updateEndMessage(e.target.value)}
              placeholder={t('admin.simulations.choice.ph_close_message')}
              className={textareaClass}
            />
          </div>
        </div>
      )}

      {/* Options */}
      {!data.isEnd && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-text-muted font-medium">
              Opciones de respuesta ({(data.options ?? []).length})
            </label>
            <button
              onClick={addOption}
              className="flex items-center gap-1 text-xs text-neon-green hover:text-neon-green/80 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> {t('common.add_option_full')}
            </button>
          </div>

          <div className="space-y-3">
            {(data.options ?? []).map((opt, idx) => (
              <div key={idx} className="p-4 rounded-xl bg-glass/4 border border-glass-border/8 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-muted">{t('common.option_n_label', { n: idx + 1 })}</span>
                  <button onClick={() => removeOption(idx)} className="text-text-subtle hover:text-danger transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div>
                  <div className="text-[10px] text-text-subtle mb-1">{t('admin.simulations.choice.option_text')}</div>
                  <LangTabs active={lang} onChange={setLang} />
                  <input
                    type="text"
                    value={opt.text[lang] ?? ''}
                    onChange={(e) => updateOptionText(idx, e.target.value)}
                    placeholder={t('admin.simulations.choice.ph_option')}
                    className={cn(inputClass, 'w-full')}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-text-subtle mb-1">{t('admin.simulations.choice.next_node')}</div>
                    <FilterDropdown
                      value={opt.nextId}
                      onChange={(v) => {
                        if (v === NEW_NODE && onCreateNode) {
                          updateOption(idx, { nextId: onCreateNode() })
                        } else {
                          updateOption(idx, { nextId: v })
                        }
                      }}
                      options={[
                        { value: '', label: t('common.select_dash') },
                        ...nodeOptions,
                        ...(onCreateNode ? [{ value: NEW_NODE, label: t('admin.simulations.new_step_option') }] : []),
                      ]}
                      compact
                    />
                  </div>
                  <div>
                    <div className="text-[10px] text-text-subtle mb-1">{t('admin.simulations.choice.points')}</div>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={opt.points}
                      onChange={(e) => updateOption(idx, { points: Number(e.target.value) })}
                      className={cn(inputClass, 'w-full')}
                    />
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-text-subtle mb-1">{t('admin.simulations.choice.feedback_es')}</div>
                  <input
                    type="text"
                    value={opt.feedback ?? ''}
                    onChange={(e) => updateOption(idx, { feedback: e.target.value })}
                    placeholder={t('admin.simulations.choice.ph_feedback')}
                    className={cn(inputClass, 'w-full')}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
