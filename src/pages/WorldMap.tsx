import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, useReducedMotion, useMotionValue, useSpring, useMotionTemplate, animate } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { getStarsFromScore, getStarsDisplay } from '@/lib/scoring'
import StarDisplay from '@/components/StarDisplay'
import { useProgressStore } from '@/stores/progressStore'
import { LevelTransition } from '@/components/worlds/LevelTransition'

/* ── Types ── */
interface World {
  id: string; name: string; description: string
  campaign_id: string | null; course_id: string | null; icon: string; color: string
  bg_type: string; status: string
  sound_theme: string; transition_type: string; character_emoji: string
}
interface Region { id: string; name: string; icon: string; order_index: number }
interface Level {
  id: string; name: string; icon: string
  order_index: number; quiz_id: string | null
  region_id: string; world_id: string
  min_score_pct: number | null
}

/* ── Theme configs ── */
const THEMES: Record<string, {
  tint: string; pathColor: string; regionGlow: string
  ambientEmojis: string[]; label: string
}> = {
  airline: {
    tint: 'rgba(0,150,255,0.07)',
    pathColor: '#0096ff',
    regionGlow: 'rgba(0,150,255,0.08)',
    ambientEmojis: ['☁️','✈️','🌤️','⭐','🛫','⛅','🌙','💫'],
    label: 'Aerolínea',
  },
  bank: {
    tint: 'rgba(160,80,255,0.07)',
    pathColor: '#a050ff',
    regionGlow: 'rgba(160,80,255,0.08)',
    ambientEmojis: ['💳','🏦','💎','💰','🏙️','📊','💵','🔐'],
    label: 'Banco',
  },
  health: {
    tint: 'rgba(0,200,100,0.07)',
    pathColor: '#00c864',
    regionGlow: 'rgba(0,200,100,0.08)',
    ambientEmojis: ['🌿','💊','🩺','❤️','🌱','🧬','💉','🌻'],
    label: 'Salud',
  },
  corporate: {
    tint: 'rgba(16,212,81,0.07)',
    pathColor: '#10D451',
    regionGlow: 'rgba(16,212,81,0.08)',
    ambientEmojis: ['🚀','⭐','💫','🌟','🎯','📈','🏆','✨'],
    label: 'Corporativo',
  },
  tech: {
    tint: 'rgba(0,255,128,0.07)',
    pathColor: '#00ff80',
    regionGlow: 'rgba(0,255,128,0.08)',
    ambientEmojis: ['💻','⚡','🖥️','📡','🤖','⚙️','🛸','🔌'],
    label: 'Tecnología',
  },
}

/* ── Sound ──
   Un único AudioContext reutilizado. Antes se creaba `new AudioContext()` en
   CADA sonido: los navegadores limitan la cantidad de contextos (~6) y a partir
   de ahí `new AudioContext()` lanza y el sonido fallaba en silencio. Además hay
   que hacer `resume()` porque el contexto arranca "suspended" por la política de
   autoplay hasta que hay un gesto del usuario. */
