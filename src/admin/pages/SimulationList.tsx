import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Eye, EyeOff, MessageSquare, PhoneCall, Plus, Trash2, Pencil,
  Loader2, Flame, AlertTriangle, Share2, Copy, Search, Check, Globe2, Building2, Library,
  UserRound,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import {
  getAllScenariosAdmin, deleteScenario, toggleScenarioPublished,
  setScenarioShareable, getShareableScenarios, cloneScenario, getSimulationAuthors,
  type ScenarioRow, type ShareableScenario, type SimulationAuthor,
} from '@/services/scenarios.admin.service'
import {
  getAllChoiceScenariosAdmin, deleteChoiceScenario, toggleChoiceScenarioPublished,
  setChoiceScenarioShareable, getShareableChoiceScenarios, cloneChoiceScenario,
  type ChoiceScenarioRow, type ShareableChoiceScenario,
} from '@/services/choiceScenarios.admin.service'
import { ownedDeleteConfirm } from '@/lib/ownedDeleteConfirm'
import { NewSimulationModal } from '@/admin/components/simulation/NewSimulationModal'
import { AiDraftsPanel } from '@/admin/components/simulation/AiDraftsPanel'
import type { Campaign } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { FadeIn } from '@/components/ui/motion'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { deletionToast } from '@/lib/deletionToast'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Tooltip } from '@/components/ui/Tooltip'
import { Skeleton } from '@/components/ui/Skeleton'
import { useTranslation } from 'react-i18next'
import { useFreshOnFocus } from '@/hooks/useFreshOnFocus'
import { ResourcePresence } from '@/components/presence/ResourcePresence'
import { rowText } from '@/lib/contentLang'

type Tab = 'dialogue' | 'choice'
/** 'mine' = simulaciones de la campaña; 'shared' = catálogo de otras campañas. */
type View = 'mine' | 'shared'

const DIFFICULTY_COLORS = { 1: 'text-brand-green', 2: 'text-brand-amber', 3: 'text-brand-magenta' } as const
const LEVEL_COLORS = { basico: 'green', medio: 'cyan', avanzado: 'magenta' } as const

