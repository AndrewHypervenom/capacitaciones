import { useEffect, useRef, useState } from 'react'

/**
 * CC0 field recordings, bundled locally, without birdsong. Each file is a baked
 * equal-power crossfade loop with 0.5 s of circular padding on each side, so the
 * loop stays seamless whatever encoder delay the browser's MP3 decoder applies.
 * Layers have different lengths (95/80/85 s), start at a random offset and the
 * wind "breathes" slowly, so the mix never repeats in an obvious way.
 */
type Layer = 'leaves' | 'stream' | 'rain'
export type Soundscape = 'forest' | 'rain' | 'stream'
const FILES: Record<Layer, string> = { leaves: '/ergonomics/wind-leaves-loop.mp3', stream: '/ergonomics/stream-loop.mp3', rain: '/ergonomics/gentle-rain-loop.mp3' }
const MIXES: Record<Soundscape, Partial<Record<Layer, number>>> = {
  forest: { leaves: 1, stream: .22 },
  rain: { rain: .9, leaves: .3 },
  stream: { stream: .75, leaves: .4 },
}
export const SOUNDSCAPES: { id: Soundscape; label: string }[] = [
  { id: 'forest', label: 'Hojas y arroyo' },
  { id: 'rain', label: 'Lluvia suave' },
  { id: 'stream', label: 'Río tranquilo' },
]
const PAD = .5
/** Male guide voice for the active break (Kokoro TTS, Apache 2.0, voice em_alex). */
export type VoiceLine = 'intro' | 'next' | 'done' | `step-${0 | 1 | 2 | 3}` | `mid-${0 | 1 | 2 | 3}`
const VOICE_LINES: VoiceLine[] = ['intro', 'next', 'done', 'step-0', 'step-1', 'step-2', 'step-3', 'mid-0', 'mid-1', 'mid-2', 'mid-3']
const STORAGE = 'ergo-ambience-v2'
type Prefs = { enabled: boolean; volume: number; scape: Soundscape; voice: boolean }
function readPrefs(): Prefs {
  const fallback: Prefs = { enabled: true, volume: 35, scape: 'forest', voice: true }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Partial<Prefs> | null
    if (!saved) return fallback
    return {
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : fallback.enabled,
      volume: typeof saved.volume === 'number' ? Math.min(100, Math.max(0, saved.volume)) : fallback.volume,
      scape: SOUNDSCAPES.some(s => s.id === saved.scape) ? saved.scape! : fallback.scape,
      voice: typeof saved.voice === 'boolean' ? saved.voice : fallback.voice,
    }
  } catch { return fallback }
}
type Channel = { gain: GainNode; breeze: GainNode; source?: AudioBufferSourceNode; loading?: Promise<void>; failed?: boolean }
type Engine = { context: AudioContext; master: GainNode; duck: GainNode; cues: GainNode; voice: GainNode; channels: Map<Layer, Channel>; lines: Map<VoiceLine, Promise<AudioBuffer | null>>; speaking?: AudioBufferSourceNode; turn: number }
const level = (volume: number) => (volume / 100) ** 1.6 * .9

