import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

/** All assets are built locally: no third-party downloads during play. */
export function createDrivingWorld(renderer: T.WebGLRenderer, mobile: boolean) {
  const scene = new T.Scene()
  scene.fog = new T.FogExp2('#b09a99', .009)
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
  const asphalt = canvasTexture(512, 512, ctx => {
    ctx.fillStyle = '#353c43'; ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 42000; i++) {
      const gray = Math.floor(35 + random() * 55)
      ctx.fillStyle = 'rgba(' + gray + ',' + gray + ',' + gray + ',.45)'
      ctx.fillRect(random() * 512, random() * 512, 1.5, 1.5)
    }
    ctx.strokeStyle = '#252d34'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(110, 0); ctx.lineTo(126, 220); ctx.lineTo(100, 512); ctx.stroke()
  })
  asphalt.wrapS = asphalt.wrapT = T.RepeatWrapping; asphalt.repeat.set(3, 48)
  const roadMat = material(new T.MeshStandardMaterial({ map: asphalt, roughness: .88 }))
  const concrete = paint('#b7a79a', .9), curb = paint('#d9cabb'), metal = paint('#283b48', .35, .75)
  const marking = paint('#f1e5c3')
  const lawn = paint('#536650'), bark = paint('#6d5444')
  const leafMats = ['#405a48', '#577454', '#71805a'].map(c => paint(c, .95))
  const glow = (color: string, strength: number) => material(new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: strength, roughness: .3 }))
  const warmLight = glow('#ffd0a0', 3), whiteLight = glow('#d4f4ff', 4)
  scene.add(new T.HemisphereLight('#c2d2eb', '#7b6452', 2.1))
  const sun = new T.DirectionalLight('#ffcd9d', 3.2)
  sun.position.set(-28, 38, -42); sun.castShadow = true
  sun.shadow.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024)
  Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 130 })
  sun.shadow.normalBias = .05; sun.shadow.bias = -.0002
  sun.target.position.set(0, 0, -15); scene.add(sun, sun.target)
  const pmrem = new T.PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const environment = pmrem.fromScene(room, .04)
  scene.environment = environment.texture; scene.environmentIntensity = .6
  room.dispose(); pmrem.dispose()

  const sky = mesh(scene, geometry(new T.SphereGeometry(480, 32, 16)), material(new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 direction; void main(){direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `varying vec3 direction;
      void main(){
        vec3 d=normalize(direction);
        vec3 color=mix(vec3(.86,.59,.43),vec3(.18,.30,.49),smoothstep(-.05,.65,d.y));
        float sun=pow(max(0.,dot(d,normalize(vec3(-.27,.12,-1.)))),900.);
        float halo=pow(max(0.,dot(d,normalize(vec3(-.27,.12,-1.)))),14.);
        color+=vec3(1.,.65,.30)*(sun*1.8+halo*.22);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })), 0, 0, 0)
  sky.castShadow = false; sky.receiveShadow = false
  const mountainMat = paint('#777c88', 1)
  for (let i = 0; i < 14; i++) {
    const mountain = mesh(scene, geometry(new T.ConeGeometry(35 + random() * 20, 35 + random() * 38, 5)), mountainMat,
      (i - 7) * 32, 4, -250 - random() * 60)
    mountain.castShadow = false
  }
  box(scene, lawn, 0, -.4, -100, 400, .4, 500)
  box(scene, roadMat, 0, -.13, -110, 15, .22, 360)
  for (const side of [-1, 1]) {
    box(scene, concrete, side * 9.7, .04, -110, 4.4, .3, 360)
    box(scene, curb, side * 7.7, .15, -110, .22, .36, 360)
    box(scene, marking, side * 7.12, .012, -110, .1, .02, 360)
    box(scene, lawn, side * 12.1, 0, -110, .9, .18, 360)
  }
  const moving = new T.Group(); scene.add(moving)
  const rows: T.Group[] = []
  const buildingTextures = ['#536979', '#79848c', '#526c70', '#877b70'].map(color => canvasTexture(256, 512, ctx => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, 256, 512)
    for (let y = 12; y < 500; y += 32) for (let x = 10; x < 250; x += 32) {
      ctx.fillStyle = random() > .7 ? '#e5bf82' : random() > .5 ? '#617e8b' : '#253e4b'
      ctx.fillRect(x, y, 19, 24)
      ctx.fillStyle = '#b3ac9866'; ctx.fillRect(x, y + 23, 19, 2)
    }
  }))
  const facades = buildingTextures.map(map => material(new T.MeshStandardMaterial({ map, roughness: .48, metalness: .25 })))
  const roofMat = paint('#687078'), trunkGeo = poleGeo
  const leafGeo = geometry(new T.SphereGeometry(1, mobile ? 7 : 10, mobile ? 5 : 8))
  const shopNames = ['NOVA / COFFEE', 'ATELIER', 'ESTUDIO 01', 'CENTRAL', 'LIBRERÍA', 'URBAN LAB']
  const signs = shopNames.map(label => material(new T.MeshBasicMaterial({ map: canvasTexture(512, 128, ctx => {
    ctx.fillStyle = '#152a31'; ctx.fillRect(0, 0, 512, 128)
    ctx.fillStyle = '#e8dcc4'; ctx.font = '500 42px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, 256, 80)
    ctx.fillStyle = '#dfad6c'; ctx.fillRect(24, 107, 464, 3)
  }) })))
  for (let i = 0; i < 18; i++) {
    const row = new T.Group(); row.userData.baseZ = 24 - i * 16; moving.add(row); rows.push(row)
    box(row, marking, 0, .012, 0, .12, .022, 5)
    for (const side of [-1, 1]) {
      const h = 9 + random() * 27, w = 6 + random() * 3
      const b = box(row, facades[(i + (side + 1)) % 4], side * (16 + w / 2), h / 2, 0, w, h, 12)
      b.castShadow = i < 5
      box(row, roofMat, side * (16 + w / 2), h + .15, 0, w + .25, .3, 12.3)
      box(row, metal, side * 15.1, 1.6, 0, .2, 3.2, 11)
      const shop = mesh(row, geometry(new T.PlaneGeometry(8, 1.6)), signs[i % signs.length], side * 14.94, 3.4, 0)
      shop.rotation.y = -side * Math.PI / 2
      box(row, concrete, side * 14.8, .25, 0, .6, .5, 12)
      const treeX = side * 10.7
      mesh(row, trunkGeo, bark, treeX, 1.75, -4, .16, 3.5, .16)
      for (let j = 0; j < 4; j++) {
        mesh(row, leafGeo, leafMats[(i + j) % 3], treeX + Math.cos(j * 2) * .55, 3.9 + j * .3,
          -4 + Math.sin(j * 2) * .5, 1.25, 1.65, 1.3)
      }
      box(row, concrete, treeX, .35, -4, 2, .5, 2)
      mesh(row, poleGeo, metal, side * 8.3, 3.6, 5, .065, 7.2, .065)
      box(row, metal, side * 7.7, 7.2, 5, 1.3, .12, .14)
      box(row, warmLight, side * 7.1, 7.15, 5, .8, .06, .4)
      if (i % 3 === 0) {
        box(row, bark, side * 9.4, .7, 2, .6, .13, 2)
        box(row, metal, side * 9.5, .38, 1.3, .45, .65, .12)
        box(row, metal, side * 9.5, .38, 2.7, .45, .65, .12)
      }
    }
  }

  const car = new T.Group(); car.position.set(2.5, .01, 0); scene.add(car)
  const body = material(new T.MeshPhysicalMaterial({ color: '#188b91', metalness: .72, roughness: .22, clearcoat: 1, clearcoatRoughness: .12 }))
  const carbon = paint('#142129', .4, .3), chrome = paint('#c2ced1', .21, .9), rubber = paint('#14171b', .95)
  const glass = material(new T.MeshPhysicalMaterial({ color: '#183746', metalness: .38, roughness: .12, clearcoat: 1 }))
  rounded(car, body, 0, .65, 0, 2.05, .65, 4.45, .23)
  rounded(car, body, 0, .98, -.45, 1.96, .28, 3.4, .12)
  const cabinProfile = new T.Shape()
  cabinProfile.moveTo(-1.12, 1.02)
  cabinProfile.lineTo(-.59, 1.54)
  cabinProfile.lineTo(.56, 1.57)
  cabinProfile.lineTo(1.25, 1.05)
  cabinProfile.closePath()
  const cabinGeometry = geometry(new T.ExtrudeGeometry(cabinProfile, {
    depth: 1.58, bevelEnabled: true, bevelSize: .035, bevelThickness: .035, bevelSegments: 2, steps: 1,
  }))
  cabinGeometry.rotateY(-Math.PI / 2); cabinGeometry.translate(.79, 0, 0)
  mesh(car, cabinGeometry, glass, 0, 0, 0)
  const contactMap = canvasTexture(128, 128, ctx => {
    const gradient = ctx.createRadialGradient(64, 64, 12, 64, 64, 64)
    gradient.addColorStop(0, '#000000bb'); gradient.addColorStop(.55, '#00000077'); gradient.addColorStop(1, '#00000000')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128)
  })
  const contact = mesh(car, geometry(new T.PlaneGeometry(3.8, 6)), material(new T.MeshBasicMaterial({
    map: contactMap, transparent: true, depthWrite: false,
  })), 0, -.005, 0)
  contact.rotation.x = -Math.PI / 2; contact.castShadow = false; contact.receiveShadow = false
  rounded(car, body, 0, 1.59, .02, 1.53, .055, 1.14, .04)
  // Slender pillars and mirrors give the coupe its silhouette.
  for (const side of [-1, 1]) {
    const pillar = box(car, body, side * .78, 1.28, .92, .075, .63, .08); pillar.rotation.x = -.28
    rounded(car, body, side * 1.05, 1.18, -.28, .28, .16, .36, .05)
    box(car, carbon, side * .99, .4, 0, .12, .12, 3)
    box(car, chrome, side * 1.02, 1.02, .55, .025, .035, .22)
  }
  rounded(car, carbon, 0, .47, 2.15, 1.75, .25, .2, .06)
  rounded(car, carbon, 0, .52, -2.19, 1.5, .24, .15, .04)
  box(car, carbon, 0, .99, 1.98, 1.85, .055, .38)
  const tail = glow('#ff2847', 2.8)
  rounded(car, tail, 0, .86, 2.225, 1.8, .065, .035, .015)
  for (const x of [-.7, .7]) {
    rounded(car, whiteLight, x, .87, -2.16, .44, .065, .09, .025)
    const exhaust = mesh(car, geometry(new T.CylinderGeometry(.09, .09, .22, 12)), chrome, x, .4, 2.2)
    exhaust.rotation.x = Math.PI / 2
  }
  const plate = material(new T.MeshBasicMaterial({ map: canvasTexture(256, 80, ctx => {
    ctx.fillStyle = '#e6e4d5'; ctx.fillRect(0, 0, 256, 80)
    ctx.fillStyle = '#24373a'; ctx.font = 'bold 38px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('LEARN 01', 128, 54)
  }) }))
  mesh(car, geometry(new T.PlaneGeometry(.61, .19)), plate, 0, .56, 2.261)
  const wheels: T.Group[] = []
  const tireGeo = geometry(new T.CylinderGeometry(.39, .39, .25, 24))
  const rimGeo = geometry(new T.CylinderGeometry(.27, .27, .265, 20))
  for (const side of [-1, 1]) for (const z of [-1.38, 1.38]) {
    const wheel = new T.Group(); wheel.position.set(side * 1.01, .4, z); car.add(wheel); wheels.push(wheel)
    const tire = mesh(wheel, tireGeo, rubber, 0, 0, 0); tire.rotation.z = Math.PI / 2
    const rim = mesh(wheel, rimGeo, carbon, 0, 0, 0); rim.rotation.z = Math.PI / 2
    for (let j = 0; j < 5; j++) {
      const spoke = box(wheel, chrome, side * .14, 0, 0, .026, .49, .055); spoke.rotation.x = j * Math.PI / 5
    }
  }
  const signal = new T.Group(); scene.add(signal)
  const signalMat = paint('#26343b', .4, .6)
  mesh(signal, poleGeo, signalMat, 7.8, 3.6, -12, .09, 7.2, .09)
  box(signal, signalMat, 4.4, 7.18, -12, 7, .12, .12)
  rounded(signal, signalMat, 2.5, 6.33, -12, .65, 1.7, .48, .09)
  const lamps = ['#ff334b', '#ffb74d', '#42f3ad'].map((color, i) => {
    const mat = glow(color, 0)
    const lamp = mesh(signal, geometry(new T.CircleGeometry(.17, 24)), mat, 2.5, 6.86 - i * .5, -11.747)
    lamp.castShadow = false
    return mat
  })
  box(signal, marking, 2.5, .025, -7.5, 6.6, .025, .3)
  for (let x = -6.5; x < 7; x += 1.2) box(signal, marking, x, .025, -9.5, .65, .025, 2.2)
  const nextSignal = signal.clone(true)
  nextSignal.traverse(object => {
    if (!(object instanceof T.Mesh)) return
    const index = lamps.indexOf(object.material as T.MeshStandardMaterial)
    if (index < 0) return
    const redLamp = material((object.material as T.MeshStandardMaterial).clone())
    redLamp.color.set(index === 0 ? '#ff334b' : '#14202b')
    redLamp.emissiveIntensity = index === 0 ? 4 : 0
    object.material = redLamp
  })
  nextSignal.visible = false
  scene.add(nextSignal)
  const bollard = glow('#ffc987', .5)
  for (const side of [-1, 1]) for (const z of [-8, -11]) mesh(signal, poleGeo, bollard, side * 7.9, .5, z, .07, 1, .07)
  // Repeating oncoming traffic stays in its own lane.
  const traffic = new T.Group(); scene.add(traffic)
  for (let i = 0; i < 3; i++) {
    const other = new T.Group(); other.position.set(-3.1, 0, -45 - i * 65); traffic.add(other)
    rounded(other, paint(['#c9bbb0', '#536a83', '#ac6256'][i], .3, .4), 0, .6, 0, 1.9, .65, 4.1, .2)
    rounded(other, glass, 0, 1.13, .2, 1.55, .65, 2, .2)
    for (const side of [-1, 1]) {
      box(other, whiteLight, side * .65, .7, 2.06, .3, .1, .05)
      for (const z of [-1.2, 1.2]) { const tire = mesh(other, tireGeo, rubber, side * .95, .37, z); tire.rotation.z = Math.PI / 2 }
    }
  }
  return {
    scene, car, wheels, signal, nextSignal, lamps, rows, traffic, asphalt, tail,
    dispose() {
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose())
      environment.dispose(); sun.shadow.dispose()
    },
  }
}