let wmAudioCtx: AudioContext | null = null
function getWorldCtx(): AudioContext | null {
  try {
    if (!wmAudioCtx) {
      const AudioCtx = window.AudioContext || (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext
      if (!AudioCtx) return null
      wmAudioCtx = new AudioCtx()
    }
    if (wmAudioCtx.state === 'suspended') void wmAudioCtx.resume()
    return wmAudioCtx
  } catch {
    return null
  }
}

function playSound(soundTheme: string, type: 'enter' | 'unlock' | 'click') {
  try {
    const ctx = getWorldCtx()
    if (!ctx) return
    const t = ctx.currentTime
    const mk = (wave: OscillatorType, dur: number, delay = 0) => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = wave; o.connect(g); g.connect(ctx.destination)
      g.gain.setValueAtTime(.001, t + delay)
      o.start(t + delay); o.stop(t + delay + dur)
      return { o, g }
    }
    if (type === 'click') {
      const { o, g } = mk('sine', .1)
      o.frequency.setValueAtTime(600, t)
      g.gain.setValueAtTime(.05, t); g.gain.exponentialRampToValueAtTime(.001, t + .08)
      return
    }
    if (type === 'unlock') {
      const { o: o1, g: g1 } = mk('sine', .65)
      const { o: o2, g: g2 } = mk('triangle', .6)
      ;[523, 659, 784].forEach((f, i) => { o1.frequency.setValueAtTime(f, t + i * .12); o2.frequency.setValueAtTime(f * 2, t + i * .12) })
      g1.gain.setValueAtTime(.12, t); g1.gain.exponentialRampToValueAtTime(.001, t + .6)
      g2.gain.setValueAtTime(.05, t); g2.gain.exponentialRampToValueAtTime(.001, t + .55)
      return
    }
    const presets: Record<string, () => void> = {
      airport: () => {
        // PA ding-dong chime + ascending shimmer
        const { o: o1, g: g1 } = mk('sine', .9)
        const { o: o2, g: g2 } = mk('sine', .75)
        const { o: o3, g: g3 } = mk('triangle', .5)
        o1.frequency.setValueAtTime(784, t); o1.frequency.setValueAtTime(659, t + .2)
        o1.frequency.setValueAtTime(880, t + .45); o1.frequency.exponentialRampToValueAtTime(1320, t + .75)
        o2.frequency.setValueAtTime(1176, t); o2.frequency.setValueAtTime(989, t + .2); o2.frequency.setValueAtTime(880, t + .5)
        o3.frequency.setValueAtTime(392, t); o3.frequency.setValueAtTime(330, t + .2)
        g1.gain.setValueAtTime(.12, t); g1.gain.exponentialRampToValueAtTime(.001, t + .85)
        g2.gain.setValueAtTime(.07, t); g2.gain.exponentialRampToValueAtTime(.001, t + .7)
        g3.gain.setValueAtTime(.03, t); g3.gain.exponentialRampToValueAtTime(.001, t + .45)
      },
      bank: () => {
        // Ka-ching: metallic strike + bell ring + confirmation
        const { o: o1, g: g1 } = mk('square', .1)
        const { o: o2, g: g2 } = mk('sine', .45, .06)
        const { o: o3, g: g3 } = mk('triangle', .35, .06)
        o1.frequency.setValueAtTime(2000, t); o1.frequency.exponentialRampToValueAtTime(800, t + .05)
        g1.gain.setValueAtTime(.06, t); g1.gain.exponentialRampToValueAtTime(.001, t + .08)
        o2.frequency.setValueAtTime(1047, t + .06); o2.frequency.setValueAtTime(1319, t + .15)
        g2.gain.setValueAtTime(.1, t + .06); g2.gain.exponentialRampToValueAtTime(.001, t + .45)
        o3.frequency.setValueAtTime(523, t + .06); o3.frequency.setValueAtTime(659, t + .15)
        g3.gain.setValueAtTime(.05, t + .06); g3.gain.exponentialRampToValueAtTime(.001, t + .35)
      },
      health: () => {
        // Heart monitor beep-beep + warm resolution chord
        const { o: o1, g: g1 } = mk('sine', .85)
        const { o: o2, g: g2 } = mk('sine', .4, .4)
        o1.frequency.setValueAtTime(880, t)
        g1.gain.setValueAtTime(.1, t); g1.gain.exponentialRampToValueAtTime(.02, t + .1)
        g1.gain.setValueAtTime(.1, t + .18); g1.gain.exponentialRampToValueAtTime(.02, t + .28)
        o1.frequency.setValueAtTime(523, t + .4)
        g1.gain.setValueAtTime(.08, t + .4); g1.gain.exponentialRampToValueAtTime(.001, t + .8)
        o2.frequency.setValueAtTime(392, t + .4)
        g2.gain.setValueAtTime(.06, t + .42); g2.gain.exponentialRampToValueAtTime(.001, t + .75)
      },
      tech: () => {
        // Rapid digital blips + sawtooth sweep + confirmation tone
        const { o: o1, g: g1 } = mk('square', .35)
        const { o: o2, g: g2 } = mk('sawtooth', .4)
        const { o: o3, g: g3 } = mk('sine', .3, .3)
        ;[330, 440, 550, 660, 880].forEach((f, i) => {
          o1.frequency.setValueAtTime(f, t + i * .05)
          g1.gain.setValueAtTime(.05, t + i * .05); g1.gain.exponentialRampToValueAtTime(.01, t + i * .05 + .03)
        })
        o2.frequency.setValueAtTime(200, t); o2.frequency.exponentialRampToValueAtTime(1600, t + .3)
        g2.gain.setValueAtTime(.04, t); g2.gain.exponentialRampToValueAtTime(.001, t + .35)
        o3.frequency.setValueAtTime(1047, t + .3)
        g3.gain.setValueAtTime(.06, t + .3); g3.gain.exponentialRampToValueAtTime(.001, t + .55)
      },
      neutral: () => {
        // Professional achievement: major chord (C-E-G) with gentle fade
        const { o: o1, g: g1 } = mk('sine', .75)
        const { o: o2, g: g2 } = mk('sine', .7)
        const { o: o3, g: g3 } = mk('triangle', .55, .1)
        o1.frequency.setValueAtTime(523, t); o2.frequency.setValueAtTime(784, t); o3.frequency.setValueAtTime(659, t + .1)
        g1.gain.setValueAtTime(.1, t); g1.gain.exponentialRampToValueAtTime(.001, t + .7)
        g2.gain.setValueAtTime(.07, t); g2.gain.exponentialRampToValueAtTime(.001, t + .65)
        g3.gain.setValueAtTime(.03, t + .1); g3.gain.exponentialRampToValueAtTime(.001, t + .55)
      },
    }
    ;(presets[soundTheme] ?? presets.neutral)()
  } catch { /* silent */ }
}

/* ── Confetti burst on unlock ── */
function ConfettiBurst({ color }: { color: string }) {
  return (
    <>
      <style>{`@keyframes cf{0%{opacity:1;transform:translate(0,0) rotate(0) scale(1)}100%{opacity:0;transform:translate(var(--tx),var(--ty)) rotate(var(--r)) scale(0)}}`}</style>
      {[...Array(12)].map((_,i)=>{
        const angle = (i/12)*360
        const dist = 60+Math.random()*40
        const tx = Math.cos(angle*Math.PI/180)*dist
        const ty = Math.sin(angle*Math.PI/180)*dist
        return (
          <div key={i} style={{
            position:'absolute',top:'50%',left:'50%',
            width:8,height:8,borderRadius:'50%',
            background:[color,'#ffd700','#ff6b6b','#4ecdc4'][i%4],
            animation:'cf .8s ease forwards',
            animationDelay:`${i*0.04}s`,
            '--tx':`${tx}px`,'--ty':`${ty}px`,
            '--r':`${Math.random()*720-360}deg`,
          } as React.CSSProperties}/>
        )
      })}
    </>
  )
}

/* ── Aurora animada de fondo ──
   Capa de "blobs" de color a la deriva con desenfoque grande y mezcla screen:
   da profundidad y un aire premium sin distraer del mapa. Se apaga con
   prefers-reduced-motion. */
function Aurora({ color, reduce }: { color: string; reduce: boolean }) {
  if (reduce) return null
  const blobs = [
    { x: '8%',  y: '12%', s: 540, d: 24, dx: 45,  dy: -32 },
    { x: '76%', y: '6%',  s: 460, d: 30, dx: -38, dy: 28  },
    { x: '62%', y: '66%', s: 620, d: 27, dx: 34,  dy: -40 },
    { x: '16%', y: '78%', s: 500, d: 33, dx: -30, dy: 36  },
  ]
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {blobs.map((b, i) => (
        <motion.div key={i}
          style={{
            position: 'absolute', left: b.x, top: b.y, width: b.s, height: b.s, borderRadius: '50%',
            background: `radial-gradient(circle, ${color}26, transparent 62%)`,
            filter: 'blur(64px)', mixBlendMode: 'screen', willChange: 'transform',
          }}
          animate={{ x: [0, b.dx, -b.dx * 0.7, 0], y: [0, b.dy, -b.dy * 0.6, 0], scale: [1, 1.14, 0.94, 1] }}
          transition={{ duration: b.d, repeat: Infinity, ease: 'easeInOut', delay: i * 1.4 }}
        />
      ))}
    </div>
  )
}

