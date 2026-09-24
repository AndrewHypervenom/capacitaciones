import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import * as THREE from 'three'
import { createDrivingWorld, onRoad, EDGE, LINES, HALF_ROAD, ENDING_Z, START, type Ending } from './drivingWorld'

export type RoadCamera = 'chase' | 'hood'
/** idle: motor apagado · roam: rumbo al semáforo que tienes delante (en rojo) · green: luz verde, a cruzar ·
 * ending: teletransporte y película final · finish: todo quieto con el resumen. */
export type DriveMode = 'idle' | 'roam' | 'green' | 'ending' | 'finish'
export interface DriveInput { throttle: boolean; brake: boolean; steer: number }
export interface Telemetry { kmh: number; meters: number | null; bearing: number }
/** Infracciones de manejo: se avisan al momento y se cuentan en el resumen. */
export type Incident = 'pedestrian' | 'crash' | 'redLight'
/** Momentos de la película final que llevan sonido. */
export type Cue = 'warp' | 'boom' | 'win' | 'bump' | 'tunnel' | 'open'
interface Props {
  drive: DriveMode; green: boolean; reduced: boolean; paused: boolean; runId: number; ending: Ending
  input: MutableRefObject<DriveInput>
  onArrive: () => void; onPassed: () => void; onEndingDone: () => void
  onIncident: (kind: Incident) => void; onCue: (cue: Cue) => void
  cameraMode: RoadCamera; quality: 'detailed' | 'performance'; onTelemetry: (t: Telemetry) => void
  showBoard: boolean; focus: boolean; children: ReactNode
  /** Pantalla de inicio: la tarjeta va al centro, de frente. */
  centered?: boolean
}
const MAX_SPEED = 17, REVERSE = -5
/** El auto se detiene con la trompa en la línea de pare, antes del paso de cebra (centro a 13.9 del cruce). */
const STOP_AT = 13.9
/** Cuánto crece la tarjeta con el acercamiento al responder. */
const FOCUS_GROWTH = 1.18
/** Duración del teletransporte y dónde aparece el auto para la película final. */
const WARP = 1.3, WARP_SWAP = .62

