import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as THREE from 'three'
import { STEPS } from '@/lab/three/steps'

/**
 * Laboratorio para aprender Three.js (solo en desarrollo: /lab/three).
 * Aquí vive lo que se repite en cada paso —renderer, escena, cámara y bucle—;
 * los pasos están en src/lab/three/steps.ts.
 */
export default function ThreeLab() {
  const [index, setIndex] = useState(0)
  const [error, setError] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const step = STEPS[index]
  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) }
    catch { setError('Este navegador no tiene WebGL: no se puede dibujar en 3D.'); return }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#1c1c22')
    // 60° de visión; ve desde 10 cm hasta 100 m.
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el
      renderer.setSize(w, h)
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize); observer.observe(el); resize()
    const run = STEPS[index].setup({ scene, camera, renderer, canvas: renderer.domElement }) ?? {}
    // El bucle: medir el tiempo, dejar que el paso mueva sus cosas y dibujar.
    const clock = new THREE.Clock()
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1) // tope: al volver de otra pestaña no hay un salto enorme
      run.update?.(dt)
      renderer.render(scene, camera)
    })
    return () => {
      renderer.setAnimationLoop(null)
      run.dispose?.()
      observer.disconnect()
      // Liberar memoria de la tarjeta de video: formas y materiales no se borran solos.
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
          for (const material of [object.material].flat()) material.dispose()
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [index])
  return <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 px-4 py-6 text-text sm:px-6">
    <div>
      <Link to="/games" className="text-sm text-text-muted hover:text-neon-green">← Volver a juegos</Link>
      <span className="mt-4 block text-xs font-bold uppercase tracking-[0.2em] text-neon-green">Laboratorio · solo en desarrollo</span>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Aprende Three.js</h1>
      <p className="mt-2 max-w-3xl text-text-muted">Cada paso es una mini escena. Lee su código en <code className="rounded bg-glass/10 px-1.5 py-0.5 text-[13px]">src/lab/three/steps.ts</code>, cambia algo, guarda y mira el resultado aquí al instante.</p>
    </div>
    <nav className="flex flex-wrap gap-2" aria-label="Pasos">
      {STEPS.map((s, i) => <button key={s.title} onClick={() => setIndex(i)} aria-pressed={i === index}
        className={'min-h-[44px] rounded-xl border px-4 text-sm font-medium transition ' + (i === index ? 'border-brand-green bg-brand-green/10 text-neon-green' : 'border-line text-text-muted hover:text-text')}>{s.title}</button>)}
    </nav>
    <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_340px]">
      <div ref={host} tabIndex={0} aria-label={'Escena 3D: ' + step.title} className="relative min-h-[420px] overflow-hidden rounded-2xl border border-line bg-[#1c1c22] focus:outline focus:outline-2 focus:outline-brand-green">
        {error && <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-text-muted">{error}</p>}
      </div>
      <aside className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-lg font-bold">{step.title}</h2>
        <h3 className="mt-4 text-xs font-bold uppercase tracking-[0.15em] text-text-subtle">Qué aprendes</h3>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">{step.learn}</p>
        <h3 className="mt-5 text-xs font-bold uppercase tracking-[0.15em] text-text-subtle">Prueba esto</h3>
        <ul className="mt-2 space-y-2 text-sm leading-relaxed text-text-muted">{step.tryThis.map(t => <li key={t} className="flex gap-2"><span className="text-neon-green">•</span><span>{t}</span></li>)}</ul>
      </aside>
    </div>
  </main>
}