/* ── Tarjeta del selector con tilt 3D + spotlight que sigue al cursor ── */
function SelectorCard({ w, i, reduce, onPick }: {
  w: World; i: number; reduce: boolean; onPick: (w: World) => void
}) {
  const { t } = useTranslation()
  const th = THEMES[w.bg_type] ?? THEMES.corporate
  const rx = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 })
  const ry = useSpring(useMotionValue(0), { stiffness: 200, damping: 18 })
  const mx = useMotionValue(-300)
  const my = useMotionValue(-300)
  const halo = useMotionTemplate`radial-gradient(240px circle at ${mx}px ${my}px, ${w.color}2e, transparent 62%)`

  const onMove = (e: React.MouseEvent) => {
    if (reduce) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    ry.set(px * 14); rx.set(-py * 14)
    mx.set(e.clientX - r.left); my.set(e.clientY - r.top)
  }
  const reset = () => { rx.set(0); ry.set(0); mx.set(-300); my.set(-300) }

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 28, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: reduce ? 0 : i * 0.09, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      whileHover={reduce ? undefined : { scale: 1.03 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{
        rotateX: reduce ? 0 : rx, rotateY: reduce ? 0 : ry, transformPerspective: 900,
        position: 'relative', overflow: 'hidden', cursor: 'pointer',
        background: `radial-gradient(ellipse 130% 80% at 50% 15%, ${th.tint}, transparent 70%), rgb(var(--surface))`,
        border: `1.5px solid ${w.color}33`, borderRadius: '1.5rem', padding: '34px 24px 30px',
        textAlign: 'center', boxShadow: `0 14px 44px ${w.color}18`, willChange: 'transform',
      }}
      onClick={() => { playSound(w.sound_theme, 'click'); onPick(w) }}
    >
      {/* Spotlight que sigue al cursor */}
      {!reduce && <motion.div aria-hidden style={{ position: 'absolute', inset: 0, background: halo, pointerEvents: 'none' }} />}
      {/* Brillo superior sutil */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${w.color}66, transparent)` }} />
      <div style={{ position: 'relative' }}>
        <motion.div
          style={{ fontSize: '3.6rem', marginBottom: 14, filter: `drop-shadow(0 0 16px ${w.color})`, display: 'inline-block' }}
          animate={reduce ? undefined : { y: [0, -7, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.3 }}
        >{w.icon}</motion.div>
        <div style={{ fontSize: '1.22rem', fontWeight: 800, color: 'rgb(var(--text))', marginBottom: 8 }}>{w.name}</div>
        {w.description && <div style={{ fontSize: '.78rem', color: 'rgb(var(--text-muted))', lineHeight: 1.6, marginBottom: 14 }}>{w.description}</div>}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${w.color}15`, border: `1px solid ${w.color}30`, borderRadius: 20, padding: '5px 14px', fontSize: '.72rem', color: w.color, fontWeight: 700 }}>{w.icon} {t(`themes.${w.bg_type}`, th.label)}</div>
      </div>
    </motion.div>
  )
}

/* ── Número que "cuenta" hacia su valor (para el XP) ── */
function CountUp({ value, reduce }: { value: number; reduce: boolean }) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)
  useEffect(() => {
    if (reduce || prev.current === value) { setDisplay(value); prev.current = value; return }
    const controls = animate(prev.current, value, {
      duration: 0.9, ease: [0.16, 1, 0.3, 1],
      onUpdate: v => setDisplay(Math.round(v)),
    })
    prev.current = value
    return () => controls.stop()
  }, [value, reduce])
  return <>{display}</>
}

