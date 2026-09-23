import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three'
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import { createDrivingWorld } from './drivingWorld'

export type RoadCamera = 'chase' | 'hood'
interface Props {
  moving: boolean; green: boolean; reduced: boolean; paused: boolean
  cameraMode: RoadCamera; quality: 'detailed' | 'performance'; onSpeed: (speed: number) => void
  showBoard: boolean; children: ReactNode
}
export default function DrivingScene(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const fallbackMount = useRef<HTMLDivElement>(null)
  const state = useRef(props)
  const invalidate = useRef(true)
  const [failed, setFailed] = useState(false)
  const [boardElement] = useState(() => {
    const element = document.createElement('div')
    element.className = 'road-world-board'
    return element
  })
  useEffect(() => { state.current = props; invalidate.current = true }, [props])
  useEffect(() => {
    if (!failed || !fallbackMount.current) return
    boardElement.style.cssText = ''
    const mount = fallbackMount.current
    mount.appendChild(boardElement)
    return () => { if (boardElement.parentElement === mount) boardElement.remove() }
  }, [failed, boardElement])
  useEffect(() => {
    const container = host.current
    if (!container) return
    const el: HTMLDivElement = container
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }) }
    catch { setFailed(true); return }
    const economical = props.quality === 'performance'
    renderer.setPixelRatio(Math.min(devicePixelRatio, economical ? 1 : 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = !economical
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)
    let world: ReturnType<typeof createDrivingWorld>
    try { world = createDrivingWorld(renderer, economical) }
    catch { renderer.dispose(); renderer.domElement.remove(); setFailed(true); return }
    setFailed(false)
    const camera = new THREE.PerspectiveCamera(57, 1, .1, 600)
    camera.position.set(6.7, 3.7, 9.5)
    const target = new THREE.Vector3()
    const aim = new THREE.Vector3()
    const look = new THREE.Vector2(), mouse = new THREE.Vector2(), neutral = new THREE.Vector2()
    // The React portal is a real world-space object rendered with the SAME camera.
    // Native buttons retain keyboard, touch, focus and screen-reader support.
    const labels = new CSS3DRenderer()
    labels.domElement.className = 'road-css3d'
    labels.domElement.style.pointerEvents = 'none'
    el.appendChild(labels.domElement)
    const sign = new CSS3DObject(boardElement)
    sign.name = 'questions-at-traffic-light'
    world.signal.add(sign)
    const projected = new THREE.Vector3(), cameraSpace = new THREE.Vector3()
    let dirty = true, width = 1, height = 1, compact = false
    const resize = () => {
      width = el.clientWidth; height = el.clientHeight; compact = width < 700
      renderer.setSize(width, height); labels.setSize(width, height)
      camera.aspect = width / Math.max(1, height); camera.updateProjectionMatrix()
      boardElement.style.width = Math.min(compact ? 390 : 470, width - 36) + 'px'
      boardElement.style.setProperty('--board-max-height', Math.max(100, Math.min(compact ? height * .47 : height - 270, height - (compact ? 310 : 230))) + 'px')
      dirty = true
    }
    const observer = new ResizeObserver(resize); observer.observe(el); resize()
    const boardObserver = new ResizeObserver(() => { dirty = true }); boardObserver.observe(boardElement)
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    function pointer(event: PointerEvent) {
      if (event.pointerType !== 'mouse') return
      const element = event.target as HTMLElement
      // Keep the world still while aiming at the answers or using a control.
      if (element.closest('button, a, summary, .road-world-board, .road-controls')) return
      const rect = el.getBoundingClientRect()
      mouse.set(THREE.MathUtils.clamp((event.clientX - rect.left) / width * 2 - 1, -1, 1),
        THREE.MathUtils.clamp((event.clientY - rect.top) / height * 2 - 1, -1, 1))
    }
    function leave() { mouse.set(0, 0) }
    const root = el.closest('.road-game') ?? el
    root.addEventListener('pointermove', pointer as EventListener)
    root.addEventListener('pointerleave', leave)
    let contextLost = false
    const lost = (event: Event) => { event.preventDefault(); contextLost = true; labels.domElement.style.display = 'none'; setFailed(true) }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    let frame = 0, previous = 0, distance = 0, elapsed = 0, wheelAngle = 0, lastHud = 0, lastTravel = 0
    let wasMoving = false, lastGreen: boolean | undefined, lastCamera = '', lastPaused = false, lastBoard = true
    function draw(time: number) {
      frame = requestAnimationFrame(draw)
      const dt = Math.min((time - previous) / 1000, .15); previous = time
      if (document.hidden || contextLost) return
      const { moving, green, reduced, paused, cameraMode, onSpeed, showBoard } = state.current
      const still = reduced || reducedQuery.matches
      if (moving !== wasMoving) { elapsed = 0; lastTravel = 0; wasMoving = moving; dirty = true }
      if (lastGreen !== green || lastCamera !== cameraMode || lastPaused !== paused || lastBoard !== showBoard) dirty = true
      lastGreen = green; lastCamera = cameraMode; lastPaused = paused; lastBoard = showBoard
      const animate = moving && !paused && !still
      if (animate) elapsed = Math.min(2.4, elapsed + dt)
      const speed = animate ? 24 * Math.sin(Math.PI * elapsed / 2.4) : 0
      if (time - lastHud > 100) { onSpeed(Math.round(speed * 3.6)); lastHud = time }
      if (animate) {
        const travel = 24 * 2.4 / Math.PI * (1 - Math.cos(Math.PI * elapsed / 2.4))
        const advance = travel - lastTravel; lastTravel = travel
        distance += advance; wheelAngle -= advance / .39
        world.signal.position.z = travel
        world.nextSignal.position.z = travel - 48 * 2.4 / Math.PI
        world.traffic.children.forEach(car => {
          car.position.z += (speed + 9) * dt
          if (car.position.z > 24) car.position.z = -200
        })
        world.asphalt.offset.y = distance / 7.5
        world.wheels.forEach(wheel => { wheel.rotation.x = wheelAngle })
        world.car.position.y = .01 + Math.sin(elapsed * 24) * .008
        world.car.rotation.x = Math.cos(Math.PI * elapsed / 2.4) * .015
      } else if (!moving) { world.signal.position.z = 0; world.car.rotation.x = 0 }
      world.rows.forEach(row => { row.position.z = ((row.userData.baseZ + distance + 248) % 288 + 288) % 288 - 248 })
      world.nextSignal.visible = moving && !still
      world.lamps.forEach((lamp, i) => {
        const active = (i === 0 && !green) || (i === 2 && green)
        lamp.color.set(active ? ['#ff334b', '#ffb74d', '#42f3ad'][i] : '#14202b')
        lamp.emissiveIntensity = active ? 4 : 0
      })
      world.tail.emissiveIntensity = moving ? 1.4 : 3
      const oldX = look.x, oldY = look.y
      const lookTarget = still || paused ? neutral : mouse
      look.lerp(lookTarget, 1 - Math.exp(-dt * 4))
      if (look.distanceToSquared(lookTarget) < .00001) look.copy(lookTarget)
      const looking = Math.abs(look.x - oldX) + Math.abs(look.y - oldY) > .00001
      const cockpit = cameraMode === 'hood'
      target.set((cockpit ? 2.5 : compact ? 3.4 : 6.7) + look.x * .65,
        (cockpit ? 1.48 : 3.7) - look.y * .13,
        cockpit ? -1.55 : 9.5 + speed * .035)
      const cameraMoving = camera.position.distanceToSquared(target) > .0001
      if (still || !cameraMoving) camera.position.copy(target)
      else camera.position.lerp(target, 1 - Math.exp(-dt * 5))
      aim.set((compact ? 2.8 : 3.8) + look.x * .8, (compact ? 3.1 : 2.7) - look.y * .3, -12)
      camera.lookAt(aim); camera.updateMatrixWorld()
      const fov = 57 + speed * .12
      if (Math.abs(camera.fov - fov) > .02) { camera.fov = fov; camera.updateProjectionMatrix(); dirty = true }
      sign.visible = showBoard
      if (showBoard) {
        // On a narrow display the sign sits below the signal, still in the scene.
        sign.position.set(compact ? 2.8 : 8.6, compact ? .2 : 3.6, -11.25 - world.signal.position.z)
        sign.rotation.y = compact ? .18 : -.10
        sign.updateWorldMatrix(true, false)
        cameraSpace.setFromMatrixPosition(sign.matrixWorld).applyMatrix4(camera.matrixWorldInverse)
        // Match readable CSS pixels to world units. Camera motion still changes
        // the plane's perspective; long questions scroll INSIDE the 3D sign.
        const scale = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, -cameraSpace.z) / height
        sign.scale.setScalar(scale)
        const boardWidth = boardElement.offsetWidth, boardHeight = boardElement.offsetHeight
        projected.setFromMatrixPosition(sign.matrixWorld).project(camera)
        const marginX = (boardWidth / 2 + 18) / width * 2
        const top = compact ? 184 : height < 540 ? 105 : 140, bottom = compact ? 98 : height < 540 ? 85 : 105
        projected.x = THREE.MathUtils.clamp(projected.x, -1 + marginX, 1 - marginX)
        projected.y = THREE.MathUtils.clamp(projected.y, -1 + (bottom + boardHeight / 2) / height * 2, 1 - (top + boardHeight / 2) / height * 2)
        projected.unproject(camera)
        world.signal.worldToLocal(projected); sign.position.copy(projected)
      }
      if (animate || dirty || invalidate.current || cameraMoving || looking) {
        renderer.render(world.scene, camera)
        labels.render(world.scene, camera)
        el.dataset.lookX = look.x.toFixed(3)
        dirty = false; invalidate.current = false
      }
    }
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); boardObserver.disconnect()
      root.removeEventListener('pointermove', pointer as EventListener); root.removeEventListener('pointerleave', leave)
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      sign.removeFromParent(); labels.domElement.remove()
      world.dispose(); renderer.dispose(); renderer.domElement.remove()
    }
  }, [props.quality, boardElement])
  return <div className={'road-scene' + (failed ? ' has-no-webgl' : '')} ref={host} aria-label="Ciudad 3D con auto y semáforo">
    {failed && <div className="road-fallback"><p>El 3D no está disponible en este dispositivo. Puedes completar las preguntas.</p><div ref={fallbackMount} className="road-fallback-board" /></div>}
    {createPortal(props.children, boardElement)}
  </div>
}
