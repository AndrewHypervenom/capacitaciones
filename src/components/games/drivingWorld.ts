import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { Sky } from 'three/addons/objects/Sky.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/** Ciudad en cuadrícula: 5 × 5 cruces separados por BLOCK, calles de doble sentido (2 carriles por lado). */
export const BLOCK = 64
export const LINES = [-2, -1, 0, 1, 2].map(i => i * BLOCK)
export const EDGE = 2 * BLOCK
export const HALF_ROAD = 7
/** La salida es la avenida central hacia el norte; el final (túnel, puente o precipicio) empieza en ENDING_Z. */
export const EXIT_Z = -EDGE - 34
export const ENDING_Z = -EDGE - 90
export type Ending = 'tunnel' | 'bridge' | 'cliff'
export interface Crossing { x: number; z: number }
export const START = { x: 1.9, z: EDGE - 16, heading: 0 }

const nearestLine = (v: number) => Math.max(-EDGE, Math.min(EDGE, Math.round(v / BLOCK) * BLOCK))
/** ¿Está el auto sobre asfalto? Los edificios hacen de muro. */
export function onRoad(x: number, z: number, exitOpen: boolean) {
  const lane = HALF_ROAD - 1.2, limit = EDGE + lane
  if (exitOpen && Math.abs(x) < lane && z < -EDGE && z > ENDING_Z - 400) return true
  if (Math.abs(x) > limit || Math.abs(z) > limit) return false
  return Math.abs(x - nearestLine(x)) < lane || Math.abs(z - nearestLine(z)) < lane
}