export default function WorldMap() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { user, profile } = useAuth() as {
    user: { id: string } | null
    profile: { campaign_id?: string | null; role?: string } | null
  }

  const [worlds, setWorlds]           = useState<World[]>([])
  const [world, setWorld]             = useState<World | null>(null)
  const [regions, setRegions]         = useState<Region[]>([])
  const [levels, setLevels]           = useState<Level[]>([])
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  const [scoreMap, setScoreMap]         = useState<Map<string, number>>(new Map())
  const [loading, setLoading]         = useState(true)
  const [showSelector, setShowSelector] = useState(false)
  const [hoveredId, setHoveredId]     = useState<string | null>(null)
  const [transition, setTransition]   = useState(false)
  const [newlyUnlocked, setNewlyUnlocked] = useState<string | null>(null)
  const [xpDisplay, setXpDisplay]     = useState(0)
  // Slug del curso dueño del mundo, para que "Volver" regrese SIEMPRE al curso
  // (no dependemos de navigate(-1), que con el historial curso→mundo→nivel→mundo
  // devolvía al nivel en vez de al curso).
  const [courseSlug, setCourseSlug]   = useState<string | null>(null)
  const [mapW, setMapW]               = useState(() => Math.min(380, typeof window !== 'undefined' ? window.innerWidth - 40 : 380))
  const charRef = useRef<HTMLDivElement>(null)
  const reduce = !!useReducedMotion()
  // El efecto de carga puede correr varias veces (la referencia de `profile`
  // cambia mientras la sesión se asienta), y con ello loadWorld. Este guard evita
  // que el sonido/animación de "nivel desbloqueado" se dispare repetidamente.
  const unlockPlayedRef = useRef(false)

  useEffect(() => {
    const update = () => setMapW(Math.min(380, window.innerWidth - 40))
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const locState     = location.state as { from?: string; worldId?: string; forceReload?: boolean } | null
  const campaignId   = profile?.campaign_id ?? null
  const isSuperAdmin = ['superadmin','super_admin'].includes(profile?.role ?? '')
  const isStaff      = ['superadmin','super_admin','capacitador'].includes(profile?.role ?? '')
  // "Volver" debe regresar a DONDE se venía, no a '/'. Antes iba a '/', y como
  // Welcome redirige al staff autenticado a '/admin', un capacitador/superadmin
  // en "vista aprendiz" terminaba fuera de la vista aprendiz, en un panel a medio
  // renderizar. Desde el curso (from:'course') volvemos con history back, que
  // devuelve a la página del curso conservando la vista aprendiz. Desde el CMS
  // (from:'admin') vamos al listado de mundos. En cualquier otro caso, a '/'.
  const goBack = useCallback(() => {
    if (locState?.from === 'admin') { navigate('/admin/worlds'); return }
    // Regresamos directo al curso por su slug (fiable, sin depender del historial).
    if (courseSlug) { navigate(`/courses/${courseSlug}`); return }
    if (locState?.from === 'course' && window.history.length > 1) { navigate(-1); return }
    navigate('/')
  }, [locState, navigate, courseSlug])

  // El menú de Mundos sigue oculto para el aprendiz y /world queda reservada
  // para staff (preview desde el CMS)… EXCEPTO cuando un aprendiz llega desde
  // la página de SU curso: "Jugar el mundo" navega con from:'course' + worldId,
  // y en ese caso puede jugar el mundo de ese curso. El acceso directo por URL
  // o por un link viejo (sin ese estado) sigue devolviéndolo al dashboard.
  const fromCourse = locState?.from === 'course' && !!locState?.worldId
  useEffect(() => {
    if (profile && !isStaff && !fromCourse) navigate('/', { replace: true })
  }, [profile, isStaff, navigate, fromCourse])

  /* Load */
  useEffect(() => {
    if (!user || !profile) return
    async function load() {
      // Aprendiz sin campaña asignada → no cargar ningún mundo
      if (!isSuperAdmin && !campaignId) {
        setLoading(false)
        return
      }

      const { data: wData } = await supabase.from('worlds').select('*').eq('status','published')
      const all = (wData ?? []) as World[]
      // El aprendiz elige entre los mundos de su campaña; el superadmin, entre todos.
      // (Los deep-links por worldId desde el curso usan `all`, así funcionan igual.)
      const visible = isSuperAdmin ? all : all.filter(x => x.campaign_id === campaignId)
      setWorlds(visible)

      // Force reload after progress reset — clear in-memory state first
      if (locState?.forceReload && locState?.worldId) {
        setCompletedIds(new Set())
        setScoreMap(new Map())
        setXpDisplay(0)
        const w = all.find(x => x.id === locState.worldId)
        if (w) { await loadWorld(w); setLoading(false); return }
      }

      // If returning from quiz, load that world directly
      if (locState?.worldId) {
        const w = all.find(x => x.id === locState.worldId)
        if (w) { await loadWorld(w); setLoading(false); return }
      }

      // Con varios mundos, mostramos el selector (antes solo para superadmin).
      if (visible.length > 1) { setShowSelector(true); setLoading(false); return }
      const w = visible[0] ?? (isSuperAdmin ? all[0] : null)
      if (w) await loadWorld(w)
      setLoading(false)
    }
    load()
  }, [user, profile])

  const loadWorld = useCallback(async (w: World) => {
    setWorld(w); setShowSelector(false)
    // Slug del curso dueño (para el botón "Volver"). Si el mundo no está ligado a
    // un curso, queda null y "Volver" cae al fallback (historial / dashboard).
    if (w.course_id) {
      supabase.from('courses').select('slug').eq('id', w.course_id).maybeSingle()
        .then(({ data }) => setCourseSlug((data as { slug?: string } | null)?.slug ?? null))
    } else {
      setCourseSlug(null)
    }
    const { data: rData } = await supabase.from('world_regions').select('*').eq('world_id',w.id).order('order_index')
    setRegions((rData ?? []) as Region[])
    const { data: lData } = await supabase.from('world_levels').select('*').eq('world_id',w.id).order('order_index')
    setLevels((lData ?? []) as Level[])
    if (user) {
      const { data: pData } = await supabase.from('world_progress').select('level_id,xp_earned,score').eq('user_id',user.id).eq('world_id',w.id).eq('completed',true)
      const ids = new Set((pData ?? []).map((p: {level_id: string}) => p.level_id))
      setCompletedIds(ids)
      const sm = new Map<string, number>()
      ;(pData ?? []).forEach((p: {level_id: string; score: number}) => sm.set(p.level_id, p.score ?? 0))
      setScoreMap(sm)
      const totalXP = (pData ?? []).reduce((s: number, p: {xp_earned: number}) => s + (p.xp_earned || 0), 0)
      setXpDisplay(totalXP)
      // Check for newly unlocked (last state from quiz). El guard evita que, si
      // loadWorld corre varias veces, el sonido/animación se repita (el usuario
      // oía el "unlock" varias veces seguidas al entrar).
      if (locState?.worldId && pData && pData.length > 0 && !unlockPlayedRef.current) {
        const lastLevels = (lData ?? []) as Level[]
        const lastCompleted = [...ids].pop()
        const nextIdx = lastLevels.findIndex(l => l.id === lastCompleted) + 1
        if (nextIdx > 0 && nextIdx < lastLevels.length) {
          unlockPlayedRef.current = true
          setNewlyUnlocked(lastLevels[nextIdx].id)
          playSound(w.sound_theme, 'unlock')
          setTimeout(() => setNewlyUnlocked(null), 2000)
        }
      }
    }
  }, [user, locState])

  const handleNodeClick = (level: Level, i: number) => {
    const done      = completedIds.has(level.id)
    const available = !done && (i === 0 || completedIds.has(levels[i-1]?.id))
    if ((!done && !available) || !level.quiz_id) return
    playSound(world?.sound_theme ?? 'neutral', 'enter')
    setTransition(true)
    // ~2s cinematográficos para que la escena de la transición se aprecie;
    // con movimiento reducido no hay animación, así que saltamos rápido.
    setTimeout(() => {
      setTransition(false)
      navigate(`/arena/${level.quiz_id}`, {
        state: { from: 'world', worldId: world?.id, levelId: level.id, minScorePct: level.min_score_pct }
      })
    }, reduce ? 500 : 2000)
  }

  /* Duolingo-style vertical path positions */
  const positions = useMemo(() => {
    const pts: { x: number; y: number; side: 'left'|'center'|'right' }[] = []
    const W = mapW
    const pattern: Array<'left'|'center'|'right'> = ['left','center','right','center']
    const xMap = { left: W*0.18, center: W*0.5, right: W*0.82 }
    const ROW_H = 110
    const START_Y = 80
    levels.forEach((_, i) => {
      const side = pattern[i % pattern.length]
      pts.push({ x: xMap[side], y: START_Y + i * ROW_H, side })
    })
    return pts
  }, [levels, mapW])

  const svgH = positions.length > 0 ? positions[positions.length-1].y + 120 : 300

  /* Stars */
  const stars = useMemo(() => [...Array(25)].map((_,i) => ({
    left:`${(i*37)%100}%`, top:`${(i*53)%100}%`,
    size: i%5===0?3:i%3===0?2:1.5,
    dur:`${2+(i%4)}s`, delay:`${(i*.3)%4}s`
  })), [])

  const theme = THEMES[world?.bg_type ?? 'corporate'] ?? THEMES.corporate
  const tc    = world?.color ?? '#10D451'

  const completedCount = completedIds.size
  const totalCount     = levels.length
  const progressPct    = totalCount > 0 ? (completedCount/totalCount)*100 : 0

  // Avance de mundo → motor de reglas: "Explorador" (≥1 nivel) y "Conquistador"
  // (mundo completo). Los umbrales viven en las defs configurables.
  useEffect(() => {
    if (completedCount > 0) {
      const worldDone = totalCount > 0 && completedCount >= totalCount ? 1 : 0
      useProgressStore.getState().recordWorldProgress(completedCount, worldDone)
    }
  }, [completedCount, totalCount])

  // Al volver de un quiz con un nivel recién desbloqueado, desplazamos el mapa
  // suavemente hasta el personaje para que el aprendiz vea el pop del nodo nuevo.
  useEffect(() => {
    if (!newlyUnlocked || reduce) return
    const id = setTimeout(
      () => charRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      350,
    )
    return () => clearTimeout(id)
  }, [newlyUnlocked, reduce])

  /* Stars score per level */
  const getStars = (level: Level): number => {
    if (!completedIds.has(level.id)) return 0
    return getStarsFromScore(scoreMap.get(level.id) ?? 0, level.min_score_pct)
  }

  /* ── Loading ── */
  if (loading) return (
    <div style={{minHeight:'100vh',background:'rgb(var(--bg))',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16,fontFamily:'inherit'}}>
      <style>{`@keyframes sp{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
      <div style={{fontSize:'3rem',animation:'sp 1.5s linear infinite'}}>🌍</div>
      <div style={{color:'rgb(var(--text-muted))',fontSize:'.875rem',letterSpacing:1}}>{t('world.loading_world')}</div>
    </div>
  )

  /* ── Sin campaña asignada ── */
  if (!isSuperAdmin && !campaignId) return (
    <div style={{minHeight:'100vh',background:'rgb(var(--bg))',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:20,fontFamily:'inherit',padding:'0 24px',textAlign:'center'}}>
      <div style={{fontSize:'3.5rem'}}>🗺️</div>
      <div style={{color:'rgb(var(--text))',fontWeight:800,fontSize:'1.2rem'}}>{t('world.no_campaign_title')}</div>
      <div style={{color:'rgb(var(--text-muted))',fontSize:'.9rem',maxWidth:320,lineHeight:1.6}}>{t('world.no_campaign_desc')}</div>
      <button onClick={() => navigate('/')} style={{marginTop:8,background:'rgb(var(--subtle))',border:'1px solid rgb(var(--line))',borderRadius:12,padding:'10px 24px',color:'rgb(var(--text-muted))',cursor:'pointer',fontFamily:'inherit',fontSize:'.9rem',fontWeight:600}}>{t('world.back_dashboard')}</button>
    </div>
  )

  /* ── Selector ── */
  if (showSelector) return (
    <>
      <style>{`
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
      `}</style>
      <div className="wm-selector-wrap" style={{minHeight:'100vh',background:'rgb(var(--bg))',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:40,fontFamily:'inherit',position:'relative',overflow:'hidden'}}>
        <Aurora color="#10D451" reduce={reduce} />
        <button onClick={goBack} style={{position:'fixed',top:20,left:20,zIndex:2,background:'none',border:'none',color:'rgb(var(--text-muted))',cursor:'pointer',fontSize:'.875rem',fontFamily:'inherit'}}>{t('world.back')}</button>
        <div style={{fontSize:'3.5rem',marginBottom:20,animation:'bob 3s ease infinite',position:'relative',zIndex:1}}>🌍</div>
        <h1 style={{color:'rgb(var(--text))',fontSize:'2rem',fontWeight:900,margin:'0 0 10px',textAlign:'center',letterSpacing:'-1px',position:'relative',zIndex:1}}>{t('world.choose_world')}</h1>
        <p style={{color:'rgb(var(--text-muted))',margin:'0 0 48px',fontSize:'.9rem',position:'relative',zIndex:1}}>{t('world.choose_world_sub')}</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:24,maxWidth:800,width:'100%',position:'relative',zIndex:1}}>
          {worlds.map((w,i) => (
            <SelectorCard key={w.id} w={w} i={i} reduce={reduce} onPick={loadWorld} />
          ))}
        </div>
      </div>
    </>
  )

  if (!world) return (
    <div style={{minHeight:'100vh',background:'rgb(var(--bg))',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,fontFamily:'inherit'}}>
      <div style={{fontSize:'3rem'}}>🌍</div>
      <div style={{color:'rgb(var(--text))',fontWeight:700,fontSize:'1.1rem'}}>{t('world.no_world')}</div>
      <button onClick={goBack} style={{background:'none',border:'1px solid rgb(var(--line))',borderRadius:12,padding:'8px 20px',color:'rgb(var(--text-muted))',cursor:'pointer',fontFamily:'inherit',fontSize:'.875rem'}}>{t('world.back')}</button>
    </div>
  )

  return (
    <>
      <style>{`
        @keyframes charBob{0%,100%{transform:translate(-50%,-120%) scale(1) rotate(-5deg)}50%{transform:translate(-50%,-135%) scale(1.08) rotate(5deg)}}
        @keyframes titleBob{0%,100%{transform:translateY(0) scale(1) rotate(-3deg)}50%{transform:translateY(-8px) scale(1.06) rotate(3deg)}}
        @keyframes pulse{0%{box-shadow:0 0 0 0 ${tc}80}70%{box-shadow:0 0 0 18px ${tc}00}100%{box-shadow:0 0 0 0 ${tc}00}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes starT{0%,100%{opacity:.15;transform:scale(.7)}50%{opacity:.7;transform:scale(1.2)}}
        @keyframes amb{0%{opacity:0;transform:translateY(10px) scale(.8)}20%{opacity:.5}80%{opacity:.3}100%{opacity:0;transform:translateY(-70px) scale(1.2)}}
        @keyframes dashFlow{to{stroke-dashoffset:-20}}
        @keyframes xpPop{0%{opacity:0;transform:translateY(0) scale(.8)}20%{opacity:1;transform:translateY(-10px) scale(1.1)}80%{opacity:1;transform:translateY(-30px)}100%{opacity:0;transform:translateY(-50px)}}
        @keyframes barShimmer{0%{transform:translateX(-120%)}60%,100%{transform:translateX(320%)}}
        .node-avail{animation:pulse 2s ease infinite;}
        .char{animation:charBob 2.5s ease-in-out infinite;}
        @media (max-width:400px){
          .wm-selector-wrap{padding:16px!important;}
          .wm-hdr-cambiar{display:none!important;}
          .wm-hdr-xp{padding:4px 8px!important;}
          .wm-world-title{font-size:1.45rem!important;}
          .wm-map-outer{padding:0 8px 80px!important;}
          .wm-hdr-name{display:none!important;}
          .wm-hdr-label{display:none!important;}
        }
      `}</style>

      {transition && <LevelTransition type={world.transition_type || 'clouds'} color={tc} reduce={reduce}/>}

      <div style={{minHeight:'100vh',background:`radial-gradient(ellipse 130% 80% at 50% 20%, ${theme.tint}, transparent 70%), rgb(var(--bg))`,fontFamily:'inherit',position:'relative',overflow:'hidden'}}>

        {/* Aurora animada de fondo */}
        <Aurora color={tc} reduce={reduce} />

        {/* Stars */}
        {stars.map((s,i) => (
          <div key={i} style={{position:'fixed',left:s.left,top:s.top,width:s.size,height:s.size,borderRadius:'50%',background:'rgb(var(--text))',animation:`starT ${s.dur} ease infinite`,animationDelay:s.delay,opacity:.2,pointerEvents:'none',zIndex:0}}/>
        ))}

        {/* Ambient emojis */}
        {theme.ambientEmojis.map((em,i) => (
          <div key={i} style={{position:'fixed',left:`${(i*13+5)%88}%`,top:`${(i*19+8)%78}%`,fontSize:`${.8+(i%3)*.3}rem`,animation:`amb ${3+(i%4)}s ease-in-out infinite`,animationDelay:`${(i*.7)%6}s`,opacity:0,pointerEvents:'none',zIndex:0,userSelect:'none'}}>{em}</div>
        ))}

        {/* ── Header ── */}
        <header style={{position:'sticky',top:0,zIndex:50,background:'rgb(var(--bg) / 0.85)',backdropFilter:'blur(24px)',borderBottom:`1px solid ${tc}20`,height:60,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 20px'}}>
          <button onClick={() => { playSound(world.sound_theme,'click'); goBack() }}
            style={{background:'none',border:'none',color:'rgb(var(--text-muted))',cursor:'pointer',fontSize:'.875rem',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6}}>
            {t('world.back')}
          </button>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{fontSize:'1.4rem',lineHeight:1}}>{world.icon}</div>
            <div>
              <div className="wm-hdr-name" style={{color:'rgb(var(--text))',fontWeight:800,fontSize:'.95rem',lineHeight:1}}>{world.name}</div>
              <div className="wm-hdr-label" style={{color:'rgb(var(--text-subtle))',fontSize:'.6rem',marginTop:1}}>{t(`themes.${world.bg_type}`, theme.label)}</div>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {/* XP counter */}
            <div className="wm-hdr-xp" style={{display:'flex',alignItems:'center',gap:6,background:`${tc}15`,border:`1px solid ${tc}25`,borderRadius:20,padding:'4px 12px'}}>
              <span style={{fontSize:'.7rem'}}>⭐</span>
              <motion.span
                key={xpDisplay}
                initial={reduce ? false : { scale: 1.5, color: '#FBBF24' }}
                animate={{ scale: 1, color: tc }}
                transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                style={{color:tc,fontWeight:800,fontSize:'.82rem',display:'inline-block'}}
              ><CountUp value={xpDisplay} reduce={reduce} /> XP</motion.span>
            </div>
            {worlds.length > 1 && (
              <button className="wm-hdr-cambiar" onClick={() => setShowSelector(true)}
                style={{background:`${tc}15`,border:`1px solid ${tc}25`,borderRadius:20,padding:'4px 12px',color:tc,fontSize:'.72rem',fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                {t('world.change')}
              </button>
            )}
          </div>
        </header>

        {/* Progress bar */}
        <div style={{height:4,background:'rgb(var(--line) / 0.3)',position:'relative',zIndex:1,overflow:'hidden'}}>
          <div style={{height:'100%',width:`${progressPct}%`,background:`linear-gradient(90deg,${tc},${tc}80)`,transition:'width 1s ease',boxShadow:`0 0 10px ${tc}80`,position:'relative',overflow:'hidden'}}>
            {!reduce && progressPct > 0 && (
              <div style={{position:'absolute',inset:0,width:'40%',background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)',animation:'barShimmer 3.5s ease-in-out infinite'}}/>
            )}
          </div>
        </div>

        {/* World title */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          style={{textAlign:'center',padding:'32px 20px 16px',position:'relative',zIndex:1}}>
          <div style={{fontSize:'2.8rem',marginBottom:10,filter:`drop-shadow(0 0 20px ${tc})`,animation:'titleBob 4s ease infinite'}}>{world.icon}</div>
          <h1 className="wm-world-title" style={{margin:0,fontSize:'1.9rem',fontWeight:900,color:'rgb(var(--text))',textShadow:`0 0 40px ${tc}`,letterSpacing:'-1px',lineHeight:1.1,wordBreak:'break-word'}}>{world.name}</h1>
          {world.description && <p style={{margin:'10px auto 0',fontSize:'.875rem',color:'rgb(var(--text-muted))',maxWidth:420,lineHeight:1.6}}>{world.description}</p>}
          {/* Progress pills */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:16,marginTop:20}}>
            <div style={{background:'rgb(var(--subtle))',border:'1px solid rgb(var(--line))',borderRadius:20,padding:'6px 16px',fontSize:'.78rem',color:'rgb(var(--text-muted))'}}>
              {t('world.levels_count', { done: completedCount, total: totalCount })}
            </div>
            <div style={{background:`${tc}15`,border:`1px solid ${tc}25`,borderRadius:20,padding:'6px 16px',fontSize:'.78rem',color:tc,fontWeight:700}}>
              {t('world.pct_complete', { pct: Math.round(progressPct) })}
            </div>
          </div>
        </motion.div>

        {/* ── Duolingo Map ── */}
        <div className="wm-map-outer" style={{display:'flex',justifyContent:'center',padding:'0 20px 80px',position:'relative',zIndex:1}}>
          <div style={{position:'relative',width:mapW,minHeight:svgH}}>

            {/* Region labels — shown at first level of each region */}
            {regions.map(region => {
              const firstLevel = levels.find(l => l.region_id === region.id)
              if (!firstLevel) return null
              const idx = levels.indexOf(firstLevel)
              const pos = positions[idx]
              if (!pos) return null
              return (
                <motion.div key={region.id}
                  initial={reduce ? false : { opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                  position:'absolute',
                  left:'50%',
                  top: pos.y - 52,
                  transform:'translateX(-50%)',
                  display:'flex',alignItems:'center',gap:8,
                  background:'rgb(var(--subtle))',
                  border:`1px solid ${tc}20`,
                  borderRadius:20,
                  padding:'4px 16px',
                  fontSize:'.65rem',fontWeight:700,
                  color:'rgb(var(--text-muted))',
                  letterSpacing:'.08em',textTransform:'uppercase',
                  whiteSpace:'nowrap',
                  maxWidth: mapW - 24,
                  zIndex:3,
                }}>
                  <span style={{flexShrink:0}}>{region.icon}</span>
                  <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{region.name}</span>
                </motion.div>
              )
            })}

            {/* SVG connecting path */}
            {positions.length > 1 && (
              <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',overflow:'visible',pointerEvents:'none',zIndex:2}} viewBox={`0 0 ${mapW} ${svgH}`}>
                {/* Defs */}
                <defs>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                    <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                </defs>
                {/* Shadow track */}
                <path d={buildPath(positions)} fill="none" stroke="rgb(var(--text) / 0.12)" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round"/>
                {/* Base track */}
                <path d={buildPath(positions)} fill="none" stroke="rgb(var(--text) / 0.07)" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round"/>
                {/* Completed section (fondo tenue del trazo completo) */}
                <path d={buildPath(positions)} fill="none" stroke={tc} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={.15}/>
                {/* Progreso real: el trazo se "dibuja" hasta la fracción completada */}
                <motion.path
                  d={buildPath(positions)}
                  fill="none"
                  stroke={tc}
                  strokeWidth={6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: totalCount > 0 ? Math.min(1, completedCount / totalCount) : 0 }}
                  transition={{ duration: reduce ? 0 : 1.1, ease: [0.16, 1, 0.3, 1] }}
                  style={{ filter: `drop-shadow(0 0 6px ${tc}66)` }}
                />
                {/* Animated dashes */}
                <path d={buildPath(positions)} fill="none" stroke={tc} strokeWidth={3} strokeLinecap="round" strokeDasharray="12 8" opacity={.6} style={{animation:'dashFlow 1s linear infinite'}}/>
                {/* Glow */}
                <path d={buildPath(positions)} fill="none" stroke={tc} strokeWidth={2} strokeLinecap="round" opacity={.8} filter="url(#glow)"/>
              </svg>
            )}

            {/* Character */}
            {positions.length > 0 && (() => {
              const lastDoneIdx = [...Array(levels.length)].reduce((acc,_,i) => completedIds.has(levels[i]?.id) ? i : acc, -1)
              const charPos = positions[lastDoneIdx >= 0 ? lastDoneIdx : 0] ?? positions[0]
              return (
                <motion.div
                  ref={charRef}
                  className="char"
                  style={{
                    position:'absolute',
                    fontSize:'2rem',zIndex:10,
                    filter:`drop-shadow(0 0 16px ${tc}) drop-shadow(0 3px 6px rgb(var(--text) / 0.3))`,
                    transform:'translate(-50%,-120%)',
                    pointerEvents:'none',
                  }}
                  initial={false}
                  animate={{ left: charPos.x, top: charPos.y }}
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 18, mass: 0.8 }}
                >
                  {world.character_emoji || '🧑'}
                </motion.div>
              )
            })()}

            {/* Nodes */}
            {levels.map((level, i) => {
              const pos      = positions[i]; if (!pos) return null
              const done     = completedIds.has(level.id)
              const available = !done && (i === 0 || completedIds.has(levels[i-1]?.id))
              const locked   = !done && !available
              const isNew    = newlyUnlocked === level.id
              const isHov    = hoveredId === level.id
              const stars    = getStars(level)

              const size = done ? 70 : available ? 76 : 60
              const bg   = done
                ? '#FBBF24'
                : available
                  ? `radial-gradient(circle at 40% 40%, ${tc}40, ${tc}15)`
                  : 'rgba(255,255,255,0.9)'
              const border = done
                ? '3px solid #D97706'
                : available
                  ? `3px solid ${tc}`
                  : `2px solid ${tc}99`
              const shadow = done
                ? '0 0 0 4px rgba(251,191,36,0.3), 0 0 24px rgba(217,119,6,0.35)'
                : available
                  ? `0 0 0 4px ${tc}20, 0 0 30px ${tc}40`
                  : `0 4px 20px rgb(var(--text) / 0.15)`

              return (
                <div key={level.id} style={{position:'absolute',left:pos.x,top:pos.y,zIndex:5}}>
                  {/* Confetti on new unlock */}
                  {isNew && <ConfettiBurst color={tc}/>}

                  {/* Sombra flotante bajo el nodo (da sensación de relieve) */}
                  {(available || done) && (
                    <div aria-hidden style={{
                      position:'absolute',left:0,top:size*0.5,transform:'translateX(-50%)',
                      width:size*0.7,height:size*0.2,borderRadius:'50%',
                      background:'rgb(var(--text) / 0.16)',filter:'blur(5px)',pointerEvents:'none',
                    }}/>
                  )}

                  {/* Halo orbital para el nodo disponible */}
                  {available && !reduce && (
                    <motion.div aria-hidden
                      style={{position:'absolute',left:0,top:0,width:size+28,height:size+28,x:'-50%',y:'-50%',borderRadius:'50%',pointerEvents:'none'}}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 7, repeat: Infinity, ease: 'linear' }}
                    >
                      <div style={{position:'absolute',top:-4,left:'50%',transform:'translateX(-50%)',width:8,height:8,borderRadius:'50%',background:tc,boxShadow:`0 0 12px ${tc}, 0 0 4px #fff`}}/>
                    </motion.div>
                  )}

                  {/* Main node */}
                  <motion.div
                    className={available ? 'node-avail' : ''}
                    style={{
                      width:size, height:size, borderRadius:'50%',
                      background:bg, border, boxShadow:shadow,
                      display:'flex',alignItems:'center',justifyContent:'center',
                      cursor:(available||done)?'pointer':'default',
                      backdropFilter:'blur(16px)',
                      x:'-50%', y:'-50%',
                      position:'relative',
                    }}
                    initial={reduce ? false : { opacity: 0, scale: 0 }}
                    animate={
                      isNew && !reduce
                        ? { opacity: 1, scale: [0.4, 1.25, 1] }
                        : { opacity: 1, scale: 1 }
                    }
                    transition={
                      isNew
                        ? { duration: 0.6, ease: [0.2, 0.8, 0.4, 1] }
                        : { delay: reduce ? 0 : Math.min(i * 0.03, 0.6), type: 'spring', stiffness: 260, damping: 18 }
                    }
                    whileHover={(available || done) && !reduce ? { scale: 1.14 } : undefined}
                    whileTap={(available || done) && !reduce ? { scale: 0.9 } : undefined}
                    onClick={() => handleNodeClick(level, i)}
                    onMouseEnter={() => (available||done) && setHoveredId(level.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {done ? (
                      <span style={{fontSize:'1.5rem',color:'#fff',fontWeight:900,textShadow:'0 1px 4px rgba(0,0,0,0.2)'}}>✓</span>
                    ) : locked ? (
                      <span style={{fontSize:'1.3rem',opacity:.7,filter:`drop-shadow(0 0 4px ${tc}40)`}}>🔒</span>
                    ) : (
                      <span style={{fontSize:'2rem',filter:`drop-shadow(0 0 10px ${tc})`}}>{level.icon || '⭐'}</span>
                    )}

                    {/* Step badge */}
                    <div style={{
                      position:'absolute',top:-8,right:-8,
                      width:22,height:22,borderRadius:'50%',
                      background:done?'#fff':available?tc:'rgb(var(--subtle))',
                      display:'flex',alignItems:'center',justifyContent:'center',
                      fontSize:'.6rem',fontWeight:900,
                      color:done?'#D97706':(available)?'#000':'rgb(var(--text-muted))',
                      border:done?'2px solid #FBBF24':'2px solid rgb(var(--bg) / 0.5)',
                      boxShadow:done?'0 0 8px rgba(251,191,36,0.5)':available?`0 0 8px ${tc}50`:'none',
                    }}>{i+1}</div>

                    {/* Stars for completed */}
                    {done && (scoreMap.get(level.id) ?? 0) > 0 && (
                      <div style={{position:'absolute',bottom:-20,left:'50%',transform:'translateX(-50%)'}}>
                        <StarDisplay value={getStarsDisplay(scoreMap.get(level.id) ?? 0)} size={12} />
                      </div>
                    )}
                  </motion.div>

                  {/* Label — se permite hasta 2 líneas para no cortar nombres largos */}
                  <div style={{
                    position:'absolute',
                    top: done ? 52 : available ? 54 : 44,
                    left:'50%',transform:'translateX(-50%)',
                    fontSize:'.62rem',fontWeight:600,lineHeight:1.15,
                    color:done?'#92400E':available?tc:'rgb(var(--text-subtle))',
                    textAlign:'center',whiteSpace:'normal',wordBreak:'break-word',
                    width:112,maxWidth:112,
                    display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',
                    textShadow:'0 1px 8px rgb(var(--bg) / 0.8), 0 0 4px rgb(var(--bg))',
                    pointerEvents:'none',
                  }}>{level.name}</div>

                  {/* Available tooltip */}
                  {available && isHov && (
                    <div style={{
                      position:'absolute',bottom:'110%',left:'50%',transform:'translateX(-50%)',
                      background:'rgb(var(--surface) / 0.95)',border:`1px solid ${tc}40`,
                      borderRadius:10,padding:'6px 12px',
                      fontSize:'.7rem',color:'rgb(var(--text))',whiteSpace:'nowrap',
                      boxShadow:`0 4px 20px ${tc}30`,backdropFilter:'blur(8px)',
                      pointerEvents:'none',
                      animation:'fadeUp .2s ease both',
                      zIndex:20,
                    }}>
                      {t('world.play_tooltip')} {level.quiz_id ? '' : t('world.no_quiz')}
                    </div>
                  )}
                  {/* Improve tooltip for completed with < 3 stars */}
                  {done && isHov && stars < 5 && (
                    <div style={{
                      position:'absolute',bottom:'110%',left:'50%',transform:'translateX(-50%)',
                      background:'rgb(var(--surface) / 0.95)',border:`1px solid ${tc}40`,
                      borderRadius:10,padding:'6px 12px',
                      fontSize:'.7rem',color:'rgb(var(--text))',whiteSpace:'nowrap',
                      boxShadow:`0 4px 20px ${tc}30`,backdropFilter:'blur(8px)',
                      pointerEvents:'none',
                      animation:'fadeUp .2s ease both',
                      zIndex:20,
                    }}>
                      {t('world.improve_score')}
                    </div>
                  )}
                </div>
              )
            })}

            {/* Completion banner */}
            {completedCount === totalCount && totalCount > 0 && (
              <motion.div
                initial={reduce ? false : { opacity: 0, scale: 0.7, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.15 }}
                style={{
                position:'absolute',
                top: positions[positions.length-1]?.y + 80,
                left:'50%',transform:'translateX(-50%)',
                textAlign:'center',
                background:`linear-gradient(135deg,${tc}20,${tc}08)`,
                border:`1px solid ${tc}35`,
                borderRadius:'1.25rem',
                padding:'20px 24px',
                backdropFilter:'blur(12px)',
                width:'max-content',maxWidth: mapW - 16,
              }}>
                <motion.div
                  style={{fontSize:'2.5rem',marginBottom:8}}
                  animate={reduce ? undefined : { rotate: [0, -8, 8, -8, 0], scale: [1, 1.12, 1] }}
                  transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.4, ease: 'easeInOut' }}
                >🏆</motion.div>
                <div style={{color:tc,fontWeight:900,fontSize:'1.1rem',textShadow:`0 0 20px ${tc}`}}>{t('world.world_complete')}</div>
                <div style={{color:'rgb(var(--text-muted))',fontSize:'.78rem',marginTop:6}}>{t('world.world_complete_sub', { total: totalCount, xp: xpDisplay })}</div>
              </motion.div>
            )}

          </div>
        </div>

      </div>
    </>
  )
}

/* ── Build smooth SVG path ── */
function buildPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i-1]; const c = pts[i]
    const cpx = (p.x + c.x) / 2
    d += ` C ${p.x} ${(p.y+c.y)/2} ${c.x} ${(p.y+c.y)/2} ${c.x} ${c.y}`
    void cpx
  }
  return d
}