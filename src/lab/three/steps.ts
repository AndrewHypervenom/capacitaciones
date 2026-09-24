import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/**
 * Laboratorio de Three.js: cada paso es una mini escena para practicar.
 *
 * La página (src/pages/ThreeLab.tsx) ya crea lo que se repite en todos:
 * el renderer, la escena, la cámara y el bucle. Cada paso solo agrega sus
 * objetos y, si quiere, devuelve:
 *   - update(dt): se llama unas 60 veces por segundo; dt = segundos desde el cuadro anterior.
 *   - dispose():  se llama al cambiar de paso, para limpiar lo que el paso creó (teclado, controles…).
 *
 * Para experimentar: cambia números aquí, guarda y Vite recarga la página solo.
 */
export interface LabContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  canvas: HTMLCanvasElement
}
export interface LabRun { update?: (dt: number) => void; dispose?: () => void }
export interface LabStep {
  title: string
  /** Qué enseña el paso, en una o dos frases. */
  learn: string
  /** Cambios sugeridos para practicar. */
  tryThis: string[]
  setup: (ctx: LabContext) => LabRun | void
}

/** Luz básica: sin luces, los materiales "Standard" se ven negros. */
function addLights(scene: THREE.Scene) {
  scene.add(new THREE.AmbientLight('#ffffff', 0.5))      // luz pareja que llega a todo
  const sun = new THREE.DirectionalLight('#ffffff', 2.2) // luz con dirección, como el sol
  sun.position.set(4, 6, 3)
  scene.add(sun)
  return sun
}

/** Un piso de 20 × 20 m acostado sobre el suelo (los planos nacen de pie). */
function addFloor(scene: THREE.Scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: '#3a3a42' }))
  floor.rotation.x = -Math.PI / 2 // girarlo 90° para que quede horizontal
  scene.add(floor)
  return floor
}

