import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, Menu, Plus, Save, Trash2, X,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  getScenarioAdmin, createScenario, updateScenario, type ScenarioRow,
} from '@/services/scenarios.admin.service'
import { type GeneratedDialogue } from '@/services/ai.service'
import { AIGeneratorPanel } from '@/admin/components/simulation/AIGeneratorPanel'
import {
  DialogueNodeForm, type DialogueNodeData,
} from '@/admin/components/simulation/DialogueNodeForm'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTranslation } from 'react-i18next'

type Lang = 'es' | 'en' | 'pt'
type Tab = 'meta' | 'nodes' | 'checklist'

interface MetaState {
  slug: string; country: 'CO' | 'MX' | 'AR'; difficulty: 1 | 2 | 3
  title_es: string; title_en: string; title_pt: string
  summary_es: string; summary_en: string; summary_pt: string
  customer_name: string; customer_phone: string
  customer_reason_es: string; customer_reason_en: string; customer_reason_pt: string
  avatar_seed: number; max_turns: number
  empathy_keywords: string[]
  start_node_id: string
  is_published: boolean
}

type ChecklistItem = { id: string; label: Record<Lang, string>; keywords: string[] }
type NodesMap = Record<string, DialogueNodeData>

const slugify = (s: string) =>
  s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)

const defaultMeta = (): MetaState => ({
  slug: '',
  country: 'CO',
  difficulty: 2,
  title_es: '', title_en: '', title_pt: '',
  summary_es: '', summary_en: '', summary_pt: '',
  customer_name: '', customer_phone: '',
  customer_reason_es: '', customer_reason_en: '', customer_reason_pt: '',
  avatar_seed: Math.floor(Math.random() * 99) + 1,
  max_turns: 10,
  empathy_keywords: ['entiendo', 'comprendo', 'lamento', 'disculpa', 'sorry', 'understand', 'entendo'],
  start_node_id: 'start',
  is_published: false,
})

const defaultNodes = (): NodesMap => ({
  start: {
    customerLine: { es: '', en: '', pt: '' },
    branches: [],
    fallback: undefined,
    terminal: undefined,
  },
})

const defaultChecklist = (): ChecklistItem[] => [
  { id: 'greeting', label: { es: 'Saludo con marca', en: 'Branded greeting', pt: 'Saudação com marca' }, keywords: ['hola', 'buenos dias', 'buenas tardes'] },
  { id: 'identity', label: { es: 'Verificación de identidad', en: 'Identity verification', pt: 'Verificação de identidade' }, keywords: ['nombre', 'documento', 'cedula'] },
  { id: 'empathy', label: { es: 'Empatía y escucha', en: 'Empathy & listening', pt: 'Empatia e escuta' }, keywords: ['entiendo', 'comprendo', 'lamento'] },
  { id: 'diagnosis', label: { es: 'Diagnóstico', en: 'Diagnosis', pt: 'Diagnóstico' }, keywords: ['cuentame', 'explicame', 'que paso'] },
  { id: 'resolution', label: { es: 'Solución', en: 'Resolution', pt: 'Solução' }, keywords: ['voy a', 'podemos', 'i will'] },
  { id: 'closing', label: { es: 'Cierre profesional', en: 'Professional closing', pt: 'Encerramento profissional' }, keywords: ['algo mas', 'feliz dia', 'anything else'] },
]

function rowToState(row: ScenarioRow): { meta: MetaState; nodes: NodesMap; checklist: ChecklistItem[] } {
  return {
    meta: {
      slug: row.slug,
      country: row.country,
      difficulty: row.difficulty as 1 | 2 | 3,
      title_es: row.title_es, title_en: row.title_en ?? '', title_pt: row.title_pt ?? '',
      summary_es: row.summary_es ?? '', summary_en: row.summary_en ?? '', summary_pt: row.summary_pt ?? '',
      customer_name: row.customer_name ?? '', customer_phone: row.customer_phone ?? '',
      customer_reason_es: row.customer_reason_es ?? '',
      customer_reason_en: row.customer_reason_en ?? '',
      customer_reason_pt: row.customer_reason_pt ?? '',
      avatar_seed: row.avatar_seed ?? 1,
      max_turns: row.max_turns ?? 10,
      empathy_keywords: row.empathy_keywords ?? [],
      start_node_id: row.start_node_id,
      is_published: row.is_published,
    },
    nodes: row.nodes as unknown as NodesMap,
    checklist: (row.checklist_items as unknown as ChecklistItem[]) ?? defaultChecklist(),
  }
}

