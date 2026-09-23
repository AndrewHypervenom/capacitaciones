import { useEffect, useRef, useState } from 'react'

/** Sound starts only from an explicit user gesture; nothing is downloaded. */
export function useDrivingAudio(speed: number, paused: boolean) {
  const [enabled, setEnabled] = useState(false)
  const audio = useRef<{ context: AudioContext; engine: OscillatorNode; volume: GainNode } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  function toggle() {
    try {
      if (!audio.current) {
        const context = new AudioContext()
        const engine = context.createOscillator()
        const filter = context.createBiquadFilter()
        const volume = context.createGain()
        engine.type = 'triangle'; engine.frequency.value = 42
        filter.type = 'lowpass'; filter.frequency.value = 180
        volume.gain.value = 0
        engine.connect(filter); filter.connect(volume); volume.connect(context.destination); engine.start()
        audio.current = { context, engine, volume }
      }
      void audio.current.context.resume().catch(() => { setUnavailable(true); setEnabled(false) })
      setEnabled(value => !value)
    } catch { setUnavailable(true) }
  }
  useEffect(() => {
    const a = audio.current
    if (!a) return
    a.engine.frequency.setTargetAtTime(38 + speed * 1.3, a.context.currentTime, .18)
    a.volume.gain.setTargetAtTime(enabled && !paused ? .018 + speed * .0003 : 0, a.context.currentTime, .12)
  }, [speed, enabled, paused])
  useEffect(() => {
    const visibility = () => {
      const a = audio.current
      if (document.hidden && a) a.volume.gain.setTargetAtTime(0, a.context.currentTime, .05)
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      if (audio.current) { audio.current.engine.stop(); void audio.current.context.close(); audio.current = null }
    }
  }, [])
  function cue(correct: boolean) {
    const a = audio.current
    if (!a || !enabled) return
    const note = a.context.createOscillator(), gain = a.context.createGain(), now = a.context.currentTime
    note.type = 'sine'; note.connect(gain); gain.connect(a.context.destination)
    note.frequency.setValueAtTime(correct ? 523 : 220, now)
    note.frequency.setValueAtTime(correct ? 784 : 174, now + .14)
    gain.gain.setValueAtTime(.07, now); gain.gain.exponentialRampToValueAtTime(.001, now + .45)
    note.start(); note.stop(now + .5)
    note.onended = () => { note.disconnect(); gain.disconnect() }
  }
  return { enabled, unavailable, toggle, cue }
}
