import { useEffect, useRef, useState } from 'react'
import * as T from 'three'
import { createErgoPerson } from './ergonomicsPerson'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { ADJUSTMENTS, isAligned, type ErgoKey, type ErgoSetup } from './ergonomicsModel'

type Props = { setup: ErgoSetup; selected: ErgoKey; onSelect: (key: ErgoKey) => void; view: number; breakStep: number; moving: boolean; reduced: boolean }
const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z)
// Brand colors from the app theme (--brand-green / --brand-magenta).
const GREEN = '#10D451', MAGENTA = '#B33D9E'
// Room palettes that match the stage background in ergonomics.css for each app theme.
const PALETTES = {
  light: { background: '#eef3f0', floor: '#fbfbf7', rug: '#d9e8de', wall: '#f3f4ef', ground: '#8f9f95', shaft: .09, lamp: 1.1, exposure: 1.05 },
  dark: { background: '#0f1318', floor: '#1b2129', rug: '#1d2b25', wall: '#171c23', ground: '#2b3331', shaft: .05, lamp: 4.2, exposure: .95 },
}
const POSES = [
  { camera: v(4.4, 2.6, -1.9), target: v(0, 1.05, .1) },
  { camera: v(4.5, 1.9, .1), target: v(0, 1.05, .1) },
  { camera: v(0, 2.6, 4.8), target: v(0, 1.05, .1) },
  { camera: v(1.65, 1.7, .85), target: v(0, 1.2, -.45) },
]
// Cinematic close-ups for each break movement: the camera frames the part of the body that moves.
const SHOTS = [
  { camera: v(1.25, 1.45, .15), target: v(0, 1.12, -.6) },
  { camera: v(.9, 1.32, .3), target: v(0, 1.13, -.4) },
  { camera: v(3.4, 1.35, 1), target: v(.92, .88, -.48) },
  { camera: v(1, 1.45, -.1), target: v(0, 1.35, -.6) },
]
const CONTINUOUS: ErgoKey[] = ['back', 'seat', 'screen', 'distance', 'reach']
const isDark = () => document.documentElement.classList.contains('dark')

