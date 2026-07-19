import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'

/* ── Transición cinematográfica de nivel (~2s) ──
   Cada tema tiene su escena con física de Motion (partículas, resortes,
   profundidad) sobre un acabado común: glow del color del mundo que respira,
   viñeta y un pie unificado con barra que se llena en la duración. Con
   prefers-reduced-motion se cae a un emoji estático + fade breve.

   Se usa tanto en el mapa del aprendiz (al entrar a un nivel) como en el editor
   admin (botón "Previsualizar transición"). Por eso vive en su propio archivo:
   solo depende de framer-motion + i18n, sin arrastrar la lógica de WorldMap. */

export const TRANS_STATIC: Record<string, string> = {
  clouds: '✈️', cards: '💳', pulse: '❤️', rocket: '🚀',
  terminal: '💻', confetti: '🎉', scan: '🔍', warp: '💫',
  portal: '🌀', shatter: '💥', splitflap: '🛫', dna: '🧬', matrix: '🖥️', fireworks: '🎆',
  curtain: '🎭', glitch: '📺', doors: '🚪', sunrise: '🌅', equalizer: '🎚️', tunnel: '🕳️',
}

export function LevelTransition({ type, color, reduce, caption }: {
  type: string
  color: string
  reduce: boolean
  /** Texto del pie. Por defecto "Cargando nivel…"; el editor lo usa para "Vista previa". */
  caption?: string
}) {
  const { t } = useTranslation()
  const D = 2 // duración nominal de la escena (s)

  // Hélice de ADN precomputada (dos hebras seno desfasadas + peldaños).
  const dnaW = 110, dnaH = 300, dnaN = 16, dnaAmp = 45, dnaMid = dnaW / 2
  const dnaP1: string[] = [], dnaP2: string[] = [], dnaRungs: { y: number; x1: number; x2: number }[] = []
  for (let i = 0; i <= dnaN; i++) {
    const y = (i / dnaN) * dnaH
    const ph = (i / dnaN) * Math.PI * 4
    const x1 = dnaMid + Math.sin(ph) * dnaAmp
    const x2 = dnaMid + Math.sin(ph + Math.PI) * dnaAmp
    dnaP1.push(`${x1.toFixed(1)},${y.toFixed(1)}`)
    dnaP2.push(`${x2.toFixed(1)},${y.toFixed(1)}`)
    if (i % 2 === 0) dnaRungs.push({ y, x1, x2 })
  }

  const scenes: Record<string, React.ReactNode> = {
    /* ── Aerolínea: nubes en capas con parallax + avión con estela ── */
    clouds: (
      <>
        {[
          { top: '18%', size: '6rem',   dur: 2.2, delay: 0,    dir: 1,  op: 0.9 },
          { top: '36%', size: '3.5rem', dur: 2.6, delay: 0.2,  dir: -1, op: 0.7 },
          { top: '58%', size: '8rem',   dur: 2.0, delay: 0.1,  dir: 1,  op: 0.85 },
          { top: '72%', size: '4rem',   dur: 2.8, delay: 0.35, dir: -1, op: 0.6 },
        ].map((c, i) => (
          <motion.div key={i} aria-hidden
            style={{ position: 'absolute', top: c.top, fontSize: c.size, opacity: c.op, filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.2))' }}
            initial={{ x: c.dir > 0 ? '-130vw' : '130vw' }}
            animate={{ x: c.dir > 0 ? '130vw' : '-130vw' }}
            transition={{ duration: c.dur, delay: c.delay, ease: 'easeInOut' }}>☁️</motion.div>
        ))}
        <motion.div aria-hidden
          style={{ position: 'absolute', top: '46%', left: 0, height: 6, width: '42vw', borderRadius: 3, background: `linear-gradient(90deg, transparent, ${color}55)` }}
          initial={{ x: '-42vw', opacity: 0 }} animate={{ x: '120vw', opacity: [0, 0.8, 0] }}
          transition={{ duration: 1.7, delay: 0.25, ease: [0.4, 0, 0.2, 1] }} />
        <motion.div
          style={{ position: 'absolute', top: '43%', fontSize: '5rem', filter: `drop-shadow(0 0 20px ${color})` }}
          initial={{ x: '-120vw', rotate: -8 }} animate={{ x: '120vw', rotate: 8 }}
          transition={{ duration: 1.7, delay: 0.25, ease: [0.4, 0, 0.2, 1] }}>✈️</motion.div>
      </>
    ),

    /* ── Banco: tarjeta que voltea en 3D + monedas cayendo ── */
    cards: (
      <>
        <motion.div style={{ fontSize: '7rem', transformPerspective: 800, filter: `drop-shadow(0 12px 30px ${color}55)` }}
          initial={{ rotateY: 0, scale: 0.9 }} animate={{ rotateY: [0, 180, 360], scale: [0.9, 1.15, 1] }}
          transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }}>💳</motion.div>
        {[...Array(11)].map((_, i) => (
          <motion.div key={i} aria-hidden
            style={{ position: 'absolute', top: 0, left: `${8 + (i * 8.3) % 84}%`, fontSize: `${1.4 + (i % 3) * 0.5}rem` }}
            initial={{ y: '-12vh', opacity: 0, rotate: 0 }}
            animate={{ y: '115vh', opacity: [0, 1, 1, 0], rotate: 360 * (i % 2 ? 1 : -1) }}
            transition={{ duration: 1.6 + (i % 4) * 0.2, delay: 0.2 + i * 0.08, ease: 'easeIn' }}>🪙</motion.div>
        ))}
      </>
    ),

    /* ── Salud: corazón latiendo + electrocardiograma que se dibuja ── */
    pulse: (
      <>
        <motion.div style={{ fontSize: '6rem', filter: 'drop-shadow(0 0 24px rgba(0,200,100,0.7))' }}
          animate={{ scale: [1, 1.35, 1, 1.3, 1] }} transition={{ duration: 1.1, repeat: 1, ease: 'easeInOut' }}>❤️</motion.div>
        <svg width="360" height="90" viewBox="0 0 360 90" style={{ position: 'absolute', bottom: '32%' }}>
          <motion.polyline
            points="0,45 80,45 100,10 120,80 140,45 200,45 220,18 240,72 260,45 360,45"
            fill="none" stroke="#00c864" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
            style={{ filter: 'drop-shadow(0 0 6px #00c864)' }}
            initial={{ pathLength: 0, opacity: 0.3 }} animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.7, ease: 'easeInOut' }} />
        </svg>
      </>
    ),

    /* ── Cohete: despegue con humo en partículas + estelas + shake ── */
    rocket: (
      <>
        {[...Array(14)].map((_, i) => (
          <motion.div key={'s' + i} aria-hidden
            style={{ position: 'absolute', left: `${(i * 7) % 100}%`, top: 0, width: 2, height: `${20 + (i % 4) * 14}px`, borderRadius: 2, background: `linear-gradient(${color}, transparent)`, opacity: 0.7 }}
            initial={{ y: '-12vh', opacity: 0 }} animate={{ y: '115vh', opacity: [0, 0.8, 0] }}
            transition={{ duration: 0.9 + (i % 3) * 0.2, delay: i * 0.05, ease: 'linear', repeat: 1 }} />
        ))}
        {[...Array(12)].map((_, i) => (
          <motion.div key={'sm' + i} aria-hidden
            style={{ position: 'absolute', bottom: '32%', left: '50%', width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.5)', filter: 'blur(4px)' }}
            initial={{ x: '-50%', y: 0, opacity: 0, scale: 0.4 }}
            animate={{ x: `calc(-50% + ${(i - 6) * 10}px)`, y: 130, opacity: [0, 0.6, 0], scale: [0.4, 1.6, 2] }}
            transition={{ duration: 1.4, delay: 0.3 + (i % 5) * 0.08, ease: 'easeOut', repeat: 1 }} />
        ))}
        <motion.div style={{ fontSize: '6rem', filter: `drop-shadow(0 0 20px ${color})` }}
          initial={{ y: '40vh', scale: 0.7 }}
          animate={{ y: '-80vh', scale: 1.3, x: [0, -4, 4, -3, 3, 0] }}
          transition={{ y: { duration: 1.8, ease: [0.5, 0, 0.75, 0] }, scale: { duration: 1.8 }, x: { duration: 0.4, repeat: 4 } }}>🚀</motion.div>
      </>
    ),

    /* ── Tech: líneas de terminal + rejilla + scanline ── */
    terminal: (
      <>
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${color}11 1px, transparent 1px), linear-gradient(90deg, ${color}11 1px, transparent 1px)`, backgroundSize: '32px 32px', maskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black, transparent)', WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 50%, black, transparent)' }} />
        <motion.div aria-hidden
          style={{ position: 'absolute', left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #00ff80, transparent)', boxShadow: '0 0 20px #00ff80' }}
          initial={{ top: '0%' }} animate={{ top: '100%' }} transition={{ duration: 2, ease: 'linear' }} />
        <div style={{ fontFamily: 'monospace', textAlign: 'left' }}>
          {[t('world.term_loading'), t('world.term_unlocked'), t('world.term_granted')].map((line, i) => (
            <motion.div key={i}
              style={{ color: '#00ff80', fontSize: '1.15rem', fontWeight: 700, letterSpacing: 2, textShadow: '0 0 10px #00ff80', marginBottom: 14 }}
              initial={{ opacity: 0, filter: 'blur(6px)', x: -16 }} animate={{ opacity: 1, filter: 'blur(0px)', x: 0 }}
              transition={{ duration: 0.4, delay: 0.3 + i * 0.45, ease: [0.16, 1, 0.3, 1] }}>
              <span style={{ opacity: 0.5 }}>{'> '}</span>{line}
            </motion.div>
          ))}
          <motion.span aria-hidden style={{ display: 'inline-block', width: 10, height: 20, background: '#00ff80', boxShadow: '0 0 8px #00ff80', verticalAlign: 'middle' }}
            animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.8, repeat: Infinity }} />
        </div>
      </>
    ),

    /* ── Confeti: piezas con física + pop central ── */
    confetti: (
      <>
        <motion.div style={{ fontSize: '6rem', filter: `drop-shadow(0 0 24px ${color})` }}
          initial={{ scale: 0, rotate: -30 }} animate={{ scale: [0, 1.3, 1], rotate: [-30, 10, 0] }}
          transition={{ duration: 0.9, ease: [0.2, 0.8, 0.3, 1] }}>🎉</motion.div>
        {[...Array(40)].map((_, i) => {
          const cols = [color, '#ffd700', '#ff6b6b', '#4ecdc4', '#a78bfa', '#f472b6']
          const w = 6 + (i % 3) * 3
          return (
            <motion.div key={i} aria-hidden
              style={{ position: 'absolute', top: '-5%', left: `${(i * 2.5) % 100}%`, width: w, height: w * 1.6, borderRadius: 2, background: cols[i % cols.length] }}
              initial={{ y: '-10vh', opacity: 1, rotate: 0, x: 0 }}
              animate={{ y: '115vh', opacity: [1, 1, 0], rotate: 720 * (i % 2 ? 1 : -1), x: (i % 2 ? 1 : -1) * (30 + i % 40) }}
              transition={{ duration: 1.6 + (i % 5) * 0.2, delay: 0.1 + (i % 10) * 0.05, ease: 'easeIn' }} />
          )
        })}
      </>
    ),

    /* ── Escáner: barrido con glow + rejilla + lupa ── */
    scan: (
      <>
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${color}14 1px, transparent 1px), linear-gradient(90deg, ${color}14 1px, transparent 1px)`, backgroundSize: '40px 40px', maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black, transparent)', WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, black, transparent)' }} />
        <motion.div aria-hidden
          style={{ position: 'absolute', left: '6%', right: '6%', height: 4, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, boxShadow: `0 0 40px 10px ${color}` }}
          initial={{ top: '2%' }} animate={{ top: ['2%', '98%', '2%'] }} transition={{ duration: 2, ease: 'easeInOut' }} />
        <motion.div style={{ fontSize: '5rem', filter: `drop-shadow(0 0 16px ${color})` }}
          animate={{ scale: [0.95, 1.1, 0.95], rotate: [0, 8, -8, 0] }} transition={{ duration: 1.2, repeat: 1, ease: 'easeInOut' }}>🔍</motion.div>
      </>
    ),

    /* ── Warp: hiperespacio, estelas radiales desde el centro ── */
    warp: (
      <>
        {[...Array(24)].map((_, i) => (
          <div key={i} aria-hidden style={{ position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, transform: `rotate(${(i / 24) * 360}deg)` }}>
            <motion.div
              style={{ position: 'absolute', left: -1, top: 0, width: 2, borderRadius: 2, background: `linear-gradient(${color}, transparent)`, boxShadow: `0 0 8px ${color}`, transformOrigin: 'top' }}
              initial={{ height: 0, y: 0, opacity: 0 }}
              animate={{ height: [0, 80, 180], y: [0, 20, 120], opacity: [0, 1, 0] }}
              transition={{ duration: 1.4, delay: (i % 6) * 0.06, ease: [0.5, 0, 0.9, 0.2], repeat: 1 }} />
          </div>
        ))}
        <motion.div style={{ fontSize: '4.5rem', zIndex: 1 }}
          initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: [0.3, 1, 1.4], opacity: [0, 1, 0.8], rotate: 360 }}
          transition={{ duration: 2, ease: [0.5, 0, 0.75, 0] }}>💫</motion.div>
      </>
    ),

    /* ── Portal: aros de energía que se abren + partículas absorbidas ── */
    portal: (
      <>
        {[0, 1, 2].map(r => {
          const s = 120 + r * 90
          return (
            <motion.div key={r} aria-hidden
              style={{ position: 'absolute', top: '50%', left: '50%', marginLeft: -s / 2, marginTop: -s / 2, width: s, height: s, borderRadius: '50%', border: `2px solid ${color}`, boxShadow: `0 0 30px ${color}, inset 0 0 30px ${color}` }}
              initial={{ scale: 0, rotate: 0, opacity: 0 }}
              animate={{ scale: [0, 1.1, 1], rotate: 360 * (r % 2 ? 1 : -1), opacity: [0, 0.7 - r * 0.15, 0.35] }}
              transition={{ duration: 2, delay: r * 0.12, ease: [0.16, 1, 0.3, 1] }} />
          )
        })}
        {[...Array(20)].map((_, i) => {
          const rad = (i / 20) * Math.PI * 2
          return (
            <motion.div key={'p' + i} aria-hidden
              style={{ position: 'absolute', top: '50%', left: '50%', width: 5, height: 5, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }}
              initial={{ x: Math.cos(rad) * 320, y: Math.sin(rad) * 320, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: [0, 1, 0] }}
              transition={{ duration: 1.4, delay: 0.3 + (i % 5) * 0.08, ease: 'easeIn', repeat: 1 }} />
          )
        })}
        <motion.div style={{ position: 'absolute', top: '50%', left: '50%', marginLeft: -35, marginTop: -35, width: 70, height: 70, borderRadius: '50%', background: `radial-gradient(circle, #fff, ${color})`, boxShadow: `0 0 60px 10px ${color}` }}
          initial={{ scale: 0 }} animate={{ scale: [0, 1.2, 1] }} transition={{ duration: 2, ease: [0.16, 1, 0.3, 1] }} />
      </>
    ),

    /* ── Shatter: la pantalla de vidrio se rompe en fragmentos que caen ── */
    shatter: (
      <>
        {(() => {
          const cols = 6, rows = 4, shards: React.ReactNode[] = []
          for (let rIdx = 0; rIdx < rows; rIdx++) for (let cIdx = 0; cIdx < cols; cIdx++) {
            const i = rIdx * cols + cIdx
            const dx = cIdx - (cols - 1) / 2
            shards.push(
              <motion.div key={i} aria-hidden
                style={{ position: 'absolute', top: `${(rIdx / rows) * 100}%`, left: `${(cIdx / cols) * 100}%`, width: `${100 / cols}%`, height: `${100 / rows}%`, background: `${color}0e`, border: `1px solid ${color}33`, backdropFilter: 'blur(2px)' }}
                initial={{ y: 0, rotate: 0, opacity: 1, scale: 1 }}
                animate={{ y: '110vh', rotate: dx * 40 + (i % 2 ? 20 : -20), opacity: [1, 1, 0], scale: 0.9 }}
                transition={{ duration: 1.6, delay: 0.25 + Math.abs(dx) * 0.06 + rIdx * 0.05, ease: [0.5, 0, 0.75, 0] }} />
            )
          }
          return shards
        })()}
        <motion.div aria-hidden style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 50%, ${color}55, transparent 55%)` }}
          initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: [0, 0.9, 0], scale: [0.6, 1.4, 1.6] }} transition={{ duration: 0.5, ease: 'easeOut' }} />
      </>
    ),

    /* ── Split-flap: tablero de aeropuerto, fichas que voltean en su lugar ── */
    splitflap: (
      <>
        <motion.div style={{ fontSize: '2.6rem', marginBottom: 20 }}
          initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.4 }}>🛫</motion.div>
        <div style={{ display: 'flex', gap: 6, perspective: 700 }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{ width: 46, height: 62, borderRadius: 6, background: '#111', border: '1px solid rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.45)' }}>
              <motion.span style={{ display: 'block', fontFamily: 'monospace', fontSize: '1.9rem', fontWeight: 800, color, transformOrigin: 'center', textShadow: `0 0 10px ${color}` }}
                initial={{ rotateX: 90 }}
                animate={{ rotateX: [90, -20, 12, -6, 0] }}
                transition={{ duration: 0.9, delay: 0.2 + i * 0.18, ease: [0.16, 1, 0.3, 1] }}>❯</motion.span>
            </div>
          ))}
        </div>
      </>
    ),

    /* ── DNA: doble hélice que se dibuja y gira en 3D ── */
    dna: (
      <motion.svg width="150" height="330" viewBox={`0 0 ${dnaW} ${dnaH}`} style={{ overflow: 'visible', transformPerspective: 700 }}
        initial={{ rotateY: 0 }} animate={{ rotateY: 360 }} transition={{ duration: 3, ease: 'linear', repeat: Infinity }}>
        {dnaRungs.map((r, i) => (
          <motion.line key={i} x1={r.x1} y1={r.y} x2={r.x2} y2={r.y} stroke={color} strokeWidth={2} strokeLinecap="round"
            initial={{ opacity: 0 }} animate={{ opacity: 0.55 }} transition={{ duration: 0.4, delay: 0.4 + i * 0.06 }} />
        ))}
        <motion.polyline points={dnaP1.join(' ')} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${color})` }}
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: 'easeInOut' }} />
        <motion.polyline points={dnaP2.join(' ')} fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.85}
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: 'easeInOut', delay: 0.1 }} />
      </motion.svg>
    ),

    /* ── Matrix: lluvia de caracteres por columnas ── */
    matrix: (
      <>
        {[...Array(18)].map((_, c) => {
          const chars = Array.from({ length: 12 }, (_, k) => String.fromCharCode(0x30a0 + ((c * 7 + k * 13) % 96)))
          return (
            <motion.div key={c} aria-hidden
              style={{ position: 'absolute', top: 0, left: `${(c / 18) * 100}%`, width: `${100 / 18}%`, textAlign: 'center', fontFamily: 'monospace', fontSize: '1rem', lineHeight: 1.15, color: '#00ff80', textShadow: '0 0 6px #00ff80', whiteSpace: 'pre' }}
              initial={{ y: '-60%' }} animate={{ y: '110%' }}
              transition={{ duration: 1.6 + (c % 5) * 0.3, delay: (c % 6) * 0.15, ease: 'linear', repeat: 1 }}>
              {chars.map((ch, k) => (
                <div key={k} style={{ opacity: (k + 1) / chars.length }}>{ch}</div>
              ))}
            </motion.div>
          )
        })}
      </>
    ),

    /* ── Fireworks: cohetes que suben y estallan en el cielo ── */
    fireworks: (
      <>
        {[
          { x: '30%', col: '#ff6b6b', delay: 0.1, burstY: '30%' },
          { x: '55%', col: color,     delay: 0.5, burstY: '20%' },
          { x: '72%', col: '#ffd700', delay: 0.9, burstY: '34%' },
        ].map((fw, fi) => (
          <div key={fi} aria-hidden style={{ position: 'absolute', inset: 0 }}>
            <motion.div style={{ position: 'absolute', left: fw.x, bottom: 0, width: 3, height: 26, borderRadius: 2, background: `linear-gradient(${fw.col}, transparent)`, boxShadow: `0 0 8px ${fw.col}` }}
              initial={{ y: 0, opacity: 1 }} animate={{ y: `-${68 - parseInt(fw.burstY)}vh`, opacity: [1, 1, 0] }}
              transition={{ duration: 0.6, delay: fw.delay, ease: 'easeOut' }} />
            {[...Array(18)].map((_, i) => {
              const rad = (i / 18) * Math.PI * 2
              const dist = 90 + (i % 3) * 30
              return (
                <motion.div key={i} style={{ position: 'absolute', left: fw.x, top: fw.burstY, width: 5, height: 5, borderRadius: '50%', background: fw.col, boxShadow: `0 0 8px ${fw.col}` }}
                  initial={{ x: 0, y: 0, opacity: 0, scale: 1 }}
                  animate={{ x: Math.cos(rad) * dist, y: Math.sin(rad) * dist, opacity: [0, 1, 0], scale: [1, 1, 0.3] }}
                  transition={{ duration: 1.2, delay: fw.delay + 0.6, ease: [0.2, 0.6, 0.3, 1] }} />
              )
            })}
            <motion.div style={{ position: 'absolute', left: fw.x, top: fw.burstY, width: 60, height: 60, marginLeft: -30, marginTop: -30, borderRadius: '50%', background: `radial-gradient(circle, ${fw.col}, transparent 60%)` }}
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: [0, 1.5], opacity: [0.9, 0] }} transition={{ duration: 0.5, delay: fw.delay + 0.6 }} />
          </div>
        ))}
      </>
    ),

    /* ── Telón: dos paneles de terciopelo que se abren + haz de luz ── */
    curtain: (
      <>
        <motion.div aria-hidden style={{ position: 'absolute', width: 6, height: '100%', left: '50%', marginLeft: -3, background: `linear-gradient(transparent, ${color}, transparent)`, boxShadow: `0 0 60px 20px ${color}` }}
          initial={{ opacity: 0, scaleX: 0.5 }} animate={{ opacity: [0, 1, 0.6], scaleX: [0.5, 3, 2] }} transition={{ duration: 2, ease: 'easeInOut' }} />
        <motion.div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '50%', height: '100%', background: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.28) 0 6px, rgba(255,255,255,0.05) 6px 26px), linear-gradient(90deg, #4a0e0e, #7a1616 80%, #3a0a0a)', boxShadow: 'inset -20px 0 40px rgba(0,0,0,0.5)', borderRight: '2px solid rgba(0,0,0,0.4)' }}
          initial={{ x: 0 }} animate={{ x: '-100%' }} transition={{ duration: 1.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }} />
        <motion.div aria-hidden style={{ position: 'absolute', top: 0, right: 0, width: '50%', height: '100%', background: 'repeating-linear-gradient(90deg, rgba(0,0,0,0.28) 0 6px, rgba(255,255,255,0.05) 6px 26px), linear-gradient(-90deg, #4a0e0e, #7a1616 80%, #3a0a0a)', boxShadow: 'inset 20px 0 40px rgba(0,0,0,0.5)', borderLeft: '2px solid rgba(0,0,0,0.4)' }}
          initial={{ x: 0 }} animate={{ x: '100%' }} transition={{ duration: 1.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }} />
      </>
    ),

    /* ── Glitch: distorsión digital con separación de canales RGB ── */
    glitch: (
      <>
        {[...Array(10)].map((_, i) => (
          <motion.div key={i} aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: `${i * 10}%`, height: `${6 + (i % 3) * 4}%`, background: `${color}18` }}
            initial={{ x: 0, opacity: 0 }}
            animate={{ x: [0, (i % 2 ? 1 : -1) * 40, 0, (i % 2 ? -1 : 1) * 20, 0], opacity: [0, 0.7, 0, 0.5, 0] }}
            transition={{ duration: 2, times: [0, 0.2, 0.4, 0.6, 1], ease: 'linear', repeat: 1 }} />
        ))}
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <motion.div style={{ position: 'absolute', inset: 0, fontSize: '5rem', color: '#ff0040', mixBlendMode: 'screen' }}
            animate={{ x: [0, -6, 4, -3, 0], opacity: [1, 0.8, 1, 0.7, 1] }} transition={{ duration: 0.3, repeat: 6 }}>⚡</motion.div>
          <motion.div style={{ position: 'absolute', inset: 0, fontSize: '5rem', color: '#00ffff', mixBlendMode: 'screen' }}
            animate={{ x: [0, 6, -4, 3, 0], opacity: [1, 0.8, 1, 0.7, 1] }} transition={{ duration: 0.3, repeat: 6, delay: 0.05 }}>⚡</motion.div>
          <div style={{ fontSize: '5rem', color: '#fff' }}>⚡</div>
        </div>
      </>
    ),

    /* ── Puertas: bóveda/ascensor metálico que se cierra y abre ── */
    doors: (
      <>
        <motion.div aria-hidden style={{ position: 'absolute', width: 4, height: '100%', left: '50%', marginLeft: -2, background: `linear-gradient(transparent, ${color}, transparent)`, boxShadow: `0 0 40px 10px ${color}` }}
          initial={{ opacity: 0 }} animate={{ opacity: [0, 0, 1, 1, 0.5] }} transition={{ duration: 2, times: [0, 0.45, 0.55, 0.8, 1] }} />
        <motion.div aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '50%', height: '100%', backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 40px), linear-gradient(135deg, #3a3f45, #6b7178 45%, #2b2f34)', boxShadow: 'inset -12px 0 30px rgba(0,0,0,0.5)' }}
          initial={{ x: '-100%' }} animate={{ x: ['-100%', '0%', '0%', '-100%'] }} transition={{ duration: 2, times: [0, 0.35, 0.6, 1], ease: [0.16, 1, 0.3, 1] }} />
        <motion.div aria-hidden style={{ position: 'absolute', top: 0, right: 0, width: '50%', height: '100%', backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 40px), linear-gradient(-135deg, #3a3f45, #6b7178 45%, #2b2f34)', boxShadow: 'inset 12px 0 30px rgba(0,0,0,0.5)' }}
          initial={{ x: '100%' }} animate={{ x: ['100%', '0%', '0%', '100%'] }} transition={{ duration: 2, times: [0, 0.35, 0.6, 1], ease: [0.16, 1, 0.3, 1] }} />
      </>
    ),

    /* ── Amanecer: sol que asoma tras el horizonte con rayos que giran ── */
    sunrise: (
      <>
        <motion.div aria-hidden style={{ position: 'absolute', top: '62%', left: '50%' }}
          initial={{ opacity: 0 }} animate={{ opacity: [0, 0.7, 0.5] }} transition={{ duration: 1.4, delay: 0.4 }}>
          <motion.div style={{ position: 'absolute' }} animate={{ rotate: 360 }} transition={{ duration: 14, ease: 'linear', repeat: Infinity }}>
            {[...Array(12)].map((_, i) => (
              <div key={i} aria-hidden style={{ position: 'absolute', width: 4, height: 220, left: -2, top: 0, background: `linear-gradient(${color}, transparent)`, transformOrigin: 'top center', transform: `rotate(${i * 30}deg)`, opacity: 0.5 }} />
            ))}
          </motion.div>
        </motion.div>
        <motion.div aria-hidden style={{ position: 'absolute', left: '50%', marginLeft: -60, width: 120, height: 120, borderRadius: '50%', background: `radial-gradient(circle, #fff, ${color})`, boxShadow: `0 0 80px 20px ${color}` }}
          initial={{ top: '75%', opacity: 0.6 }} animate={{ top: '38%', opacity: 1 }} transition={{ duration: 1.8, ease: [0.16, 1, 0.3, 1] }} />
        <div aria-hidden style={{ position: 'absolute', top: '62%', left: 0, right: 0, height: '38%', background: 'linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.7))', borderTop: `2px solid ${color}55` }} />
      </>
    ),

    /* ── Ecualizador: barras que rebotan como audio en vivo ── */
    equalizer: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 180 }}>
        {[...Array(9)].map((_, i) => (
          <motion.div key={i} style={{ width: 14, borderRadius: 6, background: `linear-gradient(${color}, ${color}55)`, boxShadow: `0 0 16px ${color}88` }}
            initial={{ height: 20 }}
            animate={{ height: [20, 40 + (i * 13 % 120), 30, 90 + (i * 7 % 80), 25, 60 + (i * 17 % 90), 20] }}
            transition={{ duration: 2, ease: 'easeInOut', repeat: Infinity, delay: i * 0.05 }} />
        ))}
      </div>
    ),

    /* ── Túnel: anillos concéntricos que vienen hacia ti ── */
    tunnel: (
      <>
        {[...Array(8)].map((_, i) => (
          <motion.div key={i} aria-hidden style={{ position: 'absolute', top: '50%', left: '50%', width: 80, height: 80, marginLeft: -40, marginTop: -40, borderRadius: '50%', border: `3px solid ${color}`, boxShadow: `0 0 20px ${color}` }}
            initial={{ scale: 0.1, opacity: 0 }} animate={{ scale: [0.1, 6], opacity: [0, 1, 0] }}
            transition={{ duration: 1.6, delay: i * 0.2, ease: 'easeIn', repeat: 1 }} />
        ))}
        <motion.div aria-hidden style={{ position: 'absolute', top: '50%', left: '50%', width: 60, height: 60, marginLeft: -30, marginTop: -30, borderRadius: '50%', background: `radial-gradient(circle, #fff, ${color})`, boxShadow: `0 0 50px 12px ${color}` }}
          animate={{ scale: [1, 1.2, 1], opacity: [0.8, 1, 0.8] }} transition={{ duration: 1, repeat: Infinity }} />
      </>
    ),
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      transition={{ duration: reduce ? 0.15 : 0.25 }}
      style={{ position: 'fixed', inset: 0, zIndex: 9999, overflow: 'hidden', background: 'rgb(var(--bg) / 0.94)', backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

      {/* Glow del color del mundo que respira */}
      <motion.div aria-hidden
        style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 45%, ${color}22, transparent 60%)`, pointerEvents: 'none' }}
        animate={reduce ? undefined : { opacity: [0.4, 1, 0.6], scale: [0.9, 1.1, 1] }}
        transition={{ duration: D, ease: 'easeInOut' }} />
      {/* Viñeta */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)', pointerEvents: 'none' }} />

      {/* Escena temática */}
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {reduce
          ? <div style={{ fontSize: '4rem', filter: `drop-shadow(0 0 20px ${color})` }}>{TRANS_STATIC[type] ?? '✨'}</div>
          : (scenes[type] ?? scenes.clouds)}
      </div>

      {/* Pie unificado: texto + barra que se llena en la duración */}
      <div style={{ position: 'absolute', bottom: '15%', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, zIndex: 2 }}>
        <div style={{ color: 'rgb(var(--text-muted))', fontSize: '.8rem', letterSpacing: 3, textTransform: 'uppercase', fontFamily: 'inherit' }}>{caption ?? t('world.loading_level')}</div>
        <div style={{ width: 180, height: 3, borderRadius: 2, background: 'rgb(var(--line) / 0.4)', overflow: 'hidden' }}>
          <motion.div style={{ height: '100%', background: `linear-gradient(90deg, ${color}, ${color}80)`, boxShadow: `0 0 10px ${color}` }}
            initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: reduce ? 0.3 : D, ease: [0.16, 1, 0.3, 1] }} />
        </div>
      </div>
    </motion.div>
  )
}