const inputClass = 'w-full glass border border-glass-border/20 rounded-xl px-3 py-2 text-sm text-text bg-transparent focus:outline-none focus:border-brand-violet/40 placeholder:text-text-subtle'

function LangTabs({ active, onChange }: { active: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex gap-0.5 p-0.5 rounded-lg glass w-fit mb-2">
      {(['es', 'en', 'pt'] as Lang[]).map((l) => (
        <button key={l} onClick={() => onChange(l)}
          className={cn('px-3 py-2 md:px-2.5 md:py-1 rounded-md text-[11px] font-medium transition-colors uppercase tracking-wide min-h-[44px] md:min-h-0',
            active === l ? 'bg-glass-border/15 text-text' : 'text-text-subtle hover:text-text-muted')}>
          {l}
        </button>
      ))}
    </div>
  )
}

export default function SimulationEditor() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { campaignId } = useAuth()
  const isNew = id === 'new' || !id

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<Tab>('meta')
  const [meta, setMeta] = useState<MetaState>(defaultMeta)
  const [nodes, setNodes] = useState<NodesMap>(defaultNodes)
  const [checklist, setChecklist] = useState<ChecklistItem[]>(defaultChecklist)
  const [selectedNodeId, setSelectedNodeId] = useState<string>('start')
  const [rowId, setRowId] = useState<string | null>(isNew ? null : id ?? null)
  const [metaLang, setMetaLang] = useState<Lang>('es')
  const [aiBanner, setAiBanner] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [nodeDrawerOpen, setNodeDrawerOpen] = useState(false)

  const slugManualRef = useRef(!isNew)
  const nodeIds = Object.keys(nodes)

  useEffect(() => {
    if (isNew) return
    getScenarioAdmin(id!)
      .then((row) => {
        const { meta: m, nodes: n, checklist: c } = rowToState(row)
        setMeta(m); setNodes(n); setChecklist(c)
        setSelectedNodeId(m.start_node_id || Object.keys(n)[0] || 'start')
      })
      .catch(() => toast.error('Error cargando escenario'))
      .finally(() => setLoading(false))
  }, [id, isNew])

  const handleSave = async () => {
    if (!campaignId) return toast.error('Sin campaña asignada')
    if (!meta.title_es.trim()) return toast.error('El título en español es requerido')
    const finalSlug = meta.slug.trim() || slugify(meta.title_es)
    if (!finalSlug) return toast.error('Agrega un título para generar el identificador')
    if (!meta.start_node_id || !nodes[meta.start_node_id]) return toast.error('El paso inicial no existe')

    setSaving(true)
    try {
      const payload = {
        campaign_id: campaignId,
        slug: finalSlug,
        country: meta.country,
        difficulty: meta.difficulty,
        title_es: meta.title_es,
        title_en: meta.title_en || null,
        title_pt: meta.title_pt || null,
        summary_es: meta.summary_es || null,
        summary_en: meta.summary_en || null,
        summary_pt: meta.summary_pt || null,
        customer_name: meta.customer_name || null,
        customer_phone: meta.customer_phone || null,
        customer_reason_es: meta.customer_reason_es || null,
        customer_reason_en: meta.customer_reason_en || null,
        customer_reason_pt: meta.customer_reason_pt || null,
        avatar_seed: meta.avatar_seed,
        max_turns: meta.max_turns,
        empathy_keywords: meta.empathy_keywords,
        start_node_id: meta.start_node_id,
        checklist_items: checklist as unknown as import('@/types/database').Json,
        nodes: nodes as unknown as import('@/types/database').Json,
        is_published: meta.is_published,
      }

      if (rowId) {
        await updateScenario(rowId, payload)
        toast.success('Guardado')
      } else {
        const row = await createScenario(payload)
        setRowId(row.id)
        nav(`/admin/simulations/${row.id}`, { replace: true })
        toast.success('Creado')
      }
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleApplyGenerated = useCallback((gen: GeneratedDialogue | import('@/services/ai.service').GeneratedChoice) => {
    const g = gen as GeneratedDialogue
    const m = g.metadata
    setMeta((prev) => ({
      ...prev,
      title_es: m.title_es, title_en: m.title_en, title_pt: m.title_pt,
      summary_es: m.summary_es, summary_en: m.summary_en, summary_pt: m.summary_pt,
      country: m.country, difficulty: m.difficulty,
      customer_name: m.customer_name, customer_phone: m.customer_phone,
      customer_reason_es: m.customer_reason_es, customer_reason_en: m.customer_reason_en, customer_reason_pt: m.customer_reason_pt,
      avatar_seed: m.avatar_seed ?? prev.avatar_seed,
      max_turns: m.max_turns ?? prev.max_turns,
      empathy_keywords: m.empathy_keywords ?? prev.empathy_keywords,
      start_node_id: g.start_node_id,
      slug: prev.slug || slugify(m.title_es),
    }))
    setNodes(g.nodes as unknown as NodesMap)
    if (Array.isArray(m.checklist_items) && m.checklist_items.length > 0) {
      setChecklist(m.checklist_items as ChecklistItem[])
    }
    setSelectedNodeId(g.start_node_id)
    setTab('meta')
    setAiBanner(true)
    toast.success('Escenario cargado — revisa los datos en "General"')
  }, [])

  const addNode = () => {
    const nid = `node_${Date.now()}`
    setNodes((prev) => ({ ...prev, [nid]: { customerLine: { es: '', en: '', pt: '' }, branches: [] } }))
    setSelectedNodeId(nid)
  }

  const removeNode = async (nid: string) => {
    if (nodeIds.length <= 1) return toast.error('Debe haber al menos un paso')
    const ok = await confirm({
      title: t('confirm.delete_node_title'),
      description: t('confirm.delete_node_desc'),
    })
    if (!ok) return
    setNodes((prev) => {
      const next = { ...prev }
      delete next[nid]
      return next
    })
    setSelectedNodeId(nodeIds.find((n) => n !== nid) ?? '')
  }

  const handleNodeChange = (nid: string, data: DialogueNodeData) => {
    setNodes((prev) => ({ ...prev, [nid]: data }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 md:gap-4 mb-6">
        <button
          onClick={() => nav('/admin/simulations')}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <GradientHeading as="h1" className="text-lg md:text-xl truncate">
            {isNew ? 'Nueva simulación de llamada' : meta.title_es || 'Editor de simulación'}
          </GradientHeading>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <NeonBadge color={meta.is_published ? 'green' : 'neutral'} className="text-[9px] hidden sm:inline-flex">
            {meta.is_published ? 'Publicado' : 'Borrador'}
          </NeonBadge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMeta((m) => ({ ...m, is_published: !m.is_published }))}
          >
            {meta.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="hidden sm:inline">{meta.is_published ? 'Despublicar' : 'Publicar'}</span>
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span className="hidden sm:inline">{t('admin.simulations.save')}</span>
          </Button>
        </div>
      </div>

      {/* AI Generator — abierto por defecto en nuevas simulaciones */}
      <AIGeneratorPanel type="dialogue" onApply={handleApplyGenerated} defaultOpen={isNew} />

      {/* Banner post-IA */}
      {aiBanner && (
        <div className="flex items-start gap-3 mb-5 p-3.5 rounded-xl bg-brand-green/6 border border-brand-green/20">
          <CheckCircle2 className="h-4 w-4 text-brand-green shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <span className="text-text font-medium">{t('admin.simulations.loaded_notice')} </span>
            <span className="text-text-muted">{t('admin.simulations.loaded_hint')}</span>
          </div>
          <button onClick={() => setAiBanner(false)} className="text-text-subtle hover:text-text transition-colors shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl glass w-fit border border-glass-border/10">
        {([
          ['meta', 'General'],
          ['nodes', 'Conversación'],
          ['checklist', 'Evaluación'],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('px-4 py-2.5 md:py-2 rounded-lg text-sm transition-all min-h-[44px] md:min-h-0',
              tab === key ? 'bg-glass-border/10 text-text font-medium' : 'text-text-muted hover:text-text')}>
            {label}
            {key === 'nodes' && <span className="ml-1 text-xs text-text-subtle">{nodeIds.length}</span>}
          </button>
        ))}
      </div>

      {/* General tab */}
      {tab === 'meta' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <GlassCard className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-text mb-3">{t('admin.simulations.config_title')}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.country')}</label>
                <FilterDropdown
                  value={meta.country}
                  onChange={(v) => setMeta((m) => ({ ...m, country: v as 'CO' | 'MX' | 'AR' }))}
                  options={[
                    { value: 'CO', label: 'Colombia (CO)' },
                    { value: 'MX', label: 'México (MX)' },
                    { value: 'AR', label: 'Argentina (AR)' },
                  ]}
                />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.difficulty')}</label>
                <FilterDropdown
                  value={String(meta.difficulty)}
                  onChange={(v) => setMeta((m) => ({ ...m, difficulty: Number(v) as 1 | 2 | 3 }))}
                  options={[
                    { value: '1', label: 'Fácil' },
                    { value: '2', label: 'Media' },
                    { value: '3', label: 'Difícil' },
                  ]}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.max_turns')}</label>
              <input type="number" min={3} max={30} value={meta.max_turns} onChange={(e) => setMeta((m) => ({ ...m, max_turns: Number(e.target.value) }))} className={inputClass} />
              <p className="text-[11px] text-text-subtle mt-1">{t('admin.simulations.max_turns_hint')}</p>
            </div>

            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-text-subtle hover:text-text-muted transition-colors flex items-center gap-1"
            >
              {showAdvanced ? '▲ Ocultar opciones avanzadas' : '▼ Opciones avanzadas'}
            </button>

            {showAdvanced && (
              <div className="space-y-3 pt-1 border-t border-glass-border/10">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.url_id')}</label>
                  <input
                    value={meta.slug}
                    onChange={(e) => {
                      slugManualRef.current = true
                      setMeta((m) => ({ ...m, slug: e.target.value }))
                    }}
                    placeholder={t('admin.simulations.ph_url_sim')}
                    className={inputClass}
                  />
                  <p className="text-[11px] text-text-subtle mt-1">{t('admin.simulations.url_auto_long')}</p>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.start_step')}</label>
                  <FilterDropdown
                    value={meta.start_node_id}
                    onChange={(v) => setMeta((m) => ({ ...m, start_node_id: v }))}
                    options={nodeIds.map((nid) => ({ value: nid, label: nid }))}
                  />
                </div>
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-text mb-1">{t('admin.simulations.title_summary')}</h3>
            <LangTabs active={metaLang} onChange={setMetaLang} />
            {metaLang === 'es' && (
              <>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.title')}</label>
                  <input
                    value={meta.title_es}
                    onChange={(e) => {
                      const val = e.target.value
                      setMeta((m) => ({
                        ...m,
                        title_es: val,
                        slug: slugManualRef.current ? m.slug : slugify(val),
                      }))
                    }}
                    placeholder={t('admin.simulations.ph_title_sim')}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.summary')}</label>
                  <textarea rows={2} value={meta.summary_es} onChange={(e) => setMeta((m) => ({ ...m, summary_es: e.target.value }))} className={cn(inputClass, 'resize-none')} placeholder={t('admin.simulations.ph_summary')} />
                </div>
              </>
            )}
            {metaLang === 'en' && (
              <>
                <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.title_en')}</label><input value={meta.title_en} onChange={(e) => setMeta((m) => ({ ...m, title_en: e.target.value }))} className={inputClass} /></div>
                <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.summary_en')}</label><textarea rows={2} value={meta.summary_en} onChange={(e) => setMeta((m) => ({ ...m, summary_en: e.target.value }))} className={cn(inputClass, 'resize-none')} /></div>
              </>
            )}
            {metaLang === 'pt' && (
              <>
                <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.title_pt')}</label><input value={meta.title_pt} onChange={(e) => setMeta((m) => ({ ...m, title_pt: e.target.value }))} className={inputClass} /></div>
                <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.summary_pt')}</label><textarea rows={2} value={meta.summary_pt} onChange={(e) => setMeta((m) => ({ ...m, summary_pt: e.target.value }))} className={cn(inputClass, 'resize-none')} /></div>
              </>
            )}
          </GlassCard>

          <GlassCard className="p-5 md:col-span-2 space-y-4">
            <h3 className="text-sm font-semibold text-text mb-0">{t('admin.simulations.fake_client_data')}</h3>
            <p className="text-xs text-text-muted">{t('admin.simulations.fake_client_hint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.name')}</label>
                <input value={meta.customer_name} onChange={(e) => setMeta((m) => ({ ...m, customer_name: e.target.value }))} placeholder={t('admin.simulations.ph_name_sim')} className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.phone')}</label>
                <input value={meta.customer_phone} onChange={(e) => setMeta((m) => ({ ...m, customer_phone: e.target.value }))} placeholder="+57 300 •••• 1234" className={inputClass} />
              </div>
              <div>
                <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.avatar')}</label>
                <input type="number" min={1} max={99} value={meta.avatar_seed} onChange={(e) => setMeta((m) => ({ ...m, avatar_seed: Number(e.target.value) }))} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.call_reason')}</label>
              <input value={meta.customer_reason_es} onChange={(e) => setMeta((m) => ({ ...m, customer_reason_es: e.target.value }))} placeholder={t('admin.simulations.ph_call_reason')} className={inputClass} />
            </div>
          </GlassCard>

          <GlassCard className="p-5 md:col-span-2">
            <h3 className="text-sm font-semibold text-text mb-1">{t('admin.simulations.empathy_words')}</h3>
            <p className="text-xs text-text-muted mb-3">{t('admin.simulations.empathy_hint')}</p>
            <input
              value={meta.empathy_keywords.join(', ')}
              onChange={(e) => setMeta((m) => ({
                ...m, empathy_keywords: e.target.value.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean),
              }))}
              placeholder={t('admin.simulations.ph_empathy')}
              className={inputClass}
            />
          </GlassCard>
        </div>
      )}

      {/* Conversación tab */}
      {tab === 'nodes' && (
        <div className="flex gap-5">
          {/* Node list — mobile: drawer */}
          {nodeDrawerOpen && (
            <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setNodeDrawerOpen(false)} />
          )}
          <div className={cn(
            'fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-bg border-r border-glass-border/8 transition-transform duration-300 ease-in-out p-4',
            'md:static md:z-auto md:w-56 md:shrink-0 md:translate-x-0 md:border-r-0 md:p-0',
            nodeDrawerOpen ? 'translate-x-0' : '-translate-x-full',
          )}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs font-medium text-text">Pasos ({nodeIds.length})</span>
                <p className="text-[11px] text-text-subtle mt-0.5">{t('admin.simulations.call_moments')}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={addNode}
                  className="flex items-center gap-1 text-xs text-brand-violet hover:text-brand-violet/80 transition-colors"
                  title={t('admin.simulations.add_step')}
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar
                </button>
                <button onClick={() => setNodeDrawerOpen(false)} className="md:hidden h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-1 flex-1 overflow-y-auto">
              {nodeIds.map((nid) => {
                const node = nodes[nid]
                const isStart = nid === meta.start_node_id
                const isTerminal = Boolean(node?.terminal)
                const linePreview = node?.customerLine?.es?.slice(0, 48)
                return (
                  <button
                    key={nid}
                    onClick={() => { setSelectedNodeId(nid); setNodeDrawerOpen(false) }}
                    className={cn(
                      'w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all border',
                      selectedNodeId === nid
                        ? 'bg-glass-border/12 border-glass-border/20 text-text'
                        : 'border-transparent text-text-muted hover:text-text hover:bg-glass/4',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                        isStart ? 'bg-brand-green' : isTerminal ? 'bg-brand-magenta' : 'bg-glass-border/40')} />
                      <span className="font-mono font-medium truncate">{nid}</span>
                      {isStart && <span className="text-[9px] text-brand-green shrink-0">{t('admin.simulations.start')}</span>}
                      {isTerminal && <span className="text-[9px] text-brand-magenta shrink-0">{node.terminal === 'resolved' ? 'FIN ✓' : 'FIN ✗'}</span>}
                    </div>
                    {linePreview
                      ? <div className="text-[10px] text-text-subtle truncate mt-1 ml-3 italic">"{linePreview}{(node.customerLine.es?.length ?? 0) > 48 ? '…' : ''}"</div>
                      : <div className="text-[10px] text-text-subtle mt-1 ml-3">{node?.branches?.length ?? 0} rutas</div>
                    }
                  </button>
                )
              })}
            </div>
          </div>

          {/* Node editor */}
          <div className="flex-1 min-w-0">
            <button
              onClick={() => setNodeDrawerOpen(true)}
              className="md:hidden flex items-center gap-2 mb-3 text-sm text-text-muted hover:text-text transition-colors"
            >
              <Menu className="h-4 w-4" /> Pasos ({nodeIds.length})
            </button>
            {selectedNodeId && nodes[selectedNodeId] ? (
              <GlassCard className="p-4 md:p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-muted">{t('admin.simulations.step_label')}</span>
                    <span className="font-mono text-sm text-text">{selectedNodeId}</span>
                    {selectedNodeId === meta.start_node_id && (
                      <span className="text-[9px] text-brand-green bg-brand-green/10 px-1.5 py-0.5 rounded-full">{t('admin.simulations.start')}</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeNode(selectedNodeId)}
                    className="p-1.5 hover:text-danger text-text-subtle transition-colors"
                    title={t('admin.simulations.del_step')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <DialogueNodeForm
                  nodeId={selectedNodeId}
                  data={nodes[selectedNodeId]}
                  allNodeIds={nodeIds}
                  onChange={handleNodeChange}
                />
              </GlassCard>
            ) : (
              <div className="text-center py-16 text-text-muted text-sm">
                Selecciona un paso para editarlo
              </div>
            )}
          </div>
        </div>
      )}

      {/* Evaluación tab */}
      {tab === 'checklist' && (
        <div className="space-y-3">
          <div className="mb-2 p-3.5 rounded-xl bg-glass/6 border border-glass-border/10">
            <p className="text-xs text-text-muted">
              <span className="font-medium text-text">{t('admin.simulations.eval_what')}</span>{' '}
              Al terminar la simulación, el sistema verifica si el agente usó las palabras clave de cada ítem. Edita los ítems o agrega nuevos según el protocolo de tu empresa.
            </p>
          </div>
          {checklist.map((item, idx) => (
            <GlassCard key={item.id} className="p-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.item_name')}</label>
                  <input
                    value={item.label.es}
                    onChange={(e) => setChecklist((prev) => prev.map((it, i) => i === idx ? { ...it, label: { ...it.label, es: e.target.value } } : it))}
                    placeholder={t('admin.simulations.ph_item_name')}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.keywords_trigger')}</label>
                  <input
                    value={item.keywords.join(', ')}
                    onChange={(e) => setChecklist((prev) => prev.map((it, i) => i === idx ? { ...it, keywords: e.target.value.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) } : it))}
                    placeholder={t('admin.simulations.ph_keywords')}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.internal_id')}</label>
                  <input
                    value={item.id}
                    onChange={(e) => setChecklist((prev) => prev.map((it, i) => i === idx ? { ...it, id: e.target.value } : it))}
                    className={inputClass}
                  />
                </div>
              </div>
            </GlassCard>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setChecklist((prev) => [
            ...prev,
            { id: `item_${Date.now()}`, label: { es: '', en: '', pt: '' }, keywords: [] },
          ])}>
            <Plus className="h-4 w-4" /> Agregar ítem
          </Button>
        </div>
      )}
    </div>
  )
}
