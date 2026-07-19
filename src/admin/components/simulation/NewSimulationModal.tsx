import { useState } from 'react'
import { createPortal } from 'react-dom'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { CheckCircle2, MessageSquare, PhoneCall, Sparkles, PencilRuler, X, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

type SimType = 'dialogue' | 'choice'
type Method = 'ai' | 'manual'

function SelectableCard({ selected, onClick, icon: Icon, title, desc }: {
  selected: boolean
  onClick: () => void
  icon: typeof PhoneCall
  title: string
  desc: string
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'relative text-left p-3.5 rounded-xl border-2 transition-all',
        selected
          ? 'border-neon-green bg-neon-green/10 shadow-[0_0_0_3px_rgb(var(--neon-green)/0.15)]'
          : 'border-glass-border/15 hover:border-glass-border/35 bg-glass/4',
      )}
    >
      {selected && (
        <CheckCircle2 className="absolute top-2.5 right-2.5 h-[18px] w-[18px] text-neon-green" fill="rgb(var(--neon-green) / 0.15)" />
      )}
      <Icon className={cn('h-5 w-5 mb-2', selected ? 'text-neon-green' : 'text-text-muted')} />
      <div className={cn('text-sm font-semibold mb-0.5', selected ? 'text-neon-green' : 'text-text')}>{title}</div>
      <div className="text-[11px] text-text-muted leading-snug">{desc}</div>
    </button>
  )
}

interface Props {
  open: boolean
  defaultType?: SimType
  onClose: () => void
  onCreate: (type: SimType, method: Method) => void
}

export function NewSimulationModal({ open, defaultType = 'choice', onClose, onCreate }: Props) {
  const { t } = useTranslation()
  const [simType, setSimType] = useState<SimType>(defaultType)
  const [method, setMethod] = useState<Method>('ai')

  if (!open) return null

  const typeCards: { value: SimType; icon: typeof PhoneCall; title: string; desc: string }[] = [
    {
      value: 'choice',
      icon: MessageSquare,
      title: t('admin.simulations.new_modal.type_choice'),
      desc: t('admin.simulations.new_modal.type_choice_desc'),
    },
    {
      value: 'dialogue',
      icon: PhoneCall,
      title: t('admin.simulations.new_modal.type_dialogue'),
      desc: t('admin.simulations.new_modal.type_dialogue_desc'),
    },
  ]

  const methodCards: { value: Method; icon: typeof Sparkles; title: string; desc: string }[] = [
    {
      value: 'ai',
      icon: Sparkles,
      title: t('admin.simulations.new_modal.method_ai'),
      desc: t('admin.simulations.new_modal.method_ai_desc'),
    },
    {
      value: 'manual',
      icon: PencilRuler,
      title: t('admin.simulations.new_modal.method_manual'),
      desc: t('admin.simulations.new_modal.method_manual_desc'),
    },
  ]

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" {...backdropDismiss(onClose)} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-bg border border-glass-border/20 shadow-2xl p-5 sm:p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-text">{t('admin.simulations.new_modal.title')}</h2>
            <p className="text-xs text-text-muted mt-0.5">{t('admin.simulations.new_modal.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs font-medium text-text-muted mb-2">{t('admin.simulations.new_modal.type_q')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
          {typeCards.map(({ value, icon: Icon, title, desc }) => (
            <SelectableCard
              key={value}
              selected={simType === value}
              onClick={() => setSimType(value)}
              icon={Icon}
              title={title}
              desc={desc}
            />
          ))}
        </div>

        <p className="text-xs font-medium text-text-muted mb-2">{t('admin.simulations.new_modal.method_q')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-6">
          {methodCards.map(({ value, icon: Icon, title, desc }) => (
            <SelectableCard
              key={value}
              selected={method === value}
              onClick={() => setMethod(value)}
              icon={Icon}
              title={title}
              desc={desc}
            />
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel', 'Cancelar')}</Button>
          <Button onClick={() => onCreate(simType, method)}>
            {t('admin.simulations.new_modal.create')} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