export const STEPS: LabStep[] = [
  {
    title: '1. Cubo girando',
    learn: 'Las 4 piezas de siempre: escena, cámara, objeto (forma + material) y el bucle que mueve y dibuja.',
    tryThis: [
      'Cambia el color «#10D451» por «tomato» o «#3b82f6».',
      'Haz que gire más rápido: cambia 0.8 por 3.',
      'Hazlo girar también en X: agrega cube.rotation.x += dt.',
      'Cambia BoxGeometry(1, 1, 1) por SphereGeometry(0.7, 32, 16).',
    ],
    setup({ scene, camera }) {
      camera.position.set(0, 1.5, 4) // 1,5 m de alto y 4 m hacia atrás
      camera.lookAt(0, 0, 0)          // mirando al centro
      addLights(scene)
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),                            // la forma: un cubo de 1 m
        new THREE.MeshStandardMaterial({ color: '#10D451' }),      // la pintura
      )
      scene.add(cube)
      // dt hace que gire igual de rápido en una computadora lenta que en una rápida.
      return { update: dt => { cube.rotation.y += 0.8 * dt } }
    },
  },
  {
    title: '2. Una mesa con cajas',
    learn: 'Armar objetos con piezas simples y agruparlas en un Group: al mover el grupo se mueve todo junto.',
    tryThis: [
      'Haz la mesa más alta: sube LEG_HEIGHT a 1.2.',
      'Agrega una silla: otro Group con un asiento y un respaldo.',
      'Mueve toda la mesa con table.position.x = 1.5.',
      'Así se construyen los edificios y los postes del juego de autos.',
    ],
    setup({ scene, camera }) {
      camera.position.set(3, 2.5, 4)
      camera.lookAt(0, 0.5, 0)
      addLights(scene)
      addFloor(scene)
      const wood = new THREE.MeshStandardMaterial({ color: '#a0703c', roughness: 0.8 })
      const LEG_HEIGHT = 0.75
      const table = new THREE.Group()
      // El tablero: 2 m de largo, 5 cm de grueso, 1 m de fondo. Se apoya sobre las patas.
      const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 1), wood)
      top.position.y = LEG_HEIGHT
      table.add(top)
      // Cuatro patas: una forma y un material compartidos, cuatro posiciones.
      const legShape = new THREE.BoxGeometry(0.08, LEG_HEIGHT, 0.08)
      for (const [x, z] of [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]]) {
        const leg = new THREE.Mesh(legShape, wood)
        leg.position.set(x, LEG_HEIGHT / 2, z) // la posición es el CENTRO de la caja
        table.add(leg)
      }
      scene.add(table)
      return { update: dt => { table.rotation.y += 0.3 * dt } }
    },
  },
  {
    title: '3. Cámara con el mouse',
    learn: 'OrbitControls: arrastra para girar, rueda para acercar, clic derecho para desplazar. Los ayudantes muestran los ejes.',
    tryThis: [
      'Ejes: rojo = X (derecha), verde = Y (arriba), azul = Z (hacia ti).',
      'Pon controls.autoRotate = true para que gire solo.',
      'Limita el zoom con controls.minDistance = 3 y controls.maxDistance = 12.',
      'Agrega más cubos en posiciones distintas y míralos desde varios ángulos.',
    ],
    setup({ scene, camera, canvas }) {
      camera.position.set(5, 4, 6)
      addLights(scene)
      scene.add(new THREE.GridHelper(20, 20, '#666', '#333')) // cuadrícula de 1 m
      scene.add(new THREE.AxesHelper(3))                      // flechas de los 3 ejes
      const colors = ['#ef4444', '#22c55e', '#3b82f6']
      colors.forEach((color, i) => {
        const cube = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color }))
        cube.position.set(i * 2 - 2, 0.4, 0)
        scene.add(cube)
      })
      const controls = new OrbitControls(camera, canvas)
      controls.enableDamping = true // frena suave al soltar el mouse
      return { update: () => controls.update(), dispose: () => controls.dispose() }
    },
  },
  {
    title: '4. Mover con el teclado',
    learn: 'Leer teclas, mover un objeto según su rumbo y hacer que la cámara lo siga. Es la base del auto del juego.',
    tryThis: [
      'Usa W A S D (o las flechas). Primero haz clic en el lienzo.',
      'Cambia SPEED y TURN para que se sienta distinto.',
      'Impide salir del piso: limita player.position.x y z entre -9 y 9.',
      'Compara con moveCar() en src/components/games/DrivingScene.tsx.',
    ],
    setup({ scene, camera }) {
      addLights(scene)
      addFloor(scene)
      scene.add(new THREE.GridHelper(20, 20, '#555', '#444'))
      const player = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 1), new THREE.MeshStandardMaterial({ color: '#10D451' }))
      player.position.y = 0.2
      scene.add(player)
      // Un "morro" blanco para ver hacia dónde apunta.
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.2), new THREE.MeshStandardMaterial({ color: 'white' }))
      nose.position.set(0, 0.25, -0.5)
      player.add(nose) // hijo del jugador: se mueve y gira con él
      const keys = new Set<string>()
      const down = (e: KeyboardEvent) => { keys.add(e.key.toLowerCase()); if (e.key.startsWith('Arrow')) e.preventDefault() }
      const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())
      window.addEventListener('keydown', down)
      window.addEventListener('keyup', up)
      const SPEED = 4, TURN = 2.5 // metros por segundo, radianes por segundo
      const behind = new THREE.Vector3()
      return {
        update(dt) {
          if (keys.has('a') || keys.has('arrowleft')) player.rotation.y += TURN * dt
          if (keys.has('d') || keys.has('arrowright')) player.rotation.y -= TURN * dt
          const move = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0)
          // "Adelante" es -Z girado según el rumbo: seno y coseno del ángulo.
          player.position.x -= Math.sin(player.rotation.y) * SPEED * move * dt
          player.position.z -= Math.cos(player.rotation.y) * SPEED * move * dt
          // Cámara de persecución: 4 m detrás y 2,5 m arriba; se acerca de a poco (lerp) para no dar saltos.
          behind.set(Math.sin(player.rotation.y) * 4, 2.5, Math.cos(player.rotation.y) * 4).add(player.position)
          camera.position.lerp(behind, Math.min(1, dt * 4))
          camera.lookAt(player.position)
        },
        dispose() { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) },
      }
    },
  },
  {
    title: '5. Luces y sombras',
    learn: 'Para ver sombras hay que activarlas en 3 lugares: el renderer, la luz (castShadow) y cada objeto (castShadow / receiveShadow).',
    tryThis: [
      'Quita castShadow a una esfera y mira cómo desaparece su sombra.',
      'Cambia la luz a un PointLight (como un foco) en vez de DirectionalLight.',
      'Sube shadow.mapSize a 2048: sombras más nítidas, pero más costosas.',
      'Prueba roughness y metalness en los materiales (de 0 a 1).',
    ],
    setup({ scene, camera, renderer, canvas }) {
      renderer.shadowMap.enabled = true // 1) el renderer calcula sombras
      camera.position.set(6, 5, 7)
      scene.add(new THREE.AmbientLight('#ffffff', 0.25))
      const sun = new THREE.DirectionalLight('#fff4e0', 2.5)
      sun.castShadow = true // 2) esta luz proyecta sombras
      sun.shadow.mapSize.set(1024, 1024)
      scene.add(sun)
      const floor = addFloor(scene)
      floor.receiveShadow = true // 3) el piso recibe sombras
      const spheres = [0, 1, 2].map(i => {
        const sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.6, 32, 16),
          new THREE.MeshStandardMaterial({ color: ['#f59e0b', '#8b5cf6', '#10D451'][i], roughness: 0.3 + i * 0.3, metalness: i === 0 ? 0.6 : 0 }),
        )
        sphere.position.set(i * 2 - 2, 0.6, 0)
        sphere.castShadow = true // 3) cada objeto proyecta su sombra
        scene.add(sphere)
        return sphere
      })
      const controls = new OrbitControls(camera, canvas)
      let t = 0
      return {
        update(dt) {
          t += dt
          // El "sol" da vueltas: mira cómo se mueven las sombras.
          sun.position.set(Math.cos(t * 0.5) * 6, 5, Math.sin(t * 0.5) * 6)
          spheres.forEach((s, i) => { s.position.y = 0.6 + Math.abs(Math.sin(t * 2 + i)) * 0.8 })
          controls.update()
        },
        dispose() { controls.dispose(); renderer.shadowMap.enabled = false },
      }
    },
  },
]