export default function SimulationList() {
  const nav = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { campaignId: authCampaignId, isSuperAdmin, user } = useAuth()

  const ALL_CAMPAIGNS = '__all__'
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  // El superadmin arranca viendo TODAS las simulaciones (como en Cursos); el
  // capacitador, su campaña casa.
  const [selectedCampaignId, setSelectedCampaignId] = useState(
    isSuperAdmin ? ALL_CAMPAIGNS : (authCampaignId ?? ''),
  )
  const [tab, setTab] = useState<Tab>('choice')
  const [view, setView] = useState<View>('mine')
  const [dialogueRows, setDialogueRows] = useState<ScenarioRow[]>([])
  const [choiceRows, setChoiceRows] = useState<ChoiceScenarioRow[]>([])
  const [loading, setLoading] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Catálogo compartido por otras campañas (se copia, no se comparte en vivo)
  const [sharedDialogue, setSharedDialogue] = useState<ShareableScenario[]>([])
  const [sharedChoice, setSharedChoice] = useState<ShareableChoiceScenario[]>([])
  const [sharedLoading, setSharedLoading] = useState(false)
  const [sharedSearch, setSharedSearch] = useState('')
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Quién creó cada simulación. Se pide aparte (RPC) porque el autor puede ser
  // de otra campaña y la RLS de profiles no deja leer su nombre por join.
  const [authors, setAuthors] = useState<Map<string, SimulationAuthor>>(new Map())

  // Superadmin: todas. Capacitador: su campaña casa + donde colabora (equipos).
  useEffect(() => {
    getAccessibleCampaigns({
      isSuperAdmin,
      homeCampaignId: authCampaignId,
      userId: user?.id ?? null,
    })
      .then((data) => {
        setCampaigns(data)
        setSelectedCampaignId((prev) =>
          prev || (isSuperAdmin ? ALL_CAMPAIGNS : data[0]?.id || ''))
      })
      .catch(() => {})
  }, [isSuperAdmin, authCampaignId, user?.id])

  useEffect(() => {
    if (!selectedCampaignId) return
    // El esqueleto solo en la primera carga: los refrescos de fondo (volver a la
    // pestaña, aviso de otra pestaña) no deben hacer parpadear la lista entera.
    if (dialogueRows.length === 0 && choiceRows.length === 0) setLoading(true)
    setError(null)
    Promise.all([
      getAllScenariosAdmin(selectedCampaignId),
      getAllChoiceScenariosAdmin(selectedCampaignId),
    ])
      .then(([d, c]) => { setDialogueRows(d); setChoiceRows(c) })
      .catch(() => setError('Error cargando simulaciones'))
      .finally(() => setLoading(false))
    // Las filas se leen para decidir el esqueleto, no para volver a disparar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, refreshKey])

  // Vuelve sola a lo último: si en otra pestaña se guardó o publicó una
  // simulación, esta lista deja de mostrar la foto de cuando se abrió.
  useFreshOnFocus(() => setRefreshKey((k) => k + 1), {
    topics: ['simulations'],
    enabled: !!selectedCampaignId,
  })

  // Catálogo compartido: necesita una campaña dueña concreta (con "Todas" no
  // sabríamos a dónde copiar ni qué excluir).
  useEffect(() => {
    if (view !== 'shared' || !selectedCampaignId || selectedCampaignId === ALL_CAMPAIGNS) return
    setSharedLoading(true)
    setError(null)
    Promise.all([
      getShareableScenarios(selectedCampaignId),
      getShareableChoiceScenarios(selectedCampaignId),
    ])
      .then(([d, c]) => { setSharedDialogue(d); setSharedChoice(c) })
      .catch(() => setError(t('admin.simulations.list.shared_error')))
      .finally(() => setSharedLoading(false))
  }, [view, selectedCampaignId, t])

  // Autores de todo lo que hay en pantalla (propias + catálogo compartido). Si
  // el RPC aún no existe en la BD no rompemos la lista: se queda sin autor.
  useEffect(() => {
    const ids = [
      ...dialogueRows.map((r) => r.id),
      ...choiceRows.map((r) => r.id),
      ...sharedDialogue.map((r) => r.id),
      ...sharedChoice.map((r) => r.id),
    ]
    if (ids.length === 0) return
    let alive = true
    getSimulationAuthors([...new Set(ids)])
      .then((map) => { if (alive) setAuthors(map) })
      .catch(() => {})
    return () => { alive = false }
  }, [dialogueRows, choiceRows, sharedDialogue, sharedChoice])

  // Simulaciones del catálogo que esta campaña ya copió: evita duplicados por
  // descuido (la copia guarda su origen en copied_from).
  const copiedSourceIds = useMemo(() => new Set(
    [...dialogueRows, ...choiceRows]
      .map((r) => r.copied_from)
      .filter((id): id is string => !!id),
  ), [dialogueRows, choiceRows])

  const filteredShared = useMemo(() => {
    const q = sharedSearch.trim().toLowerCase()
    const match = (text: string) => !q || text.toLowerCase().includes(q)
    return {
      dialogue: sharedDialogue.filter((r) =>
        match(`${rowText(r)} ${rowText(r, 'summary')} ${r.campaign_name ?? ''}`)),
      choice: sharedChoice.filter((r) =>
        match(`${rowText(r)} ${r.description ?? ''} ${r.campaign_name ?? ''}`)),
    }
  }, [sharedDialogue, sharedChoice, sharedSearch])

  const handleToggleDialogue = async (row: ScenarioRow) => {
    try {
      await toggleScenarioPublished(row.id, !row.is_published)
      setDialogueRows((prev) => prev.map((r) => r.id === row.id ? { ...r, is_published: !row.is_published } : r))
      toast.success(row.is_published ? 'Despublicado' : 'Publicado')
    } catch { toast.error('Error al cambiar estado') }
  }

  // Confirmación de borrado con dueño a la vista. El superadmin manda a la
  // papelera (30 días); el capacitador, a la cola de aprobación.
  const deleteConfirmOptions = (row: ScenarioRow | ChoiceScenarioRow) => {
    const author = authors.get(row.id)
    return ownedDeleteConfirm({
      title: rowText(row),
      ownerName: author?.name ?? null,
      ownerId: author?.id ?? null,
      actorId: user?.id ?? null,
      campaignName: campaigns.find((c) => c.id === row.campaign_id)?.name ?? null,
      isPublished: row.is_published,
      outcome: isSuperAdmin ? 'trash' : 'approval',
    })
  }

  const handleDeleteDialogue = async (row: ScenarioRow) => {
    const ok = await confirm(deleteConfirmOptions(row))
    if (!ok) return
    try {
      const result = await deleteScenario(row.id)
      setDialogueRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success(deletionToast(result, t('admin.simulations.list_toast_deleted')))
    } catch { toast.error(t('admin.simulations.list_toast_delete_error')) }
  }

  const handleToggleChoice = async (row: ChoiceScenarioRow) => {
    try {
      await toggleChoiceScenarioPublished(row.id, !row.is_published)
      setChoiceRows((prev) => prev.map((r) => r.id === row.id ? { ...r, is_published: !row.is_published } : r))
      toast.success(row.is_published ? 'Despublicado' : 'Publicado')
    } catch { toast.error('Error al cambiar estado') }
  }

  const handleDeleteChoice = async (row: ChoiceScenarioRow) => {
    const ok = await confirm(deleteConfirmOptions(row))
    if (!ok) return
    try {
      const result = await deleteChoiceScenario(row.id)
      setChoiceRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success(deletionToast(result, t('admin.simulations.list_toast_deleted')))
    } catch { toast.error(t('admin.simulations.list_toast_delete_error')) }
  }

  // Compartir: la simulación entra al catálogo de las demás campañas, que se
  // llevan una COPIA independiente. Solo se ve si además está publicada.
  // Al ACTIVARLO confirmamos explicando el alcance: es la duda típica ("¿quién
  // la ve?", "¿pueden dañar mi original?"). Al desactivarlo no hay riesgo.
  const handleToggleShareable = async (row: ScenarioRow | ChoiceScenarioRow, kind: Tab) => {
    const next = !row.is_shareable
    if (next) {
      const ok = await confirm({
        title: t('admin.simulations.list.confirm_share_title'),
        description: (
          <span className="block space-y-2">
            <span className="block">{t('admin.simulations.list.confirm_share_desc', { title: rowText(row) })}</span>
            <span className="block rounded-lg bg-subtle px-3 py-2 text-[12px]">
              {t('admin.simulations.list.confirm_share_note')}
            </span>
          </span>
        ),
        confirmLabel: t('admin.simulations.list.confirm_share_cta'),
        tone: 'default',
      })
      if (!ok) return
    }
    try {
      if (kind === 'dialogue') {
        await setScenarioShareable(row.id, next)
        setDialogueRows((prev) => prev.map((r) => r.id === row.id ? { ...r, is_shareable: next } : r))
      } else {
        await setChoiceScenarioShareable(row.id, next)
        setChoiceRows((prev) => prev.map((r) => r.id === row.id ? { ...r, is_shareable: next } : r))
      }
      if (next && !row.is_published) {
        toast.info(t('admin.simulations.list.share_needs_publish'))
      } else {
        toast.success(next
          ? t('admin.simulations.list.share_on')
          : t('admin.simulations.list.share_off'))
      }
    } catch {
      toast.error(t('admin.simulations.list.share_error'))
    }
  }

  // Copiar una simulación compartida a la campaña seleccionada.
  const handleCopyShared = async (row: ShareableScenario | ShareableChoiceScenario, kind: Tab) => {
    if (!selectedCampaignId || selectedCampaignId === ALL_CAMPAIGNS) return
    const ok = await confirm({
      title: t('admin.simulations.list.confirm_copy_title'),
      description: copiedSourceIds.has(row.id)
        // Ya existe una copia de este origen: avisamos para no llenar la campaña
        // de duplicados sin querer.
        ? t('admin.simulations.list.confirm_copy_again_desc', { title: rowText(row) })
        : t('admin.simulations.list.confirm_copy_desc', { title: rowText(row) }),
      confirmLabel: t('admin.simulations.list.confirm_copy_cta'),
      tone: 'default',
    })
    if (!ok) return
    setCopyingId(row.id)
    try {
      const newId = kind === 'dialogue'
        ? await cloneScenario(row.id, selectedCampaignId)
        : await cloneChoiceScenario(row.id, selectedCampaignId)
      toast.success(t('admin.simulations.list.copy_ok'))
      // La copia nace como borrador y sin curso: llevamos al capacitador al
      // editor para que la ajuste y la asigne.
      nav(kind === 'dialogue' ? `/admin/simulations/${newId}` : `/admin/simulations/choice/${newId}`)
      setRefreshKey((k) => k + 1)
    } catch {
      toast.error(t('admin.simulations.list.copy_error'))
    } finally {
      setCopyingId(null)
    }
  }

  const handleCreate = (type: 'dialogue' | 'choice', method: 'ai' | 'manual') => {
    setShowNewModal(false)
    const base = type === 'dialogue' ? '/admin/simulations/new' : '/admin/simulations/choice/new'
    // Con "Todas" seleccionado no hay campaña concreta: usamos la primera
    // accesible (o casa) para no crear con un campaign inválido.
    const targetCampaign =
      selectedCampaignId && selectedCampaignId !== ALL_CAMPAIGNS
        ? selectedCampaignId
        : (authCampaignId || campaigns[0]?.id || '')
    nav(`${base}?mode=${method}${targetCampaign ? `&campaign=${targetCampaign}` : ''}`)
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <GradientHeading as="h1" className="text-2xl mb-1">{t('admin.simulations.list.title')}</GradientHeading>
          <p className="text-sm text-text-muted">{t('admin.simulations.list.subtitle')}</p>
        </div>
        <Button onClick={() => setShowNewModal(true)} className="w-full sm:w-auto">
          <Plus className="h-4 w-4" /> {t('admin.simulations.list.create_new')}
        </Button>
      </div>

      {/* Escenarios generados por IA que todavía nadie cargó en el editor. Van arriba
          del todo: son trabajo ya pagado en tokens esperando dos clics. */}
      <AiDraftsPanel />

      {showNewModal && (
        <NewSimulationModal
          open
          defaultType={tab}
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreate}
        />
      )}

      {(campaigns.length > 1 || isSuperAdmin) && (
        <div className="mb-6">
          <label className="text-xs text-text-muted mb-1 block">{t('admin.simulations.list.campaign')}</label>
          <FilterDropdown
            value={selectedCampaignId}
            onChange={(v) => {
              // El catálogo compartido necesita una campaña dueña concreta.
              if (v === ALL_CAMPAIGNS) setView('mine')
              setSelectedCampaignId(v)
            }}
            options={[
              ...(isSuperAdmin ? [{ value: ALL_CAMPAIGNS, label: t('admin.courses.filter_all_campaigns', 'Todas las campañas') }] : []),
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
            className="max-w-xs"
          />
        </div>
      )}

      {/* Vista: mis simulaciones / catálogo compartido por otras campañas */}
      <div className="mb-5 flex items-center gap-1 rounded-xl bg-subtle p-1 w-fit">
        <button
          onClick={() => setView('mine')}
          className={cn(
            'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors min-h-[40px]',
            view === 'mine' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
          )}
        >
          <Library className="h-4 w-4" />
          {t('admin.simulations.list.tab_mine')}
        </button>
        <button
          onClick={() => setView('shared')}
          disabled={!selectedCampaignId || selectedCampaignId === ALL_CAMPAIGNS}
          className={cn(
            'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors min-h-[40px] disabled:opacity-40 disabled:cursor-not-allowed',
            view === 'shared' ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
          )}
        >
          <Share2 className="h-4 w-4" />
          {t('admin.simulations.list.tab_shared')}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl glass w-fit border border-glass-border/10">
        {([['choice', t('admin.simulations.tab_choice'), MessageSquare], ['dialogue', t('admin.simulations.tab_calls'), PhoneCall]] as const).map(
          ([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-lg text-sm transition-all',
                tab === key
                  ? 'bg-neon-green/10 text-neon-green font-medium'
                  : 'text-text-muted hover:text-text',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              <span className="text-xs text-text-subtle ml-1">
                {view === 'shared'
                  ? (key === 'dialogue' ? filteredShared.dialogue.length : filteredShared.choice.length)
                  : (key === 'dialogue' ? dialogueRows.length : choiceRows.length)}
              </span>
            </button>
          ),
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-danger mb-4 p-3 rounded-xl bg-danger/8 border border-danger/20">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {view === 'shared' && (
        <SharedCatalog
          tab={tab}
          loading={sharedLoading}
          search={sharedSearch}
          onSearch={setSharedSearch}
          dialogue={filteredShared.dialogue}
          choice={filteredShared.choice}
          copyingId={copyingId}
          copiedSourceIds={copiedSourceIds}
          onCopy={handleCopyShared}
          authors={authors}
        />
      )}

      {view === 'mine' && (loading ? (
        <div className="flex items-center justify-center py-16 text-text-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <FadeIn className="space-y-2" y={14}>
          {tab === 'dialogue' && (
            dialogueRows.length === 0
              ? <EmptyState onNew={() => setShowNewModal(true)} />
              : dialogueRows.map((row) => (
                <GlassCard key={row.id} className="p-4 flex items-center gap-4 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-text truncate">{rowText(row)}</span>
                      <NeonBadge color={row.is_published ? 'green' : 'neutral'} className="text-[9px] shrink-0">
                        {row.is_published ? 'Publicado' : 'Borrador'}
                      </NeonBadge>
                      <ResourcePresence type="simulation" id={row.id} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
                      <span className="font-mono">{row.slug}</span>
                      <span>·</span>
                      <span>{row.country}</span>
                      <span>·</span>
                      <span className="flex items-center gap-0.5">
                        {[1, 2, 3].map((d) => (
                          <Flame key={d} className={cn('h-3 w-3', d <= row.difficulty ? DIFFICULTY_COLORS[row.difficulty as 1 | 2 | 3] : 'text-line')} fill={d <= row.difficulty ? 'currentColor' : 'none'} />
                        ))}
                      </span>
                      <span>·</span>
                      <AuthorLine author={authors.get(row.id)} />
                    </div>
                    <ShareState shareable={row.is_shareable} published={row.is_published} />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <ShareToggle
                      on={row.is_shareable}
                      published={row.is_published}
                      onClick={() => handleToggleShareable(row, 'dialogue')}
                    />
                    <IconAction
                      label={row.is_published
                        ? t('admin.simulations.list.action_unpublish')
                        : t('admin.simulations.list.action_publish')}
                      onClick={() => handleToggleDialogue(row)}
                    >
                      {row.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </IconAction>
                    <IconAction
                      label={t('admin.simulations.list.action_edit')}
                      onClick={() => nav(`/admin/simulations/${row.id}`)}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconAction>
                    <IconAction
                      label={t('admin.simulations.list.action_delete')}
                      danger
                      onClick={() => handleDeleteDialogue(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconAction>
                  </div>
                </GlassCard>
              ))
          )}

          {tab === 'choice' && (
            choiceRows.length === 0
              ? <EmptyState onNew={() => setShowNewModal(true)} />
              : choiceRows.map((row) => (
                <GlassCard key={row.id} className="p-4 flex items-center gap-4 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-text truncate">{rowText(row)}</span>
                      <NeonBadge color={row.is_published ? 'green' : 'neutral'} className="text-[9px] shrink-0">
                        {row.is_published ? 'Publicado' : 'Borrador'}
                      </NeonBadge>
                      <NeonBadge color={LEVEL_COLORS[row.level]} className="text-[9px] shrink-0">
                        {row.level}
                      </NeonBadge>
                      <ResourcePresence type="choice" id={row.id} />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
                      <span className="font-mono">{row.slug}</span>
                      {row.client_name && <><span>·</span><span>{row.client_name}</span></>}
                      <span>·</span>
                      <AuthorLine author={authors.get(row.id)} />
                    </div>
                    <ShareState shareable={row.is_shareable} published={row.is_published} />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <ShareToggle
                      on={row.is_shareable}
                      published={row.is_published}
                      onClick={() => handleToggleShareable(row, 'choice')}
                    />
                    <IconAction
                      label={row.is_published
                        ? t('admin.simulations.list.action_unpublish')
                        : t('admin.simulations.list.action_publish')}
                      onClick={() => handleToggleChoice(row)}
                    >
                      {row.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </IconAction>
                    <IconAction
                      label={t('admin.simulations.list.action_edit')}
                      onClick={() => nav(`/admin/simulations/choice/${row.id}`)}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconAction>
                    <IconAction
                      label={t('admin.simulations.list.action_delete')}
                      danger
                      onClick={() => handleDeleteChoice(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconAction>
                  </div>
                </GlassCard>
              ))
          )}
        </FadeIn>
      ))}
    </div>
  )
}

/**
 * Interruptor de "compartida" con etiqueta visible. Un icono suelto no dice qué
 * hace ni en qué estado está: aquí el propio botón enuncia el estado actual.
 */
function ShareToggle({ on, published, onClick }: { on: boolean; published: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  const tip = on
    ? (published
      ? t('admin.simulations.list.share_tip_on')
      : t('admin.simulations.list.share_tip_unpublished'))
    : t('admin.simulations.list.share_tip_off')
  return (
    <Tooltip label={tip}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        className={cn(
          'h-10 inline-flex items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
          on
            ? 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/[0.16]'
            : 'border-line text-text-muted hover:text-text hover:bg-glass/8',
        )}
      >
        <Share2 className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">
          {on ? t('admin.simulations.list.shared_badge') : t('admin.simulations.list.share_action')}
        </span>
      </button>
    </Tooltip>
  )
}

/**
 * Quién creó la simulación. No se inventa: si no hay autor (simulaciones
 * anteriores a que se registrara el dato) se dice que no hay registro, en vez
 * de dejar el hueco o atribuirla a alguien.
 */
function AuthorLine({ author }: { author?: SimulationAuthor }) {
  const { t } = useTranslation()
  const name = author?.name
  return (
    <span className="flex items-center gap-1 text-text-subtle">
      <UserRound className="h-3.5 w-3.5 shrink-0" />
      {name
        ? t('admin.simulations.list.created_by', { name })
        : t('admin.simulations.list.created_by_unknown')}
    </span>
  )
}

/** Aviso en la fila: compartida pero sin publicar = nadie la ve todavía. */
function ShareState({ shareable, published }: { shareable: boolean; published: boolean }) {
  const { t } = useTranslation()
  if (!shareable) return null
  return (
    <p className={cn(
      'flex items-center gap-1.5 text-[11.5px] mt-1.5',
      published ? 'text-neon-cyan' : 'text-amber-500',
    )}>
      {published
        ? <><Globe2 className="h-3.5 w-3.5 shrink-0" />{t('admin.simulations.list.share_state_visible')}</>
        : <><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{t('admin.simulations.list.share_state_hidden')}</>}
    </p>
  )
}

/** Botón de icono con tooltip: todas las acciones de fila se explican al pasar. */
function IconAction({
  label, onClick, danger, children,
}: { label: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          'h-10 w-10 flex items-center justify-center rounded-lg transition-colors text-text-muted',
          danger ? 'hover:bg-danger/10 hover:text-danger' : 'hover:bg-glass/10 hover:text-text',
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

/**
 * Catálogo de simulaciones compartidas por otras campañas. A diferencia de los
 * cursos (donde el capacitador inscribe a sus aprendices en el curso ajeno),
 * aquí se copia: la simulación queda en su campaña, editable y como borrador.
 * Por eso la cabecera explica el trato en tres puntos antes de que nadie copie.
 */
function SharedCatalog({
  tab, loading, search, onSearch, dialogue, choice, copyingId, copiedSourceIds, onCopy, authors,
}: {
  tab: Tab
  loading: boolean
  search: string
  onSearch: (v: string) => void
  dialogue: ShareableScenario[]
  choice: ShareableChoiceScenario[]
  copyingId: string | null
  copiedSourceIds: Set<string>
  onCopy: (row: ShareableScenario | ShareableChoiceScenario, kind: Tab) => void
  authors: Map<string, SimulationAuthor>
}) {
  const { t } = useTranslation()
  const rows: Array<{
    id: string
    title: string
    subtitle: string | null
    campaign_name: string | null
    meta: ReactNode
    row: ShareableScenario | ShareableChoiceScenario
  }> = tab === 'dialogue'
    ? dialogue.map((r) => ({
      id: r.id,
      title: rowText(r),
      subtitle: rowText(r, 'summary'),
      campaign_name: r.campaign_name,
      meta: (
        <>
          <span>{r.country}</span>
          <span className="flex items-center gap-0.5">
            {[1, 2, 3].map((d) => (
              <Flame
                key={d}
                className={cn('h-3 w-3', d <= r.difficulty ? DIFFICULTY_COLORS[r.difficulty as 1 | 2 | 3] : 'text-line')}
                fill={d <= r.difficulty ? 'currentColor' : 'none'}
              />
            ))}
          </span>
          <span>{t('admin.simulations.list.steps_count', { n: Object.keys((r.nodes ?? {}) as object).length })}</span>
        </>
      ),
      row: r,
    }))
    : choice.map((r) => ({
      id: r.id,
      title: rowText(r),
      subtitle: r.description,
      campaign_name: r.campaign_name,
      meta: (
        <>
          <span className="capitalize">{r.level}</span>
          {r.client_name && <span>{r.client_name}</span>}
          <span>{t('admin.simulations.list.steps_count', { n: Object.keys((r.nodes ?? {}) as object).length })}</span>
        </>
      ),
      row: r,
    }))

  return (
    <div>
      {/* Cómo funciona: se lee una vez y despeja las tres dudas del modelo. */}
      <GlassCard intensity="subtle" rounded="2xl" className="p-4 mb-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neon-cyan/10 text-neon-cyan">
            <Share2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-text">{t('admin.simulations.list.shared_how_title')}</p>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-3 text-[12px] text-text-muted">
              {['shared_how_1', 'shared_how_2', 'shared_how_3'].map((k) => (
                <li key={k} className="flex items-start gap-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 mt-px text-neon-green" />
                  {t(`admin.simulations.list.${k}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </GlassCard>

      <div className="relative max-w-sm mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t('admin.simulations.list.search_shared_ph')}
          className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2.5 text-[14px] text-text outline-none focus:border-primary"
        />
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" rounded="2xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <GlassCard intensity="subtle" rounded="2xl" className="text-center p-8 sm:p-12">
          <Share2 className="h-10 w-10 text-text-muted mx-auto mb-3" />
          <p className="text-[14px] text-text font-medium">
            {search.trim()
              ? t('admin.simulations.list.shared_no_results')
              : t('admin.simulations.list.shared_empty')}
          </p>
          {!search.trim() && (
            <p className="text-[12.5px] text-text-muted mt-1.5 max-w-md mx-auto">
              {t('admin.simulations.list.shared_empty_hint')}
            </p>
          )}
        </GlassCard>
      ) : (
        <FadeIn className="grid gap-3 md:grid-cols-2" y={14}>
          {rows.map((item) => {
            const already = copiedSourceIds.has(item.id)
            const busy = copyingId === item.id
            return (
              <GlassCard
                key={item.id}
                intensity="subtle"
                rounded="2xl"
                className="p-4 flex flex-col gap-3 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-[14.5px] text-text leading-snug">{item.title}</span>
                    {already && (
                      <NeonBadge color="green" className="text-[9px] shrink-0">
                        {t('admin.simulations.list.already_copied')}
                      </NeonBadge>
                    )}
                  </div>
                  {item.subtitle && (
                    <p className="text-[12.5px] text-text-muted line-clamp-2 mt-1">{item.subtitle}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 text-[11.5px] text-text-subtle flex-wrap [&>span]:flex [&>span]:items-center [&>span]:gap-1">
                  {item.meta}
                  <AuthorLine author={authors.get(item.id)} />
                </div>

                <div className="flex items-center justify-between gap-3 pt-1 mt-auto border-t border-glass-border/8">
                  <span className="flex items-center gap-1.5 text-[11.5px] text-text-subtle min-w-0 pt-3">
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{item.campaign_name ?? '—'}</span>
                  </span>
                  <Button
                    variant={already ? 'secondary' : 'neon'}
                    size="sm"
                    className="shrink-0 flex items-center gap-1.5 mt-3"
                    disabled={copyingId !== null}
                    onClick={() => onCopy(item.row, tab)}
                  >
                    {busy
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Copy className="h-3.5 w-3.5" />}
                    {busy
                      ? t('admin.simulations.list.copying')
                      : already
                        ? t('admin.simulations.list.copy_again')
                        : t('admin.simulations.list.copy_to_campaign')}
                  </Button>
                </div>
              </GlassCard>
            )
          })}
        </FadeIn>
      )}
    </div>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="text-center py-16">
      <p className="text-text-muted text-sm mb-4">{t('admin.simulations.list.no_sims')}</p>
      <Button onClick={onNew}><Plus className="h-4 w-4" /> {t('admin.simulations.list.create_new')}</Button>
    </div>
  )
}
