import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Eye, EyeOff, MessageSquare, PhoneCall, Plus, Trash2, Pencil,
  Loader2, Flame, AlertTriangle,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import {
  getAllScenariosAdmin, deleteScenario, toggleScenarioPublished,
  type ScenarioRow,
} from '@/services/scenarios.admin.service'
import {
  getAllChoiceScenariosAdmin, deleteChoiceScenario, toggleChoiceScenarioPublished,
  type ChoiceScenarioRow,
} from '@/services/choiceScenarios.admin.service'
import { NewSimulationModal } from '@/admin/components/simulation/NewSimulationModal'
import type { Campaign } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTranslation } from 'react-i18next'
import { ResourcePresence } from '@/components/presence/ResourcePresence'

type Tab = 'dialogue' | 'choice'

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
  const [dialogueRows, setDialogueRows] = useState<ScenarioRow[]>([])
  const [choiceRows, setChoiceRows] = useState<ChoiceScenarioRow[]>([])
  const [loading, setLoading] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    setLoading(true)
    setError(null)
    Promise.all([
      getAllScenariosAdmin(selectedCampaignId),
      getAllChoiceScenariosAdmin(selectedCampaignId),
    ])
      .then(([d, c]) => { setDialogueRows(d); setChoiceRows(c) })
      .catch(() => setError('Error cargando simulaciones'))
      .finally(() => setLoading(false))
  }, [selectedCampaignId])

  const handleToggleDialogue = async (row: ScenarioRow) => {
    try {
      await toggleScenarioPublished(row.id, !row.is_published)
      setDialogueRows((prev) => prev.map((r) => r.id === row.id ? { ...r, is_published: !row.is_published } : r))
      toast.success(row.is_published ? 'Despublicado' : 'Publicado')
    } catch { toast.error('Error al cambiar estado') }
  }

  const handleDeleteDialogue = async (row: ScenarioRow) => {
    const ok = await confirm({
      title: t('confirm.delete_simulation_title'),
      description: t('confirm.delete_simulation_desc', { title: row.title_es }),
    })
    if (!ok) return
    try {
      const result = await deleteScenario(row.id)
      setDialogueRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success(result === 'pending' ? t('deletion.pending_generic') : t('admin.simulations.list_toast_deleted'))
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
    const ok = await confirm({
      title: t('confirm.delete_simulation_title'),
      description: t('confirm.delete_simulation_desc', { title: row.title_es }),
    })
    if (!ok) return
    try {
      const result = await deleteChoiceScenario(row.id)
      setChoiceRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success(result === 'pending' ? t('deletion.pending_generic') : t('admin.simulations.list_toast_deleted'))
    } catch { toast.error(t('admin.simulations.list_toast_delete_error')) }
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
            onChange={setSelectedCampaignId}
            options={[
              ...(isSuperAdmin ? [{ value: ALL_CAMPAIGNS, label: t('admin.courses.filter_all_campaigns', 'Todas las campañas') }] : []),
              ...campaigns.map((c) => ({ value: c.id, label: c.name })),
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
                {key === 'dialogue' ? dialogueRows.length : choiceRows.length}
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
        <div className="space-y-2">
          {tab === 'dialogue' && (
            dialogueRows.length === 0
              ? <EmptyState onNew={() => setShowNewModal(true)} />
              : dialogueRows.map((row) => (
                <GlassCard key={row.id} className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-text truncate">{row.title_es}</span>
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
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggleDialogue(row)}
                      className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-glass/10 text-text-muted hover:text-text transition-colors"
                      title={row.is_published ? 'Despublicar' : 'Publicar'}
                    >
                      {row.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => nav(`/admin/simulations/${row.id}`)}
                      className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-glass/10 text-text-muted hover:text-text transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteDialogue(row)}
                      className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </GlassCard>
              ))
          )}

          {tab === 'choice' && (
            choiceRows.length === 0
              ? <EmptyState onNew={() => setShowNewModal(true)} />
              : choiceRows.map((row) => (
                <GlassCard key={row.id} className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-text truncate">{row.title_es}</span>
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
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggleChoice(row)}
                      className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-glass/10 text-text-muted hover:text-text transition-colors"
                    >
                      {row.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => nav(`/admin/simulations/choice/${row.id}`)}
                      className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-glass/10 text-text-muted hover:text-text transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteChoice(row)}
                      className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </GlassCard>
              ))
          )}
        </div>
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
