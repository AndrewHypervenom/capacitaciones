import { useState } from 'react'
import { Plus, Trash2, Layers, FileText } from 'lucide-react'
import type { DbSectionRow } from '@/services/modules.service'
import type { GameClassifyBlock, ClassifyCategory, ClassifyCase } from '@/types/blocks'
import { cn } from '@/lib/cn'

interface Props {
  section: DbSectionRow
  language: 'es' | 'en' | 'pt'
  onBlockChange: (updated: GameClassifyBlock) => void
}

const AVAILABLE_COLORS = ['purple', 'pink', 'red', 'orange', 'blue', 'green']
const SELECT_CLASS =
  'border border-glass-border/10 bg-surface px-2 py-1.5 rounded-lg text-[12px] text-text outline-none focus:border-neon-green/30 dark:bg-neutral-800 [&>option]:bg-surface [&>option]:text-text dark:[&>option]:bg-neutral-800'

export function ClassifyGameEditor({ section, language, onBlockChange }: Props) {
  // Inicializamos el bloque leyendo los datos guardados o creando una plantilla base limpia
  const [block, setBlock] = useState<GameClassifyBlock>(() => {
    if (section.blocks_data && Array.isArray(section.blocks_data)) {
      const first = section.blocks_data[0] as any
      if (first?.type === 'game-classify') return first
    }
    return {
      id: crypto.randomUUID(),
      type: 'game-classify',
      title: { es: section.heading_es || 'Juego de Clasificación', en: '', pt: '' },
      instructions: { es: 'Arrastra cada caso a su categoría correspondiente.', en: '', pt: '' },
      categories: [
        { id: crypto.randomUUID(), name: { es: 'Categoría 1', en: '', pt: '' }, color: 'purple' },
        { id: crypto.randomUUID(), name: { es: 'Categoría 2', en: '', pt: '' }, color: 'pink' }
      ],
      cases: [
        { id: crypto.randomUUID(), text: { es: 'Caso operativo de prueba', en: '', pt: '' }, correctCategoryId: '' }
      ]
    }
  })

  const [activeTab, setActiveTab] = useState<'categories' | 'cases'>('categories')

  const updateBlock = (next: GameClassifyBlock) => {
    setBlock(next)
    onBlockChange(next)
  }

  // ── Gestores de Categorías ──────────────────────────────────────────
  const handleAddCategory = () => {
    if (block.categories.length >= 6) return
    const nextColor = AVAILABLE_COLORS[block.categories.length % AVAILABLE_COLORS.length]
    const newCat: ClassifyCategory = {
      id: crypto.randomUUID(),
      name: { es: `Nueva Categoría ${block.categories.length + 1}`, en: '', pt: '' },
      color: nextColor
    }
    updateBlock({ ...block, categories: [...block.categories, newCat] })
  }

  const handleRemoveCategory = (id: string) => {
    const nextCategories = block.categories.filter(c => c.id !== id)
    // Limpiamos la asignación de los casos vinculados a la categoría eliminada
    const nextCases = block.cases.map(c => 
      c.correctCategoryId === id ? { ...c, correctCategoryId: '' } : c
    )
    updateBlock({ ...block, categories: nextCategories, cases: nextCases })
  }

  // ── Gestores de Casos ───────────────────────────────────────────────
  const handleAddCase = () => {
    if (block.cases.length >= 10) return
    const newCase: ClassifyCase = {
      id: crypto.randomUUID(),
      text: { es: '', en: '', pt: '' },
      correctCategoryId: block.categories[0]?.id || ''
    }
    updateBlock({ ...block, cases: [...block.cases, newCase] })
  }

  return (
    <div className="space-y-4 rounded-2xl border border-glass-border/10 bg-glass/4 p-5">
      <div className="space-y-3 rounded-xl border border-glass-border/8 bg-white/5 p-3">
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">
            Título del modulo
          </label>
          <input
            type="text"
            value={block.title?.[language] || ''}
            onChange={(e) =>
              updateBlock({
                ...block,
                title: { ...block.title, [language]: e.target.value }
              })
            }
            placeholder="Ej: Casos  a clasificar"
            className="w-full bg-transparent px-3 py-2 border border-glass-border/10 rounded-lg text-[13px] text-text focus:border-neon-green/30 outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wider text-text-muted font-semibold">
            Instrucciones
          </label>
          <textarea
            value={block.instructions?.[language] || ''}
            rows={2}
            onChange={(e) =>
              updateBlock({
                ...block,
                instructions: { ...block.instructions, [language]: e.target.value }
              })
            }
            placeholder="Ej: Arrastra cada caso a su categoría correspondiente."
            className="w-full bg-transparent px-3 py-2 border border-glass-border/10 rounded-lg text-[13px] text-text focus:border-neon-green/30 outline-none resize-none"
          />
        </div>
      </div>
      {/* Selector de pestañas internas */}
      <div className="flex gap-2 border-b border-glass-border/8 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('categories')}
          className={cn(
            "px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-1.5",
            activeTab === 'categories'
              ? "bg-neon-green/10 border border-neon-green/20 text-neon-green"
              : "text-text-muted hover:text-text"
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          1. Categorías ({block.categories.length}/6)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('cases')}
          className={cn(
            "px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-1.5",
            activeTab === 'cases'
              ? "bg-neon-green/10 border border-neon-green/20 text-neon-green"
              : "text-text-muted hover:text-text"
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          2. Casos Operativos ({block.cases.length}/10)
        </button>
      </div>

      {/* CONTENIDO DE LA PESTAÑA 1: CONFIGURAR CATEGORÍAS */}
      {activeTab === 'categories' && (
        <div className="space-y-3">
          {block.categories.map((cat, idx) => (
            <div key={cat.id} className="flex flex-col sm:flex-row gap-3 p-3 rounded-xl bg-white/5 border border-glass-border/6 items-start sm:items-center">
              <span className="text-[11px] font-mono text-text-subtle shrink-0">#{idx + 1}</span>
              
              <input
                type="text"
                value={cat.name[language] || ''}
                onChange={(e) => {
                  const nextCats = [...block.categories]
                  nextCats[idx].name[language] = e.target.value
                  updateBlock({ ...block, categories: nextCats })
                }}
                placeholder="Nombre de la categoría (ej: PHISHING)"
                className="flex-1 bg-transparent px-3 py-1.5 border border-glass-border/10 rounded-lg text-[13px] text-text focus:border-neon-green/30 outline-none"
              />

              <select
                value={cat.color || 'purple'}
                onChange={(e) => {
                  const nextCats = [...block.categories]
                  nextCats[idx].color = e.target.value
                  updateBlock({ ...block, categories: nextCats })
                }}
                className={SELECT_CLASS}
              >
                {AVAILABLE_COLORS.map(color => (
                  <option key={color} value={color}>{color.toUpperCase()}</option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => handleRemoveCategory(cat.id)}
                disabled={block.categories.length <= 1}
                className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger/8 disabled:opacity-30 transition-colors shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {block.categories.length < 6 && (
            <button
              type="button"
              onClick={handleAddCategory}
              className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-glass-border/15 text-[12px] font-medium rounded-xl text-text-subtle hover:text-text transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Añadir Categoría
            </button>
          )}
        </div>
      )}

      {/* CONTENIDO DE LA PESTAÑA 2: CASOS OPERATIVOS */}
      {activeTab === 'cases' && (
        <div className="space-y-3">
          {block.cases.map((c, idx) => (
            <div key={c.id} className="p-3 rounded-xl bg-white/5 border border-glass-border/6 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-text-subtle">Caso #{idx + 1}</span>
                <button
                  type="button"
                  onClick={() => {
                    const nextCases = block.cases.filter(item => item.id !== c.id)
                    updateBlock({ ...block, cases: nextCases })
                  }}
                  disabled={block.cases.length <= 1}
                  className="p-1 rounded-md text-text-muted hover:text-danger hover:bg-danger/8 disabled:opacity-30 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <textarea
                value={c.text[language] || ''}
                rows={2}
                onChange={(e) => {
                  const nextCases = [...block.cases]
                  nextCases[idx].text[language] = e.target.value
                  updateBlock({ ...block, cases: nextCases })
                }}
                placeholder="Describe la situación o comportamiento operativo del cliente..."
                className="w-full bg-transparent px-3 py-2 border border-glass-border/10 rounded-lg text-[13px] text-text focus:border-neon-green/30 outline-none resize-none"
              />

              <div className="flex items-center gap-2">
                <label className="text-[11px] uppercase tracking-wider text-text-muted font-medium">
                  Categoría Correcta:
                </label>
                <select
                  value={c.correctCategoryId}
                  onChange={(e) => {
                    const nextCases = [...block.cases]
                    nextCases[idx].correctCategoryId = e.target.value
                    updateBlock({ ...block, cases: nextCases })
                  }}
                  className={cn(SELECT_CLASS, 'flex-1 py-1')}
                >
                  <option value="">-- Selecciona una categoría --</option>
                  {block.categories.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name[language] || cat.name['es'] || 'Sin nombre'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}

          {block.cases.length < 10 && (
            <button
              type="button"
              onClick={handleAddCase}
              className="w-full flex items-center justify-center gap-1.5 py-2 border border-dashed border-glass-border/15 text-[12px] font-medium rounded-xl text-text-subtle hover:text-text transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Añadir Caso de Simulación
            </button>
          )}
        </div>
      )}
    </div>
  )
}
