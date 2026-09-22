import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Eye, EyeOff, MessageSquare, PhoneCall, Plus, Trash2, Pencil,
  Loader2, Flame, AlertTriangle, UserRound,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import {
  getAllScenariosAdmin, deleteScenario, toggleScenarioPublished, getSimulationAuthors,
  type ScenarioRow, type SimulationAuthor,
} from '@/services/scenarios.admin.service'
import {
  getAllChoiceScenariosAdmin, deleteChoiceScenario, toggleChoiceScenarioPublished,
  type ChoiceScenarioRow,
} from '@/services/choiceScenarios.admin.service'
import { getAudiences, type AudienceRule } from '@/services/audiences.service'
import { getActiveOrgUnits } from '@/services/org.service'
import { ownedDeleteConfirm } from '@/lib/ownedDeleteConfirm'
import { NewSimulationModal } from '@/admin/components/simulation/NewSimulationModal'
import { AiDraftsPanel } from '@/admin/components/simulation/AiDraftsPanel'
import type { OrgUnit } from '@/types/database'
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
import { useTranslation } from 'react-i18next'
import { useFreshOnFocus } from '@/hooks/useFreshOnFocus'
import { ResourcePresence } from '@/components/presence/ResourcePresence'
import { rowText } from '@/lib/contentLang'

type Tab = 'dialogue' | 'choice'

const DIFFICULTY_COLORS = { 1: 'text-brand-green', 2: 'text-brand-amber', 3: 'text-brand-magenta' } as const
const LEVEL_COLORS = { basico: 'green', medio: 'cyan', avanzado: 'magenta' } as const

