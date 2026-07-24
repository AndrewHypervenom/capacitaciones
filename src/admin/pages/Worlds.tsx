import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue, useMotionTemplate } from 'framer-motion'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { Plus, X, Pencil, Trash2, Globe, Map, BookOpen, Sparkles, Layers } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { supabase } from '@/lib/supabase'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { generateBulkModuleRegions, type WorldRow, type WorldGenOptions } from '@/services/worlds.service'
import { WorldModulePickerModal, type PickedModule } from '@/admin/components/WorldModulePickerModal'
import { requestDeletion } from '@/services/audit.service'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/stores/toastStore'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { ResourcePresence } from '@/components/presence/ResourcePresence'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { RichTextArea } from '@/components/ui/RichTextArea'
import { stripMarkdown } from '@/components/ui/RichText'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'

type WorldStatus = 'draft' | 'published'
type BgType = 'airline' | 'bank' | 'health' | 'corporate' | 'tech'

interface World {
  id: string
  name: string
  description: string
  campaign_id: string | null
  course_id: string | null
  icon: string
  color: string
  bg_type: BgType
  status: WorldStatus
}

interface Campaign {
  id: string
  name: string
}

interface Course {
  id: string
  title_es: string
  campaign_id: string | null
}

interface WorldForm {
  name: string
  description: string
  campaign_id: string
  course_id: string
  icon: string
  color: string
  bg_type: string
}

const BG_TYPES: BgType[] = ['airline', 'bank', 'health', 'corporate', 'tech']
const BG_LABELS: Record<BgType, string> = {
  airline: 'admin.arena.theme_airline',
  bank: 'admin.arena.theme_bank',
  health: 'admin.arena.theme_health',
  corporate: 'admin.arena.theme_corporate',
  tech: 'admin.arena.theme_tech',
}

const emptyForm = (): WorldForm => ({
  name: '',
  description: '',
  campaign_id: '',
  course_id: '',
  icon: '🌍',
  color: '#10D451',
  bg_type: 'corporate',
})

function normalizeRow(row: Record<string, unknown>): World {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    campaign_id: (row.campaign_id as string | null) ?? null,
    course_id: (row.course_id as string | null) ?? null,
    icon: (row.icon as string) ?? '🌍',
    color: (row.color as string) ?? '#10D451',
    bg_type: (row.bg_type as BgType) ?? 'corporate',
    status: (row.status as WorldStatus) ?? 'draft',
  }
}

/* ── Tarjeta con spotlight que sigue al cursor + elevación con resorte ──
   Reutiliza el escalonado del kit (StaggerItem) y añade el halo reactivo del
   mismo lenguaje visual que el mapa del aprendiz. Respeta reduced-motion. */
function SpotlightWrap({
  color, reduce, className, children, ...rest
}: {
  color: string
  reduce: boolean
  className?: string
  children: React.ReactNode
} & React.ComponentProps<typeof StaggerItem>) {
  const mx = useMotionValue(-300)
  const my = useMotionValue(-300)
  const halo = useMotionTemplate`radial-gradient(260px circle at ${mx}px ${my}px, ${color}22, transparent 60%)`
  const onMove = (e: React.MouseEvent) => {
    if (reduce) return
    const r = e.currentTarget.getBoundingClientRect()
    mx.set(e.clientX - r.left); my.set(e.clientY - r.top)
  }
  const reset = () => { mx.set(-300); my.set(-300) }
  return (
    <StaggerItem
      onMouseMove={onMove}
      onMouseLeave={reset}
      whileHover={reduce ? undefined : { y: -4 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className={cn('relative', className)}
      {...rest}
    >
      {!reduce && <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: halo }} />}
      <div className="relative">{children}</div>
    </StaggerItem>
  )
}

