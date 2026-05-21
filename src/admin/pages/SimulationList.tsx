import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Eye, EyeOff, MessageSquare, PhoneCall, Plus, Trash2, Pencil,
  Download, Loader2, Flame, AlertTriangle,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  getAllScenariosAdmin, deleteScenario, toggleScenarioPublished,
  seedHardcodedScenarios, type ScenarioRow,
} from '@/services/scenarios.admin.service'
import {
  getAllChoiceScenariosAdmin, deleteChoiceScenario, toggleChoiceScenarioPublished,
  seedHardcodedChoiceScenarios, type ChoiceScenarioRow,
} from '@/services/choiceScenarios.admin.service'
import type { Campaign } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'

type Tab = 'dialogue' | 'choice'

const DIFFICULTY_COLORS = { 1: 'text-brand-green', 2: 'text-brand-amber', 3: 'text-brand-magenta' } as const
const LEVEL_COLORS = { basico: 'green', medio: 'cyan', avanzado: 'magenta' } as const

export default function SimulationList() {
  const nav = useNavigate()
  const { campaignId: authCampaignId, isSuperAdmin } = useAuth()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState(authCampaignId ?? '')
  const [tab, setTab] = useState<Tab>('dialogue')
  const [dialogueRows, setDialogueRows] = useState<ScenarioRow[]>([])
  const [choiceRows, setChoiceRows] = useState<ChoiceScenarioRow[]>([])
  const [loading, setLoading] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuperAdmin) return
    supabase.from('campaigns').select('*').order('name').then(({ data }) => {
      setCampaigns(data ?? [])
      if (!selectedCampaignId && data?.[0]) setSelectedCampaignId(data[0].id)
    })
  }, [isSuperAdmin, selectedCampaignId])

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
    if (!confirm(`¿Eliminar "${row.title_es}"? Esta acción no se puede deshacer.`)) return
    try {
      await deleteScenario(row.id)
      setDialogueRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success('Simulación eliminada')
    } catch { toast.error('Error al eliminar') }
  }

  const handleToggleChoice = async (row: ChoiceScenarioRow) => {
    try {
      await toggleChoiceScenarioPublished(row.id, !row.is_published)
      setChoiceRows((prev) => prev.map((r) => r.id === row.id ? { ...r, is_published: !row.is_published } : r))
      toast.success(row.is_published ? 'Despublicado' : 'Publicado')
    } catch { toast.error('Error al cambiar estado') }
  }

  const handleDeleteChoice = async (row: ChoiceScenarioRow) => {
    if (!confirm(`¿Eliminar "${row.title_es}"? Esta acción no se puede deshacer.`)) return
    try {
      await deleteChoiceScenario(row.id)
      setChoiceRows((prev) => prev.filter((r) => r.id !== row.id))
      toast.success('Simulación eliminada')
    } catch { toast.error('Error al eliminar') }
  }

  const handleSeed = async () => {
    if (!selectedCampaignId) return
    if (!confirm('¿Importar las simulaciones de muestra a esta campaña? Se sobreescribirán si ya existen.')) return
    setSeeding(true)
    try {
      const [d, c] = await Promise.all([
        seedHardcodedScenarios(selectedCampaignId),
        seedHardcodedChoiceScenarios(selectedCampaignId),
      ])
      toast.success(`${d + c} simulaciones importadas`)
      const [dRows, cRows] = await Promise.all([
        getAllScenariosAdmin(selectedCampaignId),
        getAllChoiceScenariosAdmin(selectedCampaignId),
      ])
      setDialogueRows(dRows)
      setChoiceRows(cRows)
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`)
    } finally {
      setSeeding(false)
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <GradientHeading as="h1" className="text-2xl mb-1">Simulaciones</GradientHeading>
          <p className="text-sm text-text-muted">Escenarios de llamada para agentes</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSeed}
            disabled={!selectedCampaignId || seeding}
            title="Importar simulaciones de muestra al DB"
          >
            {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Importar muestra
          </Button>
          <Button
            size="sm"
            onClick={() => nav(tab === 'dialogue' ? '/admin/simulations/new' : '/admin/simulations/choice/new')}
          >
            <Plus className="h-4 w-4" /> Nueva simulación
          </Button>
        </div>
      </div>

      {isSuperAdmin && campaigns.length > 0 && (
        <div className="mb-6">
          <label className="text-xs text-text-muted mb-1 block">Campaña</label>
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="glass border border-glass-border/20 rounded-xl px-3 py-2 text-sm text-text bg-transparent"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl glass w-fit border border-glass-border/10">
        {([['dialogue', 'Llamadas', PhoneCall], ['choice', 'Opción múltiple', MessageSquare]] as const).map(
          ([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all',
                tab === key
                  ? 'bg-glass-border/10 text-text font-medium'
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
              ? <EmptyState onNew={() => nav('/admin/simulations/new')} onSeed={handleSeed} />
              : dialogueRows.map((row) => (
                <GlassCard key={row.id} className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-text truncate">{row.title_es}</span>
                      <NeonBadge color={row.is_published ? 'green' : 'neutral'} className="text-[9px] shrink-0">
                        {row.is_published ? 'Publicado' : 'Borrador'}
                      </NeonBadge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted">
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
                      className="p-2 rounded-lg hover:bg-glass/10 text-text-muted hover:text-text transition-colors"
                      title={row.is_published ? 'Despublicar' : 'Publicar'}
                    >
                      {row.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => nav(`/admin/simulations/${row.id}`)}
                      className="p-2 rounded-lg hover:bg-glass/10 text-text-muted hover:text-text transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteDialogue(row)}
                      className="p-2 rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </GlassCard>
              ))
          )}

          {tab === 'choice' && (
            choiceRows.length === 0
              ? <EmptyState onNew={() => nav('/admin/simulations/choice/new')} onSeed={handleSeed} />
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
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-muted">
                      <span className="font-mono">{row.slug}</span>
                      {row.client_name && <><span>·</span><span>{row.client_name}</span></>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggleChoice(row)}
                      className="p-2 rounded-lg hover:bg-glass/10 text-text-muted hover:text-text transition-colors"
                    >
                      {row.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => nav(`/admin/simulations/choice/${row.id}`)}
                      className="p-2 rounded-lg hover:bg-glass/10 text-text-muted hover:text-text transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteChoice(row)}
                      className="p-2 rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
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

function EmptyState({ onNew, onSeed }: { onNew: () => void; onSeed: () => void }) {
  return (
    <div className="text-center py-16">
      <p className="text-text-muted text-sm mb-4">No hay simulaciones en esta campaña</p>
      <div className="flex items-center justify-center gap-2">
        <Button size="sm" onClick={onNew}><Plus className="h-4 w-4" /> Crear nueva</Button>
        <Button variant="ghost" size="sm" onClick={onSeed}><Download className="h-4 w-4" /> Importar muestra</Button>
      </div>
    </div>
  )
}