export default function DrivingScene(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const board = useRef<HTMLDivElement>(null)
  const fade = useRef<HTMLDivElement>(null)
  const warp = useRef<HTMLDivElement>(null)
  const minimap = useRef<HTMLCanvasElement>(null)
  const state = useRef(props)
  const [failed, setFailed] = useState(false)
  useEffect(() => { state.current = props }, [props])
  useEffect(() => {
    // Sin 3D no hay trayecto: se llega al semáforo al instante y acelerar lo cruza.
    if (!failed) return
    const timer = window.setInterval(() => {
      const { drive, paused, input, onArrive, onPassed, onEndingDone } = state.current
      if (paused) return
      if (drive === 'roam') onArrive()
      else if (drive === 'green' && input.current.throttle) onPassed()
      else if (drive === 'ending') onEndingDone()
    }, 150)
    return () => window.clearInterval(timer)
  }, [failed])
  useEffect(() => {
    if (!host.current || !board.current || !fade.current || !warp.current || !minimap.current) return
    const el: HTMLDivElement = host.current, boardEl: HTMLDivElement = board.current
    const fadeEl: HTMLDivElement = fade.current, warpEl: HTMLDivElement = warp.current, mapEl: HTMLCanvasElement = minimap.current
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }) }
    catch { setFailed(true); return }
    const economical = props.quality === 'performance'
    renderer.setPixelRatio(Math.min(devicePixelRatio, economical ? 1 : 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = .72
    renderer.shadowMap.enabled = !economical
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.domElement.classList.add('road-webgl')
    el.prepend(renderer.domElement)
    let world: ReturnType<typeof createDrivingWorld>
    try { world = createDrivingWorld(renderer, economical) }
    catch { renderer.dispose(); renderer.domElement.remove(); setFailed(true); return }
    setFailed(false)
    // Más allá de ~900 m la niebla ya lo tapa todo: no tiene sentido dibujarlo.
    const camera = new THREE.PerspectiveCamera(58, 1, .1, 900)
    const map = mapEl.getContext('2d')
    let width = 1, height = 1, compact = false, dirty = true, centered = false
    /** Tamaño de la tarjeta: al centro (pantalla de inicio) es más grande para leerla cómodo. */
    const sizeBoard = () => {
      const big = centered && !compact
      boardEl.classList.toggle('is-centered', big)
      boardEl.style.width = Math.min(compact ? 390 : big ? 600 : 440, width - 36) + 'px'
      boardEl.style.setProperty('--board-max-height', Math.max(120, compact ? height - 330 : big ? height - 220 : (height - 250) / FOCUS_GROWTH) + 'px')
    }
    const resize = () => {
      width = el.clientWidth; height = el.clientHeight; compact = width < 700
      renderer.setSize(width, height)
      camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix()
      sizeBoard()
      dirty = true
    }
    const observer = new ResizeObserver(resize); observer.observe(el); resize()
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const look = new THREE.Vector2(), mouse = new THREE.Vector2(), neutral = new THREE.Vector2()
    function pointer(event: PointerEvent) {
      if (event.pointerType !== 'mouse') return
      if ((event.target as HTMLElement).closest('button, a, summary, .road-world-board, .road-controls, .road-pedals')) return
      const rect = el.getBoundingClientRect()
      mouse.set(THREE.MathUtils.clamp((event.clientX - rect.left) / width * 2 - 1, -1, 1), THREE.MathUtils.clamp((event.clientY - rect.top) / height * 2 - 1, -1, 1))
    }
    function leave() { mouse.set(0, 0) }
    const root = el.closest('.road-game') ?? el
    root.addEventListener('pointermove', pointer as EventListener)
    root.addEventListener('pointerleave', leave)
    let contextLost = false
    const lost = (event: Event) => { event.preventDefault(); contextLost = true; setFailed(true) }
    renderer.domElement.addEventListener('webglcontextlost', lost)

    // ── Estado (vectores reutilizados: crear objetos por cuadro provocaba tirones de memoria) ──
    const pos = new THREE.Vector3(), camPos = new THREE.Vector3(), camAim = new THREE.Vector3()
    const wantPos = new THREE.Vector3(), wantAim = new THREE.Vector3(), tmp = new THREE.Vector3(), head = new THREE.Vector3()
    const fwd = new THREE.Vector3(), cf = new THREE.Vector3(), cr = new THREE.Vector3(), af = new THREE.Vector3(), ar = new THREE.Vector3()
    let heading = 0, camHeading = 0, speed = 0, steerVis = 0, wheelAngle = 0, zoom = 0, fovKick = 0
    let runId = -1, arrived: { crossing: number; fx: number; fz: number } | null = null
    let target = -1, targetLocked = false, lastPassed = -1, nextPick = 0
    let passed = false, lastDrive = '', lastHud = 0, lastMap = 0, lastFrame = 0, lastLights = -1, boardStyle = ''
    let insideCrossing = -1, lastTelemetry = '', lastBump = -9, daylight = 1, shadowTick = 0, wasInTunnel = false
    // Resolución adaptativa: si el equipo no da abasto baja un poco la nitidez; si sobra, la sube.
    const maxRatio = Math.min(devicePixelRatio, economical ? 1 : 1.5)
    let ratio = maxRatio, frames = 0, windowStart = 0, lastAdapt = 0
    function adapt(time: number) {
      frames++
      if (!windowStart) { windowStart = time; return }
      const span = time - windowStart
      if (span < 1000) return
      const fps = frames * 1000 / span
      frames = 0; windowStart = time
      if (time - lastAdapt < 2000) return
      const next = fps < 40 && ratio > .75 ? ratio - .25 : fps > 57 && ratio < maxRatio ? Math.min(maxRatio, ratio + .25) : ratio
      if (next !== ratio) { ratio = next; lastAdapt = time; renderer.setPixelRatio(ratio); renderer.setSize(width, height) }
    }
    const lastIncident: Record<Incident, number> = { pedestrian: -9, crash: -9, redLight: -9 }
    function incident(kind: Incident, t: number) {
      if (t - lastIncident[kind] < 2.5) return
      lastIncident[kind] = t; state.current.onIncident(kind)
    }
    interface Film {
      kind: Ending; t: number; stage: 'warp' | 'drive' | 'air' | 'boom' | 'celebrate'; group: THREE.Group
      vy: number; mark: number; boom: ((age: number, dt: number) => void) | null
      confetti: ((dt: number, t: number) => void) | null; spin: number; done: boolean; swapped: boolean
    }
    let film: Film | null = null
    let frame = 0, previous = 0
    const forward = (h: number) => fwd.set(-Math.sin(h), 0, -Math.cos(h))
    function reset() {
      pos.set(START.x, 0, START.z); heading = START.heading; camHeading = heading; speed = 0; zoom = 0; fovKick = 0
      arrived = null; passed = false; target = -1; targetLocked = false; lastPassed = -1
      if (film) { world.scene.remove(film.group); film = null }
      world.hideConfetti(); world.setGlow(0); daylight = 1; world.setDaylight(1)
      world.car.visible = true; world.car.position.y = 0; world.car.rotation.set(0, 0, 0)
      fadeEl.style.opacity = '0'; warpEl.classList.remove('is-on')
      camPos.set(pos.x, 5, pos.z + 11); camAim.set(pos.x, 1.6, pos.z - 14)
      dirty = true
    }
    const crossingOf = (i: number) => world.crossings[i]
    /** Rumbo del auto redondeado a la calle (±x o ±z). */
    function axisOf(h: number) {
      const f = forward(h)
      const fx = Math.abs(f.x) > Math.abs(f.z) ? Math.sign(f.x) : 0
      return { fx, fz: fx ? 0 : Math.sign(f.z) }
    }
    /** El semáforo-pregunta es el siguiente cruce DELANTE del auto, en la calle por la que va. */
    function pickTarget() {
      const { fx, fz } = axisOf(heading)
      let best = -1, bestD = Infinity
      world.crossings.forEach((c, i) => {
        if (i === lastPassed) return
        const tx = c.x - pos.x, tz = c.z - pos.z, d = tx * fx + tz * fz, lateral = Math.abs(tx * -fz + tz * fx)
        if (lateral < 7 && d > STOP_AT + 6 && d < bestD) { best = i; bestD = d }
      })
      if (best >= 0) return { crossing: best, d: bestD, onRoad: true }
      // Al borde de la ciudad no hay cruce delante: el que quede más al frente.
      const f = forward(heading)
      let score = -Infinity
      world.crossings.forEach((c, i) => {
        if (i === lastPassed) return
        const tx = c.x - pos.x, tz = c.z - pos.z, dist = Math.hypot(tx, tz)
        if (dist < STOP_AT + 6) return
        const s = (tx * f.x + tz * f.z) / dist - dist / 1500
        if (s > score) { score = s; best = i }
      })
      return { crossing: best, d: Infinity, onRoad: false }
    }
    /** ¿Choca el auto (tres círculos a lo largo de su eje) contra un obstáculo fijo? */
    function blockedAt(x: number, z: number, fx: number, fz: number) {
      for (const o of world.obstacles) {
        if (Math.abs(o.x - x) > 5 || Math.abs(o.z - z) > 5) continue
        for (let k = -1.3; k <= 1.31; k += 1.3) {
          const dx = x + fx * k - o.x, dz = z + fz * k - o.z
          if (dx * dx + dz * dz < (o.r + .95) ** 2) return true
        }
      }
      return false
    }
    function moveCar(dt: number, controls: DriveInput, engine: boolean, t: number) {
      const braking = !engine || controls.brake
      if (engine && controls.throttle && !controls.brake) speed += (speed < 0 ? 14 : speed < 8 ? 7 : 4.2) * dt
      else if (engine && controls.brake && speed <= .3) speed = Math.max(REVERSE, speed - 5 * dt)
      else if (braking) speed -= Math.sign(speed) * Math.min(Math.abs(speed), (engine ? 16 : 8) * dt)
      else speed -= Math.sign(speed) * Math.min(Math.abs(speed), (1 + Math.abs(speed) * .05) * dt)
      speed = THREE.MathUtils.clamp(speed, REVERSE, MAX_SPEED)
      const grip = Math.min(1, Math.abs(speed) / 5) * Math.sign(speed)
      heading -= controls.steer * 1.55 * grip * dt
      steerVis += (controls.steer - steerVis) * (1 - Math.exp(-dt * 10))
      const f = forward(heading), fx = f.x, fz = f.z
      const nx = pos.x + fx * speed * dt, nz = pos.z + fz * speed * dt
      const impact = Math.abs(speed)
      if (blockedAt(nx, nz, fx, fz)) { if (impact > 3) incident('crash', t); speed *= -.25 }
      else if (onRoad(nx, nz, false)) pos.set(nx, 0, nz)
      else if (onRoad(nx, pos.z, false)) { pos.x = nx; speed *= .92 }
      else if (onRoad(pos.x, nz, false)) { pos.z = nz; speed *= .92 }
      else { if (impact > 6) incident('crash', t); speed *= -.25 }
      for (const other of world.trafficList) {
        const dx = pos.x - other.x, dz = pos.z - other.z
        if (dx * dx + dz * dz < 6.5) { if (impact > 3) incident('crash', t); speed *= -.3; pos.x += dx * .15; pos.z += dz * .15 }
      }
      // Conos, barriles y vallas: se empujan (no frenan en seco) y suenan un golpe suave.
      if (world.bumpProps(pos.x, pos.z, fx, fz, speed)) {
        speed *= .9
        if (t - lastBump > .35) { lastBump = t; state.current.onCue('bump') }
      }
      const walker = world.hitPedestrians(pos.x, pos.z, speed, fx, fz)
      if (walker === 'hit') { incident('pedestrian', t); speed *= .2 }
      else if (walker === 'blocked' && speed > 0) speed = 0
      // Pasarse un semáforo en rojo: se mira la luz al entrar al cruce, según hacia dónde vas.
      let inside = -1
      for (let i = 0; i < world.crossings.length; i++) {
        const c = world.crossings[i]
        if (Math.abs(pos.x - c.x) < HALF_ROAD - 1 && Math.abs(pos.z - c.z) < HALF_ROAD - 1) { inside = i; break }
      }
      if (inside !== insideCrossing) {
        if (inside >= 0 && impact > 2.5 && world.lightState(t, inside, Math.abs(fz) > Math.abs(fx) ? 'ns' : 'ew', target, state.current.green) === 0) incident('redLight', t)
        insideCrossing = inside
      }
      return braking && Math.abs(speed) > .3
    }
    function startFilm(kind: Ending, still: boolean) {
      film = { kind, t: 0, stage: 'warp', group: world.buildEnding(kind), vy: 0, mark: 0, boom: null, confetti: null, spin: 0, done: false, swapped: false }
      renderer.compile(world.scene, camera)
      arrived = null; target = -1
      if (still) { film.done = true; state.current.onEndingDone(); return }
      warpEl.classList.remove('is-on'); void warpEl.offsetWidth; warpEl.classList.add('is-on')
      state.current.onCue('warp')
    }
    const stopZ = (kind: Ending) => kind === 'tunnel' ? ENDING_Z - 185 : ENDING_Z - 150
    /** Película final. Devuelve el plano de cámara si la película lo manda. */
    function runFilm(f: Film, dt: number, t: number): boolean {
      const running = !state.current.paused && !f.done
      // Cámara lenta mientras el auto vuela sobre el precipicio.
      const scale = f.stage === 'air' && f.t - f.mark < 1.6 ? .32 : 1
      const step = running ? dt * scale : 0
      f.t += step
      if (f.stage === 'warp') {
        const k = f.t / WARP
        fovKick = Math.sin(Math.min(1, k) * Math.PI) * 55
        if (f.t >= WARP_SWAP && !f.swapped) {
          f.swapped = true
          // Salto: el auto aparece en la carretera de la película, ya en marcha.
          pos.set(0, 0, ENDING_Z + 40); heading = 0; camHeading = 0; speed = 18
          camPos.set(0, 4.3, pos.z + 11); camAim.set(0, 1.7, pos.z - 14)
        }
        if (f.t >= WARP) { f.stage = 'drive'; fovKick = 0 }
        speed += (18 - speed) * Math.min(1, step * 2)
        if (f.swapped) pos.z -= speed * step
        return false
      }
      if (f.stage === 'drive') {
        if (f.kind === 'cliff') {
          speed += (22 - speed) * Math.min(1, step * 1.5)
          pos.z -= speed * step
          if (pos.z < ENDING_Z - 40) { f.stage = 'air'; f.mark = f.t; f.vy = 3 }
        } else {
          const left = pos.z - stopZ(f.kind)
          const limit = Math.sqrt(2 * 7 * Math.max(0, left))
          speed = Math.min(speed + (19 - speed) * Math.min(1, step * 1.5), limit)
          pos.z -= speed * step
          if (left < .4 && speed < .4) {
            speed = 0; f.stage = 'celebrate'; f.mark = f.t; f.spin = 0
            f.confetti = world.celebrate(pos); state.current.onCue('win')
          }
        }
        heading += (0 - heading) * Math.min(1, step * 3); pos.x += (0 - pos.x) * Math.min(1, step * 2)
        return false
      }
      if (f.stage === 'air') {
        f.vy -= 24 * step; pos.y += f.vy * step; pos.z -= speed * step * .8
        world.car.rotation.x -= step * 1.1; world.car.rotation.z += step * .7
        if (pos.y < -66) { f.boom = world.explode(pos.clone()); f.stage = 'boom'; f.mark = f.t; world.car.visible = false; state.current.onCue('boom') }
        return true
      }
      if (f.stage === 'boom') f.boom?.(f.t - f.mark, step)
      if (f.stage === 'celebrate') { f.confetti?.(step, t); f.spin += step }
      const hold = f.stage === 'boom' ? 4.4 : 5.2
      const age = f.t - f.mark
      fadeEl.style.background = f.kind === 'cliff' ? '#050507' : '#f3fff7'
      fadeEl.style.opacity = f.done ? '.35' : String(THREE.MathUtils.clamp((age - (hold - 1.1)) / 1.1, 0, .92))
      if (running && age >= hold) { f.done = true; state.current.onEndingDone() }
      return true
    }
    function draw(time: number) {
      frame = requestAnimationFrame(draw)
      const dt = Math.min((time - previous) / 1000, .1); previous = time
      if (document.hidden || contextLost) return
      // Mide el ritmo real del navegador (no los cuadros dibujados, que en reposo van a 30 a propósito).
      adapt(time)
      const s = state.current
      const { drive, paused, input } = s
      const still = s.reduced || reducedQuery.matches
      if (s.runId !== runId) { runId = s.runId; reset() }
      const t = time / 1000
      if (drive !== lastDrive) {
        if (drive === 'green') passed = false
        if (drive === 'roam') targetLocked = false
        if (drive === 'ending' && !film) startFilm(s.ending, still)
        lastDrive = drive; dirty = true
      }
      const controls = input.current
      const engine = drive === 'roam' || drive === 'green'
      // El objetivo se elige en vivo: el siguiente cruce hacia donde va el auto.
      if (!film && !arrived && (drive === 'roam' || drive === 'idle') && (!targetLocked && t > nextPick)) {
        const pick = pickTarget()
        target = pick.crossing
        targetLocked = drive === 'roam' && pick.onRoad && pick.d < 50
        nextPick = t + .25
      }
      let braking = false, moved = false
      if (!paused && !film) {
        if (still) {
          // Movimiento reducido: sin trayectos; acelerar lleva directo al semáforo que tienes delante.
          speed = 0
          if (engine && controls.throttle) {
            if (drive === 'roam' && !arrived && target >= 0) {
              const c = crossingOf(target)
              let { fx, fz } = axisOf(heading)
              const tx = c.x - pos.x, tz = c.z - pos.z
              if (Math.abs(tx * -fz + tz * fx) > 7 || tx * fx + tz * fz < 0) { fx = Math.abs(tx) > Math.abs(tz) ? Math.sign(tx) : 0; fz = fx ? 0 : Math.sign(tz) || -1 }
              pos.set(c.x - fx * STOP_AT - fz * 1.9, 0, c.z - fz * STOP_AT + fx * 1.9)
              heading = Math.atan2(-fx, -fz); camHeading = heading
              arrived = { crossing: target, fx, fz }; s.onArrive(); moved = true
            } else if (drive === 'green' && arrived && !passed) {
              const c = crossingOf(arrived.crossing)
              pos.set(c.x + arrived.fx * 26 - arrived.fz * 1.9, 0, c.z + arrived.fz * 26 + arrived.fx * 1.9)
              passed = true; lastPassed = arrived.crossing; arrived = null; targetLocked = false; s.onPassed(); moved = true
            }
          }
        } else {
          braking = moveCar(dt, controls, engine, t)
          moved = Math.abs(speed) > .01
          if (drive === 'roam' && !arrived && target >= 0) {
            // Semáforo objetivo en rojo: si vienes por su calle, el auto frena solo hasta la línea.
            const c = crossingOf(target), { fx, fz } = axisOf(heading)
            const toX = c.x - pos.x, toZ = c.z - pos.z
            const d = toX * fx + toZ * fz, lateral = Math.abs(toX * -fz + toZ * fx)
            if (lateral < 7 && d > STOP_AT - 3 && d < 50 && speed > 0) {
              targetLocked = true
              const limit = Math.sqrt(2 * 7 * Math.max(0, d - STOP_AT))
              if (speed > limit) { speed = limit; braking = true }
              if (d < STOP_AT + 1 && speed < .35) { speed = 0; arrived = { crossing: target, fx, fz }; s.onArrive() }
            } else if (targetLocked && (lateral > 7 || d < STOP_AT - 4)) targetLocked = false
          }
          if (drive === 'green' && arrived && !passed) {
            const c = crossingOf(arrived.crossing)
            if (Math.hypot(pos.x - c.x, pos.z - c.z) > 24) { passed = true; lastPassed = arrived.crossing; arrived = null; targetLocked = false; s.onPassed() }
          }
        }
      }
      // ── Película final ──────────────────────────────────────────────────────
      let filmShot = false
      if (film) { filmShot = runFilm(film, dt, t); moved = true }
      // ── Auto ────────────────────────────────────────────────────────────────
      world.car.rotation.order = 'YXZ'
      world.car.position.set(pos.x, pos.y + (moved && !film ? Math.sin(time * .024) * .006 : 0), pos.z)
      world.car.rotation.y = heading
      if (!film || film.stage === 'warp' || film.stage === 'drive') {
        world.car.rotation.x = braking ? -.012 : speed > .5 && controls.throttle ? .01 : 0
        world.car.rotation.z = -steerVis * Math.min(1, Math.abs(speed) / 10) * .035
      }
      wheelAngle -= speed * dt / .39
      for (const w of world.wheels) w.rotation.x = wheelAngle
      for (const w of world.frontWheels) w.rotation.y = -steerVis * .42
      world.tail.emissiveIntensity = braking || Math.abs(speed) < .3 ? 3.2 : 1.4
      world.barrier.visible = !film
      const targetCrossing = arrived ? arrived.crossing : film ? -1 : target
      const beaconOn = !film && !arrived && target >= 0 && (drive === 'roam' || drive === 'idle')
      if (beaconOn) { const c = crossingOf(target); world.beacon.position.set(c.x, 0, c.z) }
      world.beacon.visible = beaconOn
      if (t - lastLights > .2) { world.updateLights(t, targetCrossing, s.green); lastLights = t }
      const ambient = !paused && !still
      if (ambient) world.ambient(t, dt, pos, targetCrossing, s.green)
      if (!paused) world.updateProps(dt)
      // La sombra sigue al auto pero se ajusta a la cuadrícula de sus píxeles: así no tiembla al moverse.
      const texel = 90 / 1024
      tmp.set(Math.round(pos.x / texel) * texel, 0, Math.round(pos.z / texel) * texel)
      world.sun.position.copy(tmp).addScaledVector(world.sunDirection, 160); world.sun.target.position.copy(tmp)
      // Dentro del túnel no entra el sol: la luz del día baja y quedan solo las luces de la bóveda.
      const inTunnel = film?.kind === 'tunnel' && pos.z < ENDING_Z - 12 && pos.z > ENDING_Z - 141
      if (inTunnel !== wasInTunnel) { wasInTunnel = inTunnel; s.onCue(inTunnel ? 'tunnel' : 'open') }
      const dayGoal = inTunnel ? .12 : 1
      if (Math.abs(daylight - dayGoal) > .005) { daylight += (dayGoal - daylight) * Math.min(1, dt * 3); world.setDaylight(daylight) }
      // ── Cámara ──────────────────────────────────────────────────────────────
      const oldX = look.x, oldY = look.y
      look.lerp(still || paused || film ? neutral : mouse, 1 - Math.exp(-dt * 4))
      const lookTarget = still || paused || film ? neutral : mouse
      if (look.distanceToSquared(lookTarget) < .00001) look.copy(lookTarget)
      const looking = Math.abs(look.x - oldX) + Math.abs(look.y - oldY) > .00001
      const zoomGoal = s.focus && arrived && !paused && Math.abs(speed) < .3 ? 1 : 0
      const oldZoom = zoom
      zoom = still ? zoomGoal : zoom + (zoomGoal - zoom) * (1 - Math.exp(-dt * 2.4))
      if (Math.abs(zoom - zoomGoal) < .001) zoom = zoomGoal
      const z = zoom * zoom * (3 - 2 * zoom)
      camHeading = still ? heading : camHeading + Math.atan2(Math.sin(heading - camHeading), Math.cos(heading - camHeading)) * (1 - Math.exp(-dt * 3.2))
      forward(camHeading); cf.copy(fwd); cr.set(-cf.z, 0, cf.x)
      if (s.cameraMode === 'hood' && !film) {
        forward(heading)
        wantPos.copy(pos).addScaledVector(fwd, .25).setY(1.45); wantAim.copy(pos).addScaledVector(fwd, 25).setY(1.1)
      } else {
        const back = 10.5 + Math.abs(speed) * .12 + (film?.stage === 'warp' ? 6 * Math.sin(Math.min(1, film.t / WARP) * Math.PI) : 0)
        wantPos.copy(pos).addScaledVector(cf, -back).addScaledVector(cr, look.x * 3).setY(4.3 - look.y * .6)
        wantAim.copy(pos).addScaledVector(cf, 14).addScaledVector(cr, look.x * 2).setY(1.7 - look.y * .8)
      }
      if (arrived && z > 0) {
        // Al responder: el auto queda a la izquierda y la tarjeta junto al semáforo, a la derecha.
        const c = crossingOf(arrived.crossing)
        af.set(arrived.fx, 0, arrived.fz); ar.set(-af.z, 0, af.x)
        head.set(c.x, 5.8, c.z).addScaledVector(af, HALF_ROAD + 1.4).addScaledVector(ar, HALF_ROAD + 1.4 - 4.6)
        tmp.copy(pos).addScaledVector(af, -12).addScaledVector(ar, 2.6).setY(4.6)
        wantPos.lerp(tmp, z)
        tmp.copy(pos).addScaledVector(af, 9).lerp(head, .45).addScaledVector(ar, 1.2).setY(3.1)
        wantAim.lerp(tmp, z)
      }
      if (film && filmShot) filmCamera(film)
      else if (film && film.stage === 'drive' && film.kind === 'bridge' && pos.z < ENDING_Z - 6) { wantPos.set(30, 12, pos.z + 14); wantAim.copy(pos).setY(2) }
      else if (film && film.stage === 'drive' && film.kind === 'tunnel' && pos.z < ENDING_Z - 14 && pos.z > ENDING_Z - 140) { wantPos.set(pos.x, 2.6, pos.z + 7); wantAim.set(pos.x, 2, pos.z - 30) }
      const cameraMoving = camPos.distanceToSquared(wantPos) > .0004 || camAim.distanceToSquared(wantAim) > .0004
      if (still || !cameraMoving) { camPos.copy(wantPos); camAim.copy(wantAim) }
      else { const k = 1 - Math.exp(-dt * (film ? 3 : 5)); camPos.lerp(wantPos, k); camAim.lerp(wantAim, Math.min(1, k * 1.4)) }
      camera.position.copy(camPos); camera.lookAt(camAim)
      const fov = 58 - z * 7 + Math.abs(speed) * .3 + fovKick
      if (Math.abs(camera.fov - fov) > .02) { camera.fov = fov; camera.updateProjectionMatrix() }
      camera.updateMatrixWorld()
      // ── Tarjeta: un panel normal ubicado sobre la proyección del semáforo ──
      const visible = s.showBoard && !(drive === 'green' && Math.abs(speed) > .6)
      if (!!s.centered !== centered) { centered = !!s.centered; sizeBoard() }
      let style = 'display:none'
      if (visible) {
        const bw = boardEl.offsetWidth || 440, bh = boardEl.offsetHeight || 300
        let x = 0, y = 0, scale = 1, rot = -6, anchored = false
        if (arrived && !compact && (drive === 'idle' || drive === 'green')) {
          const c = crossingOf(arrived.crossing)
          af.set(arrived.fx, 0, arrived.fz); ar.set(-af.z, 0, af.x)
          head.set(c.x, 6.5, c.z).addScaledVector(af, HALF_ROAD + 1.4).addScaledVector(ar, HALF_ROAD + 1.4 - 4.6).project(camera)
          if (head.z < 1) { anchored = true; x = (head.x + 1) / 2 * width + 34; y = (1 - head.y) / 2 * height - 24; scale = 1 + (FOCUS_GROWTH - 1) * z; rot = -11 }
        }
        if (!anchored) {
          if (compact) { x = (width - bw) / 2; y = 150; rot = 0 }
          else if (s.centered) { x = (width - bw) / 2; y = (height - bh) / 2; rot = 0 }
          else { x = width - bw - 70; y = (height - bh) / 2 }
        }
        const top = compact ? 140 : 120, bottom = compact ? 190 : 110
        x = THREE.MathUtils.clamp(x, 16, Math.max(16, width - bw * scale - 16))
        y = THREE.MathUtils.clamp(y, top, Math.max(top, height - bh * scale - bottom))
        style = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) perspective(1100px) rotateY(${rot}deg) scale(${scale.toFixed(3)})`
      }
      mapEl.style.opacity = visible || film ? '0' : '1'
      if (style !== boardStyle) {
        boardStyle = style
        if (style === 'display:none') boardEl.style.display = 'none'
        else { boardEl.style.display = ''; boardEl.style.transform = style }
      }
      // ── Telemetría (solo si cambió), minimapa y dibujo ──────────────────────
      if (time - lastHud > 100) {
        let meters: number | null = null, bearing = 0
        if (beaconOn) {
          const c = crossingOf(target), f = forward(heading), gx = c.x - pos.x, gz = c.z - pos.z
          meters = Math.max(0, Math.round(Math.hypot(gx, gz)))
          bearing = Math.round(THREE.MathUtils.radToDeg(Math.atan2(gx * -f.z + gz * f.x, gx * f.x + gz * f.z)) / 5) * 5
        }
        const kmh = Math.round(Math.abs(speed) * 3.6)
        const key = kmh + '|' + meters + '|' + bearing
        if (key !== lastTelemetry) { lastTelemetry = key; s.onTelemetry({ kmh, meters, bearing }) }
        lastHud = time
      }
      if (map && time - lastMap > 150 && !film) { drawMap(map, mapEl.width, beaconOn ? target : -1, t); lastMap = time }
      const busy = moved || cameraMoving || looking || zoom !== oldZoom || dirty || !!film
      if (busy || (ambient && time - lastFrame > 32)) {
        renderer.shadowMap.needsUpdate = ++shadowTick % 2 === 0 || dirty
        renderer.render(world.scene, camera)
        lastFrame = time; dirty = false
        el.dataset.lookX = look.x.toFixed(3)
      }
    }
    /** Planos de la película: órbita en la meta, vuelo en cámara lenta y la explosión. */
    function filmCamera(f: Film) {
      if (f.stage === 'celebrate') {
        const a = .6 + f.spin * .75
        wantPos.set(pos.x + Math.sin(a) * 10, 3.6 + Math.sin(f.spin * .8) * .6, pos.z + Math.cos(a) * 10)
        wantAim.copy(pos).setY(1.4)
      } else if (f.stage === 'air') {
        const a = (f.t - f.mark) * .5
        wantPos.set(pos.x + 13 * Math.cos(a), pos.y + 3 + (f.t - f.mark) * 1.5, pos.z + 6 + 5 * Math.sin(a))
        wantAim.copy(pos)
      } else if (f.stage === 'boom') {
        const shake = Math.max(0, 1 - (f.t - f.mark) / 1.6) * .9
        wantPos.set(26 + (Math.random() - .5) * shake, 16 + (Math.random() - .5) * shake, ENDING_Z - 44)
        wantAim.set(pos.x, -62, pos.z)
      }
    }
    function drawMap(ctx: CanvasRenderingContext2D, size: number, targetIndex: number, t: number) {
      const scale = size / (2 * EDGE + 60), cx = size / 2, cz = size / 2
      const sx = (x: number) => cx + x * scale, sz = (z: number) => cz + z * scale
      ctx.clearRect(0, 0, size, size)
      ctx.fillStyle = '#0c0c12cc'; ctx.beginPath(); ctx.roundRect(0, 0, size, size, 14); ctx.fill()
      ctx.strokeStyle = '#8b8f96'; ctx.lineWidth = Math.max(2, 2 * HALF_ROAD * scale)
      for (const l of LINES) {
        ctx.beginPath(); ctx.moveTo(sx(l), sz(-EDGE)); ctx.lineTo(sx(l), sz(EDGE)); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(sx(-EDGE), sz(l)); ctx.lineTo(sx(EDGE), sz(l)); ctx.stroke()
      }
      if (targetIndex >= 0) {
        const c = world.crossings[targetIndex]
        ctx.fillStyle = '#10d451'; ctx.beginPath(); ctx.arc(sx(c.x), sz(c.z), 6 + Math.sin(t * 5) * 1.5, 0, Math.PI * 2); ctx.fill()
      }
      ctx.save(); ctx.translate(sx(pos.x), sz(pos.z)); ctx.rotate(-heading)
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill()
      ctx.restore()
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame); observer.disconnect()
      root.removeEventListener('pointermove', pointer as EventListener); root.removeEventListener('pointerleave', leave)
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      world.dispose(); renderer.dispose(); renderer.domElement.remove()
    }
  }, [props.quality])
  return <div className={'road-scene' + (failed ? ' has-no-webgl' : '')} ref={host} aria-label="Ciudad 3D con tu auto y los semáforos">
    {failed && <div className="road-fallback"><p>El 3D no está disponible en este dispositivo. Puedes completar las preguntas.</p></div>}
    <canvas ref={minimap} className="road-minimap" width={150} height={150} aria-hidden="true" />
    <div className="road-board-layer"><div ref={board} className={'road-world-board' + (failed ? ' is-static' : '')}>{props.children}</div></div>
    <div ref={warp} className="road-warp" aria-hidden="true" />
    <div ref={fade} className="road-fade" aria-hidden="true" />
  </div>
}