export default function Worlds() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const reduce = useReducedMotion()
  const [worlds, setWorlds] = useState<World[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  // Cursos accesibles, para enlazar un mundo a su curso desde el modal.
  const [courses, setCourses] = useState<Course[]>([])
  // Nº de regiones por mundo, para mostrar en la tarjeta cuánto contenido tiene.
  const [regionCounts, setRegionCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filterCampaign, setFilterCampaign] = useState<string>('all')

  const { isSuperAdmin, campaignId, user, loading: authLoading } = useAuth()
  // El capacitador ve/gestiona los mundos de sus campañas (casa + colaboraciones);
  // el superadmin ve todos.
  const scopedToCampaign = !isSuperAdmin
  // Mostrar filtro/selector de campaña cuando el usuario abarca más de una.
  const multiCampaign = campaigns.length > 1

  // ── Modal de creación / edición del mundo (una sola pantalla) ──
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardMode, setWizardMode] = useState<'new' | 'edit'>('new')
  const [savingWorld, setSavingWorld] = useState(false)
  const [form, setForm] = useState<WorldForm>(emptyForm())
  const [editingId, setEditingId] = useState<string | null>(null)

  // ── Armar el mundo desde módulos de varios cursos ──
  // La selección se guarda mientras se completa el modal; al crear el mundo se
  // dispara la generación en 2º plano (una región por módulo).
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickedModules, setPickedModules] = useState<PickedModule[]>([])
  const [pickedOpts, setPickedOpts] = useState<WorldGenOptions | null>(null)

  async function load() {
    // Campañas accesibles (superadmin: todas; capacitador: casa + colaboraciones).
    const camps = await getAccessibleCampaigns({
      isSuperAdmin,
      homeCampaignId: campaignId,
      userId: user?.id ?? null,
    }).catch(() => [] as Campaign[])
    setCampaigns(camps)
    const ids = camps.map((c) => c.id)

    if (scopedToCampaign && ids.length === 0) {
      setWorlds([])
      setLoading(false)
      return
    }

    let worldQuery = supabase
      .from('worlds')
      .select('*')
      .order('created_at', { ascending: false })
    if (scopedToCampaign) worldQuery = worldQuery.in('campaign_id', ids)

    const { data, error } = await worldQuery
    if (error && error.code !== '42P01') console.error('Error loading worlds:', error)
    setWorlds((data ?? []).map(normalizeRow))

    // Cursos accesibles (para el selector "Curso" del modal). Superadmin: todos;
    // capacitador: los de sus campañas.
    let courseQuery = supabase.from('courses').select('id, title_es, campaign_id').order('title_es')
    if (scopedToCampaign) courseQuery = courseQuery.in('campaign_id', ids)
    const { data: courseRows } = await courseQuery
    setCourses((courseRows ?? []) as Course[])

    // Conteo de regiones por mundo, para mostrarlo en cada tarjeta.
    const { data: regionRows } = await supabase.from('world_regions').select('world_id')
    const counts: Record<string, number> = {}
    for (const r of regionRows ?? []) {
      const wid = (r as { world_id: string | null }).world_id
      if (wid) counts[wid] = (counts[wid] ?? 0) + 1
    }
    setRegionCounts(counts)
    setLoading(false)
  }

  useEffect(() => {
    if (authLoading) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scopedToCampaign, campaignId, user?.id])

  // ── Abrir / cerrar modal ──
  const openWizardNew = () => {
    setWizardMode('new')
    setForm({ ...emptyForm(), campaign_id: scopedToCampaign ? (campaignId ?? '') : '' })
    setEditingId(null)
    setPickedModules([])
    setPickedOpts(null)
    setWizardOpen(true)
  }

  const openWizardEdit = (w: World) => {
    setWizardMode('edit')
    setForm({
      name: w.name,
      description: w.description,
      campaign_id: w.campaign_id ?? '',
      course_id: w.course_id ?? '',
      icon: w.icon,
      color: w.color,
      bg_type: w.bg_type,
    })
    setEditingId(w.id)
    setWizardOpen(true)
  }

  // Al elegir un curso, el mundo hereda su campaña (worlds.campaign_id es NOT NULL
  // y el curso ya define a qué campaña pertenece).
  const pickCourse = (courseId: string) => {
    const c = courses.find(x => x.id === courseId)
    setForm(f => ({
      ...f,
      course_id: courseId,
      campaign_id: c?.campaign_id ? c.campaign_id : f.campaign_id,
    }))
  }

  const closeWizard = () => {
    setWizardOpen(false)
    setEditingId(null)
    setPickedModules([])
    setPickedOpts(null)
    load()
  }

  // Inserta (nuevo) o actualiza (edición) el mundo. Devuelve la fila o null si falla.
  async function persistWorld(): Promise<World | null> {
    if (!form.name.trim()) return null
    // worlds.campaign_id es NOT NULL: el mundo siempre pertenece a una campaña.
    const campaign = form.campaign_id || (scopedToCampaign ? (campaignId ?? '') : '')
    if (!campaign) {
      toast.error(i18n.t('admin.worlds.toast_choose_campaign'))
      return null
    }
    setSavingWorld(true)
    const payload = {
      name: form.name.trim(),
      // Preserva el espacio arriba/abajo del editor enriquecido (solo vacía si
      // es puro espacio en blanco).
      description: form.description.trim() ? form.description : '',
      campaign_id: campaign,
      course_id: form.course_id || null,
      icon: form.icon || '🌍',
      color: form.color,
      bg_type: form.bg_type,
    }
    try {
      // Un curso solo puede tener un mundo (índice único worlds_course_id_uidx).
      const courseTakenMsg = i18n.t('admin.worlds.toast_course_taken', { defaultValue: 'Ese curso ya tiene un mundo enlazado. Elige otro curso o déjalo sin curso.' })
      if (editingId) {
        const { data, error } = await supabase.from('worlds').update(payload).eq('id', editingId).select().single()
        if (error || !data) { console.error('Error updating world:', error); toast.error('No se pudo guardar el mundo', error?.code === '23505' ? courseTakenMsg : error?.message); return null }
        const updated = normalizeRow(data)
        setWorlds(prev => prev.map(x => (x.id === editingId ? updated : x)))
        return updated
      } else {
        const { data, error } = await supabase
          .from('worlds')
          .insert({ ...payload, status: 'draft' as WorldStatus })
          .select()
          .single()
        if (error || !data) { console.error('Error saving world:', error); toast.error('No se pudo crear el mundo', error?.code === '23505' ? courseTakenMsg : error?.message); return null }
        const w = normalizeRow(data)
        setWorlds(prev => [w, ...prev])
        setEditingId(w.id)
        return w
      }
    } finally {
      setSavingWorld(false)
    }
  }

  // Guardar: al crear, lleva directo a armar regiones/niveles; al editar, cierra.
  // Si se eligieron módulos, dispara la generación (una región por módulo) en 2º
  // plano: el detalle se refresca solo cuando cada región queda lista.
  const submitWizard = async () => {
    const world = await persistWorld()
    if (!world) return
    if (wizardMode === 'new') {
      if (pickedModules.length > 0) {
        generateBulkModuleRegions(world as WorldRow, pickedModules, 0, pickedOpts ?? {})
        toast.success(i18n.t('admin.worlds.ai_gen_started'))
      }
      setWizardOpen(false)
      setEditingId(null)
      setPickedModules([])
      setPickedOpts(null)
      navigate(`/admin/worlds/${world.id}`)
    } else {
      closeWizard()
    }
  }

  const handleDelete = async (w: World) => {
    const [regions, levels, progress] = await Promise.all([
      supabase.from('world_regions').select('id', { count: 'exact', head: true }).eq('world_id', w.id),
      supabase.from('world_levels').select('id', { count: 'exact', head: true }).eq('world_id', w.id),
      supabase.from('world_progress').select('id', { count: 'exact', head: true }).eq('world_id', w.id),
    ])
    const regionCount = regions.count ?? 0
    const levelCount = levels.count ?? 0
    const progressCount = progress.count ?? 0
    const hasContent = regionCount + levelCount + progressCount > 0

    const ok = await confirm({
      title: t('confirm.delete_world_title'),
      description: (
        <div>
          <div>{t('confirm.delete_world_desc', { name: w.name })}</div>
          {hasContent && (
            <ul className="mt-2 space-y-0.5 text-text-muted">
              {regionCount > 0 && <li>• {t('confirm.delete_world_regions', { count: regionCount })}</li>}
              {levelCount > 0 && <li>• {t('confirm.delete_world_levels', { count: levelCount })}</li>}
              {progressCount > 0 && (
                <li className="text-red-400">• {t('confirm.delete_world_progress', { count: progressCount })}</li>
              )}
            </ul>
          )}
        </div>
      ),
    })
    if (!ok) return

    try {
      const result = await requestDeletion('worlds', w.id)
      setWorlds(prev => prev.filter(x => x.id !== w.id))
      if (result === 'pending') toast.success(t('deletion.pending_toast', { name: w.name }))
      else toast.success(t('confirm.delete_world_ok', { name: w.name }))
    } catch (error) {
      console.error('Error deleting world:', error)
      toast.error(t('confirm.delete_world_error'), (error as Error)?.message)
    }
  }

  const handlePublish = async (w: World) => {
    const newStatus: WorldStatus = w.status === 'published' ? 'draft' : 'published'
    const { data, error } = await supabase.from('worlds').update({ status: newStatus }).eq('id', w.id).select().single()
    if (!error && data) setWorlds(prev => prev.map(x => (x.id === w.id ? normalizeRow(data) : x)))
    else console.error('Error toggling publish:', error)
  }

  const filtered = worlds.filter(w => filterCampaign === 'all' || w.campaign_id === filterCampaign)

  if (!authLoading && !loading && scopedToCampaign && campaigns.length === 0) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">{i18n.t('admin.worlds.title')}</h1>
        <div
          className="mt-8 rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center"
          style={{ background: 'rgba(239,68,68,0.04)', border: '1px dashed rgba(239,68,68,0.20)' }}
        >
          <div className="text-[15px] font-medium text-text mb-2">{i18n.t('admin.worlds.no_campaign_title')}</div>
          <div className="text-[13px] text-text-muted">{i18n.t('admin.worlds.no_campaign_desc')}</div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="p-4 sm:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-[20px] sm:text-[24px] font-bold text-text">{i18n.t('admin.worlds.title')}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={openWizardNew}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors min-h-[44px]"
              style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.20)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.12)' }}
            >
              <Plus className="h-4 w-4" />
              Nuevo mundo
            </button>
          </div>
        </div>
        <p className="text-text-muted text-[13px] mb-8">
          Crea mundos temáticos con sus regiones y niveles. Todo lo gamificado de tu campaña vive aquí.
        </p>

        {/* Filtro de campaña (cuando el usuario abarca más de una) */}
        {!loading && multiCampaign && (
          <FilterDropdown
            value={filterCampaign === 'all' ? '' : filterCampaign}
            onChange={v => setFilterCampaign(v || 'all')}
            options={[{ value: '', label: i18n.t('common.all_campaigns') }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]}
            className="mb-5 max-w-xs"
          />
        )}

        {/* Loading skeleton */}
        {loading ? (
          <div className="grid md:grid-cols-2 gap-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl animate-pulse bg-subtle" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center"
            style={{ background: 'rgba(16,212,81,0.04)', border: '1px dashed rgba(16,212,81,0.20)' }}
          >
            <Globe className="h-10 w-10 mb-4" style={{ color: '#10D451', opacity: 0.5 }} />
            <div className="text-[15px] font-medium text-text mb-1">{i18n.t('admin.worlds.no_worlds')}</div>
            <div className="text-[13px] text-text-muted mb-5 max-w-xs">
              Crea tu primer mundo y arma sus regiones y niveles.
            </div>
            <button
              onClick={openWizardNew}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors min-h-[44px]"
              style={{ background: 'rgba(16,212,81,0.12)', color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.20)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.12)' }}
            >
              <Plus className="h-4 w-4" />
              Nuevo mundo
            </button>
          </div>
        ) : (
          <Stagger className="grid md:grid-cols-2 gap-4">
            {filtered.map(w => {
              const campaignName = campaigns.find(c => c.id === w.campaign_id)?.name
              const courseName = courses.find(c => c.id === w.course_id)?.title_es
              const isPublished = w.status === 'published'
              const nRegions = regionCounts[w.id] ?? 0
              return (
                <SpotlightWrap
                  key={w.id}
                  color={w.color}
                  reduce={reduce}
                  className="group rounded-2xl p-4 sm:p-5 transition-colors duration-300 ease-apple hover:shadow-card-hover hover:border-primary/40 bg-surface border border-line"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
                  <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 text-[20px]" style={{ background: `${w.color}18` }}>
                      {w.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <div className="text-[15px] font-semibold text-text truncate">{w.name}</div>
                        <span
                          className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={
                            isPublished
                              ? { background: 'rgba(16,212,81,0.10)', color: '#10D451' }
                              : { background: 'rgb(var(--glass-border) / 0.07)', color: 'rgb(var(--text-muted))' }
                          }
                        >
                          {isPublished ? 'Publicado' : 'Borrador'}
                        </span>
                        {campaignName && (
                          <span className="shrink-0 text-[10px] text-text-subtle px-2 py-0.5 rounded-full bg-subtle">
                            {campaignName}
                          </span>
                        )}
                        {courseName && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium"
                            style={{ background: 'rgba(99,102,241,0.12)', color: '#6366F1' }}>
                            <BookOpen className="h-2.5 w-2.5" /> {courseName}
                          </span>
                        )}
                        <ResourcePresence type="world" id={w.id} />
                      </div>
                      {w.description && (
                        <div className="text-[12px] text-text-muted leading-relaxed line-clamp-2 mb-2">{stripMarkdown(w.description)}</div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background: `${w.color}15`, color: w.color }}>
                          {BG_LABELS[w.bg_type] ? i18n.t(BG_LABELS[w.bg_type]) : w.bg_type}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                          <Map className="h-3 w-3" />
                          {nRegions === 0
                            ? i18n.t('admin.worlds.no_regions')
                            : i18n.t('admin.worlds.regions_count', { count: nRegions })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 sm:shrink-0 flex-wrap">
                    <button
                      onClick={() => openWizardEdit(w)}
                      title={i18n.t('admin.worlds.ed_title')}
                      className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted transition-colors"
                      style={{ border: '1px solid rgb(var(--glass-border) / 0.08)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--glass-border) / 0.06)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(w)}
                      title={i18n.t('confirm.delete')}
                      aria-label={i18n.t('confirm.delete')}
                      className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted transition-colors"
                      style={{ border: '1px solid rgb(var(--glass-border) / 0.08)' }}
                      onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = '#ef4444'; el.style.background = 'rgba(239,68,68,0.08)' }}
                      onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = ''; el.style.background = 'transparent' }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handlePublish(w)}
                      className="flex items-center justify-center min-h-[44px] px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all"
                      style={
                        isPublished
                          ? { background: 'rgb(var(--glass-border) / 0.06)', color: 'rgb(var(--text-muted))', border: '1px solid rgb(var(--glass-border) / 0.10)' }
                          : { background: 'rgba(16,212,81,0.10)', color: '#10D451', border: '1px solid rgba(16,212,81,0.22)' }
                      }
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.70' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
                    >
                      {isPublished ? 'Despublicar' : 'Publicar'}
                    </button>
                    <button
                      onClick={() => navigate(`/admin/worlds/${w.id}`)}
                      className="flex items-center justify-center min-h-[44px] gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors"
                      style={{ background: 'rgba(16,212,81,0.10)', color: '#10D451', border: '1px solid rgba(16,212,81,0.22)' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.20)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.10)' }}
                    >
                      <Map className="h-3.5 w-3.5" />
                      Regiones y niveles
                    </button>
                  </div>
                  </div>
                </SpotlightWrap>
              )
            })}
          </Stagger>
        )}
      </div>

      {/* ── Modal: crear / editar mundo (una sola pantalla) ── */}
      <AnimatePresence>
      {wizardOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          {...backdropDismiss(closeWizard)}
        >
          <motion.div
            className="w-full max-w-lg rounded-2xl bg-surface border border-line flex flex-col overflow-hidden"
            style={{ maxHeight: '90vh' }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 10 }}
            transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 300, damping: 26 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[16px] font-semibold text-text">
                {wizardMode === 'new' ? 'Nuevo mundo' : 'Editar mundo'}
              </h2>
              <button onClick={closeWizard} className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1">
              <div className="space-y-4">
                <div className="text-center pt-1 pb-1">
                  <div className="h-14 w-14 rounded-2xl mx-auto mb-3 flex items-center justify-center text-[28px]" style={{ background: 'rgba(16,212,81,0.12)' }}>
                    {form.icon || '🌍'}
                  </div>
                  <h3 className="text-[18px] font-bold text-text mb-1">{i18n.t('admin.worlds.wiz_name_q')}</h3>
                  <p className="text-[12.5px] text-text-muted max-w-[42ch] mx-auto">
                    {wizardMode === 'new'
                      ? i18n.t('admin.worlds.wiz_hint_new')
                      : i18n.t('admin.worlds.wiz_hint_edit')}
                  </p>
                </div>
                <input
                  autoFocus
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={i18n.t('admin.worlds.ph_world_name')}
                  className="w-full px-4 py-3 rounded-xl text-[16px] font-semibold text-center bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#10D451]/60 transition-colors"
                />
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.icon_emoji')}</label>
                    <input
                      value={form.icon}
                      onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                      placeholder="🌍"
                      className="w-full px-3 py-2.5 rounded-xl text-[18px] bg-bg border border-line text-text focus:outline-none focus:border-[#10D451]/50 transition-colors text-center min-h-[44px]"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.color')}</label>
                    <input
                      type="color"
                      value={form.color}
                      onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                      className="h-11 w-full rounded-xl border border-line bg-bg cursor-pointer p-1"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.bg_type')}</label>
                    <Select
                      value={form.bg_type}
                      onChange={v => setForm(f => ({ ...f, bg_type: v }))}
                      options={BG_TYPES.map(bt => ({ value: bt, label: i18n.t(BG_LABELS[bt]) }))}
                    />
                  </div>
                </div>
                {multiCampaign && (
                  <div>
                    <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.campaign')} <span className="text-danger">*</span></label>
                    <Select
                      value={form.campaign_id}
                      onChange={v => setForm(f => ({ ...f, campaign_id: v }))}
                      placeholder={i18n.t('admin.worlds.ph_campaign')}
                      options={[
                        { value: '', label: i18n.t('admin.worlds.ph_campaign') },
                        ...campaigns.map(c => ({ value: c.id, label: c.name })),
                      ]}
                    />
                  </div>
                )}
                {/* Enlace con un curso: la fuente de conocimiento del mundo. Opcional.
                    Se ocultan los cursos que ya tienen otro mundo (1 mundo por curso). */}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">
                    {i18n.t('admin.worlds.linked_course', { defaultValue: 'Curso enlazado' })}{' '}
                    <span className="text-text-subtle font-normal">{i18n.t('common.optional_paren')}</span>
                  </label>
                  <Select
                    value={form.course_id}
                    onChange={pickCourse}
                    placeholder={i18n.t('admin.worlds.no_course', { defaultValue: 'Sin curso (mundo suelto)' })}
                    options={[
                      { value: '', label: i18n.t('admin.worlds.no_course', { defaultValue: 'Sin curso (mundo suelto)' }) },
                      ...courses
                        .filter(c =>
                          // Solo cursos de la campaña elegida (si hay una) …
                          (!form.campaign_id || c.campaign_id === form.campaign_id) &&
                          // … y que no estén ya tomados por OTRO mundo.
                          !worlds.some(w => w.course_id === c.id && w.id !== editingId),
                        )
                        .map(c => ({ value: c.id, label: c.title_es })),
                    ]}
                  />
                  <p className="text-[11px] text-text-muted mt-1">
                    {form.course_id
                      ? i18n.t('admin.worlds.course_link_hint', { defaultValue: 'La IA de este mundo se basa en el contenido del curso.' })
                      : i18n.t('admin.worlds.course_nolink_hint', { defaultValue: 'Sin curso, armas las regiones y preguntas a mano.' })}
                  </p>
                </div>
                {/* Armar el mundo desde módulos de VARIOS cursos: cada módulo
                    elegido se vuelve una región generada con IA desde su contenido.
                    Solo al crear; en un mundo existente se hace desde su detalle. */}
                {wizardMode === 'new' && (
                  <div className="rounded-2xl p-3.5" style={{ background:'rgba(139,92,246,0.06)', border:'1px solid rgba(139,92,246,0.22)' }}>
                    <div className="flex items-start gap-3">
                      <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background:'rgba(139,92,246,0.14)' }}>
                        <Layers className="h-4 w-4" style={{ color:'#8B5CF6' }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-semibold text-text">
                          {i18n.t('admin.worlds.from_modules_title', { defaultValue: 'Ármalo desde tus módulos' })}
                        </div>
                        <div className="text-[11.5px] text-text-muted mt-0.5">
                          {pickedModules.length > 0
                            ? i18n.t('admin.worlds.from_modules_picked', { count: pickedModules.length, defaultValue: `${pickedModules.length} módulo(s) elegidos: se creará una región por cada uno.` })
                            : i18n.t('admin.worlds.from_modules_desc', { defaultValue: 'Elige módulos de cualquiera de tus cursos; cada uno se vuelve una región con sus niveles y preguntas.' })}
                        </div>
                        {pickedModules.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {pickedModules.map((m, i) => (
                              <span key={m.id} className="rounded-lg border border-line bg-glass/[0.06] px-2 py-1 text-[11px] text-text-muted">
                                <span className="font-bold text-[#8B5CF6]">{i + 1}</span> {m.title_es}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setPickerOpen(true)}
                        className="flex shrink-0 items-center justify-center gap-1.5 min-h-[44px] px-3 py-2 rounded-xl text-[12.5px] font-semibold transition-colors"
                        style={{ background:'rgba(139,92,246,0.16)', color:'#8B5CF6', border:'1px solid rgba(139,92,246,0.30)' }}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {pickedModules.length > 0
                          ? i18n.t('common.change', { defaultValue: 'Cambiar' })
                          : i18n.t('admin.worlds.from_modules_pick', { defaultValue: 'Elegir módulos' })}
                      </button>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">{i18n.t('admin.worlds.description')} <span className="text-text-subtle font-normal">{i18n.t('common.optional_paren')}</span></label>
                  <RichTextArea
                    value={form.description}
                    onChange={v => setForm(f => ({ ...f, description: v }))}
                    placeholder={i18n.t('admin.worlds.ph_world_desc')}
                    rows={3}
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
              <div className="flex-1" />
              <button onClick={closeWizard} className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted hover:text-text hover:bg-glass/6 transition-colors border border-line">
                {i18n.t('common.cancel')}
              </button>
              <button
                onClick={submitWizard}
                disabled={savingWorld || !form.name.trim() || (multiCampaign && !form.campaign_id)}
                className="flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50"
                style={{ background: 'rgba(16,212,81,0.14)', color: '#10D451', border: '1px solid rgba(16,212,81,0.28)' }}
              >
                {savingWorld
                  ? i18n.t('common.saving')
                  : wizardMode === 'new'
                    ? (pickedModules.length > 0
                        ? <>{i18n.t('admin.worlds.wiz_create_generate', { count: pickedModules.length, defaultValue: `Crear y generar ${pickedModules.length} región(es)` })} <Sparkles className="h-4 w-4" /></>
                        : <>{i18n.t('admin.worlds.wiz_create_build')} <Map className="h-4 w-4" /></>)
                    : i18n.t('common.save_changes')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Selector de módulos multi-curso: la selección se aplica al crear el mundo. */}
      {pickerOpen && (
        <WorldModulePickerModal
          submitLabel={(n) => i18n.t('admin.worlds.picker_use', { count: n, defaultValue: `Usar ${n} módulo(s)` })}
          onClose={() => setPickerOpen(false)}
          onConfirm={(mods, opts) => {
            setPickedModules(mods)
            setPickedOpts(opts)
            setPickerOpen(false)
          }}
        />
      )}
    </>
  )
}
