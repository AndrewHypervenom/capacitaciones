import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Plus, ArrowRight, Car, Pencil, Eye } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { stripMarkdown } from '@/components/ui/RichText'
import type { ArenaQuiz } from '@/admin/components/ArenaEditorModal'
import { DRIVING_ICON, validRoadQuestions } from '@/components/games/drivingModel'
import '@/components/games/driving.css'
const Editor = lazy(() => import('@/admin/components/ArenaEditorModal').then(m => ({ default: m.ArenaEditorModal })))
export default function GamesHub({ admin = false }: { admin?: boolean }) {
  const { loading: authLoading, isAuthenticated, isSuperAdmin, isRh, creationCampaignId } = useAuth()
  const [games, setGames] = useState<ArenaQuiz[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ArenaQuiz | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      let query = supabase.from('arena_quizzes').select('*').eq('theme_icon', DRIVING_ICON).is('world_id', null).order('created_at', { ascending: false })
      if (!admin || !isSuperAdmin) query = query.eq('status', 'published')
      const { data, error: failure } = await query
      if (failure) throw failure
      setGames((data ?? []) as unknown as ArenaQuiz[])
    } catch { setError('No se pudieron cargar los juegos. Intenta de nuevo.'); }
    finally { setLoading(false) }
  }, [admin, isSuperAdmin])
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
  if (authLoading) return <div className="road-page">Cargando…</div>
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (isRh || (admin && !isSuperAdmin)) return <Navigate to="/admin" replace />
  return <main className="road-page"><div className="road-hub">
    {!admin && <Link to="/dashboard" className="road-muted">← Volver al inicio</Link>}
    <span className="road-eyebrow block mt-6">LEARNING LAB / JUEGOS DE ESTUDIO</span>
    <h1>Zona de juegos</h1>
    <p>{admin ? 'Crea recorridos de estudio: cada pregunta se convierte en un semáforo. Define las respuestas y sus explicaciones, prueba el juego y publícalo para tus aprendices.' : 'Pon en marcha lo que sabes. Recorre la ciudad, resuelve las preguntas y convierte cada semáforo rojo en una nueva oportunidad de aprender.'}</p>
    {admin && <button className="road-primary" onClick={() => setEditing(null)}><Plus size={18} /> Crear juego de autos</button>}
    {error && <div className="road-error" role="alert">{error} <button onClick={() => void load()}>Reintentar</button></div>}
    {loading ? <p role="status">Cargando recorridos…</p> : games.length === 0 ? <div className="road-empty"><Car size={40} className="mb-4" />{admin ? 'Tu primer circuito empieza aquí. Crea un juego con las preguntas del tema que quieras enseñar.' : 'Todavía no hay recorridos publicados disponibles para ti.'}</div> : <div className="road-game-grid">{games.map(game => <article key={game.id} className="road-card">
      <div className="flex justify-between items-center"><Car size={30} color="#52f0ca" /><span className="road-pill">{admin && game.status === 'draft' ? 'BORRADOR' : 'LISTO PARA JUGAR'}</span></div>
      <h2>{game.title}</h2><p>{stripMarkdown(game.description) || 'Un viaje para aprender, pregunta a pregunta.'}</p>
      <p className="road-muted">{game.steps.length} semáforos · Ciudad 3D · Sin límite de tiempo</p>
      <Link className="road-primary" to={'/games/drive/' + game.id}>{admin ? 'Probar recorrido' : 'Jugar ahora'} <ArrowRight size={17} /></Link>
      {admin && <div className="road-card-actions"><button onClick={() => setEditing(game)}><Pencil size={14} className="inline mr-1" /> Editar preguntas</button><button disabled={!!busy} onClick={() => void publish(game)}><Eye size={14} className="inline mr-1" />{busy === game.id ? 'Guardando…' : game.status === 'published' ? 'Despublicar' : 'Publicar'}</button></div>}
    </article>)}</div>}
    {admin && <p className="road-muted">Los borradores solo se pueden probar desde superadmin. Al publicar, el juego aparece en Juegos para los usuarios con acceso al contenido. Las partidas son prácticas y no modifican notas ni XP.</p>}
  </div>{editing !== undefined && <Suspense fallback={<div role="status">Abriendo editor…</div>}><Editor driving editing={editing} defaultCampaignId={creationCampaignId} crumb="Zona de juegos · Un semáforo por pregunta" onClose={() => setEditing(undefined)} onSaved={() => void load()} /></Suspense>}</main>
}
