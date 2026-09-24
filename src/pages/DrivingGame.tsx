import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Flag, RotateCcw, ArrowRight, Pause, Play, Camera, Volume2, VolumeX, Maximize, Route, Gauge, Settings2, Trophy, Lightbulb, ChevronLeft, ChevronRight, Navigation, Check, TriangleAlert } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { RichText, RichTextInline } from '@/components/ui/RichText'
import { DRIVING_ICON, validRoadQuestions, shuffledQuestions, type RoadQuestion } from '@/components/games/drivingModel'
import '@/components/games/driving.css'
import { useDrivingAudio } from '@/components/games/useDrivingAudio'
import type { DriveInput, DriveMode, Incident, RoadCamera, Telemetry } from '@/components/games/DrivingScene'
import type { Ending } from '@/components/games/drivingWorld'
import { LEVEL_LABEL, DEFAULT_PASS_PCT, isLevel, routeOf, unlockedIds, passedGames, saveDrivingResult } from '@/services/drivingLevels.service'
const DrivingScene = lazy(() => import('@/components/games/DrivingScene'))
type Phase = 'ready' | 'question' | 'correct' | 'driving' | 'exit' | 'ending' | 'done'
/** El final depende de los aciertos a la primera: túnel (≥ 80 %), puente (≥ 50 %) o precipicio. */
const ENDINGS: Record<Ending, { title: string; caption: string; text: string }> = {
  tunnel: { title: '¡Directo al túnel express!', caption: 'RUTA EXPRESS', text: 'Dominaste el recorrido: tomaste el atajo por la montaña.' },
  bridge: { title: 'Cruzaste el puente', caption: 'RUTA PANORÁMICA', text: 'Buen trabajo. Con un repaso más llegarás por el túnel express.' },
  cliff: { title: '¡Al precipicio!', caption: 'SIN FRENOS', text: 'Esta vez el camino terminó en el abismo. Repasa y vuelve a intentarlo.' },
}
/** Nivel de una ruta por curso: se supera con passPct y desbloquea el siguiente. */
interface LevelInfo { label: string; passPct: number; next: { id: string; label: string } | null; save: (score: number, total: number, passed: boolean) => Promise<void> }
interface Game { title: string; steps: RoadQuestion[]; level: LevelInfo | null }
export default function DrivingGame() {
  const { id } = useParams()
  const { user, isAuthenticated, loading, isSuperAdmin, isRh } = useAuth()
  const userId = user?.id
  const [game, setGame] = useState<Game | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!isAuthenticated || !id) return
    let alive = true
    setGame(null); setError('')
    let query = supabase.from('arena_quizzes').select('title,steps,status,campaign_id,course_id,level,min_score_pct').eq('id', id).eq('theme_icon', DRIVING_ICON).is('deleted_at', null)
    if (!isSuperAdmin) query = query.eq('status', 'published')
    void (async () => {
      const { data, error: failure } = await query.single()
      if (!alive) return
      if (failure || !data) { setError('Este juego no está disponible o no tienes acceso.'); return }
      const steps = data.steps as unknown as RoadQuestion[]
      if (!Array.isArray(steps) || !validRoadQuestions(steps)) { setError('Este recorrido necesita preguntas completas. Pide al superadmin que lo revise.'); return }
      let level: LevelInfo | null = null
      if (data.course_id && isLevel(data.level)) {
        // Los niveles de la ruta que ve este usuario: los publicados (el superadmin prueba también borradores).
        let siblings = supabase.from('arena_quizzes').select('id,course_id,level,status').eq('course_id', data.course_id).eq('theme_icon', DRIVING_ICON).is('world_id', null).is('deleted_at', null)
        if (!isSuperAdmin) siblings = siblings.eq('status', 'published')
        const { data: rows } = await siblings
        const route = routeOf(rows ?? [], data.course_id)
        const passed = userId ? await passedGames(userId, route.map(g => g.id)).catch(() => new Set<string>()) : new Set<string>()
        if (!alive) return
        const position = route.findIndex(g => g.id === id)
        if (!isSuperAdmin && !unlockedIds(route, passed).has(id)) {
          const previous = route[position - 1]
          setError('Este nivel está bloqueado. Supera ' + (previous && isLevel(previous.level) ? 'el nivel ' + LEVEL_LABEL[previous.level] : 'el nivel anterior') + ' para desbloquearlo.'); return
        }
        const after = route[position + 1]
        const quizId = id, campaignId = data.campaign_id
        level = {
          label: LEVEL_LABEL[data.level], passPct: data.min_score_pct ?? DEFAULT_PASS_PCT,
          next: after && isLevel(after.level) ? { id: after.id, label: LEVEL_LABEL[after.level] } : null,
          // Las pruebas del superadmin no cuentan como progreso.
          save: (score, total, ok) => isSuperAdmin || !userId ? Promise.resolve() : saveDrivingResult({ userId, quizId, campaignId, score, total, passed: ok }),
        }
      }
      setGame({ title: data.title, steps, level })
    })().catch(() => { if (alive) setError('No se pudo cargar el juego. Comprueba tu conexión y vuelve a entrar.') })
    return () => { alive = false }
  }, [id, isAuthenticated, isSuperAdmin, userId])
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
  // Una sola oportunidad por semáforo, como los quizzes del curso: se responde una vez y
  // la correcta solo se revela después de responder.
  const [lastRight, setLastRight] = useState(true)
  const [incidents, setIncidents] = useState<Record<Incident, number>>({ pedestrian: 0, crash: 0, redLight: 0 })
  const [toast, setToast] = useState<{ kind: Incident; at: number } | null>(null)
  const [feedback, setFeedback] = useState('')
  // El panel es de juego: una vista a la vez y nunca scroll. Fallar, pedir pista
  // o repasar reemplazan el contenido en lugar de apilarlo debajo.
  const [view, setView] = useState<'options' | 'hint'>('options')
  const [reviewPage, setReviewPage] = useState(-1)
  // El panel vive dentro de la escena 3D, que carga diferida: se guarda en estado
  // para que el ajuste corra cuando el panel aparece, no solo al montar la página.
  const [boardEl, setBoardEl] = useState<HTMLElement | null>(null)
  const [missed, setMissed] = useState<number[]>([])
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [cameraMode, setCameraMode] = useState<RoadCamera>('chase')
  const [quality, setQuality] = useState<'detailed' | 'performance'>(() => window.matchMedia('(max-width: 700px)').matches ? 'performance' : 'detailed')
  const [speed, setSpeed] = useState(0)
  const [toLight, setToLight] = useState<number | null>(null)
  const [bearing, setBearing] = useState(0)
  // Tú conduces: teclado y pedales táctiles escriben aquí y la escena lo lee en cada cuadro.
  const input = useRef<DriveInput>({ throttle: false, brake: false, steer: 0 })
  const [runId, setRunId] = useState(0)
  const crossed = useRef(-1)
  const viewport = useRef<HTMLElement>(null)
  const [screenError, setScreenError] = useState('')
  const sound = useDrivingAudio(speed, paused, input)
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
  const allAnswered = phase === 'done' || phase === 'exit' || phase === 'ending'
  const firstTryCorrect = completedFirstTry()
  function completedFirstTry() {
    const resolved = allAnswered ? steps.length : index + (phase === 'correct' ? 1 : 0)
    return Math.max(0, resolved - missed.filter(questionIndex => questionIndex < resolved).length)
  }
  const completed = allAnswered ? steps.length : index + (phase === 'correct' ? 1 : 0)
  const drive: DriveMode = phase === 'driving' ? 'roam' : phase === 'correct' ? 'green' : phase === 'ending' ? 'ending' : phase === 'done' ? 'finish' : 'idle'
  // Tras la última pregunta no se maneja hasta la meta: un salto lleva directo a la película final.
  const lastLight = index + 1 === steps.length
  const behindWheel = (phase === 'driving' || (phase === 'correct' && !lastLight)) && !paused
  function goFinish() { setPhase(value => value === 'correct' ? 'ending' : value) }
  const score = (steps.length - missed.length) / steps.length
  const ending: Ending = score >= .8 ? 'tunnel' : score >= .5 ? 'bridge' : 'cliff'
  // Llegar al semáforo en rojo abre su pregunta; cruzarlo en verde lleva al siguiente.
  function arrive() { setPhase(value => value === 'driving' ? 'question' : value) }
  function cross() {
    // Un semáforo se cruza una sola vez aunque lleguen dos avisos seguidos.
    if (phase !== 'correct' || crossed.current === index) return
    crossed.current = index
    if (index + 1 >= steps.length) { setPhase('ending'); return }
    setIndex(i => i + 1); setFeedback(''); setView('options'); setPhase('driving')
  }
  // Tras la última pregunta se va a la salida; ahí empieza la película final.
  function endingDone() { setPhase(value => value === 'ending' ? 'done' : value) }
  const levelPct = Math.round((steps.length - missed.length) / steps.length * 100)
  const levelPassed = !!game.level && levelPct >= game.level.passPct
  const [saveFailed, setSaveFailed] = useState(false)
  const saved = useRef(-1)
  useEffect(() => {
    if (phase !== 'done' || !game.level || saved.current === runId) return
    saved.current = runId
    game.level.save(steps.length - missed.length, steps.length, levelPassed).then(() => setSaveFailed(false), () => setSaveFailed(true))
  }, [phase, runId, game.level, steps.length, missed.length, levelPassed])
  function telemetry(t: Telemetry) { setSpeed(t.kmh); setToLight(t.meters); setBearing(t.bearing) }
  useEffect(() => { if (!behindWheel) input.current = { throttle: false, brake: false, steer: 0 } }, [behindWheel])
  useEffect(() => {
    const onVisibility = () => { if (document.hidden) setPaused(true) }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  function answer(optionId: string) {
    if (phase !== 'question' || paused) return
    const option = current.options.find(o => o.id === optionId)
    if (!option) return
    sound.cue(option.correct)
    setLastRight(option.correct)
    if (!option.correct) setMissed(previous => previous.includes(index) ? previous : [...previous, index])
    setFeedback(option.explanation || (option.correct ? '¡Bien hecho!' : ''))
    // Acierto o no, el semáforo se pone en verde y el recorrido sigue: no hay segundo intento.
    setPhase('correct')
  }
  useEffect(() => {
    const pedal = (event: KeyboardEvent, down: boolean) => {
      const key = event.key.toLowerCase()
      const controls = input.current
      if (key === 'w' || key === 'arrowup') controls.throttle = down
      else if (key === 's' || key === 'arrowdown' || key === ' ') controls.brake = down
      else if (key === 'a' || key === 'arrowleft') controls.steer = down ? -1 : controls.steer < 0 ? 0 : controls.steer
      else if (key === 'd' || key === 'arrowright') controls.steer = down ? 1 : controls.steer > 0 ? 0 : controls.steer
      else return false
      event.preventDefault()
      return true
    }
    const release = (event: KeyboardEvent) => { pedal(event, false) }
    const keyboard = (event: KeyboardEvent) => {
      sound.wake()
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable=true]')) return
      // En la pantalla de inicio, acelerar (o Enter) también arranca: W no puede quedar muerto.
      const startKey = event.key.toLowerCase()
      if (phase === 'ready' && !paused && ['w', 'arrowup', 'enter'].includes(startKey)) {
        event.preventDefault()
        if (startKey !== 'enter') input.current.throttle = true
        sound.autoStart()
        setPhase('driving')
        return
      }
      if (phase === 'correct' && lastLight && !paused && ['w', 'arrowup', 'enter'].includes(startKey)) { event.preventDefault(); goFinish(); return }
      if (behindWheel && pedal(event, true)) return
      if (event.repeat) return
      const key = event.key.toLowerCase()
      if (key === 'p') { event.preventDefault(); setPaused(value => !value) }
      else if (key === 'c') { event.preventDefault(); setCameraMode(value => value === 'chase' ? 'hood' : 'chase') }
      else if (/^[1-4]$/.test(key) && phase === 'question' && view === 'options' && !paused) {
        const option = current.options[Number(key) - 1]
        if (option) { event.preventDefault(); answer(option.id) }
      }
    }
    window.addEventListener('keydown', keyboard)
    window.addEventListener('keyup', release)
    return () => { window.removeEventListener('keydown', keyboard); window.removeEventListener('keyup', release) }
  })
  function reportIncident(kind: Incident) {
    if (kind !== 'redLight') sound.fx(kind === 'pedestrian' ? 'pedestrian' : 'crash')
    setIncidents(previous => ({ ...previous, [kind]: previous[kind] + 1 }))
    setToast({ kind, at: Date.now() })
  }
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])
  function restart() { setSteps(shuffledQuestions(game.steps)); setIndex(0); setFeedback(''); setIncidents({ pedestrian: 0, crash: 0, redLight: 0 }); setToast(null); setMissed([]); setView('options'); setReviewPage(-1); setPaused(false); setRunId(n => n + 1); crossed.current = -1; setPhase('ready') }
  /** Pedal de pantalla: mantener presionado = pisar. Sirve con mouse y con el dedo. */
  function hold(press: (controls: DriveInput) => void, lift: (controls: DriveInput) => void) {
    const up = () => lift(input.current)
    return {
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); press(input.current) },
      onPointerUp: up, onPointerCancel: up, onLostPointerCapture: up,
      onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
    }
  }
  useFitBoard(boardEl, [phase, view, index, paused, reviewPage, feedback])
  const reviewed = reviewPage >= 0 ? steps[missed[reviewPage]] : null
  const reviewedAnswer = reviewed?.options.find(o => o.correct)
  const board = (
      <section ref={setBoardEl} className="road-panel road-hologram" aria-label="Panel del semáforo"><div className="road-fit">
        <span className="road-eyebrow">TU MISIÓN / APRENDE Y AVANZA</span><h1>{game.title}</h1>
        <div className="road-route-checkpoints" aria-label="Paradas del recorrido">{steps.length <= 16 ? steps.map((step, i) => <span key={step.id} className={i < completed ? 'completed' : i === index && phase !== 'done' ? 'current' : ''} aria-label={'Parada ' + (i + 1) + (i < completed ? ', superada' : i === index ? ', actual' : ', pendiente')}>{i < completed ? '✓' : i + 1}</span>) : <span className="road-route-count">{completed} de {steps.length} paradas completadas</span>}</div>
        <div className="road-progress" role="progressbar" aria-label="Semáforos completados" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={steps.length}><div style={{ width: completed / steps.length * 100 + '%' }} /></div>
        {paused ? <div className="road-intro"><h2>Una pausa en el camino</h2><p>Tu recorrido sigue aquí.</p><button className="road-primary" onClick={() => setPaused(false)}>Continuar jugando <Play size={18} /></button></div>
        : phase === 'ready' ? <div className="road-intro"><h2>Tú conduces. Cada semáforo es una pregunta.</h2><p>Recorre la ciudad hasta la columna de luz verde: ese semáforo está en rojo y al detenerte aparece la pregunta. Al final, tus aciertos deciden tu salida: túnel, puente… o precipicio.</p><p className="road-drive-keys"><span><kbd>W</kbd><kbd>↑</kbd> acelerar</span><span><kbd>S</kbd><kbd>↓</kbd> frenar o reversa</span><span><kbd>A</kbd><kbd>D</kbd> girar</span></p><p className="road-rule"><TriangleAlert size={15} /> Una sola oportunidad por semáforo, como en los quizzes del curso. Respeta a los peatones y los semáforos: las infracciones quedan en tu resumen.</p><p className="road-muted">{steps.length} {steps.length === 1 ? 'semáforo' : 'semáforos'} · Sin límite de tiempo · No afecta tus notas</p><button className="road-primary" onClick={() => { sound.autoStart(); setPhase('driving') }}>Comenzar recorrido <ArrowRight size={19} /></button><p className="road-muted text-center">o pulsa <kbd>W</kbd> para arrancar</p></div>
        : phase === 'done' ? (reviewed ? <div className="road-intro">
            <div className="road-question-label">REPASO {reviewPage + 1} DE {missed.length}</div>
            <div className="road-question"><RichText text={reviewed.question} /></div>
            <div className="road-feedback success"><strong>Respuesta correcta: <RichTextInline text={reviewedAnswer?.text ?? ''} inertLinks /></strong>{reviewedAnswer?.explanation && <RichText text={reviewedAnswer.explanation} />}</div>
            <div className="road-actions">
              <button className="road-secondary" onClick={() => setReviewPage(page => page - 1)}><ArrowLeft size={16} /> {reviewPage === 0 ? 'Resumen' : 'Anterior'}</button>
              {reviewPage + 1 < missed.length ? <button className="road-primary" onClick={() => setReviewPage(page => page + 1)}>Siguiente <ArrowRight size={17} /></button> : <button className="road-primary" onClick={restart}><RotateCcw size={17} /> Volver a practicar</button>}
            </div>
          </div> : <div className="road-intro road-summary"><Flag size={26} color={ending === 'cliff' ? '#ff5b77' : '#10D451'} /><span className="road-eyebrow block mt-3">{ENDINGS[ending].caption}</span><h2>{ENDINGS[ending].title}</h2><p>{ENDINGS[ending].text}</p>
            <div className="road-result"><strong>{Math.round((steps.length - missed.length) / steps.length * 100)}%</strong><span>de aciertos en {steps.length} {steps.length === 1 ? 'semáforo' : 'semáforos'}</span></div>
            {game.level && <div className={'road-level-result' + (levelPassed ? ' is-passed' : '')} role="status">
              <strong>{levelPassed ? 'Nivel ' + game.level.label + ' superado' : 'Nivel ' + game.level.label + ': necesitas ' + game.level.passPct + ' %'}</strong>
              <span>{levelPassed ? (game.level.next ? 'Desbloqueaste el nivel ' + game.level.next.label + '.' : 'Completaste la ruta de este curso.') : game.level.next ? 'Llega al ' + game.level.passPct + ' % para desbloquear el nivel ' + game.level.next.label + '.' : 'Llega al ' + game.level.passPct + ' % para completar la ruta.'}</span>
              {saveFailed && <span>No se pudo guardar tu avance. Revisa tu conexión y vuelve a jugar.</span>}
              {levelPassed && game.level.next && <Link className="road-primary" to={'/games/drive/' + game.level.next.id}>Ir al nivel {game.level.next.label} <ArrowRight size={17} /></Link>}
            </div>}
            <p className="road-driving-summary">{incidents.pedestrian + incidents.crash + incidents.redLight === 0 ? 'Conducción impecable: sin infracciones.' : 'Conducción: ' + [incidents.pedestrian && incidents.pedestrian + (incidents.pedestrian === 1 ? ' peatón atropellado' : ' peatones atropellados'), incidents.crash && incidents.crash + (incidents.crash === 1 ? ' choque' : ' choques'), incidents.redLight && incidents.redLight + (incidents.redLight === 1 ? ' semáforo en rojo' : ' semáforos en rojo')].filter(Boolean).join(' · ')}</p>
            {missed.length > 0 ? <><p>{missed.length === 1 ? 'Fallaste 1 pregunta: repásala con su explicación.' : 'Fallaste ' + missed.length + ' preguntas: repásalas con su explicación.'}</p><div className="road-actions"><button className="road-secondary" onClick={restart}><RotateCcw size={16} /> Jugar otra vez</button><button className="road-primary" onClick={() => setReviewPage(0)}>Repasar <ArrowRight size={17} /></button></div></>
              : <><p>¡Respondiste bien todas las preguntas!</p><button className="road-primary" onClick={restart}><RotateCcw size={18} /> Volver a practicar</button></>}
          </div>)
        : phase === 'driving' || phase === 'exit' || phase === 'ending' ? <div className="road-intro" role="status"><h2>{phase === 'driving' ? 'Rumbo al semáforo ' + (index + 1) : 'Rumbo a la salida'}</h2><p>Sigue la flecha y la columna de luz verde.</p></div>
        : <>
          <div className="road-question-label">SEMÁFORO {index + 1} <span className={phase === 'correct' ? (lastRight ? '' : 'is-red') : view === 'hint' ? '' : 'is-red'}>{phase === 'correct' ? (lastRight ? 'CORRECTO' : 'INCORRECTO') : view === 'hint' ? 'PISTA' : 'UNA OPORTUNIDAD'}</span></div>
          {phase === 'correct' ? <>
            {lastRight ? <div className="road-feedback success" role="status"><strong>¡Correcto! Luz verde.</strong>
                <div className="road-reveal"><Check size={16} /><span>La respuesta es:</span> <RichTextInline text={current.options.find(o => o.correct)?.text ?? ''} inertLinks /></div>
                <RichText text={feedback} /></div>
            : <div className="road-feedback is-miss" role="status"><strong>Incorrecto: esta pregunta cuenta como fallada.</strong>{feedback && <RichText text={feedback} />}
                <div className="road-reveal"><Check size={16} /><span>Era esta:</span> <RichTextInline text={current.options.find(o => o.correct)?.text ?? ''} inertLinks /></div>
                {current.options.find(o => o.correct)?.explanation && <RichText text={current.options.find(o => o.correct)?.explanation ?? ''} />}</div>}
            {lastLight ? <><button className="road-primary road-finish" onClick={goFinish}>Ir a la meta <ArrowRight size={18} /></button><p className="road-muted text-center">o pulsa <kbd>W</kbd> · tus respuestas deciden el final</p></>
              : <p className="road-go">Acelera y busca el siguiente semáforo <span><kbd>W</kbd> o <kbd>↑</kbd></span></p>}
          </> : view === 'hint' && current.context ? <>
            <div className="road-feedback road-hint-card"><strong><Lightbulb size={15} className="inline mr-1" />Pista</strong><RichText text={current.context} /></div>
            <button className="road-primary" onClick={() => setView('options')}><ArrowLeft size={17} /> Volver a las opciones</button>
          </> : <>
            <div className="road-question"><RichText text={current.question} /></div>
            <div className="road-options">{current.options.map((o, i) => <button key={o.id} onClick={() => answer(o.id)}><b>{String.fromCharCode(65 + i)}</b><RichTextInline text={o.text} inertLinks /></button>)}</div>
            {current.context && <button className="road-link" onClick={() => setView('hint')}><Lightbulb size={14} /> Necesito una pista</button>}
          </>}
        </>}
      </div></section>
  )
  const cinematic = phase === 'ending'
  return <main ref={viewport} className={'road-page road-game' + (cinematic ? ' is-cinematic' : '')}>
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
        <Suspense fallback={<div className="road-scene">Preparando ciudad 3D…</div>}><DrivingScene drive={drive} input={input} runId={runId} ending={ending} onArrive={arrive} onPassed={cross} onEndingDone={endingDone} onIncident={reportIncident} onCue={sound.fx} paused={paused} cameraMode={cameraMode} quality={quality} onTelemetry={telemetry} green={phase === 'correct'} reduced={reduced} showBoard={!(phase === 'driving' || phase === 'exit' || phase === 'ending') || paused} focus={phase === 'question' || phase === 'correct'} centered={phase === 'ready' && !paused}>{board}</DrivingScene></Suspense>
        <div className="road-scene-top"><span className="road-pill">DISTRITO CENTRAL · 25 CRUCES</span><span className="road-pill-group"><span className="road-pill road-record-pill" aria-label={firstTryCorrect + ' aciertos a la primera'}><Trophy size={11} /> {firstTryCorrect} aciertos a la primera</span><span className="road-pill">{completed} / {steps.length} semáforos</span></span></div>
        <div className="road-cinematic-shade" />
        {(phase === 'driving' || phase === 'exit') && !paused && speed === 0 && <div className="road-driving-message" role="status"><span>{phase === 'exit' ? 'ÚLTIMA ETAPA' : 'SEMÁFORO ' + (index + 1) + ' DE ' + steps.length}</span><strong>{phase === 'exit' ? 'Ve a la salida de la ciudad' : 'Busca la columna de luz verde'}</strong><p><kbd>W</kbd> acelera · <kbd>A</kbd>/<kbd>D</kbd> gira · en el celular, usa los pedales</p></div>}
        {toast && <div key={toast.at} className="road-incident" role="alert"><TriangleAlert size={18} />{toast.kind === 'pedestrian' ? '¡Atropellaste a un peatón! Frena cuando crucen.' : toast.kind === 'redLight' ? 'Te pasaste un semáforo en rojo.' : '¡Choque! Maneja con más cuidado.'}</div>}
        {cinematic && <div className={'road-ending-caption is-' + ending} role="status"><span>{ENDINGS[ending].caption}</span><strong>{ENDINGS[ending].title}</strong></div>}
        <div className="road-look-hint"><kbd>W</kbd>/<kbd>S</kbd> acelerar y frenar · <kbd>A</kbd>/<kbd>D</kbd> girar · <kbd>1</kbd>–<kbd>4</kbd> responder · <kbd>C</kbd> cámara · <kbd>P</kbd> pausa</div>
        
        <div className="road-navigation" aria-label="Ruta del recorrido"><Route size={24} /><div><small>{phase === 'done' ? 'RECORRIDO COMPLETADO' : phase === 'exit' ? 'SALIDA DE LA CIUDAD' : phase === 'correct' ? 'LUZ VERDE · CRUZA' : 'SEMÁFORO ' + (index + 1) + ' DE ' + steps.length}</small><strong>{phase === 'done' ? 'Has llegado' : (phase === 'driving' || phase === 'exit') && toLight !== null ? 'A ' + toLight + ' m' : phase === 'correct' ? 'Acelera' : 'En el semáforo'}</strong></div>{(phase === 'driving' || phase === 'exit') && toLight !== null ? <Navigation size={24} className="road-compass" style={{ transform: 'rotate(' + (bearing - 45) + 'deg)' }} aria-label={'Dirección: ' + (Math.abs(bearing) < 25 ? 'recto' : bearing > 0 ? 'a la derecha' : 'a la izquierda')} /> : <span>{phase === 'done' ? 'META' : '↑'}</span>}</div>
        {behindWheel && <div className="road-pedals" aria-label="Controles de manejo">
          <button type="button" aria-label="Girar a la izquierda" {...hold(c => { c.steer = -1 }, c => { if (c.steer < 0) c.steer = 0 })}><ChevronLeft size={22} /></button>
          <button type="button" aria-label="Girar a la derecha" {...hold(c => { c.steer = 1 }, c => { if (c.steer > 0) c.steer = 0 })}><ChevronRight size={22} /></button>
          <button type="button" className="road-pedal-brake" {...hold(c => { c.brake = true }, c => { c.brake = false })}>Frenar</button>
          <button type="button" className="road-pedal-gas" {...hold(c => { c.throttle = true }, c => { c.throttle = false })}>Acelerar</button>
        </div>}
        <div className="road-dashboard"><div className="road-speedometer"><Gauge size={18} /><div><small>VELOCIDAD</small><strong>{String(speed).padStart(2, '0')} <em>km/h</em></strong></div></div><div className="road-signal"><i className={phase === 'question' || phase === 'ready' ? 'red' : 'green'} /><span>{paused ? 'En pausa' : phase === 'driving' ? 'Busca el semáforo' : phase === 'exit' ? 'Rumbo a la salida' : phase === 'correct' ? 'Vía libre' : phase === 'done' || phase === 'ending' ? 'Meta alcanzada' : 'Responde para avanzar'}</span></div><button aria-label={paused ? 'Reanudar recorrido' : 'Pausar recorrido'} onClick={() => setPaused(p => !p)}>{paused ? <Play size={20} /> : <Pause size={20} />}</button></div>
      </section>

    </div>
  </main>
}

/** Encoge el contenido del panel (zoom) hasta que quepa: el panel de juego no hace
 * scroll. Solo si ni al 60 % cabe se deja desplazar, como último recurso. */
function useFitBoard(el: HTMLElement | null, deps: unknown[]) {
  useLayoutEffect(() => {
    if (!el) return
    let frame = 0
    const fit = () => {
      let zoom = 1
      el.style.setProperty('--fit', '1')
      while (el.scrollHeight > el.clientHeight + 1 && zoom > .6) { zoom = Math.round((zoom - .05) * 100) / 100; el.style.setProperty('--fit', String(zoom)) }
      el.classList.toggle('is-overflowing', el.scrollHeight > el.clientHeight + 1)
    }
    const refit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit) }
    fit()
    // Se mira también el contenido: cuando termina de cargar la fuente el texto
    // crece, pero la caja ya estaba en su alto máximo y por sí sola no avisaba.
    const observer = new ResizeObserver(refit)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    let alive = true
    void document.fonts?.ready.then(() => { if (alive) refit() })
    return () => { alive = false; observer.disconnect(); cancelAnimationFrame(frame) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, ...deps])
}
