import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, ListChecks, Loader2, Menu, Play, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { resolveCreationCampaignId } from '@/stores/campaignScopeStore'
import {
  getChoiceScenarioAdmin, createChoiceScenario, updateChoiceScenario, type ChoiceScenarioRow,
} from '@/services/choiceScenarios.admin.service'
import { type GeneratedChoice, type GeneratedDialogue, type GeneratedScenario } from '@/services/ai.service'
import { useSimAiStore } from '@/stores/simAiStore'
import { AIGeneratorPanel } from '@/admin/components/simulation/AIGeneratorPanel'
import { SimulationEditPanel } from '@/admin/components/simulation/SimulationEditPanel'
import { ChoiceNodeForm, type ChoiceNodeData } from '@/admin/components/simulation/ChoiceNodeForm'
import { SimulationPreviewModal } from '@/admin/components/simulation/SimulationPreviewModal'
import { reviewScenario } from '@/admin/components/simulation/simulationPreview'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { RichTextArea } from '@/components/ui/RichTextArea'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTranslation } from 'react-i18next'
import { useEditingPresence } from '@/hooks/usePresence'
import { PresenceStack } from '@/components/presence/PresenceStack'
import { EditingBanner } from '@/components/presence/EditingBanner'
import { useStaleGuard } from '@/hooks/useStaleGuard'
import { StaleNotice } from '@/components/ui/StaleNotice'
import { useUnsavedWork } from '@/hooks/useUnsavedWork'
import { SaveDock } from '@/admin/components/SaveDock'
import { useUndoHistory } from '@/hooks/useUndoHistory'
import { rowText } from '@/lib/contentLang'

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

// En opción múltiple cada paso lo habla siempre el cliente: las respuestas del
// agente son las opciones que el aprendiz selecciona. Normalizamos todos los
// nodos a 'client' (incluye escenarios viejos que quedaron con pasos de agente).
const withClientStart = (nodes: NodesMap, _startId: string): NodesMap => {
  let changed = false
  const next: NodesMap = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (node.speaker !== 'client') {
      next[id] = { ...node, speaker: 'client' }
      changed = true
    } else {
      next[id] = node
    }
  }
  return changed ? next : nodes
}

function rowToState(row: ChoiceScenarioRow): { meta: MetaState; nodes: NodesMap } {
  return {
    meta: {
      slug: row.slug, level: row.level,
      title_es: row.title_es, title_en: row.title_en ?? '', title_pt: row.title_pt ?? '',
      description: row.description ?? '', client_name: row.client_name ?? '',
      client_company: row.client_company ?? '', objective: row.objective ?? '',
      start_node_id: row.start_node_id, is_published: row.is_published,
    },
    nodes: withClientStart(row.nodes as unknown as NodesMap, row.start_node_id),
  }
}

const inputClass = 'w-full glass border border-glass-border/20 rounded-xl px-3 py-2 text-sm text-text bg-transparent focus:outline-none focus:border-neon-green/40 placeholder:text-text-subtle'