export default function SimulationList() {
  const nav = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { campaignId: authCampaignId, creationCampaignId: homeSpace, isSuperAdmin, user } = useAuth()

  const ALL_CAMPAIGNS = '__all__'
  /* Ya no hay programas en pantalla: se listan todas las simulaciones a las que
     se tiene acceso (la base decide). El espacio donde se guarda una nueva se
     elige solo, por dentro. */
  const [creationCampaignId, setCreationCampaignId] = useState('')
  const [tab, setTab] = useState<Tab>('choice')
  const [dialogueRows, setDialogueRows] = useState<ScenarioRow[]>([])
  const [choiceRows, setChoiceRows] = useState<ChoiceScenarioRow[]>([])
  const [loading, setLoading] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  /** CR: deja solo las simulaciones de cursos cuya regla le llega. */
  const [crFilter, setCrFilter] = useState('')
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [audiences, setAudiences] = useState<Map<string, AudienceRule>>(new Map())

  // Quién creó cada simulación. Se pide aparte (RPC) porque el autor puede ser
  // de otra campaña y la RLS de profiles no deja leer su nombre por join.
  const [authors, setAuthors] = useState<Map<string, SimulationAuthor>>(new Map())

  useEffect(() => {
    getAccessibleCampaigns({
      isSuperAdmin,
      homeCampaignId: authCampaignId,
      userId: user?.id ?? null,
    })
      .then((data) => {
        const ids = data.map((c) => c.id)
        setCreationCampaignId(homeSpace && ids.includes(homeSpace) ? homeSpace : ids[0] ?? '')
      })
      .catch(() => {})
    void getActiveOrgUnits()
      .then(setUnits)
      .catch(() => setUnits([]))
  }, [isSuperAdmin, authCampaignId, homeSpace, user?.id])

  useEffect(() => {
    // El esqueleto solo en la primera carga: los refrescos de fondo (volver a la
    // pestaña, aviso de otra pestaña) no deben hacer parpadear la lista entera.
    if (dialogueRows.length === 0 && choiceRows.length === 0) setLoading(true)
    setError(null)
    Promise.all([
      getAllScenariosAdmin(ALL_CAMPAIGNS),
      getAllChoiceScenariosAdmin(ALL_CAMPAIGNS),
      getAccessibleCampaigns({ isSuperAdmin, homeCampaignId: authCampaignId, userId: user?.id ?? null }),
    ])
      .then(([dAll, cAll, accessible]) => {
        /* Solo las de la org activa: lo que la otra org del grupo comparte se
         * ve (la base lo deja leer) pero no se edita desde aquí. */
        const own = new Set(accessible.map((x) => x.id))
        const d = dAll.filter((r) => !r.campaign_id || own.has(r.campaign_id))
        const c = cAll.filter((r) => !r.campaign_id || own.has(r.campaign_id))
        setDialogueRows(d)
        setChoiceRows(c)
        const courseIds = [...new Set([...d, ...c].map((r) => r.course_id).filter((x): x is string => !!x))]
        getAudiences(courseIds).then(setAudiences).catch(() => setAudiences(new Map()))
      })
      .catch(() => setError('Error cargando simulaciones'))
      .finally(() => setLoading(false))
    // Las filas se leen para decidir el esqueleto, no para volver a disparar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  // Vuelve sola a lo último: si en otra pestaña se guardó o publicó una
  // simulación, esta lista deja de mostrar la foto de cuando se abrió.
  useFreshOnFocus(() => setRefreshKey((k) => k + 1), {
    topics: ['simulations'],
  })

  // Autores de todo lo que hay en pantalla (propias + catálogo compartido). Si
  // el RPC aún no existe en la BD no rompemos la lista: se queda sin autor.
  useEffect(() => {
    const ids = [
      ...dialogueRows.map((r) => r.id),
      ...choiceRows.map((r) => r.id),
    ]
    if (ids.length === 0) return
    let alive = true
    getSimulationAuthors([...new Set(ids)])
      .then((map) => { if (alive) setAuthors(map) })
      .catch(() => {})
    return () => { alive = false }
  }, [dialogueRows, choiceRows])

  /** Filtro por CR: la simulación cuelga de un curso cuya regla le llega. */
  const byCr = <T extends { course_id: string | null }>(rows: T[]): T[] =>
    !crFilter
      ? rows
      : rows.filter((r) => {
          const rule = r.course_id ? audiences.get(r.course_id) : undefined
          return !!rule && (rule.everyone || rule.operationIds.includes(crFilter))
        })
  const visibleDialogue = useMemo(() => byCr(dialogueRows), [dialogueRows, crFilter, audiences]) // eslint-disable-line react-hooks/exhaustive-deps
  const visibleChoice = useMemo(() => byCr(choiceRows), [choiceRows, crFilter, audiences]) // eslint-disable-line react-hooks/exhaustive-deps

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
      campaignName: null,
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

  const handleCreate = (type: 'dialogue' | 'choice', method: 'ai' | 'manual') => {
    setShowNewModal(false)
    const base = type === 'dialogue' ? '/admin/simulations/new' : '/admin/simulations/choice/new'
    const targetCampaign = creationCampaignId
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

      {units.some((u) => u.kind === 'operation') && (
        <div className="mb-6">
          <FilterDropdown
            value={crFilter}
            onChange={setCrFilter}
            options={[
              { value: '', label: t('admin.progress_overview.all_operations', 'Todos los CR') },
              ...units.filter((u) => u.kind === 'operation').map((u) => ({ value: u.id, label: u.name })),
            ]}
            className="max-w-xs"
          />
        </div>
      )}

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
                {key === 'dialogue' ? visibleDialogue.length : visibleChoice.length}
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

      {loading ? (
        <div className="flex items-center justify-center py-16 text-text-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <FadeIn className="space-y-2" y={14}>
          {tab === 'dialogue' && (
            visibleDialogue.length === 0
              ? <EmptyState onNew={() => setShowNewModal(true)} />
              : visibleDialogue.map((row) => (
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
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
            visibleChoice.length === 0
              ? <EmptyState onNew={() => setShowNewModal(true)} />
              : visibleChoice.map((row) => (
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
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
      )}
    </div>
  )
}

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

function EmptyState({ onNew }: { onNew: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="text-center py-16">
      <p className="text-text-muted text-sm mb-4">{t('admin.simulations.list.no_sims')}</p>
      <Button onClick={onNew}><Plus className="h-4 w-4" /> {t('admin.simulations.list.create_new')}</Button>
    </div>
  )
}
