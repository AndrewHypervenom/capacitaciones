import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Plus, X, ChevronDown, Pencil, Trash2, ArrowLeft, ChevronRight, GripVertical } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTranslation } from 'react-i18next'

interface World {
  id: string; name: string; description: string | null
  campaign_id: string | null; icon: string; color: string
  bg_type: string; status: string
  sound_theme: string; transition_type: string; character_emoji: string
}
interface Region { id: string; name: string; description: string; icon: string; order_index: number; world_id: string }
interface Level  { id: string; name: string; description: string; icon: string; order_index: number; region_id: string; world_id: string; quiz_id: string | null; min_score_pct: number | null }
interface Quiz   { id: string; title: string }

const BG_LABELS: Record<string,string> = { airline:'Aerolínea', bank:'Banco', health:'Salud', corporate:'Corporativo', tech:'Tecnología' }
const SOUND_LABELS: Record<string,string> = { airport:'Aeropuerto', bank:'Banco', nature:'Naturaleza', tech:'Tecnología', neutral:'Neutral' }
const TRANS_LABELS: Record<string,string> = { clouds:'Nubes ☁️', cards:'Cartas 💳', pulse:'Pulso ❤️', rocket:'Cohete 🚀', terminal:'Terminal 💻', confetti:'Confeti 🎉', scan:'Escaneo 🔍', warp:'Hipersalto 💫' }

