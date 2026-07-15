import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, ListChecks, Loader2, Menu, Plus, Save, Trash2, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  getChoiceScenarioAdmin, createChoiceScenario, updateChoiceScenario, type ChoiceScenarioRow,
} from '@/services/choiceScenarios.admin.service'
import { type GeneratedChoice, type GeneratedDialogue } from '@/services/ai.service'
import { AIGeneratorPanel } from '@/admin/components/simulation/AIGeneratorPanel'
import { ChoiceNodeForm, type ChoiceNodeData } from '@/admin/components/simulation/ChoiceNodeForm'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTranslation } from 'react-i18next'

type Tab = 'meta' | 'nodes'

interface MetaState {
  slug: string; level: 'basico' | 'medio' | 'avanzado'
  title_es: string; title_en: string; title_pt: string
  description: string; client_name: string; client_company: string; objective: string
  start_node_id: string; is_published: boolean
}

type NodesMap = Record<string, ChoiceNodeData>

const slugify = (s: string) =>
  s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)

const defaultMeta = (): MetaState => ({
  slug: '', level: 'basico',
  title_es: '', title_en: '', title_pt: '',
  description: '', client_name: '', client_company: '', objective: '',
  start_node_id: 'start', is_published: false,
})

const defaultNodes = (): NodesMap => ({
  start: { message: { es: '', en: '', pt: '' }, speaker: 'client', options: [] },
})

function rowToState(row: ChoiceScenarioRow): { meta: MetaState; nodes: NodesMap } {
  return {
    meta: {
      slug: row.slug, level: row.level,
      title_es: row.title_es, title_en: row.title_en ?? '', title_pt: row.title_pt ?? '',
      description: row.description ?? '', client_name: row.client_name ?? '',
      client_company: row.client_company ?? '', objective: row.objective ?? '',
      start_node_id: row.start_node_id, is_published: row.is_published,
    },
    nodes: row.nodes as unknown as NodesMap,
  }
}

const inputClass = 'w-full glass border border-glass-border/20 rounded-xl px-3 py-2 text-sm text-text bg-transparent focus:outline-none focus:border-neon-green/40 placeholder:text-text-subtle'

