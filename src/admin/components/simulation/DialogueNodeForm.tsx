import { useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type Lang = 'es' | 'en' | 'pt'

export interface DialogueNodeData {
  customerLine: Record<Lang, string>
  nudge?: Record<Lang, string>
  branches: { keywords: string[]; next: string }[]
  fallback?: string
  terminal?: 'resolved' | 'unresolved'
}

interface Props {
  nodeId: string
  data: DialogueNodeData
  allNodeIds: string[]
  onChange: (nodeId: string, data: DialogueNodeData) => void
}

function LangTabs({ active, onChange }: { active: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex gap-0.5 p-0.5 rounded-lg glass w-fit mb-2">
      {(['es', 'en', 'pt'] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={cn(
            'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors uppercase tracking-wide',
            active === l ? 'bg-glass-border/15 text-text' : 'text-text-subtle hover:text-text-muted',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

function textareaClass() {
  return 'w-full glass border border-glass-border/20 rounded-xl px-3 py-2.5 text-sm text-text bg-transparent resize-none focus:outline-none focus:border-brand-violet/40 placeholder:text-text-subtle'
}

function inputClass() {
  return 'glass border border-glass-border/20 rounded-lg px-2.5 py-1.5 text-sm text-text bg-transparent focus:outline-none focus:border-brand-violet/40 placeholder:text-text-subtle'
}

function selectClass() {
  return 'glass border border-glass-border/20 rounded-lg px-2.5 py-1.5 text-sm text-text bg-transparent focus:outline-none'
}

export function DialogueNodeForm({ nodeId, data, allNodeIds, onChange }: Props) {
  const [lang, setLang] = useState<Lang>('es')
  const [showNudge, setShowNudge] = useState(Boolean(data.nudge))

  const update = (patch: Partial<DialogueNodeData>) => onChange(nodeId, { ...data, ...patch })

  const updateLine = (field: 'customerLine' | 'nudge', value: string) => {
    const current = data[field] ?? { es: '', en: '', pt: '' }
    update({ [field]: { ...current, [lang]: value } })
  }

  const updateBranch = (idx: number, patch: Partial<{ keywords: string[]; next: string }>) => {
    const branches = data.branches.map((b, i) => i === idx ? { ...b, ...patch } : b)
    update({ branches })
  }

  const addBranch = () => update({ branches: [...data.branches, { keywords: [], next: '' }] })

  const removeBranch = (idx: number) =>
    update({ branches: data.branches.filter((_, i) => i !== idx) })

  const toggleNudge = () => {
    if (showNudge) {
      update({ nudge: undefined })
      setShowNudge(false)
    } else {
      update({ nudge: { es: '', en: '', pt: '' } })
      setShowNudge(true)
    }
  }

  return (
    <div className="space-y-5">
      {/* Customer line */}
      <div>
        <label className="text-xs text-text-muted mb-0.5 block font-medium">¿Qué dice el cliente aquí?</label>
        <p className="text-[11px] text-text-subtle mb-2">Escribe lo que el cliente dice en este momento de la llamada.</p>
        <LangTabs active={lang} onChange={setLang} />
        <textarea
          rows={3}
          value={data.customerLine[lang] ?? ''}
          onChange={(e) => updateLine('customerLine', e.target.value)}
          placeholder="Lo que dice el cliente en este momento..."
          className={textareaClass()}
        />
      </div>

      {/* Nudge (optional) */}
      <div>
        <button
          onClick={toggleNudge}
          className="text-xs text-text-subtle hover:text-text-muted transition-colors flex items-center gap-1 mb-2"
        >
          {showNudge ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showNudge ? 'Quitar mensaje alternativo' : 'Agregar mensaje alternativo (si el agente no responde bien)'}
        </button>
        {showNudge && (
          <>
            <p className="text-[11px] text-text-subtle mb-2">Lo que el cliente dice si el agente no da una respuesta correcta.</p>
            <LangTabs active={lang} onChange={setLang} />
            <textarea
              rows={2}
              value={data.nudge?.[lang] ?? ''}
              onChange={(e) => updateLine('nudge', e.target.value)}
              placeholder="Ej: ¿Hola? ¿Hay alguien ahí? ¿Me puede ayudar?"
              className={textareaClass()}
            />
          </>
        )}
      </div>

      {/* Branches */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-text-muted font-medium">
            Rutas de respuesta ({data.branches.length})
          </label>
          <button
            onClick={addBranch}
            className="flex items-center gap-1 text-xs text-brand-violet hover:text-brand-violet/80 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Agregar ruta
          </button>
        </div>
        <p className="text-[11px] text-text-subtle mb-2">
          El sistema detecta palabras en la respuesta del agente. Si coincide, avanza a ese paso. Si no hay coincidencia, va al paso de respaldo.
        </p>

        {data.branches.length === 0 && (
          <p className="text-xs text-text-subtle italic py-2">
            Sin rutas — el flujo siempre irá al paso de respaldo.
          </p>
        )}

        <div className="space-y-2">
          {data.branches.map((branch, idx) => (
            <div key={idx} className="flex items-start gap-2 p-3 rounded-xl bg-glass/4 border border-glass-border/8">
              <div className="flex-1 space-y-2">
                <div>
                  <div className="text-[10px] text-text-subtle mb-1">Palabras clave en la respuesta del agente (minúsculas, sin tildes)</div>
                  <input
                    type="text"
                    value={branch.keywords.join(', ')}
                    onChange={(e) => updateBranch(idx, {
                      keywords: e.target.value.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean),
                    })}
                    placeholder="hola, buenos dias, mi nombre"
                    className={cn(inputClass(), 'w-full')}
                  />
                </div>
                <div>
                  <div className="text-[10px] text-text-subtle mb-1">Llevar al paso:</div>
                  <select
                    value={branch.next}
                    onChange={(e) => updateBranch(idx, { next: e.target.value })}
                    className={cn(selectClass(), 'w-full')}
                  >
                    <option value="">— Seleccionar paso —</option>
                    {allNodeIds.map((nid) => (
                      <option key={nid} value={nid}>{nid}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={() => removeBranch(idx)}
                className="p-1.5 hover:text-danger text-text-subtle transition-colors mt-0.5 shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Fallback + Terminal */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-text-muted mb-1.5 block font-medium">Si ninguna ruta coincide, ir a:</label>
          <select
            value={data.fallback ?? ''}
            onChange={(e) => update({ fallback: e.target.value || undefined })}
            className={cn(selectClass(), 'w-full')}
          >
            <option value="">— Sin respaldo —</option>
            {allNodeIds.map((nid) => (
              <option key={nid} value={nid}>{nid}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-muted mb-1.5 block font-medium">¿La llamada termina aquí?</label>
          <select
            value={data.terminal ?? ''}
            onChange={(e) => update({ terminal: (e.target.value || undefined) as DialogueNodeData['terminal'] })}
            className={cn(selectClass(), 'w-full')}
          >
            <option value="">No termina aquí</option>
            <option value="resolved">Llamada resuelta</option>
            <option value="unresolved">Llamada sin resolver</option>
          </select>
        </div>
      </div>
    </div>
  )
}
