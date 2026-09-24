import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Plus, ArrowRight, Car, Pencil, Eye, Lock, Check, Sparkles, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { stripMarkdown } from '@/components/ui/RichText'
import type { ArenaQuiz } from '@/admin/components/ArenaEditorModal'
import { DRIVING_ICON, validRoadQuestions } from '@/components/games/drivingModel'
import { LEVEL_LABEL, DEFAULT_PASS_PCT, isLevel, routeOf, unlockedIds, passedGames, deleteGames } from '@/services/drivingLevels.service'
const Editor = lazy(() => import('@/admin/components/ArenaEditorModal').then(m => ({ default: m.ArenaEditorModal })))
const RouteModal = lazy(() => import('@/admin/components/DrivingRouteModal').then(m => ({ default: m.DrivingRouteModal })))
type DriveGame = ArenaQuiz & { course_id: string | null; level: string | null; min_score_pct: number | null }
export default function GamesHub({ admin = false }: { admin?: boolean }) {
  const { user, loading: authLoading, isAuthenticated, isSuperAdmin, isRh, creationCampaignId } = useAuth()
  const [games, setGames] = useState<DriveGame[]>([])
  const [courseTitles, setCourseTitles] = useState<Record<string, string>>({})
  const [passed, setPassed] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ArenaQuiz | null | undefined>(undefined)
  const [route, setRoute] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const confirm = useConfirm()
  const userId = user?.id
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      let query = supabase.from('arena_quizzes').select('*').eq('theme_icon', DRIVING_ICON).is('world_id', null).is('deleted_at', null).order('created_at', { ascending: false })
      if (!admin || !isSuperAdmin) query = query.eq('status', 'published')
      const { data, error: failure } = await query
      if (failure) throw failure
      const list = (data ?? []) as unknown as DriveGame[]
      setGames(list)
      const courseIds = [...new Set(list.filter(g => g.course_id && isLevel(g.level)).map(g => g.course_id as string))]
      const [titles, done] = await Promise.all([
        courseIds.length ? supabase.from('courses').select('id, title_es').in('id', courseIds).then(r => r.data ?? []) : [],
        !admin && userId ? passedGames(userId, list.map(g => g.id)).catch(() => new Set<string>()) : new Set<string>(),
      ])
      setCourseTitles(Object.fromEntries(titles.map(c => [c.id, c.title_es])))
      setPassed(done)
    } catch { setError('No se pudieron cargar los juegos. Intenta de nuevo.'); }
    finally { setLoading(false) }
  }, [admin, isSuperAdmin, userId])
  useEffect(() => { if (isAuthenticated && (!admin || isSuperAdmin)) void load() }, [load, isAuthenticated, admin, isSuperAdmin])
  async function publish(game: ArenaQuiz) {
    if (busy || !isSuperAdmin) return
    if (game.status !== 'published' && !validRoadQuestions(game.steps)) { setError('Completa cada pregunta con al menos dos opciones y exactamente una respuesta correcta antes de publicar.'); return }
    setBusy(game.id); setError('')
    try {
      const status = game.status === 'published' ? 'draft' : 'published'
      const { data, error: failure } = await supabase.from('arena_quizzes').update({ status }).eq('id', game.id).select('id').single()
      if (failure || !data) throw failure || new Error('No autorizado')
      setGames(previous => previous.map(g => g.id === game.id ? { ...g, status } : g))
    } catch { setError('No se pudo cambiar la publicación. Tus cambios anteriores siguen guardados.') }
    finally { setBusy(null) }
  }
  /** Borra un juego o una ruta completa; los aprendices pierden el avance de esos niveles. */
  async function remove(targets: DriveGame[], label: string) {
    if (busy || !isSuperAdmin || targets.length === 0) return
    const many = targets.length > 1
    if (!(await confirm({ title: many ? 'Borrar ' + label : 'Borrar «' + label + '»', description: (many ? 'Se borrarán ' + targets.length + ' niveles' : 'Se borrará este juego') + '. Quedan 30 días en la papelera por si necesitas restaurarlos, y puedes volver a crearlos con la IA enseguida.', confirmLabel: 'Borrar' }))) return
    setBusy(targets[0].id); setError('')
    try {
      await deleteGames(targets.map(g => g.id))
      const gone = new Set(targets.map(g => g.id))
      setGames(previous => previous.filter(g => !gone.has(g.id)))
    } catch { setError('No se pudo borrar. Intenta de nuevo.'); void load() }
    finally { setBusy(null) }
  }
  if (authLoading) return <div className="p-6 text-text-muted" role="status">Cargando…</div>
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (isRh || (admin && !isSuperAdmin)) return <Navigate to="/admin" replace />
  const primary = 'inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green'
  const secondary = 'inline-flex items-center gap-1.5 rounded-lg border border-line/60 px-3 py-2 text-xs font-medium text-text transition hover:border-brand-green hover:text-neon-green disabled:opacity-50'
  const grid = 'grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]'
  const open = admin ? new Set(games.map(g => g.id)) : unlockedIds(games, passed)
  const routes = [...new Set(games.filter(g => g.course_id && isLevel(g.level)).map(g => g.course_id as string))]
  const loose = games.filter(g => !(g.course_id && isLevel(g.level)))
  function card(game: DriveGame, previous?: DriveGame) {
    const locked = !open.has(game.id)
    const done = passed.has(game.id)
    const level = isLevel(game.level) ? game.level : null
    const badge = admin && game.status === 'draft' ? 'Borrador' : locked ? 'Bloqueado' : done ? 'Superado' : 'Listo para jugar'
    return <article key={game.id} className={'flex flex-col rounded-2xl border border-line/40 bg-surface p-6 shadow-sm transition ' + (locked ? 'opacity-70' : 'hover:border-brand-green/60 hover:shadow-card-hover')}>
      <div className="flex items-center justify-between"><span className="grid h-12 w-12 place-items-center rounded-xl bg-brand-green/10 text-neon-green">{locked ? <Lock size={24} /> : done ? <Check size={26} /> : <Car size={26} />}</span><span className={'rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ' + (admin && game.status === 'draft' ? 'bg-brand-magenta/10 text-neon-magenta' : locked ? 'bg-glass/10 text-text-muted' : 'bg-brand-green/10 text-neon-green')}>{badge}</span></div>
      {level && <span className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-neon-green">Nivel {LEVELS_ORDER[level]} · {LEVEL_LABEL[level]}</span>}
      <h2 className={(level ? 'mb-3 mt-1' : 'my-3') + ' break-words text-xl font-bold'}>{game.title}</h2><p className="text-sm leading-relaxed text-text-muted">{stripMarkdown(game.description) || 'Un viaje para aprender, pregunta a pregunta.'}</p>
      <p className="mt-3 text-xs text-text-subtle">{game.steps.length} semáforos · {level ? 'Supera con ' + (game.min_score_pct ?? DEFAULT_PASS_PCT) + ' %' : 'Ciudad 3D · Sin límite de tiempo'}</p>
      {locked ? <p className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-dashed border-line/70 px-4 py-3 text-center text-sm text-text-muted"><Lock size={15} /> Supera {previous && isLevel(previous.level) ? 'el nivel ' + LEVEL_LABEL[previous.level] : 'el nivel anterior'} para desbloquearlo</p>
        : <Link className={primary + ' mt-5 w-full'} to={'/games/drive/' + game.id}>{admin ? 'Probar recorrido' : done ? 'Jugar otra vez' : 'Jugar ahora'} <ArrowRight size={17} /></Link>}
      {admin && <div className="mt-4 flex flex-wrap gap-3"><button className={secondary} onClick={() => setEditing(game)}><Pencil size={14} /> Editar preguntas</button><button className={secondary} disabled={!!busy} onClick={() => void publish(game)}><Eye size={14} />{busy === game.id ? 'Guardando…' : game.status === 'published' ? 'Despublicar' : 'Publicar'}</button><button className={secondary + ' hover:border-danger hover:text-danger'} disabled={!!busy} onClick={() => void remove([game], game.title)}><Trash2 size={14} /> Borrar</button></div>}
    </article>
  }
  return <main className={admin ? 'mx-auto max-w-6xl p-4 text-text sm:p-8' : 'mx-auto max-w-6xl px-4 py-8 text-text sm:px-6'}>
    {!admin && <Link to="/dashboard" className="text-sm text-text-muted transition hover:text-neon-green">← Volver al inicio</Link>}
    <span className={(admin ? '' : 'mt-6 ') + 'block text-xs font-bold uppercase tracking-[0.2em] text-neon-green'}>Learning Lab / Juegos de estudio</span>
    <h1 className="mb-3 mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Zona de juegos</h1>
    <p className="mb-6 max-w-2xl leading-relaxed text-text-muted">{admin ? 'Crea recorridos de estudio: cada pregunta se convierte en un semáforo. Genera una ruta por niveles desde un curso o arma un juego a mano, pruébalo y publícalo para tus aprendices.' : 'Pon en marcha lo que sabes. Recorre la ciudad, resuelve las preguntas y convierte cada semáforo rojo en una nueva oportunidad de aprender.'}</p>
    {admin && <div className="mb-7 flex flex-wrap gap-3"><button className={primary} onClick={() => setRoute(null)}><Sparkles size={18} /> Ruta por niveles con IA</button><button className={secondary + ' px-4 py-3 text-sm'} onClick={() => setEditing(null)}><Plus size={16} /> Crear juego a mano</button></div>}
    {error && <div className="my-4 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger" role="alert">{error} <button className="ml-2 font-semibold underline" onClick={() => void load()}>Reintentar</button></div>}
    {loading ? <p role="status" className="text-text-muted">Cargando recorridos…</p> : games.length === 0 ? <div className="rounded-2xl border border-dashed border-line/70 p-10 text-text-muted"><Car size={40} className="mb-4 text-neon-green" />{admin ? 'Tu primer circuito empieza aquí. Genera una ruta por niveles desde un curso o crea un juego con las preguntas que quieras.' : 'Todavía no hay recorridos publicados disponibles para ti.'}</div> : <>
      {routes.map(courseId => {
        const levels = routeOf(games, courseId)
        return <section key={courseId} className="mb-10" aria-labelledby={'route-' + courseId}>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><span className="text-xs font-bold uppercase tracking-[0.2em] text-text-subtle">Ruta por niveles</span><h2 id={'route-' + courseId} className="text-2xl font-bold">{courseTitles[courseId] ?? levels[0].title.split(' · ')[0]}</h2></div>
            {admin && <div className="flex flex-wrap gap-3"><button className={secondary} onClick={() => setRoute(courseId)}><Sparkles size={14} /> Rehacer con IA</button><button className={secondary + ' hover:border-danger hover:text-danger'} disabled={!!busy} onClick={() => void remove(levels, 'la ruta completa')}><Trash2 size={14} /> Borrar todos los niveles</button></div>}</div>
          <div className={grid}>{levels.map((game, i) => card(game, levels[i - 1]))}</div>
        </section>
      })}
      {loose.length > 0 && <section aria-label="Otros recorridos">{routes.length > 0 && <h2 className="mb-4 text-2xl font-bold">Otros recorridos</h2>}<div className={grid}>{loose.map(game => card(game))}</div></section>}
    </>}
    {admin && <p className="mt-6 text-xs text-text-subtle">Los borradores solo se pueden probar desde superadmin. Al publicar, el juego aparece en Juegos para los usuarios con acceso al contenido. En una ruta, cada nivel se desbloquea al superar el anterior. Las partidas no modifican notas ni XP.</p>}
    {editing !== undefined && <Suspense fallback={<div role="status">Abriendo editor…</div>}><Editor driving editing={editing} defaultCampaignId={creationCampaignId} crumb="Zona de juegos · Un semáforo por pregunta" onClose={() => setEditing(undefined)} onSaved={() => void load()} /></Suspense>}
    {route !== undefined && <Suspense fallback={<div role="status">Abriendo…</div>}><RouteModal courseId={route ?? undefined} campaignId={creationCampaignId ?? null} onClose={() => setRoute(undefined)} onCreated={() => void load()} /></Suspense>}
  </main>
}
const LEVELS_ORDER = { basico: 1, medio: 2, avanzado: 3 } as const