export default function ChoiceSimEditor() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { campaignId: authCampaignId, isSuperAdmin } = useAuth()
  const [searchParams] = useSearchParams()
  const isNew = id === 'new' || !id
  const isManualMode = searchParams.get('mode') === 'manual'

  const [campaignId, setCampaignId] = useState(() => searchParams.get('campaign') || authCampaignId || '')
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])

  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<Tab>('meta')
  const [meta, setMeta] = useState<MetaState>(defaultMeta)
  const [nodes, setNodes] = useState<NodesMap>(defaultNodes)
  const [selectedNodeId, setSelectedNodeId] = useState('start')
  const [rowId, setRowId] = useState<string | null>(isNew ? null : id ?? null)
  const [aiBanner, setAiBanner] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [nodeDrawerOpen, setNodeDrawerOpen] = useState(false)
  const [manualGuide, setManualGuide] = useState(isNew && isManualMode)

  const slugManualRef = useRef(!isNew)
  const nodeIds = Object.keys(nodes)

  const stepLabel = (nid: string) => t('admin.simulations.step_n', { n: nodeIds.indexOf(nid) + 1 })
  const nodeOptions = nodeIds.map((nid) => {
    const preview = nodes[nid]?.message?.es?.slice(0, 32)
    return { value: nid, label: preview ? `${stepLabel(nid)} — ${preview}` : stepLabel(nid) }
  })

  // La campaña del perfil puede llegar después del primer render
  useEffect(() => {
    if (authCampaignId) setCampaignId((prev) => prev || authCampaignId)
  }, [authCampaignId])

  // Superadmin sin campaña propia: puede elegirla aquí mismo
  useEffect(() => {
    if (!isSuperAdmin) return
    supabase.from('campaigns').select('id, name').order('name').then(({ data }) => {
      setCampaigns(data ?? [])
      if (data?.[0]) setCampaignId((prev) => prev || data[0].id)
    })
  }, [isSuperAdmin])

  useEffect(() => {
    if (isNew) return
    getChoiceScenarioAdmin(id!)
      .then((row) => {
        const { meta: m, nodes: n } = rowToState(row)
        setMeta(m); setNodes(n)
        setCampaignId(row.campaign_id)
        setSelectedNodeId(m.start_node_id || Object.keys(n)[0] || 'start')
      })
      .catch(() => toast.error('Error cargando escenario'))
      .finally(() => setLoading(false))
  }, [id, isNew])

  const handleSave = async () => {
    if (!campaignId) return toast.error(t('admin.simulations.toast_no_campaign'))
    if (!meta.title_es.trim()) return toast.error(t('admin.simulations.toast_title_required'))
    const finalSlug = meta.slug.trim() || slugify(meta.title_es)
    if (!finalSlug) return toast.error(t('admin.simulations.toast_slug_needs_title'))
    if (!nodes[meta.start_node_id]) return toast.error(t('admin.simulations.toast_start_missing'))

    setSaving(true)
    try {
      const payload = {
        campaign_id: campaignId,
        slug: finalSlug,
        level: meta.level,
        title_es: meta.title_es, title_en: meta.title_en || null, title_pt: meta.title_pt || null,
        description: meta.description || null,
        client_name: meta.client_name || null,
        client_company: meta.client_company || null,
        objective: meta.objective || null,
        start_node_id: meta.start_node_id,
        nodes: nodes as unknown as import('@/types/database').Json,
        is_published: meta.is_published,
      }

      if (rowId) {
        await updateChoiceScenario(rowId, payload)
        toast.success('Guardado')
      } else {
        const row = await createChoiceScenario(payload)
        setRowId(row.id)
        nav(`/admin/simulations/choice/${row.id}`, { replace: true })
        toast.success('Creado')
      }
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleApplyGenerated = useCallback((gen: GeneratedDialogue | GeneratedChoice) => {
    const g = gen as GeneratedChoice
    const m = g.metadata
    setMeta((prev) => ({
      ...prev,
      title_es: m.title_es, title_en: m.title_en ?? '', title_pt: m.title_pt ?? '',
      description: m.description ?? '',
      client_name: m.client_name ?? '',
      client_company: m.client_company ?? '',
      objective: m.objective ?? '',
      level: m.level ?? prev.level,
      start_node_id: g.start_node_id,
      slug: prev.slug || slugify(m.title_es),
    }))
    setNodes(g.nodes as unknown as NodesMap)
    setSelectedNodeId(g.start_node_id)
    setTab('meta')
    setAiBanner(true)
    toast.success('Escenario cargado — revisa los datos en "General"')
  }, [])

  const addNode = () => {
    const nid = `paso_${Date.now()}`
    setNodes((prev) => ({ ...prev, [nid]: { message: { es: '', en: '', pt: '' }, speaker: 'client', options: [] } }))
    setSelectedNodeId(nid)
    return nid
  }

  // Crea un paso sin robar el foco del editor actual (para "+ Crear paso nuevo" en opciones)
  const createLinkedNode = () => {
    const nid = `paso_${Date.now()}`
    setNodes((prev) => ({ ...prev, [nid]: { message: { es: '', en: '', pt: '' }, speaker: 'client', options: [] } }))
    return nid
  }

  const removeNode = async (nid: string) => {
    if (nodeIds.length <= 1) return toast.error('Debe haber al menos un paso')
    const ok = await confirm({
      title: t('confirm.delete_node_title'),
      description: t('confirm.delete_node_desc'),
    })
    if (!ok) return
    setNodes((prev) => { const n = { ...prev }; delete n[nid]; return n })
    setSelectedNodeId(nodeIds.find((n) => n !== nid) ?? '')
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-6 w-6 animate-spin text-text-muted" /></div>
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 md:gap-4 mb-6">
        <button onClick={() => nav('/admin/simulations')} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text transition-colors shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <GradientHeading as="h1" className="text-lg md:text-xl truncate">
            {isNew ? t('admin.simulations.new_choice_sim') : meta.title_es || t('admin.simulations.choice_editor')}
          </GradientHeading>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <NeonBadge color={meta.is_published ? 'green' : 'neutral'} className="text-[9px] hidden sm:inline-flex">
            {meta.is_published ? 'Publicado' : 'Borrador'}
          </NeonBadge>
          <Button variant="ghost" size="sm" onClick={() => setMeta((m) => ({ ...m, is_published: !m.is_published }))}>
            {meta.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="hidden sm:inline">{meta.is_published ? 'Despublicar' : 'Publicar'}</span>
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            <span className="hidden sm:inline">{t('admin.simulations.save')}</span>
          </Button>
        </div>
      </div>

      {/* AI Generator — abierto por defecto salvo en modo manual */}
      <AIGeneratorPanel type="choice" onApply={handleApplyGenerated} defaultOpen={isNew && !isManualMode} campaignId={campaignId} />

      {/* Guía rápida para creación manual */}
      {manualGuide && (
        <div className="flex items-start gap-3 mb-5 p-3.5 rounded-xl bg-neon-green/6 border border-neon-green/20">
          <ListChecks className="h-4 w-4 text-neon-green shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-text-muted">
            <span className="text-text font-medium">{t('admin.simulations.manual_guide_title')} </span>
            {t('admin.simulations.manual_guide_choice')}
          </div>
          <button onClick={() => setManualGuide(false)} className="text-text-subtle hover:text-text transition-colors shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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
        {([['meta', t('admin.simulations.tab_general')], ['nodes', t('admin.simulations.tab_conversation')]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn('px-4 py-2.5 md:py-2 rounded-lg text-sm transition-all min-h-[44px] md:min-h-0',
              tab === key ? 'bg-neon-green/10 text-neon-green font-medium' : 'text-text-muted hover:text-text')}>
            {label}
            {key === 'nodes' && <span className="ml-1 text-xs text-text-subtle">{nodeIds.length}</span>}
          </button>
        ))}
      </div>

      {/* General tab */}
      {tab === 'meta' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <GlassCard className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-text">{t('admin.simulations.config_title')}</h3>
            {isSuperAdmin && campaigns.length > 0 && (
              <div>
                <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.list.campaign')}</label>
                <FilterDropdown
                  value={campaignId}
                  onChange={setCampaignId}
                  options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
                />
              </div>
            )}
            <div>
              <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.difficulty_level')}</label>
              <FilterDropdown
                value={meta.level}
                onChange={(v) => setMeta((m) => ({ ...m, level: v as MetaState['level'] }))}
                options={[
                  { value: 'basico', label: t('admin.simulations.level_basic') },
                  { value: 'medio', label: t('admin.simulations.level_medium') },
                  { value: 'avanzado', label: t('admin.simulations.level_advanced') },
                ]}
              />
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
                    placeholder={t('admin.simulations.ph_url_choice')}
                    className={inputClass}
                  />
                  <p className="text-[11px] text-text-subtle mt-1">{t('admin.simulations.url_auto')}</p>
                </div>
                <div>
                  <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.start_step')}</label>
                  <FilterDropdown
                    value={meta.start_node_id}
                    onChange={(v) => setMeta((m) => ({ ...m, start_node_id: v }))}
                    options={nodeOptions}
                  />
                </div>
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-text">{t('admin.simulations.title')}</h3>
            <div>
              <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.title_es')}</label>
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
                placeholder={t('admin.simulations.ph_title_choice')}
                className={inputClass}
              />
            </div>
            <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.title_en')}</label><input value={meta.title_en} onChange={(e) => setMeta((m) => ({ ...m, title_en: e.target.value }))} className={inputClass} /></div>
            <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.title_pt')}</label><input value={meta.title_pt} onChange={(e) => setMeta((m) => ({ ...m, title_pt: e.target.value }))} className={inputClass} /></div>
          </GlassCard>

          <GlassCard className="p-5 md:col-span-2 space-y-4">
            <h3 className="text-sm font-semibold text-text">{t('admin.simulations.scenario_context')}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.client_name')}</label><input value={meta.client_name} onChange={(e) => setMeta((m) => ({ ...m, client_name: e.target.value }))} placeholder={t('admin.simulations.ph_client_name')} className={inputClass} /></div>
              <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.client_company')}</label><input value={meta.client_company} onChange={(e) => setMeta((m) => ({ ...m, client_company: e.target.value }))} placeholder={t('admin.simulations.ph_company')} className={inputClass} /></div>
            </div>
            <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.agent_goal')}</label><input value={meta.objective} onChange={(e) => setMeta((m) => ({ ...m, objective: e.target.value }))} placeholder={t('admin.simulations.ph_agent_goal')} className={inputClass} /></div>
            <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.scenario_desc')}</label><textarea rows={2} value={meta.description} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} placeholder={t('admin.simulations.ph_scenario_desc')} className={cn(inputClass, 'resize-none')} /></div>
          </GlassCard>
        </div>
      )}

      {/* Conversación tab */}
      {tab === 'nodes' && (
        <div className="flex gap-5">
          {/* Node list — mobile: drawer */}
          {nodeDrawerOpen && (
            <div className="md:hidden fixed inset-0 bg-black/50 z-40" {...backdropDismiss(() => setNodeDrawerOpen(false))} />
          )}
          <div className={cn(
            'fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-bg border-r border-glass-border/8 transition-transform duration-300 ease-in-out p-4',
            'md:static md:z-auto md:w-56 md:shrink-0 md:translate-x-0 md:border-r-0 md:p-0',
            nodeDrawerOpen ? 'translate-x-0' : '-translate-x-full',
          )}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs font-medium text-text">{t('common.steps_count', { n: nodeIds.length })}</span>
                <p className="text-[11px] text-text-subtle mt-0.5">{t('admin.simulations.scenario_moments')}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={addNode} className="flex items-center gap-1 text-xs text-neon-green hover:text-neon-green/80 transition-colors" title={t('admin.simulations.add_step')}>
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
                const linePreview = node?.message?.es?.slice(0, 48)
                return (
                  <button key={nid} onClick={() => { setSelectedNodeId(nid); setNodeDrawerOpen(false) }}
                    className={cn('w-full text-left px-3 py-2.5 rounded-xl text-xs transition-all border',
                      selectedNodeId === nid
                        ? 'bg-neon-green/10 border-neon-green/40 text-text'
                        : 'border-transparent text-text-muted hover:text-text hover:bg-glass/4')}>
                    <div className="flex items-center gap-1.5">
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0',
                        isStart ? 'bg-brand-green' : node?.isEnd ? 'bg-brand-magenta' : 'bg-glass-border/40')} />
                      <span className="font-medium truncate">{stepLabel(nid)}</span>
                      {isStart && <span className="text-[9px] text-brand-green shrink-0">{t('admin.simulations.start')}</span>}
                      {node?.isEnd && <span className="text-[9px] text-brand-magenta shrink-0">{t('admin.simulations.end')}</span>}
                    </div>
                    {linePreview
                      ? <div className="text-[10px] text-text-subtle truncate mt-1 ml-3 italic">"{linePreview}{(node.message.es?.length ?? 0) > 48 ? '…' : ''}"</div>
                      : <div className="text-[10px] text-text-subtle mt-1 ml-3">{node?.options?.length ?? 0} opciones</div>
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
                    <span className="text-sm font-medium text-text">{stepLabel(selectedNodeId)}</span>
                    {selectedNodeId === meta.start_node_id && (
                      <span className="text-[9px] text-brand-green bg-brand-green/10 px-1.5 py-0.5 rounded-full">{t('admin.simulations.start')}</span>
                    )}
                  </div>
                  <button onClick={() => removeNode(selectedNodeId)} className="p-1.5 hover:text-danger text-text-subtle transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <ChoiceNodeForm
                  nodeId={selectedNodeId}
                  data={nodes[selectedNodeId]}
                  nodeOptions={nodeOptions}
                  onCreateNode={createLinkedNode}
                  onChange={(nid, data) => setNodes((prev) => ({ ...prev, [nid]: data }))}
                />
              </GlassCard>
            ) : (
              <div className="text-center py-16 text-text-muted text-sm">{t('admin.simulations.select_step')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
