import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ERGO_GUIDES } from './ergonomicsGuides'
import { SOUNDSCAPES, useErgoAmbience, type Soundscape } from './useErgoAmbience'
import { Maximize, Mic, MicOff, Minimize, Volume2, VolumeX, Activity, ArrowRight, Check, CheckCircle2, ChevronRight, Eye, Monitor, Move3D, Pause, Play, RotateCcw, Sparkles, Trophy, X } from 'lucide-react'
import ErgonomicsScene from './ErgonomicsScene'
import { useFloatingDockStore } from '@/stores/floatingDockStore'
import { ADJUSTMENTS, BREAKS, CHALLENGES, IDEAL, INITIAL, alignmentCount, isAligned, type ErgoKey, type ErgoSetup } from './ergonomicsModel'
import './ergonomics.css'

export default function ErgonomicsGame({ onClose }: { onClose: () => void }) {
  const [setup, setSetup] = useState<ErgoSetup>({ ...INITIAL })
  const [selected, setSelected] = useState<ErgoKey>('back')
  const [mode, setMode] = useState<'challenge' | 'explore' | 'break'>('challenge')
  const [round, setRound] = useState(0)
  const [solved, setSolved] = useState<number[]>([])
  const [feedback, setFeedback] = useState('')
  const [view, setView] = useState(0)
  const [reference, setReference] = useState(false)
  const [breakStep, setBreakStep] = useState(0)
  const [remaining, setRemaining] = useState(BREAKS[0].seconds)
  const [running, setRunning] = useState(false)
  const [breakDone, setBreakDone] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const root = useRef<HTMLElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const ambient = useErgoAmbience()
  const title = useRef<HTMLHeadingElement>(null)
  const secondsRef = useRef(remaining)
  const cue = useRef(ambient.cue)
  const say = useRef(ambient.say)
  const midSpoken = useRef(-1)
  useEffect(() => { cue.current = ambient.cue; say.current = ambient.say })
  const count = alignmentCount(setup)
  const rule = ADJUSTMENTS.find(a => a.key === selected)!
  const good = isAligned(selected, setup)
  const guide = ERGO_GUIDES[selected]
  const passed = solved.includes(round)
  const displayed = reference || mode === 'break' ? IDEAL : setup
  useEffect(() => {
    title.current?.focus({ preventScroll: true })
    title.current?.closest('section')?.scrollIntoView({ block: 'start', behavior: 'instant' })
    useFloatingDockStore.getState().setInlineGameActive(true)
    return () => useFloatingDockStore.getState().setInlineGameActive(false)
  }, [])
  useEffect(() => { secondsRef.current = remaining }, [remaining])
  useEffect(() => {
    const pauseHidden = () => { if (document.hidden) setRunning(false) }
    document.addEventListener('visibilitychange', pauseHidden)
    return () => document.removeEventListener('visibilitychange', pauseHidden)
  }, [])
  useEffect(() => {
    if (!running || mode !== 'break') return
    const end = Date.now() + secondsRef.current * 1000
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setRemaining(seconds)
      // The guide adds one gentle reminder halfway through each movement.
      if (seconds === 8 && midSpoken.current !== breakStep) { midSpoken.current = breakStep; say.current(`mid-${breakStep as 0 | 1 | 2 | 3}`) }
      if (!seconds) { setRunning(false); const last = breakStep === BREAKS.length - 1; if (last) setBreakDone(true); cue.current(last ? 'success' : 'step'); say.current(last ? 'done' : 'next', .9) }
    }, 250)
    return () => window.clearInterval(timer)
  }, [running, mode, breakStep])
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === root.current)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('fullscreenchange', sync); document.removeEventListener('keydown', escape) }
  }, [])
  useEffect(() => {
    if (!expanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const background = Array.from(document.body.children)
      .filter((el): el is HTMLElement => el instanceof HTMLElement && el !== root.current && !el.contains(root.current))
      .map(el => ({ el, inert: el.inert }))
    background.forEach(({ el }) => { el.inert = true })
    title.current?.focus({ preventScroll: true })
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const targets = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, a[href]') ?? []).filter(el => el.getClientRects().length > 0)
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === title.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trapFocus)
    return () => {
      document.body.style.overflow = previous
      background.forEach(({ el, inert }) => { el.inert = inert })
      document.removeEventListener('keydown', trapFocus)
      window.requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('[data-ergo-fullscreen]')?.focus({ preventScroll: true }))
    }
  }, [expanded])
  async function toggleFullscreen() {
    if (expanded) { setExpanded(false); return }
    if (document.fullscreenElement === root.current) { await document.exitFullscreen().catch(() => {}); return }
    try {
      if (!root.current?.requestFullscreen) { setExpanded(true); return }
      await root.current.requestFullscreen()
    } catch { setExpanded(true) }
  }
  async function closeGame() {
    if (document.fullscreenElement === root.current) await document.exitFullscreen().catch(() => {})
    onClose()
  }
  function change(key: ErgoKey, value: number) { setSetup(s => ({ ...s, [key]: value })); setReference(false); setFeedback('') }
  function switchMode(next: typeof mode) {
    setMode(next); setRunning(false); setReference(false); setFeedback('')
    if (next !== 'break') { ambient.hush(); return }
    ambient.preloadVoice()
    if (mode !== 'break' && !breakDone && breakStep === 0 && remaining === BREAKS[0].seconds) ambient.say('intro')
  }
  function toggleMovement() {
    if (running) { setRunning(false); ambient.hush(); return }
    if (remaining === BREAKS[breakStep].seconds) { midSpoken.current = -1; ambient.say(`step-${breakStep as 0 | 1 | 2 | 3}`) }
    setRunning(true)
  }
  function startRound(index: number) { setRound(index); setSetup({ ...CHALLENGES[index].setup }); setReference(false); setFeedback(''); setSelected('back') }
  function verify() {
    const issues = ADJUSTMENTS.filter(a => !isAligned(a.key, setup))
    if (issues.length) { setSelected(issues[0].key); setFeedback(`Quedan ${issues.length} ajustes. ${issues[0].issue}`); return }
    setSolved(prev => prev.includes(round) ? prev : [...prev, round]); ambient.cue('success'); setFeedback('¡Puesto equilibrado! Has resuelto este reto. Recuerda alternar posiciones durante el día.')
  }
  function restartBreak() { ambient.hush(); setBreakStep(0); setRemaining(BREAKS[0].seconds); setBreakDone(false); setRunning(false) }
  const content = <section ref={root} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} onPointerDown={ambient.unlock} onKeyDown={ambient.unlock} className={'ergo-game' + (expanded ? ' ergo-expanded' : '')} aria-label="Juego de ergonomía y pausa activa">
    <header className="ergo-header"><div><span className="ergo-eyebrow"><Activity size={14} /> LEARNING LAB · BIENESTAR</span><h2 ref={title} tabIndex={-1}>Un respiro para ti<span>.</span></h2><p>Ajusta tu espacio. Entiende tu postura. Vuelve con energía.</p></div><div className="ergo-toolbar">
      <div className="ergo-toolbar-buttons">
        <button className="ergo-tool" disabled={ambient.status === 'unavailable'} aria-pressed={ambient.enabled && ambient.status === 'playing'} onClick={ambient.toggle} aria-label={ambient.enabled && ambient.status === 'playing' ? 'Silenciar sonidos de naturaleza' : 'Activar sonidos de naturaleza'}>{ambient.enabled && ambient.status === 'playing' ? <span className="ergo-eq" aria-hidden="true"><i /><i /><i /></span> : ambient.enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}<span>{ambient.status === 'unavailable' ? 'Audio no disponible' : !ambient.enabled ? 'Sin sonido' : ambient.status === 'playing' ? 'Naturaleza' : ambient.status === 'loading' ? 'Cargando sonido…' : 'Activar sonido'}</span></button>
        <button className="ergo-tool" data-ergo-fullscreen onClick={() => void toggleFullscreen()} aria-label={fullscreen || expanded ? 'Salir de pantalla completa' : 'Pantalla completa'}>{fullscreen || expanded ? <Minimize size={18} /> : <Maximize size={18} />}<span>{fullscreen || expanded ? 'Reducir' : 'Pantalla completa'}</span></button>
        <button className="ergo-icon-button" onClick={() => void closeGame()} aria-label="Cerrar juego de pausa activa"><X size={20} /></button>
      </div>
      <div className="ergo-sound">
        <select className="ergo-scape" aria-label="Paisaje sonoro" value={ambient.scape} disabled={ambient.status === 'unavailable'} onChange={e => ambient.setScape(e.target.value as Soundscape)}>{SOUNDSCAPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <label className="ergo-volume">Volumen<input type="range" min="0" max="100" step="5" value={ambient.volume} disabled={ambient.status === 'unavailable'} onChange={e => ambient.setVolume(Number(e.target.value))} /><output>{ambient.volume}%</output></label>
      </div>
    </div></header>
    <nav className="ergo-tabs" aria-label="Modo de juego">{([{ id: 'challenge', label: '01 · Corrige el puesto', icon: Sparkles }, { id: 'explore', label: '02 · Explora en 3D', icon: Move3D }, { id: 'break', label: '03 · Pausa activa', icon: Activity }] as const).map(tab => <button key={tab.id} aria-pressed={mode === tab.id} onClick={() => switchMode(tab.id)} className={mode === tab.id ? 'active' : ''}><tab.icon size={17} />{tab.label}</button>)}</nav>
    <div className="ergo-workspace">
      <div className="ergo-stage">
        <ErgonomicsScene setup={displayed} selected={selected} onSelect={setSelected} view={view} breakStep={mode === 'break' ? breakStep : -1} moving={running} reduced={reduced} />
        <div className="ergo-stage-top"><span className="ergo-live"><span /> ESTUDIO 3D</span><span className="ergo-scene-label">{mode === 'break' ? 'Tu momento de bienestar' : reference ? 'Referencia · puesto ajustado' : 'Tu puesto · ajustes en vivo'}</span></div>
        {mode !== 'break' && <div className="ergo-scene-note" key={selected + String(good)}><span className={good ? '' : 'pending'}>{good ? <Check size={18} /> : ADJUSTMENTS.findIndex(a => a.key === selected) + 1}</span><div><strong>{rule.label}</strong><small>{reference ? 'Observa la referencia y vuelve a tu puesto.' : good ? 'Ajuste adecuado para este personaje' : 'Hay algo que puedes mejorar'}</small></div></div>}
        {mode === 'break' && <div className="ergo-scene-note" key={breakStep + String(breakDone)}><Activity size={25} /><div><strong>{breakDone ? 'Pausa completada' : BREAKS[breakStep].title}</strong><small>{reduced ? 'Demostración estática · movimiento reducido' : running ? 'Sigue el movimiento a tu ritmo' : 'Demostración en pausa'}</small></div></div>}
        {mode === 'break' ? <p className="ergo-orbit-hint">Cámara guiada sobre cada movimiento · Arrastra para mirar libremente</p> : <><div className="ergo-camera-bar"><div>{['Perspectiva', 'Lateral', 'Frente', 'Persona'].map((label, i) => <button key={label} aria-pressed={view % 4 === i} onClick={() => setView(current => current - current % 4 + (current % 4 === i ? 4 : 0) + i)}>{label}</button>)}</div><button aria-label="Restablecer cámara" onClick={() => setView(current => current - current % 4 + 4)}><RotateCcw size={16} /></button></div>
        <p className="ergo-orbit-hint">Arrastra para girar · Usa dos dedos o la rueda para acercar</p></>}
      </div>
      <aside className="ergo-panel">
        {mode !== 'break' ? <>
          <div className="ergo-panel-heading"><span className="ergo-eyebrow">{mode === 'challenge' ? `MISIÓN ${round + 1} DE 3` : 'LABORATORIO LIBRE'}</span><span className="ergo-counter">{count}/7 <CheckCircle2 size={14} /></span></div>
          <h3>{mode === 'challenge' ? CHALLENGES[round].title : 'Tu espacio, a tu medida'}</h3>
          <p className="ergo-description">{mode === 'challenge' ? CHALLENGES[round].description : 'Compara una postura incómoda con un puesto ajustado. Cada control transforma la escena.'}</p>
          <div className={'ergo-progress' + (count === 7 ? ' complete' : '')} aria-label={`${count} de 7 ajustes adecuados`}>{ADJUSTMENTS.map(a => <span key={a.key} className={isAligned(a.key, setup) ? 'done' : ''} />)}</div>
          <div className="ergo-adjustments" aria-label="Ajustes del puesto">{ADJUSTMENTS.map((a, i) => <button key={a.key} className={selected === a.key ? 'selected' : ''} aria-pressed={selected === a.key} onClick={() => setSelected(a.key)}><span className={isAligned(a.key, setup) ? 'ergo-number ok' : 'ergo-number'}>{isAligned(a.key, setup) ? <Check size={13} /> : i + 1}</span>{a.label}<ChevronRight size={14} /></button>)}</div>
          <div className="ergo-control">
            <div className="ergo-control-title"><label htmlFor={`ergo-${selected}`}>{rule.label}</label><output htmlFor={`ergo-${selected}`}>{selected === 'feet' ? setup.feet ? 'Con apoyo' : 'Sin apoyo' : selected === 'glare' ? setup.glare ? 'Con reflejo' : 'Sin reflejo' : `${setup[selected] > 0 && selected === 'screen' ? '+' : ''}${setup[selected]}${rule.unit}`}</output></div>
            {selected === 'feet' || selected === 'glare' ? <button id={`ergo-${selected}`} className="ergo-toggle" role="switch" aria-checked={selected === 'feet' ? setup.feet === 1 : setup.glare === 0} onClick={() => change(selected, setup[selected] ? 0 : 1)}><span />{selected === 'feet' ? 'Usar reposapiés' : 'Cerrar persiana'}</button> : <input id={`ergo-${selected}`} type="range" min={rule.min} max={rule.max} step={rule.step} value={setup[selected]} onChange={e => change(selected, Number(e.target.value))} aria-describedby="ergo-adjustment-hint" />}
            <p id="ergo-adjustment-hint">{rule.hint}</p><span className={'ergo-status ' + (good ? 'good' : '')}>{good ? <CheckCircle2 size={14} /> : <Eye size={14} />}{good ? 'Bien ajustado' : 'Por ajustar'}</span>
            <div className="ergo-coach"><strong>{good ? 'Comprueba en tu cuerpo' : 'Observa la escena'}</strong><p>{good ? guide.check : guide.observe}</p></div>
            <details className="ergo-guide" key={selected}><summary>Cómo ajustarlo en tu puesto</summary><ol>{guide.steps.map(step => <li key={step}>{step}</li>)}</ol><p><strong>Evita:</strong> {guide.avoid}</p></details>
          </div>
          <button className={'ergo-reference ' + (reference ? 'active' : '')} aria-pressed={reference} onClick={() => setReference(s => !s)}><Eye size={16} />{reference ? 'Volver a mis ajustes' : 'Comparar con postura recomendada'}</button>
          {feedback && <p className={'ergo-feedback ' + (count === 7 ? 'success' : '')} role="status">{feedback}</p>}
          {mode === 'challenge' ? <>
            <button className="ergo-primary" onClick={verify}><CheckCircle2 size={17} /> Comprobar mi puesto</button>
            {passed && <button className="ergo-secondary" onClick={() => round < 2 ? startRound(round + 1) : switchMode('break')}>{round < 2 ? 'Siguiente misión' : 'Continuar con la pausa activa'}<ArrowRight size={16} /></button>}
            <div className="ergo-missions">{CHALLENGES.map((c, i) => <button key={c.title} aria-label={`Misión ${i + 1}: ${c.title}${solved.includes(i) ? ', superada' : ''}`} aria-pressed={round === i} onClick={() => startRound(i)}>{solved.includes(i) ? <Check size={14} /> : i + 1}</button>)}<span>{solved.length}/3 misiones superadas</span><button aria-label="Reiniciar misión actual" onClick={() => startRound(round)}><RotateCcw size={14} /></button></div>
          </> : <div className="ergo-explore-actions"><button className="ergo-secondary" onClick={() => { setSetup({ ...INITIAL }); setReference(false) }}>Postura incorrecta</button><button className="ergo-secondary" onClick={() => { setSetup({ ...IDEAL }); setReference(false) }}>Postura recomendada</button></div>}
        </> : <>
          <span className="ergo-eyebrow">80 SEGUNDOS PARA RECARGAR</span><h3>{breakDone ? '¡Qué bien hacer una pausa!' : 'Muévete con calma'}</h3><p className="ergo-description">Sin prisa y sin forzar. Adapta los movimientos a tu comodidad; detente si sientes dolor o mareo.</p>
          <div className={'ergo-timer' + (breakDone ? ' complete' : running ? ' running' : '')} style={{ '--progress': `${breakDone ? 100 : (1 - remaining / BREAKS[breakStep].seconds) * 100}%` } as React.CSSProperties}>{breakDone ? <Trophy size={44} /> : <><strong>{remaining.toString().padStart(2, '0')}</strong><span>segundos</span><em aria-hidden="true">{running ? (BREAKS[breakStep].seconds - remaining) % 8 < 4 ? 'Inhala…' : 'Exhala…' : ''}</em></>}</div>
          <div className="ergo-break-copy" aria-live="polite"><span>PASO {breakStep + 1} DE {BREAKS.length}</span><h4>{breakDone ? 'Tu cuerpo también cuenta' : BREAKS[breakStep].title}</h4><p>{breakDone ? 'Lleva estos ajustes a tu espacio y alterna tareas y posiciones a lo largo del día.' : BREAKS[breakStep].instruction}</p></div>
          <ol className="ergo-break-steps">{BREAKS.map((step, i) => <li key={step.title} className={i < breakStep || breakDone ? 'done' : i === breakStep ? 'current' : ''}><span>{i < breakStep || breakDone ? <Check size={13} /> : i + 1}</span>{step.title}<small>{step.seconds} s</small></li>)}</ol>
          {breakDone ? <button className="ergo-primary" onClick={restartBreak}><RotateCcw size={17} /> Repetir pausa</button> : remaining === 0 ? <button className="ergo-primary" onClick={() => { setBreakStep(i => i + 1); setRemaining(BREAKS[breakStep + 1].seconds) }}>Siguiente movimiento <ArrowRight size={17} /></button> : <button className="ergo-primary" onClick={toggleMovement}>{running ? <Pause size={17} /> : <Play size={17} />}{running ? 'Pausar' : remaining === BREAKS[breakStep].seconds ? 'Comenzar movimiento' : 'Continuar'}</button>}
          <button className="ergo-voice" aria-pressed={ambient.voice} disabled={ambient.status === 'unavailable'} onClick={() => ambient.setVoice(!ambient.voice)}>{ambient.voice ? <Mic size={15} /> : <MicOff size={15} />}<span><strong>Voz guía</strong><small>{ambient.voice ? 'Te acompaña en cada movimiento' : 'Desactivada · solo texto'}</small></span><i aria-hidden="true" /></button>
          <label className="ergo-motion"><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} /> Reducir movimiento de la demostración</label>
          {!breakDone && <button className="ergo-reference" onClick={restartBreak}><RotateCcw size={14} /> Reiniciar pausa</button>}
        </>}
      </aside>
    </div>
    <footer className="ergo-footer"><span><Monitor size={15} /> Los valores corresponden al personaje del juego. Ajusta tu puesto a tu cuerpo.</span><a href="https://www.osha.gov/etools/computer-workstations" target="_blank" rel="noreferrer">Guía de referencia · OSHA ↗</a></footer>
  </section>
  return expanded ? createPortal(content, document.body) : content
}