export default function ErgonomicsScene(props: Props) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef(props)
  const [failed, setFailed] = useState(false)
  const [humanState, setHumanState] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => { live.current = props }, [props])
  useEffect(() => {
    const el = host.current!
    let renderer: T.WebGLRenderer
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false }) } catch { setFailed(true); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = T.PCFSoftShadowMap
    renderer.outputColorSpace = T.SRGBColorSpace
    renderer.toneMapping = T.ACESFilmicToneMapping
    el.appendChild(renderer.domElement)
    renderer.domElement.setAttribute('aria-label', 'Puesto de trabajo 3D. Usa los botones de vista y los controles de ajuste para explorar con teclado.')
    const scene = new T.Scene()
    scene.fog = new T.Fog('#eef3f0', 9, 19)
    // Soft studio reflections so skin, wood and metal read as real materials.
    const pmrem = new T.PMREMGenerator(renderer)
    const environment = pmrem.fromScene(new RoomEnvironment(), .04).texture
    scene.environment = environment
    scene.environmentIntensity = .42
    const camera = new T.PerspectiveCamera(38, 1, .05, 35)
    camera.position.copy(POSES[0].camera)
    const orbit = new OrbitControls(camera, renderer.domElement)
    orbit.target.copy(POSES[0].target)
    orbit.enableDamping = true
    orbit.enablePan = false
    orbit.minDistance = .7; orbit.maxDistance = 7
    orbit.maxPolarAngle = Math.PI * .48
    orbit.minPolarAngle = .35
    const hemi = new T.HemisphereLight('#ffffff', '#8f9f95', 1.7); scene.add(hemi)
    const sun = new T.DirectionalLight('#fff6e2', 2.8)
    sun.position.set(-3, 6, -4); sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: .1, far: 15 })
    sun.shadow.bias = -.0005; sun.shadow.normalBias = .02; sun.shadow.radius = 4
    scene.add(sun)
    const fill = new T.DirectionalLight('#d6ecff', 1.2); fill.position.set(4, 3, 2); scene.add(fill)
    const mat = (color: string, roughness = .65, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness })
    const ivory = mat('#f2f1ea', .5), wood = mat('#c29f78', .55), dark = mat('#20252c', .45), metal = mat('#b9c2c4', .25, .8)
    const fabric = mat('#2c333d', .9), accent = mat('#128a3f', .75)
    const add = (geometry: T.BufferGeometry, material: T.Material, parent: T.Object3D = scene) => {
      const mesh = new T.Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh
    }
    const box = (w: number, h: number, d: number, material: T.Material, x: number, y: number, z: number, parent: T.Object3D = scene) => {
      const mesh = add(new RoundedBoxGeometry(w, h, d, 3, Math.min(.035, h / 3, w / 3, d / 3)), material, parent)
      mesh.position.set(x, y, z); return mesh
    }
    const ball = (radius: number, material: T.Material, parent: T.Object3D = scene) => add(new T.SphereGeometry(radius, 24, 16), material, parent)
    const rod = (radius: number, material: T.Material, parent: T.Object3D = scene) => add(new T.CylinderGeometry(radius, radius, 1, 16), material, parent)
    const axis = v(0, 1, 0)
    const link = (mesh: T.Mesh, a: T.Vector3, b: T.Vector3) => { mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.scale.y = a.distanceTo(b); mesh.quaternion.setFromUnitVectors(axis, b.clone().sub(a).normalize()) }
    const textures: T.Texture[] = []
    const paint = (width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      draw(canvas.getContext('2d')!)
      const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; textures.push(texture); return texture
    }
    // Room shell: floor disc, rug and a partition wall that frames the window.
    const floorMat = mat('#fbfbf7', .8), rugMat = mat('#d9e8de', 1), wallMat = mat('#f3f4ef', .95), groundMat = mat('#eef3f0', 1)
    const floor = add(new T.CylinderGeometry(2.6, 2.65, .12, 96), floorMat); floor.position.y = -.08
    const ground = add(new T.PlaneGeometry(200, 200), groundMat); ground.rotation.x = -Math.PI / 2; ground.position.y = -.15
    const rug = box(1.8, .012, 1.9, rugMat, 0, -.008, -.2); rug.castShadow = false
    const wall = add(new T.PlaneGeometry(4.2, 3.1), wallMat); wall.rotation.y = Math.PI / 2; wall.position.set(-1.72, 1.4, .3); wall.castShadow = false
    box(.03, .1, 4.2, ivory, -1.7, .0, .3)
    // Desk and peripherals, built locally: no downloads or external models.
    box(1.75, .075, .86, wood, 0, .92, .13)
    for (const x of [-.73, .73]) for (const z of [-.19, .45]) box(.055, .9, .055, ivory, x, .44, z)
    box(1.46, .08, .04, ivory, 0, .62, .45)
    const keyboard = new T.Group(); scene.add(keyboard)
    box(.48, .025, .16, dark, 0, 0, 0, keyboard)
    const keys = mat('#f1f1ec', .6)
    for (let row = 0; row < 4; row++) for (let col = 0; col < 12; col++) box(.029, .006, .024, keys, -.21 + col * .038, .016, -.054 + row * .034, keyboard)
    const mouse = ball(.055, dark); mouse.scale.set(.75, .45, 1.2)
    const monitor = new T.Group(); scene.add(monitor)
    box(.77, .46, .045, dark, 0, 0, 0, monitor)
    const glow = (color: string) => new T.MeshBasicMaterial({ color })
    box(.71, .395, .007, glow('#0f1a17'), 0, .005, -.026, monitor)
    box(.71, .045, .008, glow('#16211d'), 0, .18, -.031, monitor)
    box(.26, .018, .009, glow(GREEN), -.17, .115, -.033, monitor)
    for (let i = 0; i < 4; i++) box(.42 - i * .06, .009, .009, glow('#8fa39a'), -.09, .055 - i * .044, -.033, monitor)
    box(.11, .21, .01, glow(MAGENTA), .25, -.015, -.034, monitor)
    box(.07, .03, .01, glow(GREEN), .25, -.07, -.036, monitor)
    monitor.scale.y = .68
    const stem = rod(.025, metal)
    const monitorBase = box(.3, .025, .2, dark, 0, .975, .8)
    const reflection = box(.72, .39, .008, new T.MeshBasicMaterial({ color: '#fff5d3', transparent: true, opacity: .55 }), 0, .005, -.04, monitor)
    const cup = add(new T.CylinderGeometry(.052, .044, .12, 32), mat(MAGENTA, .35)); cup.position.set(-.7, 1.018, .36)
    const handle = add(new T.TorusGeometry(.03, .008, 10, 24, Math.PI), cup.material as T.Material); handle.position.set(-.7, 1.02, .41); handle.rotation.set(0, -Math.PI / 2, -Math.PI / 2)
    const notebook = box(.2, .016, .27, mat('#128a3f', .7), -.48, .966, .08); notebook.rotation.y = .22
    const pages = box(.19, .006, .26, ivory, -.482, .977, .081); pages.rotation.y = .22
    // Desk lamp with a warm light that glows more in the dark theme.
    box(.14, .02, .14, dark, .78, .968, .45)
    link(rod(.012, metal), v(.78, .97, .45), v(.8, 1.32, .52))
    link(rod(.012, metal), v(.8, 1.32, .52), v(.68, 1.44, .36))
    const shade = add(new T.ConeGeometry(.085, .13, 32, 1, true), mat('#20252c', .5, .3)); shade.position.set(.68, 1.405, .36); shade.rotation.x = .25
    const bulb = add(new T.SphereGeometry(.03, 16, 12), new T.MeshBasicMaterial({ color: '#fff1d0' })); bulb.position.set(.68, 1.37, .35); bulb.castShadow = false
    const lamp = new T.PointLight('#ffd9a0', 1.1, 2.6, 2); lamp.position.set(.68, 1.33, .33); scene.add(lamp)
    // Task chair with five casters, adjustable seat and lumbar support.
    const seat = box(.53, .095, .48, fabric, 0, .6, -.48)
    const post = rod(.035, metal); link(post, v(0, .12, -.48), v(0, .6, -.48))
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5
      const end = v(Math.sin(a) * .34, .075, -.48 + Math.cos(a) * .34)
      link(rod(.022, dark), v(0, .12, -.48), end)
      const wheel = ball(.048, dark); wheel.position.copy(end); wheel.scale.y = .75
    }
    const backrest = new T.Group(); scene.add(backrest)
    box(.49, .62, .07, fabric, 0, .31, 0, backrest)
    box(.41, .14, .075, accent, 0, .12, .045, backrest)
    for (const x of [-.32, .32]) { box(.065, .045, .3, dark, x, .88, -.45); box(.027, .28, .027, metal, x, .72, -.52) }
    const footrest = new T.Group(); scene.add(footrest)
    box(.63, .06, .36, dark, 0, .10, -.025, footrest)
    for (let i = 0; i < 8; i++) box(.56, .007, .01, metal, 0, .133, -.15 + i * .036, footrest)
    box(.48, .09, .21, metal, 0, .035, -.025, footrest)
    const human = createErgoPerson(scene, () => setHumanState('ready'), () => setHumanState('failed'))
    // Window with a painted landscape, a working blind and a sunbeam that causes the glare.
    box(.055, 1.65, 1.45, ivory, -1.65, 1.5, .3)
    const view = add(new T.PlaneGeometry(1.28, 1.48), new T.MeshBasicMaterial({ map: paint(256, 296, ctx => {
      const sky = ctx.createLinearGradient(0, 0, 0, 296); sky.addColorStop(0, '#9fd3ea'); sky.addColorStop(.62, '#e4f3f2'); sky.addColorStop(1, '#f5f1df')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 256, 296)
      ctx.fillStyle = '#ffffffb0'; for (const [x, y, r] of [[60, 60, 22], [84, 54, 28], [110, 62, 20], [190, 96, 16], [208, 90, 20]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill() }
      const hill = (color: string, base: number, amp: number, phase: number) => { ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, 296); for (let x = 0; x <= 256; x += 8) ctx.lineTo(x, base - Math.sin(x / 46 + phase) * amp - Math.sin(x / 19 + phase * 2) * amp * .25); ctx.lineTo(256, 296); ctx.fill() }
      hill('#9cc9a8', 205, 16, .4); hill('#5fae78', 232, 14, 2.1); hill('#2f8a55', 262, 10, 4)
    }) }))
    view.rotation.y = Math.PI / 2; view.position.set(-1.618, 1.5, .3); view.castShadow = false
    const blinds = new T.Group(); scene.add(blinds)
    for (let i = 0; i < 12; i++) box(.075, .075, 1.28, ivory, -1.57, .85 + i * .12, .3, blinds)
    const shaftMat = new T.MeshBasicMaterial({ color: '#fff0c4', transparent: true, opacity: .13, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })
    const shaft = new T.Mesh(new T.CylinderGeometry(.16, .42, 1, 32, 1, true), shaftMat); shaft.renderOrder = 5; scene.add(shaft)
    // Plant with real leaf blades instead of spheres.
    const pot = add(new T.CylinderGeometry(.16, .12, .3, 32), mat('#e7e1d6', .6)); pot.position.set(1.22, .15, .85)
    add(new T.TorusGeometry(.158, .012, 10, 40), pot.material as T.Material).position.set(1.22, .3, .85)
    const soil = add(new T.CircleGeometry(.15, 32), mat('#4a3a2c', 1)); soil.rotation.x = -Math.PI / 2; soil.position.set(1.22, .285, .85)
    const leafShape = new T.Shape(); leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(.075, .16, 0, .38); leafShape.quadraticCurveTo(-.075, .16, 0, 0)
    const leafGeometry = new T.ShapeGeometry(leafShape, 10)
    const leafMats = ['#2f8a55', '#3c9c62', '#246e46'].map(c => new T.MeshStandardMaterial({ color: c, roughness: .55, side: T.DoubleSide }))
    const plant = new T.Group(); plant.position.set(1.22, .29, .85); scene.add(plant)
    for (let i = 0; i < 16; i++) {
      const a = i * 2.39996, tilt = .25 + (i % 4) * .17, h = .12 + (i % 5) * .05
      const stalk = rod(.006, mat('#3f6b45'), plant); link(stalk, v(0, 0, 0), v(Math.sin(a) * .05, h, Math.cos(a) * .05))
      const leaf = add(leafGeometry, leafMats[i % 3], plant)
      leaf.position.set(Math.sin(a) * .05, h, Math.cos(a) * .05)
      leaf.rotation.set(0, a, 0); leaf.rotateX(tilt); leaf.scale.setScalar(.8 + (i % 3) * .15)
    }
    // Numbered markers: magenta while pending, brand green with a check once aligned.
    const marker = (ok: boolean, label: string) => paint(128, 128, ctx => {
      ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill()
      ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fillStyle = ok ? GREEN : MAGENTA; ctx.fill()
      ctx.fillStyle = ok ? '#03140a' : '#ffffff'; ctx.strokeStyle = ctx.fillStyle
      if (ok) { ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(40, 66); ctx.lineTo(57, 82); ctx.lineTo(88, 48); ctx.stroke() }
      else { ctx.font = '800 56px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 64, 68) }
    })
    const okTexture = marker(true, '')
    const markers = ADJUSTMENTS.map((item, i) => {
      const pending = marker(false, String(i + 1))
      const sprite = new T.Sprite(new T.SpriteMaterial({ map: pending, depthTest: false, transparent: true }))
      sprite.scale.set(.17, .17, 1); sprite.userData = { key: item.key, pending }; sprite.renderOrder = 10; scene.add(sprite); return sprite
    })
    const guideMaterial = new T.LineDashedMaterial({ color: GREEN, dashSize: .045, gapSize: .03, transparent: true, opacity: .85 })
    const eyeLine = new T.Line(new T.BufferGeometry().setFromPoints([v(0, 0, 0), v(0, 0, 1)]), guideMaterial); scene.add(eyeLine)
    const applyTheme = () => {
      const p = PALETTES[isDark() ? 'dark' : 'light']
      scene.background = new T.Color(p.background); scene.fog!.color.set(p.background); groundMat.color.set(p.background)
      floorMat.color.set(p.floor); rugMat.color.set(p.rug); wallMat.color.set(p.wall); hemi.groundColor.set(p.ground)
      shaftMat.opacity = p.shaft; lamp.intensity = p.lamp; renderer.toneMappingExposure = p.exposure
    }
    applyTheme()
    const themeWatch = new MutationObserver(applyTheme); themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    const ray = new T.Raycaster(), pointer = new T.Vector2()
    let downX = 0, downY = 0
    const down = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY }
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect(); pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1)
      ray.setFromCamera(pointer, camera)
      return ray.intersectObjects(markers).find(h => h.object.visible)
    }
    const click = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return
      const hit = pick(e)
      if (hit) live.current.onSelect(hit.object.userData.key as ErgoKey)
    }
    const hover = (e: PointerEvent) => { if (!e.buttons) renderer.domElement.style.cursor = pick(e) ? 'pointer' : '' }
    renderer.domElement.addEventListener('pointerdown', down)
    renderer.domElement.addEventListener('pointerup', click)
    renderer.domElement.addEventListener('pointermove', hover)
    const lost = (e: Event) => { e.preventDefault(); setFailed(true); renderer.setAnimationLoop(null) }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    const observer = new ResizeObserver(() => { const { width, height } = el.getBoundingClientRect(); renderer.setSize(width, height); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix() })
    observer.observe(el)
    let lastShot = '', override = false, drift = 0, elapsed = 0, lastTime = 0, inView = true, clock = 0
    const shown = { ...live.current.setup }
    const fly = { t: 1, duration: .9, from: v(0, 0, 0), to: v(0, 0, 0), fromTarget: v(0, 0, 0), toTarget: v(0, 0, 0) }
    // Dragging takes over the camera until the next shot starts.
    const takeOver = () => { override = true }
    orbit.addEventListener('start', takeOver)
    const shotBase = v(0, 0, 0), offset = v(0, 0, 0)
    const visibility = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting }); visibility.observe(el)
    renderer.setAnimationLoop((time) => {
      const dt = Math.min((time - lastTime) / 1000, .25); lastTime = time
      if (document.hidden || !inView) return
      const p = live.current, target = p.setup
      clock += dt
      if (p.moving && !p.reduced) elapsed += dt
      const active = p.breakStep >= 0, stand = p.breakStep === 2
      const shotKey = active ? 'break' + p.breakStep : 'view' + p.view
      if (shotKey !== lastShot) {
        const pose = active ? SHOTS[p.breakStep] : POSES[p.view % 4]
        override = false; drift = 0
        if (!lastShot || p.reduced) { camera.position.copy(pose.camera); orbit.target.copy(pose.target); fly.t = 1 }
        else { fly.from.copy(camera.position); fly.fromTarget.copy(orbit.target); fly.to.copy(pose.camera); fly.toTarget.copy(pose.target); fly.t = 0; fly.duration = active ? 1.8 : .9 }
        shotBase.copy(pose.camera)
        lastShot = shotKey
      }
      if (fly.t < 1 && !override) {
        fly.t = Math.min(1, fly.t + dt / fly.duration)
        const k = fly.t < .5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2
        camera.position.lerpVectors(fly.from, fly.to, k); orbit.target.lerpVectors(fly.fromTarget, fly.toTarget, k)
      } else if (active && !override && !p.reduced) {
        // Slow dolly around the subject, like a steady cinematic shot.
        offset.copy(shotBase).sub(orbit.target).applyAxisAngle(axis, Math.sin(drift * .22) * .12)
        camera.position.copy(orbit.target).add(offset); camera.position.y += Math.sin(drift * .31) * .03
        drift += dt
      }
      // Ease the set-up toward its new values so every adjustment animates.
      const ease = p.reduced ? 1 : 1 - Math.exp(-dt * 7)
      for (const key of CONTINUOUS) shown[key] += (target[key] - shown[key]) * ease
      shown.feet = target.feet; shown.glare = target.glare
      const s = shown
      const wave = p.reduced ? 0 : Math.sin(elapsed * 2.3)
      const seatY = .6 + (s.seat - 47) * .012
      seat.position.y = seatY
      link(post, v(0, .12, -.48), v(0, seatY, -.48))
      const lean = (s.back - 90) * Math.PI / 180
      backrest.position.set(0, seatY, -.68); backrest.rotation.x = -Math.max(0, lean)
      footrest.visible = s.feet === 1
      const hip = v(stand ? .9 : 0, stand ? .96 : seatY + .12, -.48)
      const shoulder = hip.clone().add(v(0, .5 * Math.cos(lean), -.5 * Math.sin(lean)))
      if (stand) shoulder.set(.9, 1.48, -.48)
      if (p.breakStep === 0) shoulder.y += .025 + wave * .02
      // The monitor follows the seated eye height of the set-up, never the moving body,
      // so it stays perfectly still during the break.
      const seatedEye = active ? human.update({ setup: s, step: -1, time: 0, reduced: true })?.eye.y : undefined
      const body = human.update({ setup: s, step: p.breakStep, time: elapsed, reduced: p.reduced })
      const headPos = body?.eye.clone().add(v(0, -.03, -.13)) ?? shoulder.clone().add(v(0, .19, 0))
      keyboard.position.set(-.05, .973, -.25 + s.reach * .008); mouse.position.set(.33, .983, keyboard.position.z)
      const monitorZ = -.48 - .5 * Math.sin(Math.PI / 12) + .13 + s.distance * .01
      const top = Math.max(1.28, (seatedEye ?? body?.eye.y ?? (seatY + .82)) + s.screen * .01)
      monitor.position.set(0, top - .1564, monitorZ)
      link(stem, v(0, .97, monitorZ), v(0, top - .17, monitorZ)); monitorBase.position.z = monitorZ
      reflection.visible = s.glare === 1; blinds.visible = s.glare === 0
      shaft.visible = s.glare === 1
      if (shaft.visible) link(shaft, v(-1.55, 1.55, .3), v(0, top - .16, monitorZ + .02))
      const positions = [shoulder.clone().add(v(-.36, 0, 0)), v(.38, seatY, -.52), v(.49, top - .05, monitorZ), v(.4, 1.2, (monitorZ - .2) / 2), v(.45, 1.08, keyboard.position.z), v(.42, .18, -.03), v(-1.53, 1.7, .3)]
      markers.forEach((m, i) => {
        const key = ADJUSTMENTS[i].key, chosen = key === p.selected, ok = isAligned(key, target)
        m.visible = !active && p.view % 4 !== 3
        m.position.copy(positions[i])
        const map = ok ? okTexture : m.userData.pending as T.Texture
        if (m.material.map !== map) m.material.map = map
        m.scale.setScalar(chosen ? .23 + (p.reduced ? 0 : Math.sin(clock * 4) * .012) : .16)
        m.material.opacity = chosen ? 1 : .9
      })
      const points = eyeLine.geometry.attributes.position as T.BufferAttribute
      points.setXYZ(0, 0, headPos.y + .03, headPos.z + .13); points.setXYZ(1, 0, headPos.y + .03, monitorZ); points.needsUpdate = true; eyeLine.computeLineDistances(); eyeLine.visible = !active && (p.selected === 'screen' || p.selected === 'distance')
      orbit.update(); renderer.render(scene, camera)
    })
    return () => {
      renderer.setAnimationLoop(null); human.dispose(); observer.disconnect(); visibility.disconnect(); themeWatch.disconnect(); orbit.removeEventListener('start', takeOver); orbit.dispose()
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', click); renderer.domElement.removeEventListener('pointermove', hover); renderer.domElement.removeEventListener('webglcontextlost', lost)
      const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), owned = new Set<T.Texture>(textures)
      scene.traverse(obj => { if (obj instanceof T.Mesh || obj instanceof T.Line || obj instanceof T.Sprite) { if ('geometry' in obj) geometries.add(obj.geometry); const list = Array.isArray(obj.material) ? obj.material : [obj.material]; list.forEach(m => materials.add(m)) } })
      materials.forEach(m => { for (const value of Object.values(m)) if (value instanceof T.Texture) owned.add(value); m.dispose() })
      geometries.forEach(g => g.dispose()); owned.forEach(t => t.dispose()); environment.dispose(); pmrem.dispose()
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    }
  }, [])
  return <div ref={host} className="ergo-canvas" data-human={humanState}>
    {!failed && humanState !== 'ready' && <div className="ergo-human-loading" data-state={humanState} role={humanState === 'failed' ? 'alert' : 'status'}>{humanState === 'loading' ? 'Preparando el personaje y sus texturas…' : 'No se pudo cargar el personaje. Cierra y vuelve a abrir el juego para reintentar.'}</div>}
    {failed && <div className="ergo-fallback" role="alert"><strong>No se pudo mostrar la escena 3D.</strong><p>Puedes completar los ajustes y la pausa con las instrucciones. Para ver el modelo, activa la aceleración gráfica y vuelve a abrir el juego.</p></div>}</div>
}
