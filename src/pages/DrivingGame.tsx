import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Flag, RotateCcw, ArrowRight, Pause, Play, Camera, Volume2, VolumeX, Maximize, Route, Gauge, Settings2, Trophy } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { RichText, RichTextInline } from '@/components/ui/RichText'
import { DRIVING_ICON, validRoadQuestions, shuffledQuestions, type RoadQuestion } from '@/components/games/drivingModel'
import '@/components/games/driving.css'
import { useDrivingAudio } from '@/components/games/useDrivingAudio'
import type { RoadCamera } from '@/components/games/DrivingScene'
const DrivingScene = lazy(() => import('@/components/games/DrivingScene'))
type Phase = 'ready' | 'question' | 'correct' | 'driving' | 'done'
interface Game { title: string; steps: RoadQuestion[] }
export default function DrivingGame() {
  const { id } = useParams()
  const { isAuthenticated, loading, isSuperAdmin, isRh } = useAuth()
  const [game, setGame] = useState<Game | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!isAuthenticated || !id) return
    let alive = true
    setGame(null); setError('')
    let query = supabase.from('arena_quizzes').select('title,steps,status').eq('id', id).eq('theme_icon', DRIVING_ICON)
    if (!isSuperAdmin) query = query.eq('status', 'published')
    void Promise.resolve(query.single()).then(({ data, error: failure }) => {
      if (!alive) return
      if (failure || !data) { setError('Este juego no está disponible o no tienes acceso.'); return }
      const steps = data.steps as unknown as RoadQuestion[]
      if (!Array.isArray(steps) || !validRoadQuestions(steps)) { setError('Este recorrido necesita preguntas completas. Pide al superadmin que lo revise.'); return }
      setGame({ title: data.title, steps })
    }).catch(() => { if (alive) setError('No se pudo cargar el juego. Comprueba tu conexión y vuelve a entrar.') })
    return () => { alive = false }
  }, [id, isAuthenticated, isSuperAdmin])
  if (loading) return <div className="road-page">Cargando…</div>
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (isRh) return <Navigate to="/admin" replace />
  const back = isSuperAdmin ? '/admin/games' : '/games'
  if (error) return <div className="road-page"><p role="alert">{error}</p><Link to={back}>Volver a juegos</Link></div>
  if (!game) return <div className="road-page">Preparando el recorrido…</div>
  return <Run key={id} game={game} back={back} />
}
function Run({ game, back }: { game: Game; back: string }) {
  const [steps, setSteps] = useState(() => shuffledQuestions(game.steps))
  const [phase, setPhase] = useState<Phase>('ready')
  const [index, setIndex] = useState(0)
  const [wrong, setWrong] = useState<string[]>([])
  const [feedback, setFeedback] = useState('')
  const [missed, setMissed] = useState<number[]>([])
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [cameraMode, setCameraMode] = useState<RoadCamera>('chase')
  const [quality, setQuality] = useState<'detailed' | 'performance'>(() => window.matchMedia('(max-width: 700px)').matches ? 'performance' : 'detailed')
  const [speed, setSpeed] = useState(0)
  const viewport = useRef<HTMLElement>(null)
  const remainingDrive = useRef(2400)
  const [screenError, setScreenError] = useState('')
  const sound = useDrivingAudio(speed, paused)
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await viewport.current?.requestFullscreen()
    } catch { setScreenError('La pantalla completa no está disponible en este navegador.') }
  }
  useEffect(() => {
    document.documentElement.classList.add('road-immersive-active')
    return () => document.documentElement.classList.remove('road-immersive-active')
  }, [])
  const current = steps[index]
  const firstTryCorrect = completedFirstTry()
  function completedFirstTry() {
    const resolved = phase === 'done' ? steps.length : index + (phase === 'correct' || phase === 'driving' ? 1 : 0)
    return Math.max(0, resolved - missed.filter(questionIndex => questionIndex < resolved).length)
  }
  const completed = phase === 'done' ? steps.length : index
  useEffect(() => {
    if (phase !== 'driving') { remainingDrive.current = 2400; return }
    if (paused) return
    const started = performance.now()
    const timer = window.setTimeout(() => {
      if (index + 1 === steps.length) setPhase('done')
      else { setIndex(i => i + 1); setWrong([]); setFeedback(''); setPhase('question') }
    }, reduced ? 250 : remainingDrive.current)
    return () => { window.clearTimeout(timer); remainingDrive.current = Math.max(0, remainingDrive.current - (performance.now() - started)) }
  }, [phase, index, steps.length, paused, reduced])
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) setPaused(true) }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  function answer(optionId: string) {
    if (phase !== 'question' || paused || wrong.includes(optionId)) return
    const option = current.options.find(o => o.id === optionId)
    if (!option) return
    sound.cue(option.correct)
    if (option.correct) { setFeedback(option.explanation || '¡Bien hecho! Ya puedes avanzar al siguiente semáforo.'); setPhase('correct') }
    else {
      setWrong(previous => [...previous, optionId])
      setMissed(previous => previous.includes(index) ? previous : [...previous, index])
      setFeedback(option.explanation || current.context || 'Esta opción no resuelve la situación. Lee de nuevo la pregunta y prueba otra respuesta.')
    }
  }
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true]')) return
      const key = event.key.toLowerCase()
      if (key === 'p') { event.preventDefault(); setPaused(value => !value) }
      else if (key === 'c') { event.preventDefault(); setCameraMode(value => value === 'chase' ? 'hood' : 'chase') }
      else if (/^[1-4]$/.test(key) && phase === 'question' && !paused) {
        const option = current.options[Number(key) - 1]
        if (option) { event.preventDefault(); answer(option.id) }
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  })
  function restart() { setSteps(shuffledQuestions(game.steps)); setIndex(0); setWrong([]); setFeedback(''); setMissed([]); setPaused(false); setPhase('ready') }
  const board = (
      <section className="road-panel road-hologram" aria-label="Panel del semáforo">
        <span className="road-eyebrow">TU MISIÓN / APRENDE Y AVANZA</span><h1>{game.title}</h1>
        <div className="road-route-checkpoints" aria-label="Paradas del recorrido">{steps.length <= 16 ? steps.map((step, i) => <span key={step.id} className={i < completed ? 'completed' : i === index && phase !== 'done' ? 'current' : ''} aria-label={'Parada ' + (i + 1) + (i < completed ? ', superada' : i === index ? ', actual' : ', pendiente')}>{i < completed ? '✓' : i + 1}</span>) : <span className="road-route-count">{completed} de {steps.length} paradas completadas</span>}</div>
        <div className="road-progress" role="progressbar" aria-label="Semáforos completados" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={steps.length}><div style={{ width: completed / steps.length * 100 + '%' }} /></div>
        {paused ? <div className="road-intro"><h2>Una pausa en el camino</h2><p>Tu recorrido sigue aquí.</p><button className="road-primary" onClick={() => setPaused(false)}>Continuar jugando <Play size={18} /></button></div> : phase === 'ready' ? <div className="road-intro"><div className="road-big-icon"><Route size={36} strokeWidth={1.3} /></div><h2>Tu conocimiento abre el camino.</h2><p>Conducción automática, una pregunta en cada semáforo. Acierta para avanzar. Si fallas, lee la explicación y vuelve a intentarlo, sin límite de tiempo.</p><p className="road-muted">{steps.length} paradas · Práctica sin afectar tus notas</p><button className="road-primary" onClick={() => setPhase('question')}>Comenzar recorrido <ArrowRight size={19} /></button></div> : phase === 'done' ? <div className="road-intro"><Flag size={38} color="#52f0ca" /><h2>¡Llegaste a la meta!</h2><p>Superaste los {steps.length} semáforos.</p><div className="road-result"><strong>{Math.round((steps.length - missed.length) / steps.length * 100)}%</strong><span>de aciertos al primer intento</span></div>{missed.length > 0 ? <><h3>Para seguir estudiando</h3><ul className="road-review">{missed.map(i => <li key={steps[i].id}><RichText text={steps[i].question} /><p>{steps[i].options.find(o => o.correct)?.explanation || steps[i].options.find(o => o.correct)?.text}</p></li>)}</ul></> : <p>¡Todas las respuestas fueron correctas al primer intento!</p>}<button className="road-primary" onClick={restart}><RotateCcw size={18} /> Volver a practicar</button><p className="road-muted">Este resumen corresponde a esta partida.</p></div> : phase === 'driving' ? <div className="road-intro" role="status"><h2>¡Semáforo en verde!</h2><p>{index + 1 === steps.length ? 'Vas camino a la meta…' : 'Avanzando a la siguiente parada…'}</p></div> : <>
          <div className="road-question-label">SEMÁFORO {index + 1} <span>{phase === 'correct' ? 'RESUELTO' : 'EN ROJO'}</span></div>
          <div className="road-question"><RichText text={current.question} /></div>
          <div className="road-options">{current.options.map((o, i) => <button key={o.id} onClick={() => answer(o.id)} disabled={phase === 'correct' || wrong.includes(o.id)} className={phase === 'correct' && o.correct ? 'is-correct' : wrong.includes(o.id) ? 'is-wrong' : ''}><b>{String.fromCharCode(65 + i)}</b><RichTextInline text={o.text} inertLinks /></button>)}</div>
          {feedback && <div className={'road-feedback ' + (phase === 'correct' ? 'success' : '')} role="status"><strong>{phase === 'correct' ? '¡Correcto! Luz verde.' : 'Sigue en rojo. ¡Puedes intentarlo otra vez!'}</strong><RichText text={feedback} /></div>}
          {phase === 'correct' ? <button className="road-primary" onClick={() => setPhase('driving')}>{index + 1 === steps.length ? 'Conducir hasta la meta' : 'Continuar conduciendo'} <ArrowRight size={18} /></button> : current.context && <details className="road-hint"><summary>Necesito una pista</summary><RichText text={current.context} /></details>}
        </>}
        <div className="road-keyboard-hints"><span><kbd>1</kbd>–<kbd>4</kbd> Responder</span><span><kbd>C</kbd> Cámara</span><span><kbd>P</kbd> Pausa</span></div>
      </section>
  )
  return <main ref={viewport} className="road-page road-game">
    <header className="road-header"><Link to={back}><ArrowLeft size={17} /> Salir</Link><span className="road-brand">DRIVE / ACADEMY <small>EL CONOCIMIENTO TE LLEVA MÁS LEJOS</small></span><button onClick={() => setReduced(v => !v)} aria-pressed={reduced}>{reduced ? 'Movimiento reducido' : 'Reducir movimiento'}</button></header>
    <div className="road-toolbar">
      <div className="road-location"><span className="road-live-dot" /> DISTRITO CENTRAL <span> / GOLDEN HOUR</span></div>
      <div className="road-controls">
        <button onClick={() => setCameraMode(c => c === 'chase' ? 'hood' : 'chase')} aria-label="Cambiar cámara" aria-pressed={cameraMode === 'hood'}><Camera size={16} /> {cameraMode === 'hood' ? 'Capó' : 'Persecución'}</button>
        <button disabled={phase === 'driving'} onClick={() => setQuality(value => value === 'detailed' ? 'performance' : 'detailed')} aria-label={'Calidad gráfica: ' + (quality === 'detailed' ? 'Detallada' : 'Fluida')} title="Cambia la calidad cuando estés detenido"><Settings2 size={16} /> {quality === 'detailed' ? 'Detallada' : 'Fluida'}</button>
        <button onClick={sound.toggle} aria-label={sound.enabled ? 'Silenciar sonido' : 'Activar sonido'} aria-pressed={sound.enabled}>{sound.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />} Sonido</button>
        <button onClick={() => void fullscreen()} aria-label="Pantalla completa"><Maximize size={16} /></button>
      </div>
    </div>
    {(screenError || sound.unavailable) && <p role="status" className="road-muted">{screenError || 'El sonido no está disponible en este navegador.'}</p>}
    <div className="road-layout">
      <section className={"road-visual " + (phase === 'driving' && !paused ? 'is-driving' : '')}>
        <Suspense fallback={<div className="road-scene">Preparando ciudad 3D…</div>}><DrivingScene moving={phase === 'driving'} paused={paused} cameraMode={cameraMode} quality={quality} onSpeed={setSpeed} green={phase === 'correct' || phase === 'driving' || phase === 'done'} reduced={reduced} showBoard={phase !== 'driving' || paused}>{board}</DrivingScene></Suspense>
        <div className="road-scene-top"><span className="road-pill">RUTA 01 · BOULEVARD</span><span className="road-pill">{completed} / {steps.length} semáforos</span></div>
        <div className="road-cinematic-shade" />
        {phase === 'driving' && !paused && <div className="road-driving-message" role="status"><span>VÍA LIBRE</span><strong>{index + 1 === steps.length ? 'Camino a la meta' : 'Siguiente semáforo'}</strong><p>Tu conocimiento abre el camino.</p></div>}
        <div className="road-look-hint">Mueve el mouse para mirar alrededor</div>
        <div className="road-driver-record"><Trophy size={14} /><span>{firstTryCorrect} <small>ACIERTOS A LA PRIMERA</small></span></div>
        <div className="road-navigation" aria-label="Ruta del recorrido"><Route size={24} /><div><small>{phase === 'done' ? 'RECORRIDO COMPLETADO' : 'SIGUE RECTO'}</small><strong>{phase === 'done' ? 'Has llegado' : 'Semáforo ' + (index + 1)}</strong></div><span>{phase === 'done' ? 'META' : '↑'}</span></div>
        <div className="road-dashboard"><div className="road-speedometer"><Gauge size={18} /><div><small>VELOCIDAD</small><strong>{String(speed).padStart(2, '0')} <em>km/h</em></strong></div></div><div className="road-signal"><i className={phase === 'correct' || phase === 'driving' || phase === 'done' ? 'green' : 'red'} /><span>{paused ? 'En pausa' : phase === 'driving' ? '¡En camino!' : phase === 'correct' ? 'Vía libre' : phase === 'done' ? 'Meta alcanzada' : 'Responde para avanzar'}</span></div><button aria-label={paused ? 'Reanudar recorrido' : 'Pausar recorrido'} onClick={() => setPaused(p => !p)}>{paused ? <Play size={20} /> : <Pause size={20} />}</button></div>
      </section>

    </div>
  </main>
}
