import { useEffect, useRef, useState, type MutableRefObject } from 'react'

export type SoundFx = 'crash' | 'pedestrian' | 'warp' | 'boom' | 'win' | 'bump' | 'tunnel' | 'open'
interface Rig {
  context: AudioContext; bus: GainNode; reverb: GainNode; noise: AudioBuffer[]; loopStart: number
  engine: { saw: OscillatorNode; beat: OscillatorNode; sub: OscillatorNode; filter: BiquadFilterNode; gain: GainNode }
  tires: { filters: BiquadFilterNode[]; gain: GainNode }; wind: GainNode; city: GainNode
}
interface Controls { throttle: boolean; brake: boolean }
/** Marchas (velocidad tope de cada una en m/s): el motor sube de vueltas y cae al cambiar. */
const GEARS = [4.5, 8.5, 12.5, 17.5]

/** Sonido generado en el navegador (nada se descarga) y solo tras un gesto del usuario.
 * Estéreo envolvente: ambiente, viento y llantas abiertos a los lados, eco en estéreo,
 * bocinas ubicadas alrededor (HRTF) y efectos repartidos entre izquierda y derecha. */
export function useDrivingAudio(speedKmh: number, paused: boolean, input?: MutableRefObject<Controls>) {
  const [enabled, setEnabled] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const rig = useRef<Rig | null>(null)
  const muted = useRef(false)
  const live = useRef({ speed: 0, paused: false, enabled: false, hidden: false, tunnel: false })
  live.current.speed = speedKmh / 3.6; live.current.paused = paused; live.current.enabled = enabled

  function build() {
    if (rig.current) return rig.current
    const context = new AudioContext()
    const sr = context.sampleRate
    // Salida con margen: volumen general moderado → compresor suave (sin «bombeo») →
    // corte de subgraves (< 35 Hz, que los parlantes no reproducen y suenan a distorsión).
    const master = context.createDynamicsCompressor()
    master.threshold.value = -10; master.knee.value = 18; master.ratio.value = 2.5; master.attack.value = .02; master.release.value = .3
    const rumbleCut = context.createBiquadFilter(); rumbleCut.type = 'highpass'; rumbleCut.frequency.value = 35; rumbleCut.Q.value = .5
    master.connect(rumbleCut); rumbleCut.connect(context.destination)
    const bus = context.createGain(); bus.gain.value = .7; bus.connect(master)
    // Eco estéreo: los dos canales son distintos, eso es lo que da amplitud.
    const ir = context.createBuffer(2, sr * 2.2, sr)
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c)
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2)
    }
    const convolver = context.createConvolver(); convolver.buffer = ir
    const reverb = context.createGain(); reverb.gain.value = .16
    reverb.connect(convolver); convolver.connect(master)
    // Ruido en bucle SIN costura: el final se funde con el principio. Antes el corte cada 2 s
    // hacía un clic periódico (esa «leve distorsión»). Dos buffers distintos para izquierda y derecha.
    const fadeLen = Math.floor(sr * .25), len = sr * 3
    const makeNoise = () => {
      const buffer = context.createBuffer(1, len, sr), d = buffer.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      for (let k = 0; k < fadeLen; k++) { const t = k / fadeLen; d[len - fadeLen + k] = d[len - fadeLen + k] * (1 - t) + d[k] * t }
      return buffer
    }
    const noise = [makeNoise(), makeNoise()], loopStart = fadeLen / sr
    const loop = (buffer: AudioBuffer, type: BiquadFilterType, freq: number, q: number, pan: number, out: GainNode) => {
      const src = context.createBufferSource(); src.buffer = buffer; src.loop = true; src.loopStart = loopStart; src.loopEnd = len / sr
      const filter = context.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q
      const panner = context.createStereoPanner(); panner.pan.value = pan
      src.connect(filter); filter.connect(panner); panner.connect(out); src.start(0, loopStart + Math.random() * (len / sr - loopStart - .1))
      return filter
    }
    const outGain = () => { const g = context.createGain(); g.gain.value = 0; g.connect(bus); return g }
    const tiresGain = outGain(), windGain = outGain(), cityGain = outGain()
    const tireFilters = [loop(noise[0], 'bandpass', 420, 1.2, -.35, tiresGain), loop(noise[1], 'bandpass', 420, 1.2, .35, tiresGain)]
    loop(noise[1], 'highpass', 900, .7, -.7, windGain); loop(noise[0], 'highpass', 900, .7, .7, windGain)
    loop(noise[0], 'lowpass', 260, .7, -.9, cityGain); loop(noise[1], 'lowpass', 260, .7, .9, cityGain)
    // Motor suave: dos triangulares apenas desafinadas (una a cada lado) y un sub senoidal al centro.
    const mix = context.createGain()
    const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 300; filter.Q.value = .6
    const gain = context.createGain(); gain.gain.value = 0
    const osc = (type: OscillatorType, pan: number, detune = 0) => {
      const o = context.createOscillator(); o.type = type; o.frequency.value = 55; o.detune.value = detune
      const p = context.createStereoPanner(); p.pan.value = pan
      o.connect(p); p.connect(mix); o.start(); return o
    }
    const saw = osc('triangle', -.18), beat = osc('triangle', .18, 6), sub = osc('sine', 0)
    mix.connect(filter); filter.connect(gain); gain.connect(bus)
    const engineSend = context.createGain(); engineSend.gain.value = .1; gain.connect(engineSend); engineSend.connect(reverb)
    rig.current = { context, bus, reverb, noise, loopStart, engine: { saw, beat, sub, filter, gain }, tires: { filters: tireFilters, gain: tiresGain }, wind: windGain, city: cityGain }
    return rig.current
  }
  /** Motor, llantas, viento y ciudad: se leen del estado vivo ~16 veces por segundo, sin re-renders. */
  useEffect(() => {
    let gearDip = 0, lastGear = 0
    const timer = window.setInterval(() => {
      const r = rig.current, l = live.current
      if (!r) return
      const now = r.context.currentTime, on = l.enabled && !l.paused && !l.hidden
      const speed = Math.max(0, l.speed), controls = input?.current
      const load = controls?.throttle ? 1 : controls?.brake ? 0 : .35
      const gear = Math.max(0, GEARS.findIndex(top => speed < top))
      const low = gear ? GEARS[gear - 1] : 0, top = GEARS[gear] ?? GEARS[GEARS.length - 1]
      const rpm = speed < .3 ? 850 : (gear ? 1900 : 950) + Math.min(1, (speed - low) / (top - low)) * (gear ? 3600 : 4200)
      if (gear !== lastGear && speed > .5) { gearDip = 4; lastGear = gear }
      const dip = gearDip > 0 ? .8 : 1; gearDip--
      // Fundamental desde ~55 Hz en ralentí: nada por debajo de lo que un parlante reproduce bien.
      const f = 30 + rpm / 60 * 1.8
      r.engine.saw.frequency.setTargetAtTime(f, now, .15)
      r.engine.beat.frequency.setTargetAtTime(f, now, .15)
      r.engine.sub.frequency.setTargetAtTime(Math.max(42, f / 2), now, .15)
      r.engine.filter.frequency.setTargetAtTime((l.tunnel ? 180 : 240) + load * 260 + rpm * .06, now, .2)
      r.engine.gain.gain.setTargetAtTime(on ? (.016 + load * .008 + speed * .0006) * dip * (l.tunnel ? 1.25 : 1) : 0, now, .2)
      for (const f2 of r.tires.filters) f2.frequency.setTargetAtTime(300 + speed * 40, now, .1)
      r.tires.gain.gain.setTargetAtTime(on ? Math.min(.035, speed * .0022) : 0, now, .12)
      r.wind.gain.setTargetAtTime(on ? Math.min(.03, speed * speed * .00011) : 0, now, .2)
      r.city.gain.setTargetAtTime(on && !l.tunnel ? .009 : 0, now, .5)
    }, 60)
    return () => window.clearInterval(timer)
  }, [input])
  /** Bocinas lejanas de vez en cuando, cada una en un punto distinto alrededor tuyo. */
  useEffect(() => {
    if (!enabled) return
    let timer = 0
    const schedule = () => {
      timer = window.setTimeout(() => {
        const r = rig.current, l = live.current
        if (r && !l.paused && !l.hidden && !l.tunnel) {
          const now = r.context.currentTime, f = Math.random() > .5 ? 330 : 294
          const a = Math.random() * Math.PI * 2, d = 25 + Math.random() * 20
          const at = { x: Math.cos(a) * d, z: Math.sin(a) * d }
          tone(r, 'square', f, f, now, .28, .02, 900, .3, at); tone(r, 'square', f * 1.26, f * 1.26, now, .28, .016, 900, .3, at)
          if (Math.random() > .5) { tone(r, 'square', f, f, now + .38, .2, .016, 900, .3, at); tone(r, 'square', f * 1.26, f * 1.26, now + .38, .2, .013, 900, .3, at) }
        }
        schedule()
      }, 16000 + Math.random() * 24000)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [enabled])
  useEffect(() => {
    const visibility = () => {
      live.current.hidden = document.hidden
      const r = rig.current
      if (r && !document.hidden && r.context.state !== 'running') void r.context.resume().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      const r = rig.current
      if (r) { void r.context.close(); rig.current = null }
    }
  }, [])
  function toggle() {
    try {
      const r = build()
      void r.context.resume().catch(() => { setUnavailable(true); setEnabled(false) })
      const next = !enabled
      muted.current = !next
      setEnabled(next)
    } catch { setUnavailable(true) }
  }
  /** Al empezar a jugar (un gesto del usuario) el sonido se enciende solo, salvo que lo haya silenciado. */
  function autoStart() {
    if (muted.current || enabled) return
    try {
      const r = build()
      void r.context.resume().then(() => setEnabled(true)).catch(() => setUnavailable(true))
    } catch { setUnavailable(true) }
  }
  /** Los navegadores suspenden el audio (cambio de pestaña, ahorro de energía): se reactiva en cada gesto. */
  function wake() {
    const r = rig.current
    if (r && enabled && r.context.state !== 'running') void r.context.resume().catch(() => undefined)
  }
  /** Ubicación de un sonido: un número es paneo estéreo (-1 izquierda, 1 derecha); {x, z} lo pone en el espacio. */
  type Place = number | { x: number; z: number }
  function placeNode(r: Rig, where: Place, start: number, sweepTo?: number) {
    if (typeof where === 'number') {
      const p = r.context.createStereoPanner(); p.pan.setValueAtTime(where, start)
      if (sweepTo !== undefined) p.pan.linearRampToValueAtTime(sweepTo, start + 1.1)
      return p
    }
    const p = r.context.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 10; p.rolloffFactor = .6
    p.positionX.value = where.x; p.positionY.value = 1; p.positionZ.value = where.z
    return p
  }
  function tone(r: Rig, type: OscillatorType, from: number, to: number, start: number, length: number, gain: number, cutoff = 0, send = .25, where: Place = 0, sweepTo?: number) {
    const o = r.context.createOscillator(), amp = r.context.createGain(), place = placeNode(r, where, start, sweepTo)
    o.type = type; o.frequency.setValueAtTime(from, start); o.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + length)
    amp.gain.setValueAtTime(.0001, start); amp.gain.exponentialRampToValueAtTime(gain, start + .015); amp.gain.exponentialRampToValueAtTime(.0001, start + length)
    let last: AudioNode = o
    if (cutoff) { const lp = r.context.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; o.connect(lp); last = lp }
    last.connect(amp); amp.connect(place); place.connect(r.bus)
    const s = r.context.createGain(); s.gain.value = send; place.connect(s); s.connect(r.reverb)
    o.start(start); o.stop(start + length + .05)
    o.onended = () => { o.disconnect(); amp.disconnect(); place.disconnect(); s.disconnect() }
  }
  function hiss(r: Rig, from: number, to: number, start: number, length: number, gain: number, type: BiquadFilterType = 'lowpass', q = .8, send = .3, where: Place = 0, sweepTo?: number) {
    const src = r.context.createBufferSource(), filter = r.context.createBiquadFilter(), amp = r.context.createGain(), place = placeNode(r, where, start, sweepTo)
    src.buffer = r.noise[Math.random() > .5 ? 1 : 0]; src.loop = true; src.loopStart = r.loopStart; filter.type = type; filter.Q.value = q
    filter.frequency.setValueAtTime(from, start); filter.frequency.exponentialRampToValueAtTime(to, start + length)
    amp.gain.setValueAtTime(.0001, start); amp.gain.exponentialRampToValueAtTime(gain, start + .01); amp.gain.exponentialRampToValueAtTime(.0001, start + length)
    src.connect(filter); filter.connect(amp); amp.connect(place); place.connect(r.bus)
    const s = r.context.createGain(); s.gain.value = send; place.connect(s); s.connect(r.reverb)
    src.start(start, r.loopStart + Math.random()); src.stop(start + length + .05)
    src.onended = () => { src.disconnect(); filter.disconnect(); amp.disconnect(); place.disconnect(); s.disconnect() }
  }
  const side = () => (Math.random() - .5) * .8
  function fx(kind: SoundFx) {
    const r = rig.current
    if (!r) return
    if (kind === 'tunnel' || kind === 'open') {
      // Dentro del túnel todo retumba más y el motor suena encerrado.
      live.current.tunnel = kind === 'tunnel'
      r.reverb.gain.setTargetAtTime(kind === 'tunnel' ? .45 : .16, r.context.currentTime, .25)
      return
    }
    if (!enabled) return
    wake()
    const now = r.context.currentTime
    if (kind === 'crash') {
      const at = side()
      hiss(r, 2400, 220, now, .45, .32, 'lowpass', .8, .4, at)
      tone(r, 'sine', 130, 55, now, .35, .3, 0, .2, at)
      for (const f of [780, 1130, 1570]) tone(r, 'triangle', f, f * .96, now + .01, .5, .035, 0, .5, at + (Math.random() - .5) * .4)
    } else if (kind === 'bump') {
      const at = side()
      tone(r, 'triangle', 420, 180, now, .09, .12, 0, .15, at)
      hiss(r, 2400, 900, now, .07, .07, 'bandpass', 2, .15, at)
    } else if (kind === 'pedestrian') {
      const at = side()
      tone(r, 'sine', 190, 80, now, .22, .22, 0, .2, at)
      hiss(r, 700, 220, now, .18, .08, 'lowpass', .8, .3, at)
    } else if (kind === 'warp') {
      // Barrido de izquierda a derecha: el salto «cruza» alrededor tuyo.
      tone(r, 'sine', 140, 1800, now, 1.15, .06, 0, .6, -.8, .8)
      tone(r, 'sine', 147, 1880, now, 1.15, .045, 0, .6, .8, -.8)
      hiss(r, 250, 6000, now, 1.25, .1, 'bandpass', 1.5, .6, -.9, .9)
      tone(r, 'sine', 1760, 880, now + 1.05, .6, .04, 0, .8, 0)
    } else if (kind === 'boom') {
      hiss(r, 900, 70, now, 2.8, .45, 'lowpass', .7, .7, -.6)
      hiss(r, 850, 75, now + .02, 2.7, .45, 'lowpass', .7, .7, .6)
      tone(r, 'sine', 90, 42, now, 1.6, .45, 0, .3, 0)
      // Crujidos del fuego, repartidos a los lados.
      for (let i = 0; i < 14; i++) hiss(r, 3000 + Math.random() * 2000, 1200, now + .25 + Math.random() * 1.6, .05, .05 + Math.random() * .05, 'bandpass', 3, .4, (Math.random() - .5) * 1.6)
    } else {
      // Fanfarria: arpegio que se abre de un lado al otro y un acorde final amplio.
      ;[523.3, 659.3, 784, 1046.5].forEach((f, i) => {
        tone(r, 'triangle', f, f, now + i * .12, .32, .07, 0, .35, -.6 + i * .4)
        tone(r, 'sine', f * 2, f * 2, now + i * .12, .25, .022, 0, .5, -.6 + i * .4)
      })
      ;[523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(r, 'triangle', f, f, now + .52, 1.5, .045, 0, .5, [-.7, -.25, .25, .7][i]))
      for (let i = 0; i < 6; i++) tone(r, 'sine', 2093 + i * 180, 2093 + i * 180, now + .6 + i * .07, .4, .012, 0, .8, (Math.random() - .5) * 1.6)
    }
  }
  function cue(correct: boolean) {
    const r = rig.current
    if (!r || !enabled) return
    const now = r.context.currentTime
    if (correct) {
      // Campanita de acierto: dos notas con parciales de campana, una a cada lado.
      for (const [f, t, p] of [[880, 0, -.3], [1318.5, .13, .3]] as const) {
        tone(r, 'sine', f, f, now + t, .6, .07, 0, .45, p)
        tone(r, 'sine', f * 2.76, f * 2.76, now + t, .25, .014, 0, .5, p)
      }
    } else {
      tone(r, 'triangle', 233, 220, now, .18, .08, 1200, .2, -.2)
      tone(r, 'triangle', 196, 175, now + .17, .32, .08, 1200, .2, .2)
    }
  }
  return { enabled, unavailable, toggle, cue, fx, wake, autoStart }
}