export function useErgoAmbience() {
  const [prefs, setPrefs] = useState(readPrefs)
  const [status, setStatus] = useState<'loading' | 'playing' | 'ready' | 'unavailable'>('loading')
  const engine = useRef<Engine | null>(null)
  const preference = useRef(prefs)
  const applyMix = useRef<(scape: Soundscape) => void>(() => {})
  useEffect(() => {
    preference.current = prefs
    try { localStorage.setItem(STORAGE, JSON.stringify(prefs)) } catch { /* private mode */ }
    const audio = engine.current
    if (!audio) return
    const now = audio.context.currentTime
    audio.master.gain.cancelScheduledValues(now)
    audio.master.gain.setTargetAtTime(prefs.enabled ? level(prefs.volume) : 0, now, .3)
    audio.cues.gain.setTargetAtTime(prefs.enabled && prefs.volume > 0 ? Math.max(.2, level(prefs.volume) * 1.4) : 0, now, .05)
  }, [prefs])
  useEffect(() => { applyMix.current(prefs.scape) }, [prefs.scape])
  useEffect(() => {
    let context: AudioContext
    try { context = new AudioContext() } catch { setStatus('unavailable'); return }
    const master = context.createGain(); master.gain.value = 0; master.connect(context.destination)
    const cues = context.createGain(); cues.gain.value = 0; cues.connect(context.destination)
    // The voice has its own level; the nature mix is ducked underneath it while it speaks.
    const voice = context.createGain(); voice.gain.value = .95; voice.connect(context.destination)
    const duck = context.createGain(); duck.gain.value = 1; duck.connect(master)
    // Gentle tilt: remove rumble and tame the hiss so water and rain sound soft, not harsh.
    const low = context.createBiquadFilter(); low.type = 'highpass'; low.frequency.value = 110; low.Q.value = .5
    const high = context.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 5200; high.gain.value = -5
    low.connect(high); high.connect(duck)
    const channels = new Map<Layer, Channel>()
    engine.current = { context, master, duck, cues, voice, channels, lines: new Map(), turn: 0 }
    let alive = true
    const abort = new AbortController()
    const timers: number[] = []
    const sync = () => {
      if (!alive) return
      const playing = [...channels.values()].some(c => c.source)
      const pending = [...channels.values()].some(c => c.loading && !c.source && !c.failed)
      setStatus(playing && context.state === 'running' ? 'playing' : pending ? 'loading' : playing ? 'ready' : [...channels.values()].every(c => c.failed) && channels.size ? 'unavailable' : 'ready')
    }
    context.addEventListener('statechange', sync)
    function channel(layer: Layer) {
      let c = channels.get(layer)
      if (c) return c
      const gain = context.createGain(); gain.gain.value = 0
      const breeze = context.createGain(); breeze.gain.value = 1
      gain.connect(breeze); breeze.connect(low)
      c = { gain, breeze }; channels.set(layer, c)
      const created = c
      created.loading = (async () => {
        try {
          const response = await fetch(FILES[layer], { signal: abort.signal })
          if (!response.ok) throw new Error('Audio unavailable')
          const buffer = await context.decodeAudioData(await response.arrayBuffer())
          if (!alive) return
          const source = context.createBufferSource()
          source.buffer = buffer; source.loop = true
          source.loopStart = PAD; source.loopEnd = Math.max(PAD + 1, buffer.duration - PAD)
          source.connect(gain)
          source.start(0, PAD + Math.random() * (source.loopEnd - PAD))
          created.source = source
        } catch { created.failed = true }
        sync()
      })()
      sync()
      return created
    }
    applyMix.current = (scape: Soundscape) => {
      const mix = MIXES[scape], now = context.currentTime
      for (const layer of Object.keys(FILES) as Layer[]) {
        const target = mix[layer] ?? 0
        if (!target && !channels.has(layer)) continue
        const c = channel(layer)
        c.gain.gain.cancelScheduledValues(now)
        c.gain.gain.setTargetAtTime(target, now, .9)
      }
    }
    applyMix.current(preference.current.scape)
    // Slow, irregular gusts: the leaves swell and settle every 6–14 s.
    const breathe = () => {
      if (!alive) return
      const now = context.currentTime
      for (const [layer, c] of channels) {
        const depth = layer === 'leaves' ? .35 : layer === 'stream' ? .12 : .08
        c.breeze.gain.setTargetAtTime(1 - depth / 2 + Math.random() * depth, now, 2.5 + Math.random() * 2)
      }
      timers.push(window.setTimeout(breathe, 6000 + Math.random() * 8000))
    }
    breathe()
    const resume = () => {
      const { enabled, voice: guide, volume } = preference.current
      if ((!enabled && !guide) || document.hidden) return
      master.gain.setTargetAtTime(enabled ? level(volume) : 0, context.currentTime, .8)
      void context.resume().then(sync).catch(sync)
    }
    const visibility = () => { if (document.hidden) void context.suspend().catch(() => {}); else resume() }
    document.addEventListener('visibilitychange', visibility)
    resume()
    return () => {
      alive = false; abort.abort(); engine.current?.speaking?.stop(); engine.current = null; applyMix.current = () => {}
      timers.forEach(t => window.clearTimeout(t))
      document.removeEventListener('visibilitychange', visibility); context.removeEventListener('statechange', sync)
      for (const c of channels.values()) { c.source?.stop(); c.source?.disconnect(); c.gain.disconnect(); c.breeze.disconnect() }
      low.disconnect(); high.disconnect(); duck.disconnect(); master.disconnect(); cues.disconnect(); voice.disconnect(); void context.close().catch(() => {})
    }
  }, [])
  function unlock() {
    const audio = engine.current
    if (audio && (preference.current.enabled || preference.current.voice) && audio.context.state === 'suspended' && !document.hidden) void audio.context.resume().catch(() => {})
  }
  function toggle() {
    if (status === 'unavailable') return
    if (prefs.enabled && status !== 'playing') { unlock(); return }
    const next = !prefs.enabled
    preference.current = { ...preference.current, enabled: next }; setPrefs(p => ({ ...p, enabled: next }))
    if (next) unlock()
  }
  /** A soft singing-bowl tone for step changes and a two-note bloom for success. Silent when muted. */
  function cue(kind: 'step' | 'success') {
    const audio = engine.current
    if (!audio || !preference.current.enabled || audio.context.state !== 'running') return
    const { context, cues } = audio
    const notes = kind === 'success' ? [[523.25, 0], [783.99, .16]] : [[392, 0]]
    for (const [base, delay] of notes) {
      const start = context.currentTime + delay
      for (const [ratio, amount, decay] of [[1, .5, 3.2], [2.01, .18, 2.2], [3.93, .07, 1.2], [5.4, .03, .7]]) {
        const osc = context.createOscillator(), env = context.createGain()
        osc.type = 'sine'; osc.frequency.value = base * ratio
        env.gain.setValueAtTime(0, start)
        env.gain.linearRampToValueAtTime(amount * .22, start + .012)
        env.gain.exponentialRampToValueAtTime(.0001, start + decay)
        osc.connect(env); env.connect(cues)
        osc.start(start); osc.stop(start + decay + .05)
        osc.onended = () => { osc.disconnect(); env.disconnect() }
      }
    }
  }
  function line(audio: Engine, key: VoiceLine) {
    let pending = audio.lines.get(key)
    if (!pending) {
      pending = fetch(`/ergonomics/voice/${key}.mp3`).then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error('Voice unavailable')))
        .then(data => audio.context.decodeAudioData(data)).catch(() => null)
      audio.lines.set(key, pending)
    }
    return pending
  }
  /** Fetches every line ahead of time so the guide never waits on the network. */
  function preloadVoice() {
    const audio = engine.current
    if (audio && preference.current.voice) VOICE_LINES.forEach(key => void line(audio, key))
  }
  function hush() {
    const audio = engine.current
    if (!audio) return
    audio.turn++
    audio.speaking?.stop(); audio.speaking = undefined
    audio.duck.gain.setTargetAtTime(1, audio.context.currentTime, .4)
  }
  /** Speaks one guide line, replacing whatever the guide was saying. */
  function say(key: VoiceLine, delay = 0) {
    const audio = engine.current
    if (!audio || !preference.current.voice) return
    hush()
    const turn = audio.turn
    unlock()
    void line(audio, key).then(buffer => {
      if (!buffer || turn !== audio.turn || engine.current !== audio) return
      const { context } = audio
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(audio.voice)
      const start = context.currentTime + delay
      audio.duck.gain.setTargetAtTime(.4, Math.max(context.currentTime, start - .3), .25)
      source.onended = () => {
        source.disconnect()
        if (audio.speaking !== source) return
        audio.speaking = undefined
        audio.duck.gain.setTargetAtTime(1, context.currentTime, .6)
      }
      audio.speaking = source; source.start(start)
    })
  }
  function setVoice(next: boolean) {
    preference.current = { ...preference.current, voice: next }; setPrefs(p => ({ ...p, voice: next }))
    if (next) { unlock(); preloadVoice() } else hush()
  }
  return {
    voice: prefs.voice, setVoice, say, hush, preloadVoice,
    enabled: prefs.enabled, volume: prefs.volume, scape: prefs.scape, status,
    setVolume: (volume: number) => setPrefs(p => ({ ...p, volume })),
    setScape: (scape: Soundscape) => { setPrefs(p => ({ ...p, scape })); unlock() },
    toggle, unlock, cue,
  }
}