/** Todo se construye localmente: sin descargas de terceros durante el juego. */
export function createDrivingWorld(renderer: T.WebGLRenderer, mobile: boolean) {
  const scene = new T.Scene()
  scene.fog = new T.FogExp2('#e3ae8c', mobile ? .0052 : .0042)
  const geometries = new Set<T.BufferGeometry>()
  const materials = new Set<T.Material>()
  const textures = new Set<T.Texture>()
  const geometry = <G extends T.BufferGeometry>(g: G) => { geometries.add(g); return g }
  const material = <M extends T.Material>(m: M) => { materials.add(m); return m }
  const paint = (color: string, roughness = .65, metalness = 0) =>
    material(new T.MeshStandardMaterial({ color, roughness, metalness }))
  const unitBox = geometry(new T.BoxGeometry(1, 1, 1))
  const poleGeo = geometry(new T.CylinderGeometry(1, 1, 1, 10))
  function mesh(parent: T.Object3D, geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
    const object = new T.Mesh(geo, mat)
    object.position.set(x, y, z); object.scale.set(sx, sy, sz)
    object.castShadow = true; object.receiveShadow = true; parent.add(object)
    return object
  }
  const box = (parent: T.Object3D, mat: T.Material, x: number, y: number, z: number, w: number, h: number, d: number) =>
    mesh(parent, unitBox, mat, x, y, z, w, h, d)
  function rounded(parent: T.Object3D, mat: T.Material, x: number, y: number, z: number, w: number, h: number, d: number, radius = .1) {
    return mesh(parent, geometry(new RoundedBoxGeometry(w, h, d, 3, radius)), mat, x, y, z)
  }
  function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    draw(ctx)
    const texture = new T.CanvasTexture(canvas)
    texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    textures.add(texture); return texture
  }
  let seed = 37
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  const dummy = new T.Object3D(); dummy.rotation.order = 'YXZ'
  const place = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => {
    dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(rx, ry, rz)
    dummy.updateMatrix(); return dummy.matrix.clone()
  }
  /** Malla instanciada: una sola llamada de dibujo para cientos de piezas iguales. */
  function instanced(geo: T.BufferGeometry, mat: T.Material, matrices: T.Matrix4[], shadows = true, parent: T.Object3D = scene) {
    const im = new T.InstancedMesh(geo, mat, Math.max(1, matrices.length))
    matrices.forEach((m, i) => im.setMatrixAt(i, m))
    im.count = matrices.length
    im.castShadow = shadows; im.receiveShadow = true; parent.add(im)
    return im
  }

  // ── Luz de atardecer ────────────────────────────────────────────────────────
  const sky = new Sky(); sky.scale.setScalar(4500); scene.add(sky)
  const sunDirection = new T.Vector3().setFromSphericalCoords(1, T.MathUtils.degToRad(80), T.MathUtils.degToRad(38))
  const skyUniforms = sky.material.uniforms
  skyUniforms.turbidity.value = 5.5; skyUniforms.rayleigh.value = 2.4
  skyUniforms.mieCoefficient.value = .006; skyUniforms.mieDirectionalG.value = .86
  skyUniforms.sunPosition.value.copy(sunDirection)
  materials.add(sky.material); geometries.add(sky.geometry)
  const sky2 = new T.HemisphereLight('#ffd9b8', '#5b4a5e', 1.5); scene.add(sky2)
  const sun = new T.DirectionalLight('#ffc28a', 3.4)
  sun.castShadow = !mobile
  sun.shadow.mapSize.set(1024, 1024)
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 60, far: 260 })
  sun.shadow.normalBias = .05; sun.shadow.bias = -.0003
  scene.add(sun, sun.target)
  const pmrem = new T.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = pmrem.fromScene(room, .04)
  scene.environment = environment.texture; scene.environmentIntensity = .55
  room.dispose(); pmrem.dispose()

  // ── Materiales ──────────────────────────────────────────────────────────────
  const asphalt = canvasTexture(512, 512, ctx => {
    ctx.fillStyle = '#2f353b'; ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 38000; i++) {
      const gray = Math.floor(32 + random() * 55)
      ctx.fillStyle = 'rgba(' + gray + ',' + gray + ',' + gray + ',.42)'
      ctx.fillRect(random() * 512, random() * 512, 1.5, 1.5)
    }
  })
  asphalt.wrapS = asphalt.wrapT = T.RepeatWrapping
  const roadTexture = (u: number, v: number) => { const t = asphalt.clone(); t.repeat.set(u, v); t.needsUpdate = true; textures.add(t); return t }
  const roadZ = material(new T.MeshStandardMaterial({ map: roadTexture(1.5, 2 * EDGE / 9), roughness: .82 }))
  const roadX = material(new T.MeshStandardMaterial({ map: roadTexture(2 * EDGE / 9, 1.5), roughness: .82, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }))
  const concrete = paint('#c9b8a6', .9), curb = paint('#e1d3c2', .8), metal = paint('#2b3238', .35, .75)
  const decal = (color: string) => material(new T.MeshStandardMaterial({ color, roughness: .7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
  const marking = decal('#f4ecd8'), yellowLine = decal('#f2c14e')
  const lawn = paint('#62794f', .95), bark = paint('#6d5444')
  const glow = (color: string, strength: number) => material(new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: strength, roughness: .3 }))
  const lampShade = paint('#e9e2d4', .4), whiteLight = glow('#e8f7ff', 4)

  // ── Suelo, calles y marcas viales ───────────────────────────────────────────
  const groundEnd = ENDING_Z
  box(scene, lawn, 0, -.25, (450 + groundEnd) / 2, 900, .4, 450 - groundEnd).castShadow = false
  // Terreno provisional al norte; el final elegido lo reemplaza (el puente y el precipicio necesitan vacío).
  const placeholder = box(scene, lawn, 0, -.25, groundEnd - 150, 900, .4, 300); placeholder.castShadow = false
  const span = 2 * EDGE + 2 * HALF_ROAD
  for (const line of LINES) {
    box(scene, roadZ, line, 0, 0, 2 * HALF_ROAD, .04, span).castShadow = false
    box(scene, roadX, 0, .002, line, span, .04, 2 * HALF_ROAD).castShadow = false
  }
  const exitLength = -EDGE - groundEnd
  box(scene, roadZ, 0, 0, -EDGE - exitLength / 2, 2 * HALF_ROAD, .04, exitLength).castShadow = false
  for (const side of [-1, 1]) box(scene, metal, side * (HALF_ROAD + .6), .5, -EDGE - exitLength / 2 - 6, .15, .35, exitLength - 12)
  const dashes: T.Matrix4[] = [], centers: T.Matrix4[] = [], stops: T.Matrix4[] = [], zebra: T.Matrix4[] = []
  for (const line of LINES) for (let i = 0; i < LINES.length - 1; i++) {
    const a = LINES[i] + HALF_ROAD + 7, b = LINES[i + 1] - HALF_ROAD - 7
    const mid = (a + b) / 2, len = b - a
    centers.push(place(line - .15, .03, mid, .12, 1, len), place(line + .15, .03, mid, .12, 1, len))
    centers.push(place(mid, .032, line - .15, len, 1, .12), place(mid, .032, line + .15, len, 1, .12))
    for (let s = a + 2; s < b; s += 6) for (const off of [-3.5, 3.5]) {
      dashes.push(place(line + off, .03, s, .12, 1, 2.6), place(s, .032, line + off, 2.6, 1, .12))
    }
  }
  for (const x of LINES) for (const z of LINES) {
    for (const [fx, fz] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
      const rx = -fz, rz = fx, stopAt = HALF_ROAD + 4.6
      stops.push(place(x - fx * stopAt + rx * 3.5, .034, z - fz * stopAt + rz * 3.5, fz ? 6.4 : .45, 1, fz ? .45 : 6.4))
      for (let k = -6; k <= 6; k += 1.6) {
        zebra.push(place(x - fx * (HALF_ROAD + 2.2) + rx * k, .033, z - fz * (HALF_ROAD + 2.2) + rz * k, fz ? .8 : 3.2, 1, fz ? 3.2 : .8))
      }
    }
  }
  const flat = geometry(new T.BoxGeometry(1, .02, 1))
  instanced(flat, marking, dashes, false); instanced(flat, yellowLine, centers, false)
  instanced(flat, marking, stops, false); instanced(flat, marking, zebra, false)

  // ── Manzanas: aceras, edificios y un parque ─────────────────────────────────
  const facades = ['#b98f74', '#8c9aa6', '#d1b99b', '#7f8c8a', '#c9a28f', '#9aa8b5'].map((color, n) => {
    const map = canvasTexture(128, 128, ctx => {
      ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 128)
      for (let y = 10; y < 128; y += 32) for (let x = 8; x < 128; x += 32) {
        const lit = random()
        ctx.fillStyle = lit > .8 ? '#ffd79a' : lit > .45 ? '#7c95a6' : '#34495a'
        ctx.fillRect(x, y, 18, 20)
        ctx.fillStyle = n % 2 ? '#ffffff22' : '#00000022'; ctx.fillRect(x, y + 20, 18, 3)
      }
    })
    map.wrapS = map.wrapT = T.RepeatWrapping
    return material(new T.MeshStandardMaterial({ map, roughness: .55, metalness: .15 }))
  })
  const roofMat = paint('#5d6268', .8)
  const glassMat = material(new T.MeshPhysicalMaterial({ color: '#6f95ab', roughness: .06, metalness: .65, clearcoat: 1 }))
  function building(x: number, z: number, w: number, d: number, h: number) {
    const geo = geometry(new T.BoxGeometry(w, h, d))
    const uv = geo.attributes.uv as T.BufferAttribute, normal = geo.attributes.normal as T.BufferAttribute
    for (let i = 0; i < uv.count; i++) {
      const across = Math.abs(normal.getX(i)) > .5 ? d : w
      uv.setXY(i, uv.getX(i) * across / 8, uv.getY(i) * h / 8)
    }
    mesh(scene, geo, random() > .8 ? glassMat : facades[Math.floor(random() * facades.length)], x, h / 2, z)
    box(scene, roofMat, x, h + .2, z, w + .4, .4, d + .4).castShadow = false
    if (h > 26 && random() > .5) box(scene, roofMat, x + (random() - .5) * w * .4, h + 1.6, z + (random() - .5) * d * .4, 3, 2.8, 3)
  }
  const inner = BLOCK - 2 * HALF_ROAD
  const treeSpots: [number, number][] = []
  const sidewalkMats: T.Matrix4[] = [], curbMats: T.Matrix4[] = []
  for (let bx = -2.5; bx <= 2.5; bx++) for (let bz = -2.5; bz <= 2.5; bz++) {
    const cx = bx * BLOCK, cz = bz * BLOCK
    sidewalkMats.push(place(cx, .1, cz, inner, .2, inner))
    curbMats.push(place(cx, .12, cz, inner + .3, .24, inner + .3))
    if (Math.abs(bx) > 2 || Math.abs(bz) > 2) {
      // Anillo exterior: una muralla de edificios cierra la ciudad, salvo la salida norte.
      if (bz < -2 && Math.abs(cx) < BLOCK) building(cx + Math.sign(cx) * 8, cz + 6, inner - 16, inner - 12, 14 + random() * 20)
      else building(cx, cz, inner - 6, inner - 6, 16 + random() * 40)
      continue
    }
    if (bx === -.5 && bz === .5) {
      box(scene, lawn, cx, .22, cz, inner - 8, .1, inner - 8).castShadow = false
      mesh(scene, geometry(new T.CylinderGeometry(5, 5.4, .8, 32)), concrete, cx, .5, cz).castShadow = false
      mesh(scene, geometry(new T.CylinderGeometry(4.5, 4.5, .1, 32)), material(new T.MeshStandardMaterial({ color: '#5fb3c9', roughness: .05, metalness: .3 })), cx, .86, cz)
      mesh(scene, poleGeo, concrete, cx, 1.8, cz, .35, 2.4, .35)
      for (let k = 0; k < 10; k++) treeSpots.push([cx + (random() - .5) * (inner - 14), cz + (random() - .5) * (inner - 14)])
      continue
    }
    const half = (inner - 8) / 2
    for (const qx of [-1, 1]) for (const qz of [-1, 1]) {
      building(cx + qx * (half / 2 + 1), cz + qz * (half / 2 + 1), half - 2 - random() * 4, half - 2 - random() * 4,
        10 + random() * (Math.abs(bx) + Math.abs(bz) < 2 ? 46 : 28))
    }
  }
  instanced(unitBox, concrete, sidewalkMats, false); instanced(unitBox, curb, curbMats, false)
  for (const line of LINES) for (let i = 0; i < LINES.length - 1; i++) {
    for (let s = LINES[i] + HALF_ROAD + 10; s < LINES[i + 1] - HALF_ROAD - 8; s += 13) {
      for (const side of [-1, 1]) {
        const off = line + side * (HALF_ROAD + 2.1)
        treeSpots.push([off, s])
        treeSpots.push([s, off])
      }
    }
  }
  instanced(poleGeo, bark, treeSpots.map(([x, z]) => place(x, 1.6, z, .17, 3.2, .17)))
  const leafGeo = geometry(new T.IcosahedronGeometry(1, mobile ? 0 : 1))
  const leafMats = ['#4f6f45', '#6b8a4c', '#7e9551'].map(c => paint(c, .95))
  const crownCounts = [0, 0, 0]
  const crownBase: { x: number; z: number; y: number; s: number; phase: number; mesh: number; slot: number }[] = []
  treeSpots.forEach(([x, z], i) => {
    for (let j = 0; j < 3; j++) {
      const m = (i + j) % 3
      crownBase.push({ x: x + Math.cos(j * 2.1) * .6, z: z + Math.sin(j * 2.1) * .6, y: 3.6 + j * .45, s: 1.3 - j * .15, phase: i * 1.3 + j, mesh: m, slot: crownCounts[m]++ })
    }
  })
  const crowns = leafMats.map((mat, m) => instanced(leafGeo, mat, Array.from({ length: crownCounts[m] }, () => new T.Matrix4())))
  const lampPoles: T.Matrix4[] = [], lampHeads: T.Matrix4[] = []
  for (const line of LINES) for (let i = 0; i < LINES.length - 1; i++) {
    const s = (LINES[i] + LINES[i + 1]) / 2
    for (const side of [-1, 1]) {
      lampPoles.push(place(line + side * (HALF_ROAD + 1), 3.5, s, .09, 7, .09), place(s, 3.5, line + side * (HALF_ROAD + 1), .09, 7, .09))
      lampHeads.push(place(line + side * (HALF_ROAD - .3), 6.95, s, 1.6, .12, .45), place(s, 6.95, line + side * (HALF_ROAD - .3), .45, .12, 1.6))
    }
  }
  instanced(poleGeo, metal, lampPoles); instanced(unitBox, lampShade, lampHeads, false)
  const hillMat = paint('#8a7a6e', 1)
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2, r = 330 + random() * 60, hz = Math.sin(a) * r
    if (hz < groundEnd) continue
    mesh(scene, geometry(new T.ConeGeometry(40 + random() * 40, 30 + random() * 60, 6)), hillMat, Math.cos(a) * r, 10, hz).castShadow = false
  }

  // ── Semáforos de verdad: poste, brazo, cabezal con placa, viseras y 3 luces ──
  const crossings: Crossing[] = []
  LINES.forEach(x => LINES.forEach(z => crossings.push({ x, z })))
  const heads: { crossing: number; axis: 'ns' | 'ew' }[] = []
  const parts = { pole: [] as T.Matrix4[], arm: [] as T.Matrix4[], housing: [] as T.Matrix4[], plate: [] as T.Matrix4[], frame: [] as T.Matrix4[], visor: [] as T.Matrix4[], lamp: [] as T.Matrix4[] }
  function addHead(hx: number, hy: number, hz: number, yaw: number, crossing: number, axis: 'ns' | 'ew') {
    heads.push({ crossing, axis })
    const fx = Math.sin(yaw), fz = Math.cos(yaw)
    parts.housing.push(place(hx, hy, hz, 1, 1, 1, yaw))
    // Placa negra delante y el borde amarillo detrás, visible solo de frente (por detrás se ve negro).
    parts.plate.push(place(hx - fx * .19, hy, hz - fz * .19, 1, 1, 1, yaw))
    parts.frame.push(place(hx - fx * .215, hy, hz - fz * .215, 1, 1, 1, yaw))
    for (let k = 0; k < 3; k++) {
      const ly = hy + .42 - k * .42
      parts.lamp.push(place(hx + fx * .185, ly, hz + fz * .185, 1, 1, 1, yaw))
      parts.visor.push(place(hx + fx * .33, ly + .02, hz + fz * .33, 1, 1, 1, yaw, Math.PI / 2))
    }
  }
  crossings.forEach(({ x, z }, c) => {
    for (const [fx, fz] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
      // Para quien llega con dirección f: poste en la esquina lejana derecha y brazo sobre sus carriles.
      const rx = -fz, rz = fx, corner = HALF_ROAD + 1.4
      const px = x + fx * corner + rx * corner, pz = z + fz * corner + rz * corner
      if (Math.abs(px) > EDGE + 12 || Math.abs(pz) > EDGE + 12) continue
      parts.pole.push(place(px, 3.4, pz, .16, 6.8, .16))
      const armLen = 7.4
      parts.arm.push(place(px - rx * armLen / 2, 6.55, pz - rz * armLen / 2, rx ? armLen : .16, .16, rz ? armLen : .16))
      const yaw = Math.atan2(-fx, -fz), axis = fz ? 'ns' : 'ew'
      addHead(px - rx * 4.6, 5.55, pz - rz * 4.6, yaw, c, axis)
      addHead(px - fx * .25, 3.2, pz - fz * .25, yaw, c, axis)
    }
  })
  const signalBlack = paint('#15181b', .45, .4)
  instanced(poleGeo, signalBlack, parts.pole); instanced(unitBox, signalBlack, parts.arm)
  instanced(geometry(new RoundedBoxGeometry(.52, 1.36, .36, 3, .07)), signalBlack, parts.housing)
  instanced(geometry(new T.BoxGeometry(.86, 1.62, .03)), signalBlack, parts.plate)
  instanced(geometry(new T.PlaneGeometry(.96, 1.72)), material(new T.MeshStandardMaterial({ color: '#f2c43d', roughness: .5, side: T.FrontSide })), parts.frame, false)
  instanced(geometry(new T.CylinderGeometry(.19, .19, .3, 16, 1, true, -Math.PI / 2, Math.PI)),
    material(new T.MeshStandardMaterial({ color: '#15181b', roughness: .5, side: T.DoubleSide })), parts.visor, false)
  const lampMesh = instanced(geometry(new T.CircleGeometry(.155, 24)), material(new T.MeshBasicMaterial({ toneMapped: false })), parts.lamp, false)
  const LAMP_ON = [new T.Color(4, .35, .25), new T.Color(3.6, 1.6, .15), new T.Color(.3, 3.4, .9)]
  const LAMP_OFF = [new T.Color('#3a1210'), new T.Color('#3a2a0e'), new T.Color('#0e2a16')]
  for (let i = 0; i < parts.lamp.length; i++) lampMesh.setColorAt(i, LAMP_OFF[i % 3])
  let lampKey = ''
  /** Semáforos de adorno en ciclo; el del objetivo muestra lo que diga la partida. 0 rojo · 1 ámbar · 2 verde. */
  function lightState(t: number, crossing: number, axis: 'ns' | 'ew', target: number, targetGreen: boolean): 0 | 1 | 2 {
    if (crossing === target) return targetGreen ? 2 : 0
    const phase = (t + (crossing % 3) * 2.1) % 16
    if (axis === 'ns') return phase < 6.5 ? 2 : phase < 8 ? 1 : 0
    return phase >= 8 && phase < 14.5 ? 2 : phase >= 14.5 ? 1 : 0
  }
  function updateLights(t: number, target: number, targetGreen: boolean) {
    const states = heads.map(h => lightState(t, h.crossing, h.axis, target, targetGreen))
    const key = states.join('')
    if (key === lampKey) return
    lampKey = key
    states.forEach((s, h) => { for (let k = 0; k < 3; k++) lampMesh.setColorAt(h * 3 + k, k === s ? LAMP_ON[k] : LAMP_OFF[k]) })
    if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true
  }

  // ── Marcador del objetivo estilo GTA: columna de luz y anillo en el piso ────
  const beaconMat = material(new T.ShaderMaterial({
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, toneMapped: false,
    uniforms: { color: { value: new T.Color(.25, 2.4, .8) }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 color; uniform float time; varying vec2 vUv; void main(){ float a = (1. - vUv.y) * (.3 + .08 * sin(time * 3. + vUv.y * 12.)); gl_FragColor = vec4(color * a, a); }',
  }))
  const beacon = new T.Group(); scene.add(beacon)
  mesh(beacon, geometry(new T.CylinderGeometry(3.2, 3.2, 70, 32, 1, true)), beaconMat, 0, 35, 0).castShadow = false
  const ring = mesh(beacon, geometry(new T.RingGeometry(4.2, 5, 48)), material(new T.MeshBasicMaterial({ color: new T.Color(.3, 2.6, .9), transparent: true, opacity: .7, toneMapped: false, depthWrite: false })), 0, .08, 0)
  ring.rotation.x = -Math.PI / 2; ring.castShadow = false

  // ── Barrera de la salida: se abre al terminar las preguntas ─────────────────
  const barrier = new T.Group(); scene.add(barrier)
  const stripe = material(new T.MeshStandardMaterial({ roughness: .6, map: canvasTexture(128, 16, ctx => {
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f4f1ea' : '#d8322f'; ctx.fillRect(i * 16, 0, 16, 16) }
  }) }))
  box(barrier, stripe, 0, 1.1, -EDGE - 12, 2 * HALF_ROAD, .35, .3)
  for (const x of [-HALF_ROAD + .4, HALF_ROAD - .4]) box(barrier, metal, x, .6, -EDGE - 12, .3, 1.2, .3)

  const trafficPaintsBase = () => ['#d9d4c7', '#39506b', '#a3423a', '#e0b646', '#2f2f35', '#8fb3c4', '#f2f0ea'].map(c => material(new T.MeshStandardMaterial({ color: c, metalness: .4, roughness: .35 })))
  const parkedShell = geometry(new RoundedBoxGeometry(1.9, .65, 4.1, 2, .2)), parkedCabin = geometry(new RoundedBoxGeometry(1.55, .6, 2, 2, .2))
  const parkedGlass = paint('#1f3440', .2, .4), parkedTire = paint('#14171b', .95)
  const parkedTireGeo = geometry(new T.CylinderGeometry(.39, .39, .25, 12))
  function carShellStatic(group: T.Group, paintMat: T.Material) {
    mesh(group, parkedShell, paintMat, 0, .6, 0); mesh(group, parkedCabin, parkedGlass, 0, 1.13, .25)
    for (const side of [-1, 1]) for (const z of [-1.2, 1.2]) mesh(group, parkedTireGeo, parkedTire, side * .95, .37, z).rotation.z = Math.PI / 2
  }
  // ── Mobiliario urbano ───────────────────────────────────────────────────────
  const benchParts: T.Matrix4[] = [], bins: T.Matrix4[] = [], hydrants: T.Matrix4[] = []
  for (const line of LINES) for (let i = 0; i < LINES.length - 1; i++) {
    const a = LINES[i] + HALF_ROAD + 6
    for (const side of [-1, 1]) {
      const off = line + side * (HALF_ROAD + 3.6), s1 = a + 5 + random() * 30
      benchParts.push(place(off, .45, s1, .5, .1, 1.8), place(off + side * .22, .75, s1, .08, .5, 1.8))
      benchParts.push(place(s1, .45, off, 1.8, .1, .5), place(s1, .75, off + side * .22, 1.8, .5, .08))
      bins.push(place(off, .45, s1 + 3, .45, .9, .45), place(s1 + 3, .45, off, .45, .9, .45))
      hydrants.push(place(line + side * (HALF_ROAD + .9), .35, a + 2, .18, .7, .18))
    }
  }
  instanced(unitBox, paint('#7a5a3e', .8), benchParts); instanced(poleGeo, paint('#3f5a4a', .7), bins)
  instanced(poleGeo, paint('#c8322b', .5), hydrants)

  // Paradas de bus con techo, vidrio y banca.
  const shelterGlass = material(new T.MeshStandardMaterial({ color: '#b9d9e6', transparent: true, opacity: .35, roughness: .05 }))
  const busSign = material(new T.MeshBasicMaterial({ map: canvasTexture(128, 128, ctx => {
    ctx.fillStyle = '#10a46a'; ctx.beginPath(); ctx.arc(64, 64, 60, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BUS', 64, 82)
  }) }))
  for (const [x, z, yaw] of [[HALF_ROAD + 3.2, 96, 0], [-HALF_ROAD - 3.2, -96, Math.PI], [64 + HALF_ROAD + 3.2, 20, 0], [-40, 64 + HALF_ROAD + 3.2, Math.PI / 2], [30, -64 - HALF_ROAD - 3.2, -Math.PI / 2], [-64 - HALF_ROAD - 3.2, 30, Math.PI]] as const) {
    const stop = new T.Group(); stop.position.set(x, 0, z); stop.rotation.y = yaw; scene.add(stop)
    box(stop, metal, 0, 2.6, 0, 1.8, .12, 4.4)
    box(stop, shelterGlass, .8, 1.35, 0, .05, 2.4, 4.2).castShadow = false
    for (const zz of [-2.1, 2.1]) box(stop, metal, .8, 1.3, zz, .1, 2.6, .1)
    box(stop, paint('#7a5a3e', .8), .45, .5, 0, .5, .1, 3)
    mesh(stop, poleGeo, metal, -.7, 1.5, 2.6, .05, 3, .05)
    mesh(stop, geometry(new T.CircleGeometry(.4, 24)), busSign, -.7, 3.1, 2.62).castShadow = false
  }

  // Autos estacionados en el carril exterior: obligan a ir por el interior o esquivar.
  const obstacles: { x: number; z: number; r: number }[] = []
  const parkedPaints = trafficPaintsBase()
  for (const line of LINES) for (let i = 0; i < LINES.length - 1; i++) for (const axis of ['z', 'x'] as const) for (const side of [-1, 1]) {
    if (random() > (mobile ? .18 : .32)) continue
    if (line === 0 && axis === 'z') continue
    const start = LINES[i] + HALF_ROAD + 12 + random() * 14
    for (let k = 0; k < 2; k++) {
      const along = start + k * 6.4, off = line + side * 6.1
      const group = new T.Group(); scene.add(group)
      carShellStatic(group, parkedPaints[Math.floor(random() * parkedPaints.length)])
      if (axis === 'z') { group.position.set(off, 0, along); group.rotation.y = side > 0 ? Math.PI : 0 }
      else { group.position.set(along, 0, off); group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2 }
      for (const d of [-1.2, 1.2]) obstacles.push(axis === 'z' ? { x: off, z: along + d, r: 1.05 } : { x: along + d, z: off, r: 1.05 })
    }
  }

  // Obras en la vía: conos, barriles y vallas con física propia. Se pueden atropellar:
  // salen empujados según la velocidad, se voltean y ruedan hasta quedarse quietos.
  const coneGeo = geometry(new T.ConeGeometry(.32, .76, 14).translate(0, .38, 0))
  const coneBandGeo = geometry(new T.CylinderGeometry(.19, .235, .13, 14, 1, true).translate(0, .36, 0))
  const barrelGeo = geometry(new T.CylinderGeometry(.42, .42, 1.1, 16).translate(0, .55, 0))
  const fenceParts = [new T.BoxGeometry(2.8, .5, .08).translate(0, .95, 0), new T.BoxGeometry(.08, 1.1, .08).translate(-1.2, .55, 0), new T.BoxGeometry(.08, 1.1, .08).translate(1.2, .55, 0), new T.BoxGeometry(.5, .06, .6).translate(-1.2, .03, 0), new T.BoxGeometry(.5, .06, .6).translate(1.2, .03, 0)]
  const fenceGeo = geometry(mergeGeometries(fenceParts)); fenceParts.forEach(g => g.dispose())
  const barrelStripes = material(new T.MeshStandardMaterial({ roughness: .5, map: canvasTexture(16, 128, ctx => {
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f4f1ea' : '#f06a24'; ctx.fillRect(0, i * 16, 16, 16) }
  }) }))
  interface Prop { kind: 0 | 1 | 2; x: number; z: number; y: number; vx: number; vz: number; vy: number; yaw: number; tilt: number; tiltTo: number; axis: number; spin: number; r: number; lie: number; slot: number; moving: boolean }
  const props: Prop[] = []
  const works: [number, 'x' | 'z', number, number][] = [[LINES[1], 'z', 1, 1], [LINES[3], 'x', 2, -1], [LINES[4], 'z', 0, 1], [LINES[2], 'x', 3, 1], [LINES[1], 'x', 1, -1]]
  const slots = [0, 0, 0]
  const addProp = (kind: 0 | 1 | 2, x: number, z: number, yaw = 0) => props.push({ kind, x, z, y: 0, vx: 0, vz: 0, vy: 0, yaw, tilt: 0, tiltTo: 0, axis: 0, spin: 0, r: [.42, .55, 1.4][kind], lie: [.3, .42, .1][kind], slot: slots[kind]++, moving: false })
  for (const [line, axis, seg, side] of works) {
    const mid = (LINES[seg] + LINES[seg + 1]) / 2
    for (let k = -8; k <= 8; k += 2) {
      const off = line + side * (k === -8 || k === 8 ? 2.8 : 1.9)
      addProp(0, axis === 'z' ? off : mid + k, axis === 'z' ? mid + k : off)
    }
    for (const k of [-10.5, 10.5]) addProp(1, axis === 'z' ? line + side * 4.6 : mid + k, axis === 'z' ? mid + k : line + side * 4.6)
    addProp(2, axis === 'z' ? line + side * 1.9 : mid - 9.5, axis === 'z' ? mid - 9.5 : line + side * 1.9, axis === 'z' ? 0 : Math.PI / 2)
  }
  const propMeshes = [
    [new T.InstancedMesh(coneGeo, paint('#f06a24', .55), slots[0]), new T.InstancedMesh(coneBandGeo, material(new T.MeshStandardMaterial({ color: '#f4f1ea', roughness: .3, side: T.DoubleSide })), slots[0])],
    [new T.InstancedMesh(barrelGeo, barrelStripes, slots[1])],
    [new T.InstancedMesh(fenceGeo, stripe, slots[2])],
  ]
  propMeshes.flat().forEach(m => { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m) })
  const tiltQ = new T.Quaternion(), yawQ = new T.Quaternion(), tiltAxis = new T.Vector3(), upAxis = new T.Vector3(0, 1, 0)
  function writeProp(p: Prop) {
    yawQ.setFromAxisAngle(upAxis, p.yaw)
    tiltAxis.set(Math.cos(p.axis), 0, Math.sin(p.axis)); tiltQ.setFromAxisAngle(tiltAxis, p.tilt)
    dummy.position.set(p.x, p.y + Math.sin(Math.min(Math.PI / 2, p.tilt)) * p.lie, p.z); dummy.scale.set(1, 1, 1)
    dummy.quaternion.copy(tiltQ).multiply(yawQ); dummy.updateMatrix()
    for (const m of propMeshes[p.kind]) m.setMatrixAt(p.slot, dummy.matrix)
  }
  props.forEach(writeProp)
  /** El auto (tres puntos a lo largo de su eje) empuja lo que toque. Devuelve si golpeó algo. */
  function bumpProps(x: number, z: number, fx: number, fz: number, speed: number) {
    let hit = false
    for (const p of props) {
      if (Math.abs(p.x - x) > 5 || Math.abs(p.z - z) > 5) continue
      for (let k = -1.3; k <= 1.31; k += 1.3) {
        const cx = x + fx * k, cz = z + fz * k, dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz)
        if (d > p.r + 1) continue
        const nx = d > .001 ? dx / d : fx, nz = d > .001 ? dz / d : fz
        const push = Math.abs(speed)
        p.x = cx + nx * (p.r + 1.02); p.z = cz + nz * (p.r + 1.02)
        p.vx = nx * Math.max(1.2, push * .5) + fx * speed * .9; p.vz = nz * Math.max(1.2, push * .5) + fz * speed * .9
        p.vy = Math.min(7, push * .38); p.spin = (random() - .5) * (4 + push)
        p.axis = Math.atan2(p.vx, -p.vz); if (push > 2.5) p.tiltTo = Math.PI / 2
        p.moving = true; hit = true
        break
      }
    }
    return hit
  }
  function updateProps(dt: number) {
    let changed = [false, false, false]
    for (const p of props) {
      if (!p.moving) continue
      p.vy -= 22 * dt; p.y += p.vy * dt
      if (p.y <= 0) { p.y = 0; p.vy = Math.abs(p.vy) > 1.5 ? -p.vy * .3 : 0 }
      const ground = p.y === 0 ? Math.exp(-dt * 2.6) : 1
      p.vx *= ground; p.vz *= ground; p.x += p.vx * dt; p.z += p.vz * dt
      p.yaw += p.spin * dt; p.spin *= Math.exp(-dt * 2)
      p.tilt += (p.tiltTo - p.tilt) * Math.min(1, dt * 7)
      changed[p.kind] = true
      if (p.y === 0 && p.vy === 0 && Math.hypot(p.vx, p.vz) < .05 && Math.abs(p.spin) < .05 && Math.abs(p.tilt - p.tiltTo) < .01) p.moving = false
      writeProp(p)
    }
    changed.forEach((c, kind) => { if (c) propMeshes[kind].forEach(m => { m.instanceMatrix.needsUpdate = true }) })
    changed = [false, false, false]
  }

  // Letreros con el nombre de las calles en cada cruce.
  const streetNames = { x: ['Av. Innovación', 'Calle Servicio', 'Av. Aprendizaje', 'Calle Talento', 'Av. Futuro'], z: ['Calle Norte', 'Calle Liderazgo', 'Av. Central', 'Calle Equipo', 'Calle Sur'] }
  const nameMat = (label: string) => material(new T.MeshBasicMaterial({ map: canvasTexture(256, 48, ctx => {
    ctx.fillStyle = '#0f6b3f'; ctx.fillRect(0, 0, 256, 48); ctx.strokeStyle = '#f4f1ea'; ctx.lineWidth = 3; ctx.strokeRect(3, 3, 250, 42)
    ctx.fillStyle = '#f4f1ea'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, 128, 33)
  }) }))
  const namesX = streetNames.x.map(nameMat), namesZ = streetNames.z.map(nameMat)
  const plateGeo = geometry(new T.BoxGeometry(2.6, .48, .04))
  LINES.forEach((x, ix) => LINES.forEach((z, iz) => {
    const px = x + HALF_ROAD + 1.4, pz = z + HALF_ROAD + 1.4
    mesh(scene, poleGeo, metal, px + 1.2, 2, pz + 1.2, .06, 4, .06)
    const a = mesh(scene, plateGeo, namesX[ix], px + 1.2, 3.9, pz + 1.2); a.rotation.y = Math.PI / 2
    mesh(scene, plateGeo, namesZ[iz], px + 1.2, 4.45, pz + 1.2)
  }))

  // Vallas publicitarias al final de las avenidas.
  const billboards = ['Aprende algo nuevo cada día', 'Escucha, entiende y resuelve', 'Tu conocimiento te lleva más lejos', 'Learning Lab · Drive Academy']
  const boards: [number, number, number][] = [[-BLOCK * 1.5, EDGE + 22, Math.PI], [BLOCK * 1.5, -EDGE - 22, 0], [EDGE + 22, BLOCK * .5, -Math.PI / 2], [-EDGE - 22, -BLOCK * .5, Math.PI / 2]]
  boards.forEach(([x, z, yaw], i) => {
    const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = yaw; scene.add(g)
    for (const dx of [-5, 5]) mesh(g, poleGeo, metal, dx, 6, 0, .25, 12, .25)
    box(g, material(new T.MeshBasicMaterial({ map: canvasTexture(512, 192, ctx => {
      const gradient = ctx.createLinearGradient(0, 0, 512, 192)
      gradient.addColorStop(0, i % 2 ? '#B33D9E' : '#10a46a'); gradient.addColorStop(1, '#101418')
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 192)
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center'
      const words = billboards[i].split(' '), mid = Math.ceil(words.length / 2)
      ctx.fillText(words.slice(0, mid).join(' '), 256, 86); ctx.fillText(words.slice(mid).join(' '), 256, 136)
    }) })), 0, 13, 0, 14, 5.2, .3)
  })

  // ── El auto (mira hacia -z) ─────────────────────────────────────────────────
  const car = new T.Group(); scene.add(car)
  const body = material(new T.MeshPhysicalMaterial({ color: '#10a46a', metalness: .72, roughness: .22, clearcoat: 1, clearcoatRoughness: .1 }))
  const carbon = paint('#142129', .4, .3), chrome = paint('#c2ced1', .21, .9), rubber = paint('#14171b', .95)
  const glass = material(new T.MeshPhysicalMaterial({ color: '#183746', metalness: .38, roughness: .12, clearcoat: 1 }))
  rounded(car, body, 0, .65, 0, 2.05, .65, 4.45, .23)
  rounded(car, body, 0, .98, -.45, 1.96, .28, 3.4, .12)
  const cabinProfile = new T.Shape()
  cabinProfile.moveTo(-1.12, 1.02); cabinProfile.lineTo(-.59, 1.54); cabinProfile.lineTo(.56, 1.57); cabinProfile.lineTo(1.25, 1.05); cabinProfile.closePath()
  const cabinGeometry = geometry(new T.ExtrudeGeometry(cabinProfile, { depth: 1.58, bevelEnabled: true, bevelSize: .035, bevelThickness: .035, bevelSegments: 2, steps: 1 }))
  cabinGeometry.rotateY(-Math.PI / 2); cabinGeometry.translate(.79, 0, 0)
  mesh(car, cabinGeometry, glass, 0, 0, 0)
  const contactMap = canvasTexture(128, 128, ctx => {
    const gradient = ctx.createRadialGradient(64, 64, 12, 64, 64, 64)
    gradient.addColorStop(0, '#000000bb'); gradient.addColorStop(.55, '#00000077'); gradient.addColorStop(1, '#00000000')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128)
  })
  const contact = mesh(car, geometry(new T.PlaneGeometry(3.8, 6)), material(new T.MeshBasicMaterial({ map: contactMap, transparent: true, depthWrite: false })), 0, .03, 0)
  contact.rotation.x = -Math.PI / 2; contact.castShadow = false; contact.receiveShadow = false
  rounded(car, body, 0, 1.59, .02, 1.53, .055, 1.14, .04)
  for (const side of [-1, 1]) {
    const pillar = box(car, body, side * .78, 1.28, .92, .075, .63, .08); pillar.rotation.x = -.28
    rounded(car, body, side * 1.05, 1.18, -.28, .28, .16, .36, .05)
    box(car, carbon, side * .99, .4, 0, .12, .12, 3)
  }
  rounded(car, carbon, 0, .47, 2.15, 1.75, .25, .2, .06)
  rounded(car, carbon, 0, .52, -2.19, 1.5, .24, .15, .04)
  box(car, carbon, 0, .99, 1.98, 1.85, .055, .38)
  const tail = glow('#ff2847', 2.8)
  rounded(car, tail, 0, .86, 2.225, 1.8, .065, .035, .015)
  for (const x of [-.7, .7]) {
    rounded(car, whiteLight, x, .87, -2.16, .44, .065, .09, .025)
    mesh(car, geometry(new T.CylinderGeometry(.09, .09, .22, 12)), chrome, x, .4, 2.2).rotation.x = Math.PI / 2
  }
  const plate = material(new T.MeshBasicMaterial({ map: canvasTexture(256, 80, ctx => {
    ctx.fillStyle = '#e6e4d5'; ctx.fillRect(0, 0, 256, 80)
    ctx.fillStyle = '#24373a'; ctx.font = 'bold 38px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('LEARN 01', 128, 54)
  }) }))
  mesh(car, geometry(new T.PlaneGeometry(.61, .19)), plate, 0, .56, 2.261)
  const wheels: T.Group[] = [], frontWheels: T.Group[] = []
  const tireGeo = geometry(new T.CylinderGeometry(.39, .39, .25, 24)), rimGeo = geometry(new T.CylinderGeometry(.27, .27, .265, 20))
  for (const side of [-1, 1]) for (const z of [-1.38, 1.38]) {
    const mount = new T.Group(); mount.position.set(side * 1.01, .4, z); car.add(mount)
    const wheel = new T.Group(); mount.add(wheel); wheels.push(wheel)
    if (z < 0) frontWheels.push(mount)
    mesh(wheel, tireGeo, rubber, 0, 0, 0).rotation.z = Math.PI / 2
    mesh(wheel, rimGeo, carbon, 0, 0, 0).rotation.z = Math.PI / 2
    for (let j = 0; j < 5; j++) box(wheel, chrome, side * .14, 0, 0, .026, .49, .055).rotation.x = j * Math.PI / 5
  }

  // ── Tráfico: respeta los semáforos y frena si tienes el auto delante ────────
  const trafficPaints = ['#d9d4c7', '#39506b', '#a3423a', '#e0b646', '#2f2f35', '#8fb3c4'].map(c => material(new T.MeshStandardMaterial({ color: c, metalness: .45, roughness: .32 })))
  const shellGeo = geometry(new RoundedBoxGeometry(1.9, .65, 4.1, 3, .2)), cabinGeo = geometry(new RoundedBoxGeometry(1.55, .6, 2, 3, .2))
  function carShell(parent: T.Object3D, paintMat: T.Material) {
    const group = new T.Group(); parent.add(group)
    mesh(group, shellGeo, paintMat, 0, .6, 0); mesh(group, cabinGeo, glass, 0, 1.13, .25)
    for (const side of [-1, 1]) {
      box(group, whiteLight, side * .62, .7, -2.06, .32, .1, .05)
      box(group, tail, side * .62, .72, 2.06, .32, .1, .05)
      for (const z of [-1.2, 1.2]) mesh(group, tireGeo, rubber, side * .95, .37, z).rotation.z = Math.PI / 2
    }
    return group
  }
  interface Traffic { group: T.Group; axis: 'x' | 'z'; line: number; dir: 1 | -1; pos: number; speed: number; v: number }
  const traffic: Traffic[] = []
  for (let i = 0; i < (mobile ? 7 : 14); i++) {
    const group = carShell(scene, trafficPaints[i % trafficPaints.length])
    const pos = -EDGE + random() * 2 * EDGE
    traffic.push({ group, axis: i % 2 ? 'x' : 'z', line: LINES[(i * 3 + 1) % 5], dir: i % 3 ? 1 : -1, pos, speed: 8 + random() * 3, v: 8 })
  }

  // ── Peatones de pocos polígonos ─────────────────────────────────────────────
  const skin = ['#8d5a3b', '#c68c64', '#e0b08b', '#6b4430'].map(c => paint(c, .8))
  const clothes = ['#10D451', '#B33D9E', '#e0ebe7', '#3d4b57', '#c7a15a', '#7a8791', '#2c6e5a', '#e57b5c'].map(c => paint(c, .75))
  const pants = ['#2b3440', '#4a4f57', '#2f3b31', '#5b4a3d'].map(c => paint(c, .8))
  const headGeo = geometry(new T.SphereGeometry(.17, 10, 8))
  /** Los que cruzan (`cross`) esperan en la esquina y atraviesan la calle por la cebra: hay que frenarles. */
  interface Crossing3 { x: number; z: number; rx: number; rz: number; at: number; dir: number; wait: number }
  interface Walker { body: T.Group; legs: T.Group[]; arms: T.Group[]; axis: 'x' | 'z'; dir: number; speed: number; step: number; down: number; cross?: Crossing3 }
  const walkers: Walker[] = []
  for (let i = 0; i < (mobile ? 14 : 30); i++) {
    const body = new T.Group(); scene.add(body)
    const shirt = clothes[i % clothes.length], leg = pants[i % pants.length]
    rounded(body, shirt, 0, 1.3, 0, .46, .66, .28, .1)
    mesh(body, headGeo, skin[i % skin.length], 0, 1.84, 0)
    const legs = [-1, 1].map(s => { const hip = new T.Group(); hip.position.set(s * .12, .98, 0); body.add(hip); box(hip, leg, 0, -.47, 0, .16, .94, .18); return hip })
    const arms = [-1, 1].map(s => { const sh = new T.Group(); sh.position.set(s * .3, 1.58, 0); body.add(sh); box(sh, shirt, 0, -.3, 0, .11, .6, .13); return sh })
    const axis = i % 2 ? 'x' : 'z', side = i % 4 < 2 ? 1 : -1
    const lane = LINES[i % 5] + side * (HALF_ROAD + 2.6 + random() * 1.2), along = -EDGE + random() * 2 * EDGE, dir = i % 3 ? 1 : -1
    if (axis === 'z') body.position.set(lane, 0, along); else body.position.set(along, 0, lane)
    body.rotation.y = axis === 'z' ? (dir > 0 ? Math.PI : 0) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2)
    walkers.push({ body, legs, arms, axis, dir, speed: 1.1 + random() * .6, step: random() * 10, down: 0 })
  }
  for (let i = 0; i < (mobile ? 6 : 12); i++) {
    const w = walkers[i]
    // Cruces cerca del recorrido: el primero, en la avenida de salida, se ve desde el inicio.
    const c = i === 0 ? { x: 0, z: BLOCK } : { x: LINES[Math.floor(random() * 5)], z: LINES[Math.floor(random() * 5)] }
    const [fx, fz] = [[0, -1], [0, 1], [1, 0], [-1, 0]][i === 0 ? 1 : Math.floor(random() * 4)]
    const rx = -fz, rz = fx, back = HALF_ROAD + 2.2
    w.cross = { x: c.x - fx * back, z: c.z - fz * back, rx, rz, at: random() > .5 ? 9.5 : -9.5, dir: 0, wait: 2 + random() * 6 }
    w.speed = 1.25 + random() * .3
  }

  // ── Hojas que caen alrededor del auto ───────────────────────────────────────
  const leafCount = mobile ? 40 : 110
  const fallingLeaves = new T.InstancedMesh(geometry(new T.PlaneGeometry(.3, .19)), material(new T.MeshStandardMaterial({ color: '#ffffff', roughness: .9, side: T.DoubleSide })), leafCount)
  fallingLeaves.frustumCulled = false; scene.add(fallingLeaves)
  const leafTones = ['#6f8a4f', '#8a9a55', '#c9a052', '#b8743f', '#577454'].map(c => new T.Color(c))
  const leaves = Array.from({ length: leafCount }, (_, i) => {
    fallingLeaves.setColorAt(i, leafTones[i % leafTones.length])
    return { x: 0, y: -10, z: 0, fall: .4 + random() * .35, sway: .3 + random() * .5, spin: 1 + random() * 2.5, phase: random() * 6.3 }
  })

  /** Vida de la ciudad: viento, hojas, peatones y tráfico. `focus` es el auto del jugador. */
  function ambient(t: number, dt: number, focus: { x: number; z: number }, target: number, targetGreen: boolean) {
    const gust = .7 + .3 * Math.sin(t * .23) + .15 * Math.sin(t * .71)
    for (const c of crownBase) {
      dummy.position.set(c.x + Math.sin(t * 1.2 + c.phase) * .12 * gust, c.y, c.z + Math.sin(t * .8 + c.phase * 1.7) * .09 * gust)
      dummy.rotation.set(Math.sin(t * .9 + c.phase) * .05 * gust, 0, Math.sin(t * 1.3 + c.phase) * .06 * gust)
      dummy.scale.set(c.s, c.s * 1.15, c.s); dummy.updateMatrix()
      crowns[c.mesh].setMatrixAt(c.slot, dummy.matrix)
    }
    crowns.forEach(im => { im.instanceMatrix.needsUpdate = true })
    leaves.forEach((leaf, i) => {
      leaf.y -= leaf.fall * dt
      leaf.x += (Math.sin(t * leaf.sway * 2 + leaf.phase) * .35 + .15) * dt * gust
      if (leaf.y < .03 || Math.abs(leaf.x - focus.x) > 45 || Math.abs(leaf.z - focus.z) > 45) {
        leaf.x = focus.x + (random() - .5) * 70; leaf.z = focus.z + (random() - .5) * 70; leaf.y = 2.5 + random() * 5
      }
      dummy.position.set(leaf.x, leaf.y, leaf.z); dummy.scale.set(1, 1, 1)
      dummy.rotation.set(t * leaf.spin + leaf.phase, t * leaf.spin * .7, Math.sin(t * 2 + leaf.phase) * .8)
      dummy.updateMatrix(); fallingLeaves.setMatrixAt(i, dummy.matrix)
    })
    fallingLeaves.instanceMatrix.needsUpdate = true
    for (const w of walkers) {
      const p = w.body.position
      if (w.down > 0) {
        // Atropellado: cae, se queda un momento en el piso y se levanta (sin nada gráfico).
        w.down -= dt
        w.body.rotation.x = w.down > .6 ? Math.max(-1.45, w.body.rotation.x - dt * 9) : -1.45 * Math.max(0, w.down / .6)
        p.y = w.body.rotation.x < -1 ? .22 : 0
        continue
      }
      w.body.rotation.x = 0
      let walking = true
      if (w.cross) {
        const c = w.cross
        if (c.dir === 0) {
          walking = false; c.wait -= dt
          if (c.wait <= 0) c.dir = c.at > 0 ? -1 : 1
        } else {
          c.at += c.dir * w.speed * dt
          if (Math.abs(c.at) >= 9.5) { c.at = Math.sign(c.at) * 9.5; c.dir = 0; c.wait = 4 + random() * 8 }
        }
        p.x = c.x + c.rx * c.at; p.z = c.z + c.rz * c.at
        if (c.dir) w.body.rotation.y = Math.atan2(c.rx * c.dir, c.rz * c.dir)
      } else {
        if (w.axis === 'z') p.z += w.dir * w.speed * dt; else p.x += w.dir * w.speed * dt
        if (Math.abs(w.axis === 'z' ? p.z : p.x) > EDGE + 4) { w.dir *= -1; w.body.rotation.y += Math.PI }
      }
      if (walking) w.step += dt * w.speed * 4.2
      const swing = walking ? Math.sin(w.step) * .45 : 0
      w.legs[0].rotation.x = swing; w.legs[1].rotation.x = -swing
      w.arms[0].rotation.x = -swing * .8; w.arms[1].rotation.x = swing * .8
      p.y = walking ? Math.abs(Math.cos(w.step)) * .04 : 0
    }
    for (const car of traffic) {
      const off = (car.axis === 'z' ? -car.dir : car.dir) * 1.9
      let want = car.speed
      const next = LINES.find(l => (l - car.pos) * car.dir > 0 && (l - car.pos) * car.dir < 24)
      if (next !== undefined) {
        const gap = (next - car.pos) * car.dir - (HALF_ROAD + 5)
        const crossing = car.axis === 'z' ? LINES.indexOf(car.line) * 5 + LINES.indexOf(next) : LINES.indexOf(next) * 5 + LINES.indexOf(car.line)
        if (gap > .5 && lightState(t, crossing, car.axis === 'z' ? 'ns' : 'ew', target, targetGreen) !== 2) want = Math.min(want, Math.sqrt(2 * 6 * gap))
      }
      const px = car.axis === 'z' ? focus.x - (car.line + off) : focus.x - car.pos
      const pz = car.axis === 'z' ? focus.z - car.pos : focus.z - (car.line + off)
      const ahead = car.axis === 'z' ? pz * car.dir : px * car.dir, side = car.axis === 'z' ? Math.abs(px) : Math.abs(pz)
      if (side < 2.6 && ahead > 0 && ahead < 11) want = 0
      car.v += (want - car.v) * Math.min(1, dt * 2.5)
      car.pos += car.v * car.dir * dt
      if (car.pos > EDGE + 20) car.pos = -EDGE - 20
      if (car.pos < -EDGE - 20) car.pos = EDGE + 20
      if (car.axis === 'z') { car.group.position.set(car.line + off, 0, car.pos); car.group.rotation.y = car.dir > 0 ? Math.PI : 0 }
      else { car.group.position.set(car.pos, 0, car.line + off); car.group.rotation.y = car.dir > 0 ? -Math.PI / 2 : Math.PI / 2 }
    }
    ;(beaconMat as T.ShaderMaterial).uniforms.time.value = t
    ring.scale.setScalar(1 + (Math.sin(t * 3) + 1) * .06)
  }
  /** Lista fija (sin crear arreglos por cuadro): posiciones vivas del tráfico. */
  const trafficList = traffic.map(c => c.group.position)
  /** Choque del auto del jugador contra peatones: rápido los tumba; despacio solo lo detienen. */
  function hitPedestrians(x: number, z: number, speed: number, fx: number, fz: number): 'hit' | 'blocked' | null {
    let result: 'hit' | 'blocked' | null = null
    for (const w of walkers) {
      if (w.down > 0) continue
      const p = w.body.position, dx = p.x - x, dz = p.z - z
      // El auto mide ~4.4 de largo: se revisa a lo largo de su eje.
      const along = dx * fx + dz * fz, side = Math.abs(dx * -fz + dz * fx)
      if (Math.abs(along) > 2.6 || side > 1.45) continue
      if (Math.abs(speed) > 1.8) {
        w.down = 3.4; w.body.rotation.y = Math.atan2(fx, fz) + Math.PI
        p.x += fx * 1.2; p.z += fz * 1.2
        result = 'hit'
      } else if (!result) result = 'blocked'
    }
    return result
  }

  // ── Finales: túnel, puente o precipicio (solo se construye el que toca) ─────
  function buildEnding(kind: Ending) {
    placeholder.visible = false
    const group = new T.Group(); scene.add(group)
    const z0 = ENDING_Z, rock = paint('#8b7563', .95), dark = paint('#1b1d21', .9)
    if (kind === 'tunnel') {
      box(group, lawn, 0, -.25, z0 - 150, 900, .4, 300).castShadow = false
      box(group, roadZ, 0, .01, z0 - 110, 2 * HALF_ROAD, .04, 220).castShadow = false
      finishArch(group, z0 - 185)
      buildTunnel(group, z0 - 14, 125)
    } else if (kind === 'bridge') {
      box(group, rock, 0, -30, z0 - 5, 900, 60, 10).castShadow = false
      box(group, rock, 0, -30, z0 - 130, 900, 60, 30).castShadow = false
      box(group, lawn, 0, -.25, z0 - 250, 900, .4, 210).castShadow = false
      mesh(group, geometry(new T.PlaneGeometry(900, 120)), material(new T.MeshStandardMaterial({ color: '#2f7fa3', roughness: .08, metalness: .4 })), 0, -42, z0 - 62).rotation.x = -Math.PI / 2
      box(group, paint('#6f6a66', .7), 0, -.45, z0 - 62, 2 * HALF_ROAD + 3, .8, 124)
      box(group, roadZ, 0, .01, z0 - 150, 2 * HALF_ROAD, .04, 300).castShadow = false
      finishArch(group, z0 - 150)
      const steel = paint('#c0503b', .45, .6)
      for (const tz of [z0 - 27, z0 - 97]) {
        for (const side of [-1, 1]) box(group, steel, side * (HALF_ROAD + 1.6), 12, tz, 1.1, 30, 1.1)
        box(group, steel, 0, 26, tz, 2 * HALF_ROAD + 4.4, 1, 1)
      }
      for (const side of [-1, 1]) {
        const curve = new T.CatmullRomCurve3([z0 - 5, z0 - 27, z0 - 62, z0 - 97, z0 - 119].map((z, i) => new T.Vector3(side * (HALF_ROAD + 1.6), [2, 26.5, 7, 26.5, 2][i], z)))
        mesh(group, geometry(new T.TubeGeometry(curve, 80, .18, 6)), steel, 0, 0, 0)
        for (let k = 1; k < 28; k++) {
          const p = curve.getPoint(k / 28)
          if (p.y > 1.5) box(group, steel, p.x, p.y / 2, p.z, .06, p.y, .06)
        }
      }
    } else {
      box(group, roadZ, 0, .01, z0 - 20, 2 * HALF_ROAD, .04, 40).castShadow = false
      box(group, rock, 0, -40.2, z0 - 20, 900, 80, 40).castShadow = false
      // Baranda rota al borde y el mar muy abajo.
      box(group, stripe, -HALF_ROAD + 2, .9, z0 - 39, 4, .35, .25).rotation.z = .5
      box(group, stripe, HALF_ROAD - 2, .6, z0 - 39.4, 4, .35, .25).rotation.z = -.7
      mesh(group, geometry(new T.PlaneGeometry(1200, 900)), material(new T.MeshStandardMaterial({ color: '#2b6f93', roughness: .1, metalness: .4 })), 0, -70, z0 - 460).rotation.x = -Math.PI / 2
      for (let i = 0; i < 12; i++) mesh(group, geometry(new T.DodecahedronGeometry(3 + random() * 5)), rock, (random() - .5) * 60, -68, z0 - 50 - random() * 40)
    }
    return group
  }

  /** Montaña con túnel: portal de piedra con arco, bóveda iluminada y la montaña DETRÁS del portal. */
  const stoneMat = material(new T.MeshStandardMaterial({ roughness: .9, map: canvasTexture(256, 256, ctx => {
    ctx.fillStyle = '#9b8f80'; ctx.fillRect(0, 0, 256, 256)
    for (let y = 0; y < 256; y += 32) for (let x = (y / 32) % 2 ? -32 : 0; x < 256; x += 64) {
      const g = 130 + Math.floor(random() * 40); ctx.fillStyle = 'rgb(' + g + ',' + (g - 10) + ',' + (g - 22) + ')'
      ctx.fillRect(x + 2, y + 2, 60, 28)
    }
  }) }))
  if (stoneMat.map) { stoneMat.map.wrapS = stoneMat.map.wrapT = T.RepeatWrapping; stoneMat.map.repeat.set(.12, .12) }
  const vault = material(new T.MeshStandardMaterial({ color: '#3a3d42', roughness: .85, side: T.DoubleSide }))
  const grassMat = material(new T.MeshStandardMaterial({ color: '#5f7d45', roughness: 1 }))
  const rockMat = material(new T.MeshStandardMaterial({ color: '#8a7b6d', roughness: 1 }))
  const snowMat = material(new T.MeshStandardMaterial({ color: '#f3f5f7', roughness: .8 }))
  function lump(parent: T.Object3D, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const g = new T.SphereGeometry(1, 48, 24), p = g.attributes.position as T.BufferAttribute
    const phase = random() * 6.3
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      const k = 1 + .05 * Math.sin(x * 3.1 + phase) * Math.cos(z * 2.7 + phase) + .03 * Math.sin(y * 4 + phase)
      p.setXYZ(i, x * k, y * k, z * k)
    }
    g.computeVertexNormals()
    const m = mesh(parent, geometry(g), mat, x, y, z, sx, sy, sz); m.castShadow = true
    return m
  }
  function portal(parent: T.Object3D, z: number, facing: 1 | -1) {
    const face = new T.Shape()
    face.moveTo(-15, 0); face.lineTo(15, 0); face.lineTo(15, 18); face.lineTo(-15, 18); face.closePath()
    const hole = new T.Path(); hole.moveTo(-7.4, 0); hole.lineTo(-7.4, 6.2); hole.absarc(0, 6.2, 7.4, Math.PI, 0, true); hole.lineTo(7.4, 0); hole.closePath()
    face.holes.push(hole)
    const g = geometry(new T.ExtrudeGeometry(face, { depth: 2.4, bevelEnabled: true, bevelSize: .15, bevelThickness: .15, bevelSegments: 1 }))
    const m = mesh(parent, g, stoneMat, 0, 0, z - (facing > 0 ? 2.4 : 0)); if (facing < 0) m.rotation.y = Math.PI
    box(parent, stoneMat, 0, 18.4, z - facing * 1.2, 31, .8, 3.2)
    // Dovelas del arco y placa con el nombre.
    const ring = mesh(parent, geometry(new T.TorusGeometry(7.6, .45, 8, 32, Math.PI)), paint('#c9bda9', .8), 0, 6.2, z + facing * .1); if (facing < 0) ring.rotation.y = Math.PI
    const sign = mesh(parent, geometry(new T.PlaneGeometry(8, 1.4)), material(new T.MeshBasicMaterial({ map: canvasTexture(512, 90, ctx => {
      ctx.fillStyle = '#1d2a22'; ctx.fillRect(0, 0, 512, 90); ctx.fillStyle = '#7ee8a3'; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('TÚNEL EXPRESS', 256, 60)
    }) })), 0, 15.9, z + facing * .12)
    if (facing < 0) sign.rotation.y = Math.PI
    for (const side of [-1, 1]) {
      // Muros de contención en diagonal: tapan el hueco entre el portal y la ladera.
      const wing = box(parent, stoneMat, side * 19, 5, z - facing * 5, 9, 10, 2); wing.rotation.y = side * facing * .55
    }
  }
  function buildTunnel(parent: T.Object3D, z: number, length: number) {
    portal(parent, z, 1); portal(parent, z - length, -1)
    const arch = mesh(parent, geometry(new T.CylinderGeometry(7.4, 7.4, length, 32, 1, true, -Math.PI / 2, Math.PI)), vault, 0, 6.2, z - length / 2)
    arch.rotation.x = -Math.PI / 2; arch.castShadow = true
    for (const side of [-1, 1]) box(parent, vault, side * 7.4, 3.1, z - length / 2, .2, 6.2, length)
    // Losa de roca sobre la bóveda: bloquea el sol aunque la cámara lo mire en ángulo.
    box(parent, rockMat, 0, 14.6, z - length / 2, 18, 2, length - 2)
    const lights: T.Matrix4[] = []
    for (let k = 4; k < length; k += 6) for (const side of [-1, 1]) lights.push(place(side * 5.3, 11.4, z - k, .25, .12, 2.6, 0, 0, side * .78))
    instanced(unitBox, material(new T.MeshBasicMaterial({ color: new T.Color(3.2, 2.5, 1.4), toneMapped: false })), lights, false, parent)
    // La montaña va detrás del portal y deja libre el paso: laderas a cada lado y la cumbre
    // encima de la bóveda. Nada de ella cruza el interior del túnel (|x| < 7.4, y < 13.6).
    const mid = z - length / 2, deep = length / 2 - 9
    for (const side of [-1, 1]) lump(parent, grassMat, side * 39, -4, mid, 30, 38, deep)
    lump(parent, grassMat, 0, 34, mid, 36, 18, deep)
    // Ladera continua justo encima del portal: une los dos lados y no deja la vegetación «cortada».
    lump(parent, grassMat, 0, 23, z - 22, 44, 8.5, 16)
    lump(parent, grassMat, 0, 27, z - 40, 40, 12, 22)
    lump(parent, rockMat, -4, 44, mid - 4, 26, 14, deep - 14)
    lump(parent, snowMat, -3, 55, mid - 8, 14, 6, 18)
    lump(parent, grassMat, -46, -3, mid + 8, 36, 26, 40); lump(parent, rockMat, -48, 12, mid, 22, 18, 26)
    lump(parent, grassMat, 48, -3, mid - 6, 40, 30, 44); lump(parent, rockMat, 50, 16, mid - 12, 24, 20, 26); lump(parent, snowMat, 50, 33, mid - 12, 10, 6, 12)
    for (const side of [-1, 1]) lump(parent, grassMat, side * 24, -1, z - 16, 12, 11, 12)
    // Dos árboles como los de la ciudad, asentados en la ladera sobre el portal.
    for (const [tx, tz] of [[-9, z - 16], [11, z - 20]]) {
      const ground = 23 + 8.5 * Math.sqrt(Math.max(0, 1 - (tx / 44) ** 2 - ((tz - (z - 22)) / 16) ** 2))
      mesh(parent, poleGeo, bark, tx, ground + 1.2, tz, .22, 3, .22)
      for (let k = 0; k < 3; k++) mesh(parent, leafGeo, leafMats[k], tx + Math.cos(k * 2.1) * .7, ground + 3.4 + k * .5, tz + Math.sin(k * 2.1) * .7, 1.6 - k * .2, 1.8 - k * .2, 1.6 - k * .2)
    }
  }

  /** Arco de meta con pancarta y línea a cuadros en el piso. */
  const archBanner = material(new T.MeshBasicMaterial({ side: T.DoubleSide, map: canvasTexture(512, 128, ctx => {
    const g = ctx.createLinearGradient(0, 0, 512, 0); g.addColorStop(0, '#0c8a4a'); g.addColorStop(.5, '#10d451'); g.addColorStop(1, '#B33D9E')
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 128)
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 64px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('META', 256, 70)
    ctx.font = '600 22px sans-serif'; ctx.fillText('DRIVE ACADEMY · LO LOGRASTE', 256, 106)
  }) }))
  const checker = material(new T.MeshStandardMaterial({ roughness: .6, polygonOffset: true, polygonOffsetFactor: -2, map: canvasTexture(256, 32, ctx => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f1ea'; ctx.fillRect(x * 16, y * 16, 16, 16) }
  }) }))
  const archPaint = paint('#10a46a', .4, .3), archBase = paint('#f4f1ea', .5)
  function finishArch(parent: T.Object3D, z: number) {
    for (const side of [-1, 1]) {
      box(parent, archPaint, side * (HALF_ROAD + 1.4), 4.5, z, 1.2, 9, 1.2)
      box(parent, archBase, side * (HALF_ROAD + 1.4), .25, z, 1.8, .5, 1.8)
    }
    box(parent, archPaint, 0, 9.2, z, 2 * HALF_ROAD + 4, 1, 1.2)
    mesh(parent, geometry(new T.PlaneGeometry(2 * HALF_ROAD - 1, 3.4)), archBanner, 0, 7, z + .05).castShadow = false
    box(parent, checker, 0, .03, z, 2 * HALF_ROAD, .02, 2.4).castShadow = false
  }

  /** 1 = pleno día; 0 = dentro del túnel (sin sol, solo las luces de la bóveda). */
  function setDaylight(k: number) { sun.intensity = 3.4 * k; sky2.intensity = .35 + 1.15 * k }
  /** Brillo del auto durante el teletransporte (0 a 1). */
  function setGlow(k: number) { body.emissive.setRGB(.12 * k, 1.1 * k, .45 * k) }

  /** Confeti de celebración: una malla instanciada que cae girando alrededor del auto. */
  const confettiCount = mobile ? 140 : 280
  const confetti = new T.InstancedMesh(geometry(new T.PlaneGeometry(.22, .34)), material(new T.MeshBasicMaterial({ side: T.DoubleSide })), confettiCount)
  confetti.frustumCulled = false; confetti.visible = false; scene.add(confetti)
  const confettiTones = ['#10D451', '#B33D9E', '#f4f1ea', '#f2c14e', '#7ee8a3', '#e57bd0'].map(c => new T.Color(c))
  const bits = Array.from({ length: confettiCount }, (_, i) => {
    confetti.setColorAt(i, confettiTones[i % confettiTones.length])
    return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, phase: random() * 6.3 }
  })
  function celebrate(at: T.Vector3) {
    confetti.visible = true
    for (const b of bits) {
      const a = random() * Math.PI * 2, burst = 4 + random() * 9
      b.x = at.x; b.y = 3 + random() * 2; b.z = at.z
      b.vx = Math.cos(a) * burst; b.vz = Math.sin(a) * burst; b.vy = 9 + random() * 9; b.spin = 2 + random() * 6
    }
    return function update(dt: number, t: number) {
      bits.forEach((b, i) => {
        b.vy = Math.max(-2.2, b.vy - 14 * dt); b.vx *= 1 - dt * 1.4; b.vz *= 1 - dt * 1.4
        b.x += (b.vx + Math.sin(t * 3 + b.phase) * .6) * dt; b.y = Math.max(.05, b.y + b.vy * dt); b.z += b.vz * dt
        dummy.position.set(b.x, b.y, b.z); dummy.scale.set(1, 1, 1)
        dummy.rotation.set(t * b.spin + b.phase, t * b.spin * .6, b.phase); dummy.updateMatrix()
        confetti.setMatrixAt(i, dummy.matrix)
      })
      confetti.instanceMatrix.needsUpdate = true
    }
  }
  function hideConfetti() { confetti.visible = false }

  // ── Explosión: bola de fuego, humo, onda expansiva, chispas y restos ────────
  // Todo se crea de antemano (materiales y la luz del destello): crearlos en plena escena
  // obligaba a recompilar shaders y producía el tirón justo en el momento importante.
  const sphere = geometry(new T.IcosahedronGeometry(1, 2))
  const fireMats = [0, 1, 2].map(k => material(new T.MeshBasicMaterial({ color: new T.Color(4, 1.4 + k * .6, .3), transparent: true, toneMapped: false, depthWrite: false, blending: T.AdditiveBlending })))
  const smokeMat = material(new T.MeshStandardMaterial({ color: '#2a2624', transparent: true, opacity: 0, roughness: 1, depthWrite: false }))
  const shockMat = material(new T.MeshBasicMaterial({ color: new T.Color(3, 1.8, .8), transparent: true, opacity: 0, toneMapped: false, depthWrite: false, side: T.DoubleSide, blending: T.AdditiveBlending }))
  const sparkMat = material(new T.MeshBasicMaterial({ color: new T.Color(4, 2.6, .8), toneMapped: false }))
  const shockGeo = geometry(new T.RingGeometry(.8, 1, 48))
  function explode(at: T.Vector3) {
    const group = new T.Group(); group.position.copy(at); scene.add(group)
    const fire = Array.from({ length: 22 }, (_, i) => {
      const m = new T.Mesh(sphere, fireMats[i % 3])
      m.position.set((random() - .5) * 3, 1 + random() * 3, (random() - .5) * 3); group.add(m)
      return { m, grow: 4 + random() * 6, rise: 1 + random() * 4 }
    })
    const smoke = Array.from({ length: 14 }, () => {
      const m = new T.Mesh(sphere, smokeMat)
      m.position.set((random() - .5) * 4, 2 + random() * 2, (random() - .5) * 4); m.scale.setScalar(.1); group.add(m)
      return { m, grow: 5 + random() * 7, rise: 3 + random() * 5, delay: .2 + random() * .6 }
    })
    const shock = mesh(group, shockGeo, shockMat, 0, .6, 0); shock.rotation.x = -Math.PI / 2; shock.castShadow = false
    const sparkMesh = new T.InstancedMesh(unitBox, sparkMat, 70); sparkMesh.frustumCulled = false; group.add(sparkMesh)
    const sparks = Array.from({ length: 70 }, () => ({ p: new T.Vector3(0, 1.5, 0), v: new T.Vector3((random() - .5) * 40, 8 + random() * 26, (random() - .5) * 40) }))
    const debris = Array.from({ length: 14 }, (_, i) => {
      const m = new T.Mesh(unitBox, i % 3 ? carbon : body); m.scale.set(.3 + random() * .5, .1 + random() * .2, .3 + random() * .6); group.add(m)
      return { m, v: new T.Vector3((random() - .5) * 26, 10 + random() * 18, (random() - .5) * 26), spin: new T.Vector3(random() * 9, random() * 9, random() * 9) }
    })
    return function update(age: number, dt: number) {
      const k = Math.min(1, age / 1.8)
      fireMats.forEach(m => { m.opacity = Math.max(0, 1 - k) })
      for (const f of fire) { f.m.scale.setScalar(.3 + f.grow * Math.sqrt(k)); f.m.position.y += f.rise * dt }
      const sk = Math.max(0, age - .4) / 4.5
      smokeMat.opacity = Math.max(0, Math.min(.85, sk * 3) * (1 - Math.max(0, sk - .65) * 2.8))
      for (const s of smoke) { s.m.scale.setScalar(.1 + s.grow * Math.min(1, Math.max(0, age - s.delay) / 2.5)); if (age > s.delay) s.m.position.y += s.rise * dt }
      const ring = Math.min(1, age / .9)
      shock.scale.setScalar(1 + ring * 45); shockMat.opacity = Math.max(0, .9 * (1 - ring))
      sparks.forEach((sp, i) => {
        sp.v.y -= 30 * dt; sp.p.addScaledVector(sp.v, dt)
        dummy.position.copy(sp.p); dummy.rotation.set(age * 9 + i, i, 0)
        const size = Math.max(0, .35 * (1 - age / 1.6)); dummy.scale.set(size * .4, size * .4, size * 2.2); dummy.updateMatrix()
        sparkMesh.setMatrixAt(i, dummy.matrix)
      })
      sparkMesh.instanceMatrix.needsUpdate = true
      for (const d of debris) {
        if (d.m.position.y < -3 && d.v.y < 0) continue
        d.v.y -= 22 * dt; d.m.position.addScaledVector(d.v, dt)
        d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt; d.m.rotation.z += d.spin.z * dt
      }
    }
  }

  // ── Todo lo quieto se fusiona: una malla por material en vez de cientos ─────
  // (mismo aspecto, muchísimas menos llamadas de dibujo: era lo que volvía lento el juego).
  const moving = new Set<T.Object3D>([sky, sun.target, confetti, placeholder, beacon, barrier, car, fallingLeaves, ...traffic.map(c => c.group), ...walkers.map(w => w.body)])
  // Por material Y por zona de 96 m: con una sola malla gigante la ciudad entera se dibujaba
  // siempre (también en la sombra), aunque estuviera detrás de la cámara.
  const buckets = new Map<string, { mat: T.Material; geos: T.BufferGeometry[]; shadow: boolean }>()
  const zone = new T.Vector3()
  const drop: T.Object3D[] = []
  scene.updateMatrixWorld(true)
  for (const top of [...scene.children]) {
    if (moving.has(top) || top instanceof T.Light || top instanceof T.InstancedMesh) continue
    top.traverse(object => {
      if (!(object instanceof T.Mesh) || object instanceof T.InstancedMesh || Array.isArray(object.material)) return
      const baked = (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()).applyMatrix4(object.matrixWorld)
      for (const name of Object.keys(baked.attributes)) if (!['position', 'normal', 'uv'].includes(name)) baked.deleteAttribute(name)
      if (!baked.attributes.uv) baked.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(baked.attributes.position.count * 2), 2))
      baked.computeBoundingBox()
      const box3 = baked.boundingBox!
      // Solo proyecta sombra lo que tiene volumen: aceras, placas y marcas planas no.
      const shadow = object.castShadow && box3.max.y - box3.min.y > .5
      box3.getCenter(zone)
      const key = object.material.uuid + '|' + Math.floor(zone.x / 96) + ',' + Math.floor(zone.z / 96) + '|' + shadow
      const bucket = buckets.get(key) ?? { mat: object.material as T.Material, geos: [] as T.BufferGeometry[], shadow }
      bucket.geos.push(baked)
      buckets.set(key, bucket)
    })
    drop.push(top)
  }
  drop.forEach(object => scene.remove(object))
  buckets.forEach(({ geos, shadow, mat }) => {
    const merged = mergeGeometries(geos)
    geos.forEach(g => g.dispose())
    if (!merged) return
    const m = new T.Mesh(geometry(merged), mat); m.castShadow = shadow; m.receiveShadow = true; m.matrixAutoUpdate = false
    scene.add(m)
  })
  const skyTarget = new T.WebGLCubeRenderTarget(512)
  const skyScene = new T.Scene(); scene.remove(sky); skyScene.add(sky)
  new T.CubeCamera(1, 10000, skyTarget).update(renderer, skyScene)
  scene.background = skyTarget.texture
  ambient(0, 0, START, -1, false)
  updateLights(0, -1, false)
  return {
    scene, sun, sunDirection, car, wheels, frontWheels, tail, crossings, beacon, barrier, obstacles,
    ambient, updateLights, lightState, buildEnding, explode, celebrate, hideConfetti, setGlow, setDaylight, bumpProps, updateProps, trafficList, hitPedestrians,
    dispose() {
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose())
      environment.dispose(); sun.shadow.dispose(); skyTarget.dispose()
    },
  }
}
export type DrivingWorld = ReturnType<typeof createDrivingWorld>