export default function WorldDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { user, isSuperAdmin, campaignId, loading: authLoading, profile } = useAuth()
  // 'admin' ya no existe como rol; solo el superadmin llega aquí, así que nunca hay scoping por campaña
  const isAdminOnly = false

  const [world, setWorld]     = useState<World | null>(null)
  const [regions, setRegions] = useState<Region[]>([])
  const [levels, setLevels]   = useState<Level[]>([])
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Record<string,boolean>>({})

  // Region modal
  const [regionModal, setRegionModal] = useState(false)
  const [editingRegion, setEditingRegion] = useState<Region | null>(null)
  const [regionForm, setRegionForm] = useState({ name:'', description:'', icon:'📍', order_index:0 })
  const [savingRegion, setSavingRegion] = useState(false)

  // Level modal
  const [levelModal, setLevelModal] = useState(false)
  const [editingLevel, setEditingLevel] = useState<Level | null>(null)
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null)
  const [levelForm, setLevelForm] = useState({ name:'', description:'', icon:'⭐', order_index:0, quiz_id:'', min_score_pct: null as number | null })
  const [savingLevel, setSavingLevel] = useState(false)
  const [levelScoreError, setLevelScoreError] = useState<string | null>(null)

  // Reset progress
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetToast, setResetToast] = useState(false)
  const [resetError, setResetError] = useState(false)

  useEffect(() => {
    if (!id) return
    async function load() {
      if (!id) return
      const { data: wData } = await supabase.from('worlds').select('*').eq('id', id).single()
      if (wData) {
        const raw = wData as Record<string,unknown>
        setWorld({
          ...wData,
          sound_theme:     (raw.sound_theme     as string) ?? 'neutral',
          transition_type: (raw.transition_type as string) ?? 'clouds',
          character_emoji: (raw.character_emoji as string) ?? '🧑',
        })
        // Load quizzes
        const qQuery = supabase.from('arena_quizzes').select('id, title').order('created_at')
        if (wData.campaign_id) qQuery.eq('campaign_id', wData.campaign_id)
        const { data: qData } = await qQuery
        setQuizzes((qData ?? []) as Quiz[])
      }
      const { data: rData } = await supabase.from('world_regions').select('*').eq('world_id', id).order('order_index')
      const regionList = (rData ?? []) as Region[]
      setRegions(regionList)
      // Expand first region by default
      if (regionList.length > 0) setExpanded({ [regionList[0].id]: true })

      const { data: lData } = await supabase.from('world_levels').select('*').eq('world_id', id).order('order_index')
      setLevels((lData ?? []) as Level[])
      setLoading(false)
    }
    load()
  }, [id])

  /* ── Theme autosave ── */
  const handleTheme = async (field: string, value: string) => {
    if (!world) return
    setWorld(prev => prev ? { ...prev, [field]: value } : prev)
    const { error } = await supabase.from('worlds').update({ [field]: value } as any).eq('id', world.id)
    if (error) console.error('Error updating theme:', error)
  }

  /* ── Region CRUD ── */
  const openNewRegion = () => {
    setEditingRegion(null)
    setRegionForm({ name:'', description:'', icon:'📍', order_index: regions.length })
    setRegionModal(true)
  }
  const openEditRegion = (r: Region) => {
    setEditingRegion(r)
    setRegionForm({ name:r.name, description:r.description, icon:r.icon, order_index:r.order_index })
    setRegionModal(true)
  }
  const saveRegion = async () => {
    if (!regionForm.name.trim() || !world) return
    setSavingRegion(true)
    const payload = { name:regionForm.name.trim(), description:regionForm.description.trim(), icon:regionForm.icon||'📍', order_index:regionForm.order_index, world_id:world.id }
    if (editingRegion) {
      const { data, error } = await supabase.from('world_regions').update(payload).eq('id', editingRegion.id).select().single()
      if (!error && data) setRegions(prev => prev.map(r => r.id === editingRegion.id ? data as Region : r))
    } else {
      const { data, error } = await supabase.from('world_regions').insert(payload).select().single()
      if (!error && data) {
        setRegions(prev => [...prev, data as Region])
        setExpanded(prev => ({ ...prev, [(data as Region).id]: true }))
      }
    }
    setSavingRegion(false); setRegionModal(false)
  }
  const deleteRegion = async (r: Region) => {
    const ok = await confirm({
      title: t('confirm.delete_region_title'),
      description: t('confirm.delete_region_desc', { name: r.name }),
    })
    if (!ok) return
    await supabase.from('world_levels').delete().eq('region_id', r.id)
    await supabase.from('world_regions').delete().eq('id', r.id)
    setRegions(prev => prev.filter(x => x.id !== r.id))
    setLevels(prev => prev.filter(x => x.region_id !== r.id))
  }

  /* ── Level CRUD ── */
  const openNewLevel = (regionId: string) => {
    setEditingLevel(null)
    setActiveRegionId(regionId)
    const regionLevels = levels.filter(l => l.region_id === regionId)
    setLevelForm({ name:'', description:'', icon:'⭐', order_index: levels.length, quiz_id:'', min_score_pct: null })
    setLevelModal(true)
  }
  const openEditLevel = (l: Level) => {
    setEditingLevel(l)
    setActiveRegionId(l.region_id)
    setLevelForm({ name:l.name, description:l.description, icon:l.icon, order_index:l.order_index, quiz_id:l.quiz_id||'', min_score_pct: l.min_score_pct ?? null })
    setLevelModal(true)
  }
  const saveLevel = async () => {
    if (!levelForm.name.trim() || !world || !activeRegionId) return
    if (levelForm.min_score_pct !== null && (levelForm.min_score_pct < 0 || levelForm.min_score_pct > 100)) {
      setLevelScoreError('El valor debe estar entre 0 y 100.')
      return
    }
    setLevelScoreError(null)
    setSavingLevel(true)
    const payload = { name:levelForm.name.trim(), description:levelForm.description.trim(), icon:levelForm.icon||'⭐', order_index:levelForm.order_index, quiz_id:levelForm.quiz_id||null, min_score_pct:levelForm.min_score_pct, region_id:activeRegionId, world_id:world.id }
    if (editingLevel) {
      const { data, error } = await supabase.from('world_levels').update(payload).eq('id', editingLevel.id).select().single()
      if (!error && data) setLevels(prev => prev.map(l => l.id === editingLevel.id ? data as Level : l))
    } else {
      const { data, error } = await supabase.from('world_levels').insert(payload).select().single()
      if (!error && data) setLevels(prev => [...prev, data as Level])
      else console.error('Error saving level:', error)
    }
    setSavingLevel(false); setLevelModal(false)
  }
  const deleteLevel = async (l: Level) => {
    const ok = await confirm({
      title: t('confirm.delete_level_title'),
      description: t('confirm.delete_level_desc', { name: l.name }),
    })
    if (!ok) return
    await supabase.from('world_levels').delete().eq('id', l.id)
    setLevels(prev => prev.filter(x => x.id !== l.id))
  }

  const resetProgress = async () => {
    if (!world || !user) return
    setResetting(true)
    const { data: levelRows } = await supabase.from('world_levels').select('id').eq('world_id', world.id)
    const levelIds = (levelRows || []).map(l => l.id)
    const { error } = await supabase.from('world_progress').delete().eq('user_id', user.id).in('level_id', levelIds)
    setResetting(false)
    setShowResetConfirm(false)
    if (error) {
      console.error('world_progress delete error:', error, { userId: user.id, worldId: world.id })
      setResetError(true)
      setTimeout(() => setResetError(false), 3000)
    } else {
      setResetToast(true)
      setTimeout(() => setResetToast(false), 3000)
    }
  }

  if (loading || authLoading) return <div className="p-8 text-text-muted">Cargando…</div>
  if (!world) return <div className="p-8 text-text-muted">Mundo no encontrado.</div>
  if (isAdminOnly && !campaignId) {
    return <div className="p-8 text-text-muted">No tienes una campaña asignada. Contacta al superadmin.</div>
  }
  if (isAdminOnly && world.campaign_id !== campaignId) {
    return (
      <div className="p-4 sm:p-8">
        <button onClick={() => navigate('/admin/worlds')}
          className="flex items-center gap-2 text-text-muted hover:text-text transition-colors mb-5 sm:mb-6 text-[13px] min-h-[44px]">
          <ArrowLeft className="h-4 w-4" /> Volver a Mundos
        </button>
        <div
          className="rounded-2xl p-6 sm:p-10 flex flex-col items-center justify-center text-center"
          style={{ background: 'rgba(239,68,68,0.04)', border: '1px dashed rgba(239,68,68,0.20)' }}
        >
          <div className="text-[15px] font-medium mb-2" style={{ color: '#ef4444' }}>Acceso denegado</div>
          <div className="text-[13px] text-text-muted">Este mundo no pertenece a tu campaña.</div>
        </div>
      </div>
    )
  }

  const tc = world.color

  return (
    <>
      <style>{`
        @keyframes slideDown { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes modalIn   { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .region-body { animation: slideDown .2s ease both; }
        .wd-modal    { animation: modalIn .22s cubic-bezier(.16,1,.3,1); }
      `}</style>

      <div className="p-4 sm:p-6 max-w-4xl mx-auto">

        {/* ── Back ── */}
        <button onClick={() => navigate('/admin/worlds')}
          className="flex items-center gap-2 text-text-muted hover:text-text transition-colors mb-5 sm:mb-6 text-[13px] min-h-[44px]">
          <ArrowLeft className="h-4 w-4" /> Volver a Mundos
        </button>

        {/* ── World header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6 p-4 sm:p-5 rounded-2xl bg-surface border border-line">
          <div className="h-14 w-14 rounded-2xl flex items-center justify-center text-[28px] flex-shrink-0" style={{ background:`${tc}18` }}>
            {world.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[18px] sm:text-[20px] font-bold text-text leading-none mb-1">{world.name}</h1>
            {world.description && <p className="text-[13px] text-text-muted leading-relaxed">{world.description}</p>}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ background:`${tc}15`, color:tc }}>{BG_LABELS[world.bg_type] ?? world.bg_type}</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${world.status==='published' ? 'text-[#00C228]' : 'text-text-muted'}`} style={{ background: world.status==='published' ? 'rgba(0,194,40,0.1)' : 'rgb(var(--glass-border) / 0.06)' }}>
                {world.status === 'published' ? 'Publicado' : 'Borrador'}
              </span>
            </div>
          </div>
          <div className="flex flex-row sm:flex-col gap-2">
            <button onClick={() => navigate(`/world`, { state:{ from:'admin', worldId:world.id } })}
              className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors"
              style={{ background:`${tc}15`, color:tc, border:`1px solid ${tc}30` }}>
              Vista previa
            </button>
            {isSuperAdmin && (
              <button onClick={() => setShowResetConfirm(true)}
                className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors"
                style={{ background:'rgba(239,68,68,0.07)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.22)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.13)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.07)' }}>
                Reiniciar mi progreso
              </button>
            )}
          </div>
        </div>

        {/* ── Theme config ── */}
        <div className="rounded-2xl bg-surface border border-line p-4 sm:p-5 mb-6">
          <h2 className="text-[13px] font-semibold text-text-muted uppercase tracking-wider mb-4">Configuración visual</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">🔊 Sonido</label>
              <div className="relative">
                <select value={world.sound_theme||'neutral'} onChange={e => handleTheme('sound_theme',e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none appearance-none cursor-pointer">
                  {Object.entries(SOUND_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none"/>
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">✨ Transición</label>
              <div className="relative">
                <select value={world.transition_type||'clouds'} onChange={e => handleTheme('transition_type',e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none appearance-none cursor-pointer">
                  {Object.entries(TRANS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none"/>
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">🧑 Personaje</label>
              <input value={world.character_emoji||'🧑'} onChange={e => handleTheme('character_emoji',e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-[20px] bg-bg border border-line text-text focus:outline-none text-center"
                placeholder="🧑" maxLength={2}/>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-text-muted mb-1.5">🎨 Color</label>
              <input type="color" value={world.color} onChange={e => handleTheme('color',e.target.value)}
                className="h-[42px] w-full rounded-xl border border-line bg-bg cursor-pointer p-1"/>
            </div>
          </div>
          <p className="text-[11px] text-text-muted mt-3 opacity-60">Los cambios se guardan automáticamente y se reflejan en el mapa del aprendiz.</p>
        </div>

        {/* ── Regions ── */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-[15px] sm:text-[16px] font-bold text-text">Regiones y Niveles</h2>
            <p className="text-[12px] text-text-muted mt-0.5 hidden sm:block">Las regiones agrupan niveles. El aprendiz los completa en orden.</p>
          </div>
          <button onClick={openNewRegion}
            className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-xl text-[12px] sm:text-[13px] font-medium transition-colors shrink-0 min-h-[44px]"
            style={{ background:'rgba(0,194,40,0.12)', color:'#00C228', border:'1px solid rgba(0,194,40,0.25)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='rgba(0,194,40,0.20)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='rgba(0,194,40,0.12)'}>
            <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4"/> <span className="hidden xs:inline">Nueva</span> región
          </button>
        </div>

        {regions.length === 0 ? (
          <div className="rounded-2xl p-6 sm:p-10 text-center border border-dashed border-line">
            <div className="text-3xl mb-3">🗺️</div>
            <div className="text-[14px] font-medium text-text mb-1">Sin regiones</div>
            <div className="text-[12px] text-text-muted mb-4">Crea una región para empezar a agregar niveles</div>
            <button onClick={openNewRegion} className="flex items-center justify-center min-h-[44px] text-[13px] font-medium px-4 py-2 rounded-xl" style={{ background:'rgba(0,194,40,0.12)', color:'#00C228', border:'1px solid rgba(0,194,40,0.25)' }}>
              + Nueva región
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {regions.sort((a,b) => a.order_index - b.order_index).map((region, ri) => {
              const regionLevels = levels.filter(l => l.region_id === region.id).sort((a,b) => a.order_index - b.order_index)
              const isOpen = expanded[region.id] ?? false
              return (
                <div key={region.id} className="rounded-2xl border border-line bg-surface overflow-hidden">
                  {/* Region header */}
                  <div className="flex items-center gap-3 px-3 sm:px-5 py-3 sm:py-4 cursor-pointer select-none"
                    onClick={() => setExpanded(prev => ({ ...prev, [region.id]: !isOpen }))}>
                    <div className="h-8 w-8 rounded-xl flex items-center justify-center text-[16px] flex-shrink-0" style={{ background:`${tc}15` }}>
                      {region.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold text-text">{region.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-subtle text-text-muted font-medium">#{ri+1}</span>
                        <span className="text-[10px] text-text-muted">{regionLevels.length} {regionLevels.length === 1 ? 'nivel' : 'niveles'}</span>
                      </div>
                      {region.description && <p className="text-[12px] text-text-muted truncate mt-0.5">{region.description}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); openEditRegion(region) }}
                        className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-subtle">
                        <Pencil className="h-4 w-4"/>
                      </button>
                      <button onClick={e => { e.stopPropagation(); deleteRegion(region) }}
                        className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400">
                        <Trash2 className="h-4 w-4"/>
                      </button>
                      <ChevronRight className={`h-4 w-4 text-text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`}/>
                    </div>
                  </div>

                  {/* Levels */}
                  {isOpen && (
                    <div className="region-body border-t border-line">
                      {regionLevels.length === 0 ? (
                        <div className="px-5 py-6 text-center">
                          <div className="text-[12px] text-text-muted mb-3">Esta región no tiene niveles. Agrega el primer nivel.</div>
                          <button onClick={() => openNewLevel(region.id)}
                            className="flex items-center justify-center min-h-[44px] text-[12px] font-medium px-3 py-1.5 rounded-lg"
                            style={{ background:`${tc}12`, color:tc, border:`1px solid ${tc}25` }}>
                            + Agregar nivel
                          </button>
                        </div>
                      ) : (
                        <div>
                          {regionLevels.map((level, li) => {
                            const quiz = quizzes.find(q => q.id === level.quiz_id)
                            return (
                              <div key={level.id} className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 border-b border-line/50 last:border-b-0 hover:bg-bg/40 transition-colors group">
                                {/* Order indicator */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <div className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-800" style={{ background:`${tc}15`, color:tc, fontWeight:700 }}>
                                    {li+1}
                                  </div>
                                  <span className="text-[16px]">{level.icon}</span>
                                </div>
                                {/* Level info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[13px] font-medium text-text">{level.name}</span>
                                    {quiz && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium truncate max-w-[140px]" style={{ background:`${tc}10`, color:tc, border:`1px solid ${tc}20` }}>
                                        📋 {quiz.title}
                                      </span>
                                    )}
                                    {!quiz && (
                                      <span className="text-[10px] px-2 py-0.5 rounded-full text-amber-500 bg-amber-500/10 border border-amber-500/20">
                                        ⚠️ Sin quiz
                                      </span>
                                    )}
                                  </div>
                                  {level.description && <p className="text-[11px] text-text-muted mt-0.5 truncate">{level.description}</p>}
                                </div>
                                {/* Actions */}
                                <div className="flex items-center gap-1.5 flex-shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => navigate(`/arena/${level.quiz_id}`, { state:{ from:'admin', worldId:world.id, levelId:level.id } })}
                                    disabled={!level.quiz_id}
                                    className="flex items-center justify-center min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] font-medium disabled:opacity-30"
                                    style={{ background:`${tc}12`, color:tc, border:`1px solid ${tc}25` }}>
                                    Probar
                                  </button>
                                  <button onClick={() => openEditLevel(level)}
                                    className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:bg-subtle">
                                    <Pencil className="h-4 w-4"/>
                                  </button>
                                  <button onClick={() => deleteLevel(level)}
                                    className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:bg-red-500/10 hover:text-red-400">
                                    <Trash2 className="h-4 w-4"/>
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                          {/* Add level button */}
                          <div className="px-3 sm:px-5 py-3 border-t border-line/30">
                            <button onClick={() => openNewLevel(region.id)}
                              className="flex items-center gap-2 text-[12px] font-medium transition-colors"
                              style={{ color:tc }}
                              onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity='.7'}
                              onMouseLeave={e => (e.currentTarget as HTMLElement).style.opacity='1'}>
                              <Plus className="h-3.5 w-3.5"/> Agregar nivel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Region Modal ── */}
      {regionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setRegionModal(false) }}>
          <div className="wd-modal w-full max-w-md rounded-2xl bg-surface border border-line overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[15px] font-semibold text-text">{editingRegion ? 'Editar región' : 'Nueva región'}</h2>
              <button onClick={() => setRegionModal(false)} className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-subtle">
                <X className="h-4 w-4"/>
              </button>
            </div>
            <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">Nombre *</label>
                <input required value={regionForm.name} onChange={e => setRegionForm(f => ({...f,name:e.target.value}))}
                  placeholder="Ej: Zona de Check-in"
                  className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">Descripción</label>
                <input value={regionForm.description} onChange={e => setRegionForm(f => ({...f,description:e.target.value}))}
                  placeholder="Descripción opcional"
                  className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">Icono</label>
                  <input value={regionForm.icon} onChange={e => setRegionForm(f => ({...f,icon:e.target.value}))}
                    className="w-full px-3 py-2.5 rounded-xl text-[20px] bg-bg border border-line text-text focus:outline-none text-center min-h-[44px]" maxLength={2}/>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">Orden</label>
                  <input type="number" value={regionForm.order_index} onChange={e => setRegionForm(f => ({...f,order_index:parseInt(e.target.value)||0}))}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
              <button onClick={() => setRegionModal(false)} className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted border border-line hover:text-text transition-colors">Cancelar</button>
              <button onClick={saveRegion} disabled={savingRegion} className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium disabled:opacity-50"
                style={{ background:'rgba(0,194,40,0.14)', color:'#00C228', border:'1px solid rgba(0,194,40,0.28)' }}>
                {savingRegion ? 'Guardando…' : editingRegion ? 'Guardar' : 'Crear región'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Level Modal ── */}
      {levelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setLevelModal(false) }}>
          <div className="wd-modal w-full max-w-md rounded-2xl bg-surface border border-line overflow-hidden flex flex-col" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-line shrink-0">
              <h2 className="text-[15px] font-semibold text-text">{editingLevel ? 'Editar nivel' : 'Nuevo nivel'}</h2>
              <button onClick={() => setLevelModal(false)} className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-subtle">
                <X className="h-4 w-4"/>
              </button>
            </div>
            <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">Nombre *</label>
                <input required value={levelForm.name} onChange={e => setLevelForm(f => ({...f,name:e.target.value}))}
                  placeholder="Ej: Nivel 1 — Introducción"
                  className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">Quiz de Arena</label>
                <div className="relative">
                  <select value={levelForm.quiz_id} onChange={e => setLevelForm(f => ({...f,quiz_id:e.target.value}))}
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none appearance-none cursor-pointer min-h-[44px]">
                    <option value="">Sin quiz asignado</option>
                    {quizzes.map(q => <option key={q.id} value={q.id}>{q.title}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none"/>
                </div>
                <p className="text-[11px] text-text-muted mt-1">El quiz debe crearse primero en el módulo Arena.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">Icono</label>
                  <input value={levelForm.icon} onChange={e => setLevelForm(f => ({...f,icon:e.target.value}))}
                    className="w-full px-3 py-2.5 rounded-xl text-[20px] bg-bg border border-line text-text focus:outline-none text-center min-h-[44px]" maxLength={2}/>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-text-muted mb-1.5">Descripción</label>
                  <input value={levelForm.description} onChange={e => setLevelForm(f => ({...f,description:e.target.value}))}
                    placeholder="Opcional"
                    className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none min-h-[44px]"/>
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-text-muted mb-1.5">Puntuación mínima para pasar (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={levelForm.min_score_pct ?? ''}
                  onChange={e => {
                    setLevelScoreError(null)
                    setLevelForm(f => ({
                      ...f,
                      min_score_pct: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }}
                  placeholder="0-100, vacío para sin requisito"
                  className="w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border text-text placeholder-text-subtle focus:outline-none transition-colors min-h-[44px]"
                  style={{ borderColor: levelScoreError ? '#ef4444' : undefined }}/>
                {levelScoreError && (
                  <p className="mt-1 text-[11px]" style={{ color: '#ef4444' }}>{levelScoreError}</p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-line shrink-0">
              <button onClick={() => setLevelModal(false)} className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted border border-line hover:text-text transition-colors">Cancelar</button>
              <button onClick={saveLevel} disabled={savingLevel} className="flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium disabled:opacity-50"
                style={{ background:'rgba(0,194,40,0.14)', color:'#00C228', border:'1px solid rgba(0,194,40,0.28)' }}>
                {savingLevel ? 'Guardando…' : editingLevel ? 'Guardar' : 'Crear nivel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reset confirm modal ── */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background:'rgba(0,0,0,0.55)', backdropFilter:'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowResetConfirm(false) }}>
          <div className="wd-modal w-full max-w-sm rounded-2xl bg-surface border border-line overflow-hidden">
            <div className="px-4 sm:px-6 pt-6 pb-4 text-center">
              <div className="text-[2rem] mb-3">⚠️</div>
              <h3 className="text-[16px] font-semibold text-text mb-2">¿Estás seguro?</h3>
              <p className="text-[13px] text-text-muted leading-relaxed">
                Esto borrará todo tu progreso en este mundo.
              </p>
            </div>
            <div className="flex items-center gap-3 px-4 sm:px-6 pb-6">
              <button onClick={() => setShowResetConfirm(false)}
                className="flex-1 flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] text-text-muted border border-line hover:text-text transition-colors">
                Cancelar
              </button>
              <button onClick={resetProgress} disabled={resetting}
                className="flex-1 flex items-center justify-center min-h-[44px] px-4 py-2 rounded-xl text-[13px] font-medium transition-colors disabled:opacity-50"
                style={{ background:'rgba(239,68,68,0.12)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.28)' }}>
                {resetting ? 'Borrando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {resetToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-[13px] font-medium"
          style={{ background:'rgba(0,194,40,0.15)', color:'#00C228', border:'1px solid rgba(0,194,40,0.30)', boxShadow:'0 4px 20px rgba(0,0,0,0.3)' }}>
          ✓ Progreso reiniciado correctamente
        </div>
      )}
      {resetError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-[13px] font-medium"
          style={{ background:'rgba(239,68,68,0.15)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.30)', boxShadow:'0 4px 20px rgba(0,0,0,0.3)' }}>
          ✗ No se pudo reiniciar el progreso, intenta de nuevo
        </div>
      )}
    </>
  )
}