export default function ChoiceSimEditor() {
  const { id } = useParams<{ id: string }>()
  const nav = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { campaignId: authCampaignId, isSuperAdmin, user } = useAuth()
  const [searchParams] = useSearchParams()
  const isNew = id === 'new' || !id
  const isManualMode = searchParams.get('mode') === 'manual'

  // Se resuelve al cargar las campañas accesibles (URL → panel → primera). NO se
  // parte de la campaña "casa": creando desde la campaña B, el escenario se
  // guardaba en la casa A.
  const [campaignId, setCampaignId] = useState('')
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
  // Vista previa: `from` es el paso desde el que arranca el ensayo (null = el inicial).
  const [preview, setPreview] = useState<{ from: string | null } | null>(null)

  // Ruta con la que se montó el editor. Los paneles de IA arman su clave de corrida
  // con esta misma ruta, y al guardar la URL ya puede haber cambiado de /new a /:id.
  const mountPathRef = useRef(window.location.pathname)
  const flushAppliedDrafts = useSimAiStore((s) => s.flushAppliedDrafts)

  const slugManualRef = useRef(!isNew)
  // El paso inicial siempre va primero (Paso 1), sin importar el orden en que se
  // hayan creado los pasos, para que el flujo se lea de arriba hacia abajo.
  const nodeIds = (() => {
    const ids = Object.keys(nodes)
    const start = meta.start_node_id
    return start && nodes[start] ? [start, ...ids.filter((id) => id !== start)] : ids
  })()

  // Presencia colaborativa: coeditores de este escenario (una vez guardado).
  const coeditors = useEditingPresence(
    rowId ? { type: 'choice', id: rowId, title: rowText(meta) } : null,
  )

  const stepLabel = (nid: string) => t('admin.simulations.step_n', { n: nodeIds.indexOf(nid) + 1 })

  // Problemas del guion (opciones sin destino, callejones, momentos sueltos).
  const previewIssues = useMemo(
    () => reviewScenario(nodes, meta.start_node_id, 'choice'),
    [nodes, meta.start_node_id],
  )

  const nodeOptions = nodeIds.map((nid) => {
    const preview = nodes[nid]?.message?.es?.slice(0, 32)
    return { value: nid, label: preview ? `${stepLabel(nid)} — ${preview}` : stepLabel(nid) }
  })

  // Escenario actual (para "Mejorar con IA"). null si aún no hay contenido real.
  const currentContent = useMemo<GeneratedScenario | null>(() => {
    const hasText = Object.values(nodes).some(
      (n) => n.message?.es?.trim() || (n.options ?? []).some((o) => o.text?.es?.trim()),
    )
    if (!hasText && !rowText(meta)) return null
    return {
      metadata: {
        title_es: meta.title_es, title_en: meta.title_en, title_pt: meta.title_pt,
        description: meta.description, client_name: meta.client_name,
        client_company: meta.client_company, objective: meta.objective,
        level: meta.level,
      },
      start_node_id: meta.start_node_id,
      nodes,
    }
  }, [meta, nodes])

  // Campañas donde puede crear: superadmin todas; capacitador su campaña casa +
  // aquellas donde colabora (equipos). Un escenario ya existente conserva la
  // suya; esto solo resuelve el destino de uno nuevo.
  useEffect(() => {
    getAccessibleCampaigns({
      isSuperAdmin,
      homeCampaignId: authCampaignId,
      userId: user?.id ?? null,
    })
      .then((data) => {
        setCampaigns(data)
        if (!isNew) return
        const ids = data.map((c) => c.id)
        setCampaignId((prev) =>
          prev && ids.includes(prev)
            ? prev
            : resolveCreationCampaignId(searchParams.get('campaign'), ids),
        )
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, authCampaignId, user?.id, isNew])

  // Guardia de versión: ver SimulationEditor. Con la misma simulación abierta en
  // dos pestañas, la que llevaba rato abierta guardaba su copia vieja encima.
  const staleGuard = useStaleGuard<ChoiceScenarioRow>({
    fetch: () => getChoiceScenarioAdmin(rowId!),
    topic: 'simulations',
    id: rowId,
  })

  // Cambios sin guardar: alimenta el aviso de "Nueva versión disponible" y el de
  // cerrar la pestaña, para que ninguno de los dos se lleve el trabajo por
  // delante sin decir qué se pierde (ver lib/unsavedWork.ts).
  const unsaved = useUnsavedWork({ meta, nodes }, { label: rowText(meta) || t('admin.simulations.ai_gen.bg_untitled'), enabled: !loading })

  // Deshacer/rehacer del guion completo (Ctrl+Z / Ctrl+Shift+Z): borrar un
  // nodo o reescribir una opción ya no es un camino de ida.
  const undoHistory = useUndoHistory({
    state: { meta, nodes },
    apply: (s) => {
      setMeta(s.meta)
      setNodes(s.nodes)
    },
    enabled: !loading,
  })

  /** Vuelca una fila de la base en el editor y la fija como versión de referencia. */
  const adoptUndo = undoHistory.adopt
  const applyRow = useCallback(
    (row: ChoiceScenarioRow) => {
      const { meta: m, nodes: n } = rowToState(row)
      setMeta(m); setNodes(n)
      setCampaignId(row.campaign_id)
      setSelectedNodeId(m.start_node_id || Object.keys(n)[0] || 'start')
      staleGuard.mark(row)
      unsaved.markSaved()
      // Traer la versión de la base no es una edición: es el nuevo punto de
      // partida, no un paso al que volver con Ctrl+Z.
      adoptUndo()
    },
    [staleGuard, unsaved, adoptUndo],
  )

  useEffect(() => {
    if (isNew) return
    getChoiceScenarioAdmin(id!)
      .then(applyRow)
      .catch(() => toast.error('Error cargando escenario'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew])

  /** "Traer lo último": descarta lo local y recarga desde la base. */
  const handleReloadLatest = async () => {
    if (!rowId) return
    const ok = await confirm({
      title: t('common.stale.confirm_title'),
      description: t('common.stale.message'),
      confirmLabel: t('common.stale.reload'),
      tone: 'default',
    })
    if (!ok) return
    try {
      applyRow(await getChoiceScenarioAdmin(rowId))
      toast.success(t('common.stale.reloaded'))
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`)
    }
  }

  const handleSave = async () => {
    if (!campaignId) return toast.error(t('admin.simulations.toast_no_campaign'))
    if (!rowText(meta)) return toast.error(t('admin.simulations.toast_title_required'))
    const finalSlug = meta.slug.trim() || slugify(rowText(meta))
    if (!finalSlug) return toast.error(t('admin.simulations.toast_slug_needs_title'))
    if (!nodes[meta.start_node_id]) return toast.error(t('admin.simulations.toast_start_missing'))

    // ¿Sigue siendo la versión que se abrió? Si no, se pregunta en vez de pisar.
    if (rowId && !(await staleGuard.isSafeToSave())) {
      const overwrite = await confirm({
        title: t('common.stale.confirm_title'),
        description: t('common.stale.confirm_body'),
        confirmLabel: t('common.stale.confirm_overwrite'),
      })
      if (!overwrite) return
    }

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
        staleGuard.mark(await updateChoiceScenario(rowId, payload))
        unsaved.markSaved()
        toast.success('Guardado')
      } else {
        const row = await createChoiceScenario(payload)
        setRowId(row.id)
        staleGuard.mark(row)
        unsaved.markSaved()
        nav(`/admin/simulations/choice/${row.id}`, { replace: true })
        toast.success('Creado')
      }
      // Recién ahora el escenario está a salvo en su propia tabla: el borrador de IA
      // que lo trajo hasta acá ya no hace falta.
      flushAppliedDrafts(mountPathRef.current)
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
      slug: prev.slug || slugify(rowText(m)),
    }))
    setNodes(withClientStart(g.nodes as unknown as NodesMap, g.start_node_id))
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
            {isNew ? t('admin.simulations.new_choice_sim') : rowText(meta) || t('admin.simulations.choice_editor')}
          </GradientHeading>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          {coeditors.length > 0 && (
            <div className="pr-2 mr-1 border-r border-glass-border/10">
              <PresenceStack peers={coeditors} size={28} />
            </div>
          )}
          <NeonBadge color={meta.is_published ? 'green' : 'neutral'} className="text-[9px] hidden sm:inline-flex">
            {meta.is_published ? 'Publicado' : 'Borrador'}
          </NeonBadge>
          {/* Ensayo del borrador en pantalla: nada se guarda. El contador avisa
              de opciones sin destino o callejones antes de publicar. */}
          <Button variant="glass" size="sm" onClick={() => setPreview({ from: null })}>
            <Play className="h-4 w-4" fill="currentColor" />
            <span className="hidden sm:inline">{t('admin.simulations.preview.open')}</span>
            {previewIssues.length > 0 && (
              <span className={cn(
                'ml-0.5 rounded-full px-1.5 text-[10px] font-semibold',
                previewIssues.some((i) => i.level === 'error')
                  ? 'bg-danger/15 text-danger'
                  : 'bg-amber-400/20 text-amber-500',
              )}>
                {previewIssues.length}
              </span>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMeta((m) => ({ ...m, is_published: !m.is_published }))}>
            {meta.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            <span className="hidden sm:inline">{meta.is_published ? 'Despublicar' : 'Publicar'}</span>
          </Button>
          {/* Guardar vive en la barra única del pie (SaveDock). */}
        </div>
      </div>

      <div className="mb-4 -mt-2">
        <EditingBanner coeditors={coeditors} />
      </div>

      {staleGuard.stale && (
        <StaleNotice
          className="mb-4"
          onReload={handleReloadLatest}
          onDismiss={staleGuard.dismiss}
        />
      )}

      {/* AI Generator — abierto por defecto salvo en modo manual */}
      <AIGeneratorPanel type="choice" onApply={handleApplyGenerated} defaultOpen={isNew && !isManualMode} campaignId={campaignId} currentContent={currentContent} />

      {/* Ajustar con IA: cambiar UNA parte sin rehacer la simulación entera. Solo
          tiene sentido cuando ya hay algo escrito. */}
      {currentContent && (
        <SimulationEditPanel type="choice" current={currentContent} onApply={handleApplyGenerated} campaignId={campaignId} />
      )}

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
            {campaigns.length > 1 && (
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
                    onChange={(v) => {
                      setMeta((m) => ({ ...m, start_node_id: v }))
                      setNodes((prev) => withClientStart(prev, v))
                    }}
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
            <div><label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.scenario_desc')}</label><RichTextArea rows={3} value={meta.description} onChange={(v) => setMeta((m) => ({ ...m, description: v }))} placeholder={t('admin.simulations.ph_scenario_desc')} /></div>
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
                <button onClick={() => setNodeDrawerOpen(false)} className="md:hidden h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors">
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
                      : <div className="text-[10px] text-text-subtle mt-1 ml-3">{t('admin.simulations.choice.answers_count', { n: node?.options?.length ?? 0 })}</div>
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
                  <div className="flex items-center gap-1">
                    {/* Ensayar la conversación empezando justo en este momento. */}
                    <button
                      onClick={() => setPreview({ from: selectedNodeId })}
                      className="flex items-center gap-1.5 rounded-full border border-glass-border/20 px-2.5 py-1.5 text-[11.5px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors"
                      title={t('admin.simulations.preview.from_here')}
                    >
                      <Play className="h-3 w-3" fill="currentColor" />
                      <span className="hidden sm:inline">{t('admin.simulations.preview.from_here')}</span>
                    </button>
                    <button onClick={() => removeNode(selectedNodeId)} className="p-1.5 hover:text-danger text-text-subtle transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
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

      {preview && (
        <SimulationPreviewModal
          type="choice"
          nodes={nodes}
          startNodeId={meta.start_node_id}
          fromNodeId={preview.from}
          meta={{
            title: rowText(meta),
            clientName: meta.client_name,
            clientSubtitle: meta.client_company || meta.objective,
            description: meta.description,
            objective: meta.objective,
            level: meta.level,
            passScore: null,
          }}
          stepLabel={stepLabel}
          onGoToStep={(nid) => { setTab('nodes'); setSelectedNodeId(nid) }}
          onClose={() => setPreview(null)}
        />
      )}

      {/* Único lugar donde se guarda: aparece solo si hay cambios. */}
      <SaveDock
        pending={unsaved.dirty ? [{ id: 'sim', label: rowText(meta) || t('common.untitled') }] : []}
        onSave={handleSave}
        saving={saving}
        onUndo={undoHistory.undo}
        canUndo={undoHistory.canUndo}
      />
    </div>
  )
}
