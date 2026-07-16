import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { getStarsFromScore, getStarsDisplay } from '@/lib/scoring'
import StarDisplay from '@/components/StarDisplay'

/* ── Types ── */
interface QuizOption { id: string; text: string; correct: boolean; explanation: string }
interface QuizStep   { id: string; question: string; context: string; options: QuizOption[] }
interface ArenaQuiz  {
  id: string; title: string; description: string; campaign_id: string | null
  theme_icon: string; theme_color: string; theme_type: string
  xp_per_question: number; min_score_pct: number | null; section_size: number; status: string; steps: QuizStep[]
}

/* ── Normalize ── */
// Hash estable de un string → número (para ordenar de forma determinista).
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}

function normalizeQuiz(raw: Record<string, unknown>): ArenaQuiz {
  const steps = Array.isArray(raw.steps) ? raw.steps : []
  return {
    id: raw.id as string,
    title: (raw.title as string) ?? '',
    description: (raw.description as string) ?? '',
    campaign_id: (raw.campaign_id as string | null) ?? null,
    theme_icon: (raw.theme_icon as string) ?? '⚔️',
    theme_color: (raw.theme_color as string) ?? '#10D451',
    theme_type: (raw.theme_type as string) ?? 'corporate',
    xp_per_question: (raw.xp_per_question as number) ?? 10,
    min_score_pct: (raw.min_score_pct as number | null) ?? null,
    section_size: Math.max(1, (raw.section_size as number) ?? SECTION_SIZE),
    status: (raw.status as string) ?? 'draft',
    steps: steps.map((s: Record<string, unknown>) => {
      const stepId = typeof s.id === 'string' && s.id ? s.id : crypto.randomUUID()
      const options = (Array.isArray(s.options)
        ? (s.options as Record<string, unknown>[]).map(o => ({
            id: typeof o.id === 'string' && o.id ? o.id : crypto.randomUUID(),
            text: typeof o.text === 'string' ? o.text : '',
            correct: o.correct === true,
            explanation: typeof o.explanation === 'string' ? o.explanation : '',
          }))
        : [])
        // La IA suele poner la correcta primera (posición A). Reordenamos las
        // opciones de forma determinista (sembrada por el id de la pregunta) para
        // que la correcta no quede siempre en A, y el orden sea estable por pregunta.
        .sort((a, b) => hashStr(stepId + a.id) - hashStr(stepId + b.id))
      return {
        id: stepId,
        question: typeof s.question === 'string' ? s.question : '',
        context: typeof s.context === 'string' ? s.context : '',
        options,
      }
    }),
  }
}

/* ── Sound Engine ── */
function useSFX() {
  const ctxRef = useRef<AudioContext | null>(null)
  const getCtx = () => {
    if (!ctxRef.current) {
      try { ctxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)() } catch { /* silent */ }
    }
    return ctxRef.current
  }
  const play = useCallback((type: 'correct' | 'wrong' | 'complete' | 'click' | 'unlock') => {
    const ctx = getCtx(); if (!ctx) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    const t = ctx.currentTime
    if (type === 'correct') {
      o.type = 'sine'
      o.frequency.setValueAtTime(523,t); o.frequency.setValueAtTime(659,t+.1); o.frequency.setValueAtTime(784,t+.2)
      g.gain.setValueAtTime(.18,t); g.gain.exponentialRampToValueAtTime(.001,t+.55)
      o.start(t); o.stop(t+.6)
    } else if (type === 'wrong') {
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(220,t); o.frequency.setValueAtTime(170,t+.15)
      g.gain.setValueAtTime(.12,t); g.gain.exponentialRampToValueAtTime(.001,t+.38)
      o.start(t); o.stop(t+.42)
    } else if (type === 'complete') {
      o.type = 'sine'
      ;[523,659,784,1047].forEach((f,i) => o.frequency.setValueAtTime(f,t+i*.15))
      g.gain.setValueAtTime(.15,t); g.gain.exponentialRampToValueAtTime(.001,t+.95)
      o.start(t); o.stop(t+1)
    } else if (type === 'unlock') {
      o.type = 'sine'
      o.frequency.setValueAtTime(440,t); o.frequency.setValueAtTime(587,t+.1); o.frequency.setValueAtTime(880,t+.22)
      g.gain.setValueAtTime(.14,t); g.gain.exponentialRampToValueAtTime(.001,t+.6)
      o.start(t); o.stop(t+.65)
    } else {
      o.type = 'sine'
      o.frequency.setValueAtTime(700,t)
      g.gain.setValueAtTime(.05,t); g.gain.exponentialRampToValueAtTime(.001,t+.08)
      o.start(t); o.stop(t+.1)
    }
  }, [])
  return { play }
}

const OPT_LABELS = ['A','B','C','D']
// Tamaño de sección por defecto (preguntas por ronda) cuando el quiz no define
// uno propio. Cada quiz puede configurar arena_quizzes.section_size (1-5); acá
// solo es el fallback histórico para quizzes viejos.
const SECTION_SIZE = 3

export default function ArenaPlayer() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t }    = useTranslation()
  const { id }   = useParams<{ id: string }>()
  const { user } = useAuth()
  const { play } = useSFX()

  const locationState = location.state as { from?: string; levelId?: string; worldId?: string; minScorePct?: number | null } | null
  const backPath =
    locationState?.from === 'world'
      ? '/world'
      : locationState?.from === 'admin' || document.referrer.includes('/admin')
        ? '/admin/arena'
        : '/arena'

  const backLabel =
    backPath === '/world'         ? t('arena.back_map')
    : backPath === '/admin/arena' ? t('arena.back_admin')
    : t('arena.back_arena')

  const backNavOpts = backPath === '/world'
    ? { state: { worldId: locationState?.worldId } }
    : {}

  const [quiz, setQuiz]               = useState<ArenaQuiz | null>(null)
  const [loading, setLoading]         = useState(true)
  const [currentQ, setCurrentQ]       = useState(0)
  const [selected, setSelected]       = useState<Record<number,string>>({})
  const [xp, setXp]                   = useState(0)
  const [timerSecs, setTimerSecs]     = useState(0)
  const [xpPopup, setXpPopup]         = useState<{val:number;key:number}|null>(null)
  const [shake, setShake]             = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const [planePos, setPlanePos]       = useState(0)
  const [popup, setPopup]             = useState<{show:boolean;icon:string;title:string;text:string}>({show:false,icon:'',title:'',text:''})
  const [groupIndex, setGroupIndex]   = useState(0)
  const progressSaved = useRef(false)

  /* Load quiz */
  useEffect(() => {
    if (!id) return
    supabase.from('arena_quizzes').select('*').eq('id',id).single()
      .then(({data,error}) => {
        if (!error && data) setQuiz(normalizeQuiz(data as Record<string,unknown>))
        setLoading(false)
      })
  }, [id])

  /* Timer */
  useEffect(() => {
    const iv = setInterval(() => setTimerSecs(s => s+1), 1000)
    return () => clearInterval(iv)
  }, [])

  const showPopup = useCallback((icon:string, title:string, text:string) => {
    setPopup({show:true,icon,title,text})
    setTimeout(() => setPopup(p => ({...p,show:false})), 2600)
  }, [])

  /* Save progress */
  useEffect(() => {
    if (!showComplete || progressSaved.current || !user?.id || !quiz) return
    progressSaved.current = true
    const correct = quiz.steps.filter((_,i) => {
      const oId = selected[i]
      return oId && quiz.steps[i].options.find(o => o.id === oId)?.correct
    }).length
    const scorePct = Math.round((correct / quiz.steps.length) * 100)
    const passed = (locationState?.minScorePct ?? quiz.min_score_pct) === null || scorePct >= (locationState?.minScorePct ?? quiz.min_score_pct)!
    ;(async () => {
      if (!id) return
      await supabase.from('arena_progress').upsert({
        user_id:user.id, quiz_id:id, campaign_id:quiz.campaign_id,
        xp_earned:xp, score:correct, total_questions:quiz.steps.length,
        completed:passed,
      }, { onConflict: 'user_id,quiz_id' })
      const state = locationState
      if (state?.worldId && state?.levelId) {
        supabase.from('world_level_attempts').insert({
          user_id:     user.id,
          level_id:    state.levelId,
          world_id:    state.worldId,
          campaign_id: quiz.campaign_id,
          score:       scorePct,
        }).then(({ error }) => {
          if (error) console.error('world_level_attempts insert error:', error)
        })

        if (passed) {
          const { data: existing } = await supabase
            .from('world_progress')
            .select('score')
            .eq('user_id', user.id)
            .eq('level_id', state.levelId)
            .maybeSingle()

          const existingScore = existing?.score ?? null
          const effectiveMin = locationState?.minScorePct ?? quiz.min_score_pct
          const shouldUpsert = existingScore === null
            || (getStarsFromScore(existingScore, effectiveMin) < 5 && scorePct > existingScore)

          if (shouldUpsert) {
            const { error: wpError } = await supabase.from('world_progress').upsert({
              user_id:      user.id,
              level_id:     state.levelId,
              world_id:     state.worldId,
              campaign_id:  quiz.campaign_id,
              completed:    true,
              xp_earned:    xp,
              score:        scorePct,
              completed_at: new Date().toISOString(),
            }, { onConflict: 'user_id,level_id' })
            if (wpError) {
              console.error('world_progress upsert error:', wpError, { worldId: state.worldId, levelId: state.levelId, userId: user.id })
              showPopup('⚠️', t('arena.save_error_title'), t('arena.save_error_text'))
            }
          }
        }
      }
    })()
  }, [showComplete, user, quiz, selected, xp, timerSecs, id, locationState, showPopup])

  const handleAnswer = useCallback((optId:string) => {
    if (!quiz || selected[currentQ] !== undefined) return
    play('click')
    const step = quiz.steps[currentQ]
    const isCorrect = step.options.find(o => o.id === optId)?.correct ?? false
    setSelected(prev => ({...prev,[currentQ]:optId}))
    if (isCorrect) {
      play('correct')
      setTimeout(() => play('unlock'), 300)
      const gain = quiz.xp_per_question
      setXp(prev => prev + gain)
      setXpPopup({val:gain,key:Date.now()})
      setTimeout(() => setXpPopup(null), 1800)
    } else {
      play('wrong')
      setShake(true)
      setTimeout(() => setShake(false), 600)
    }
  }, [quiz, currentQ, selected, play])

  const handleNext = useCallback(() => {
    if (!quiz) return
    if (currentQ >= quiz.steps.length - 1) {
      play('complete')
      setShowComplete(true)
    } else {
      play('click')
      setPlanePos(q => q+1)
      setCurrentQ(q => q+1)
      showPopup(quiz.theme_icon, t('arena.step_complete_title', { n: currentQ+1 }), t('arena.step_complete_text'))
    }
  }, [quiz, currentQ, play, showPopup])

  const handleNextGroup = useCallback(() => {
    if (!quiz) return
    play('click')
    const nextStart = (groupIndex + 1) * quiz.section_size
    setGroupIndex(g => g + 1)
    setCurrentQ(nextStart)
    setPlanePos(nextStart)
    showPopup(quiz.theme_icon, t('arena.round_complete_title', { n: groupIndex + 1 }), t('arena.round_complete_text'))
  }, [quiz, groupIndex, play, showPopup])

  const fmt = (s:number) =>
    `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`

  /* Loading */
  if (loading) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',background:'rgb(var(--bg))',color:'rgb(var(--text-muted))',fontFamily:'inherit',fontSize:'.875rem'}}>
      {t('arena.loading')}
    </div>
  )

  if (!quiz || quiz.steps.length === 0) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,minHeight:'100vh',background:'rgb(var(--bg))',fontFamily:'inherit',color:'rgb(var(--text))'}}>
      <div style={{fontSize:'2.5rem'}}>🏟️</div>
      <div style={{fontWeight:600,fontSize:'1.1rem'}}>{t('arena.unavailable')}</div>
      <button onClick={() => navigate(backPath, backNavOpts)} style={{background:'none',border:'1px solid rgb(var(--line))',borderRadius:10,padding:'8px 20px',color:'rgb(var(--text-muted))',cursor:'pointer',fontFamily:'inherit',fontSize:'.875rem'}}>{backLabel}</button>
    </div>
  )

  const tc      = quiz.theme_color
  const totalXP = quiz.steps.length * quiz.xp_per_question
  const xpPct   = totalXP > 0 ? Math.min((xp/totalXP)*100,100) : 0
  const level   = Math.floor(xp/100) + 1
  const step    = quiz.steps[currentQ]
  const answeredOptId = selected[currentQ]
  const isAnswered    = answeredOptId !== undefined
  const isCorrect     = isAnswered && (step.options.find(o => o.id === answeredOptId)?.correct ?? false)
  const selectedOpt   = step.options.find(o => o.id === answeredOptId)
  const correctCount  = quiz.steps.filter((_,i) => {
    const oId = selected[i]; return oId && quiz.steps[i].options.find(o => o.id === oId)?.correct
  }).length
  const scorePct = Math.round((correctCount / quiz.steps.length) * 100)
  const passed   = (locationState?.minScorePct ?? quiz.min_score_pct) === null || scorePct >= (locationState?.minScorePct ?? quiz.min_score_pct)!
  const stars    = getStarsFromScore(scorePct, locationState?.minScorePct ?? quiz.min_score_pct)
  // Cada "sección" (P1, P2…) agrupa quiz.section_size preguntas. El recorrido
  // muestra una parada por sección, no por pregunta.
  const sectionCount     = Math.ceil(quiz.steps.length / quiz.section_size)
  const currentSection   = Math.floor(currentQ / quiz.section_size)
  const planePct = sectionCount > 1 ? (currentSection/(sectionCount-1))*80+8 : 8

  const groupStart       = groupIndex * quiz.section_size
  const groupEnd         = Math.min(groupStart + quiz.section_size, quiz.steps.length)
  const groupSteps       = quiz.steps.slice(groupStart, groupEnd)
  const isLastGroup      = groupEnd >= quiz.steps.length
  const allGroupAnswered = groupSteps.every((_,gi) => selected[groupStart + gi] !== undefined)

  return (
    <>
      <style>{`
        @keyframes planeSway  { 0%,100%{transform:translate(-50%,-50%) rotate(0)} 30%{transform:translate(-50%,-60%) rotate(4deg)} 70%{transform:translate(-50%,-42%) rotate(-3deg)} }
        @keyframes ringPulse  { 0%{box-shadow:0 0 0 0 ${tc}60} 70%{box-shadow:0 0 0 10px ${tc}00} 100%{box-shadow:0 0 0 0 ${tc}00} }
        @keyframes fadeUp     { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes correctPop { 0%{transform:scale(1)} 45%{transform:scale(1.03)} 100%{transform:scale(1)} }
        @keyframes shakeFx    { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)} 40%{transform:translateX(8px)} 60%{transform:translateX(-5px)} 80%{transform:translateX(5px)} }
        @keyframes unlockCard { 0%{transform:scale(.88);opacity:0} 65%{transform:scale(1.02)} 100%{transform:scale(1);opacity:1} }
        @keyframes xpRise     { 0%{opacity:1;transform:translateY(0)} 100%{opacity:0;transform:translateY(-44px)} }
        @keyframes spinIn     { from{transform:scale(0) rotate(-180deg)} to{transform:scale(1) rotate(0)} }
        @keyframes blink      { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes popShow    { 0%{opacity:0;transform:translateX(-50%) scale(.7)} 65%{transform:translateX(-50%) scale(1.05)} 100%{opacity:1;transform:translateX(-50%) scale(1)} }

        .ap-plane     { animation: planeSway 4s ease-in-out infinite; }
        .ap-cp-active { animation: ringPulse 1.8s ease infinite; }
        .ap-card-in   { animation: fadeUp .45s cubic-bezier(.2,.8,.4,1) both; }
        .ap-unlocked  { animation: unlockCard .5s cubic-bezier(.2,.8,.4,1) both; }
        .ap-shake     { animation: shakeFx .5s ease; }
        .ap-correct   { animation: correctPop .35s ease; }
        .ap-badge-dot { animation: blink 2s ease infinite; }

        .ap-opt { display:flex;align-items:center;gap:12px;padding:12px 16px;background:transparent;border:1px solid rgb(var(--line));border-radius:0.75rem;cursor:pointer;transition:all .2s;font-family:inherit;font-size:.875rem;color:rgb(var(--text));text-align:left;width:100%; }
        .ap-opt:hover:not(:disabled) { border-color:${tc}; background:${tc}0a; transform:translateX(3px); }
        .ap-opt.opt-correct  { border-color:#10D451; background:rgba(16,212,81,0.1); color:#10D451; pointer-events:none; }
        .ap-opt.opt-wrong    { border-color:#ef4444; background:rgba(239,68,68,0.08); color:#ef4444; }
        .ap-opt.opt-disabled { opacity:.35; pointer-events:none; }
        .ap-opt:disabled     { cursor:default; }

        .ap-key { width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;background:${tc}15;border:1px solid ${tc}30;color:${tc};flex-shrink:0;transition:.2s; }
        .ap-opt.opt-correct .ap-key { background:rgba(16,212,81,0.2);border-color:#10D451;color:#10D451; }
        .ap-opt.opt-wrong   .ap-key { background:rgba(239,68,68,0.15);border-color:#ef4444;color:#ef4444; }

        @media (max-width: 768px) {
          .ap-hud { padding: 0 12px !important; gap: 10px !important; }
          .ap-timer { display: none !important; }
          .ap-xp-area { gap: 6px !important; }
          .ap-subhero { padding: 20px 5% 16px !important; }
          .ap-subhero-title { font-size: 1.3rem !important; }
          .ap-route-section { padding: 0 5% 20px !important; }
          .ap-questions { padding: 0 5% 40px !important; }
          .ap-questions-grid { grid-template-columns: 1fr !important; }
          .ap-checkpoint { width: 26px !important; height: 26px !important; }
          .ap-plane-icon { font-size: 1.2rem !important; }
          .ap-card-body { padding: 14px 16px !important; }
          .ap-opt { padding: 10px 12px !important; font-size: .82rem !important; }
        }
        @media (max-width: 480px) {
          .ap-xp-area { display: none !important; }
          .ap-subhero-title { font-size: 1.1rem !important; }
          .ap-quiz-title { display: none !important; }
        }
      `}</style>

      <div style={{minHeight:'100vh',background:'rgb(var(--bg))',fontFamily:'inherit',color:'rgb(var(--text))',overflowX:'hidden'}}>

        {/* ══ HUD ══ */}
        <header className="ap-hud" style={{
          position:'sticky',top:0,zIndex:50,
          background:'rgb(var(--surface))',
          borderBottom:`2px solid ${tc}30`,
          padding:'0 20px',height:54,
          display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,
        }}>
          <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
            <button onClick={() => navigate(backPath, backNavOpts)} style={{background:'none',border:'none',color:'rgb(var(--text-muted))',cursor:'pointer',fontSize:'.82rem',padding:'4px 8px',borderRadius:6,fontFamily:'inherit',transition:'.2s',whiteSpace:'nowrap'}}>{backLabel}</button>
            <span style={{fontSize:'1.3rem',flexShrink:0}}>{quiz.theme_icon}</span>
            <span className="ap-quiz-title" style={{fontSize:'.875rem',fontWeight:600,color:'rgb(var(--text))',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{quiz.title}</span>
          </div>
          <div className="ap-xp-area" style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
            <span style={{fontSize:'.7rem',fontWeight:700,color:tc,background:`${tc}15`,border:`1px solid ${tc}30`,borderRadius:20,padding:'2px 10px'}}>LVL {level}</span>
            <div style={{display:'flex',alignItems:'center',gap:7}}>
              <span style={{fontSize:'.75rem',fontWeight:700,color:tc}}>{xp} XP</span>
              <div style={{width:80,height:5,background:'rgb(var(--subtle))',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${xpPct}%`,background:tc,borderRadius:3,transition:'width .6s ease'}} />
              </div>
              <span style={{fontSize:'.68rem',color:'rgb(var(--text-muted))'}}>{totalXP}</span>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:14,flexShrink:0}}>
            <span style={{fontSize:'.78rem',color:'rgb(var(--text-muted))',fontWeight:500}}>{currentQ+1}/{quiz.steps.length}</span>
            <span className="ap-timer" style={{fontSize:'.82rem',fontWeight:600,color:'rgb(var(--text-muted))',fontVariantNumeric:'tabular-nums',letterSpacing:'1px'}}>{fmt(timerSecs)}</span>
          </div>
        </header>

        {/* XP accent line */}
        <div style={{height:3,background:'rgb(var(--subtle))'}}>
          <div style={{height:'100%',width:`${xpPct}%`,background:`linear-gradient(90deg,${tc},${tc}88)`,transition:'width .6s ease'}} />
        </div>

        {/* ══ SUBHERO ══ */}
        <section className="ap-subhero" style={{padding:'28px 7% 20px'}}>
          <div style={{display:'inline-flex',alignItems:'center',gap:8,background:`${tc}10`,border:`1px solid ${tc}22`,borderRadius:50,padding:'5px 16px',fontSize:'.72rem',fontWeight:500,color:tc,marginBottom:14}}>
            <span className="ap-badge-dot" style={{width:6,height:6,borderRadius:'50%',background:tc,display:'inline-block'}} />
            {t('arena.training')} · {t(`themes.${quiz.theme_type}`, quiz.theme_type)}
          </div>
          <h1 className="ap-subhero-title" style={{fontSize:'1.6rem',fontWeight:700,color:'rgb(var(--text))',lineHeight:1.2,margin:'0 0 8px'}}>
            {quiz.title}
          </h1>
          {quiz.description && (
            <p style={{fontSize:'.85rem',color:'rgb(var(--text-muted))',maxWidth:520,lineHeight:1.7,margin:0}}>{quiz.description}</p>
          )}
        </section>

        {/* ══ MAPA DE RUTA ══ */}
        <section className="ap-route-section" style={{padding:'0 7% 28px'}}>
          <div style={{
            background:'rgb(var(--surface))',
            border:`1px solid rgb(var(--line))`,
            borderRadius:'1rem',padding:'16px 20px',
          }}>
            <div style={{fontSize:'.6rem',color:'rgb(var(--text-muted))',letterSpacing:'.15em',textTransform:'uppercase',marginBottom:16}}>
              {t('arena.route_label', { title: quiz.title })}
            </div>
            <div style={{overflowX:'auto',paddingBottom:4}}>
            <div style={{position:'relative',height:52,minWidth:`${Math.max(sectionCount * 96 + 60, 280)}px`}}>
              {/* Línea de ruta — alineada al centro de los círculos (16px = radio) */}
              <div style={{position:'absolute',top:16,left:0,right:0,height:3,background:'rgb(var(--subtle))',borderRadius:2,transform:'translateY(-50%)',zIndex:0}}>
                <div style={{position:'absolute',top:0,left:0,height:'100%',width:`${planePct}%`,background:`linear-gradient(90deg,${tc},${tc}88)`,borderRadius:2,transition:'width .8s cubic-bezier(.4,0,.2,1)'}} />
              </div>
              {/* Ícono animado */}
              <div className="ap-plane ap-plane-icon" style={{
                position:'absolute',top:16,left:`${planePct}%`,
                transform:'translate(-50%,-50%)',
                fontSize:'1.6rem',zIndex:3,
                filter:`drop-shadow(0 0 8px ${tc}80)`,
                transition:'left .8s cubic-bezier(.4,0,.2,1)',
              }}>
                {quiz.theme_icon}
              </div>
              {/* Checkpoints — la etiqueta va absoluta debajo para no descentrar el círculo */}
              <div style={{position:'absolute',top:0,left:0,right:0,display:'flex',alignItems:'flex-start',justifyContent:'space-between'}}>
                {Array.from({ length: sectionCount }).map((_, si) => {
                  const secStart = si * quiz.section_size
                  const secEnd   = Math.min(secStart + quiz.section_size, quiz.steps.length)
                  const secTotal = secEnd - secStart
                  const done     = quiz.steps.slice(secStart, secEnd).every((_, k) => selected[secStart + k] !== undefined)
                  const active   = si === groupIndex
                  const locked   = si > groupIndex
                  return (
                    <div key={si} style={{position:'relative',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                      <div className={`ap-checkpoint${active ? ' ap-cp-active' : ''}`} style={{
                        width:34,height:34,borderRadius:'50%',
                        display:'flex',alignItems:'center',justifyContent:'center',
                        fontSize:done?'.85rem':'.68rem',fontWeight:700,
                        // Fondo siempre OPACO (tinte sobre superficie en el activo) para
                        // que la línea de ruta quede oculta detrás del círculo, no cruzándolo.
                        background:done?tc:active?`linear-gradient(${tc}18,${tc}18), rgb(var(--surface))`:'rgb(var(--subtle))',
                        border:`2px solid ${done?tc:active?tc:'rgb(var(--line))'}`,
                        color:done?'#fff':active?tc:'rgb(var(--text-muted))',
                        opacity:locked?.4:1,
                        transition:'all .3s',
                        position:'relative',zIndex:1,
                      }}>
                        {done?'✓':`P${si+1}`}
                      </div>
                      <div style={{position:'absolute',top:'100%',marginTop:6,fontSize:'.55rem',color:active?tc:done?tc:'rgb(var(--text-muted))',fontWeight:active||done?600:400,opacity:locked?.4:1,whiteSpace:'nowrap',textAlign:'center'}}>
                        {t('arena.questions', { count: secTotal })}
                      </div>
                    </div>
                  )
                })}
                {/* Checkpoint final */}
                <div style={{position:'relative',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <div style={{width:32,height:32,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1rem',background:showComplete?tc:'rgb(var(--subtle))',border:`2px solid ${showComplete?tc:'rgb(var(--line))'}`,transition:'all .3s',position:'relative',zIndex:1}}>🏆</div>
                  <div style={{position:'absolute',top:'100%',marginTop:6,fontSize:'.55rem',color:'rgb(var(--text-muted))',whiteSpace:'nowrap'}}>{t('arena.goal')}</div>
                </div>
              </div>
            </div>
            </div>
          </div>
        </section>

        {/* ══ TARJETAS DE PREGUNTA ══ */}
        <section className="ap-questions" style={{padding:'0 7% 60px'}}>
          {/* Cabecera de la sección actual: deja claro que P = sección con N preguntas */}
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
            <span style={{fontSize:'.82rem',fontWeight:700,color:tc,background:`${tc}12`,border:`1px solid ${tc}28`,borderRadius:8,padding:'3px 12px'}}>
              P{groupIndex+1}
            </span>
            <span style={{fontSize:'.78rem',fontWeight:600,color:'rgb(var(--text))'}}>
              {t('arena.section_label', { n: groupIndex+1 })}
            </span>
            <span style={{fontSize:'.72rem',color:'rgb(var(--text-muted))'}}>
              · {t('arena.questions', { count: groupSteps.length })}
            </span>
          </div>
          <div className="ap-questions-grid" style={{display:'grid',gridTemplateColumns:`repeat(${groupSteps.length}, 1fr)`,gap:20}}>
            {groupSteps.map((s,gi) => {
              const i         = groupStart + gi
              const isDone    = selected[i] !== undefined
              const isActive  = i === currentQ
              const isLocked  = !isDone && i > currentQ
              const aOptId    = selected[i]
              const sAnswered = aOptId !== undefined
              const sCorrect  = sAnswered && (s.options.find(o => o.id === aOptId)?.correct ?? false)
              const sSelOpt   = s.options.find(o => o.id === aOptId)
              const showNextBtn = sAnswered && isActive && (i < groupEnd - 1 || i === quiz.steps.length - 1)

              return (
                <div
                  key={s.id}
                  className={isDone && !isActive ? 'ap-unlocked' : isActive ? 'ap-card-in' : ''}
                  style={{
                    height:'auto',width:'100%',
                    background:'rgb(var(--surface))',
                    border:`1px solid ${isActive?`${tc}50`:isDone?'rgba(16,212,81,0.2)':'rgb(var(--line))'}`,
                    borderRadius:'1rem',
                    overflow:'hidden',
                    opacity:isLocked?.4:1,
                    pointerEvents:isLocked?'none':'auto',
                    boxShadow:isActive?`0 0 24px ${tc}15`:'none',
                    transition:'border-color .3s, box-shadow .3s',
                    animationDelay:`${gi*0.08}s`,
                  }}
                >
                  {/* Terminal header */}
                  <div style={{background:'rgb(var(--bg))',padding:'10px 16px',display:'flex',alignItems:'center',gap:10,borderBottom:'1px solid rgb(var(--line))'}}>
                    <div style={{display:'flex',gap:5}}>
                      {['#ff5f57','#ffbd2e','#28c840'].map(c => (
                        <div key={c} style={{width:10,height:10,borderRadius:'50%',background:c}} />
                      ))}
                    </div>
                    <span style={{fontSize:'.65rem',color:'rgb(var(--text-muted))',flex:1,letterSpacing:'.5px'}}>
                      {quiz.title.toUpperCase().replace(/ /g,'_')} · pregunta_{String(i+1).padStart(2,'0')}.exe
                    </span>
                    <span style={{fontSize:'.65rem',fontWeight:700,color:tc,background:`${tc}12`,border:`1px solid ${tc}25`,borderRadius:4,padding:'2px 8px'}}>
                      {String(i+1).padStart(2,'0')}
                    </span>
                  </div>

                  {/* Body */}
                  <div className="ap-card-body" style={{padding:'20px 24px'}}>
                    {/* Mission label */}
                    <div style={{display:'flex',alignItems:'center',gap:8,fontSize:'.72rem',fontWeight:600,color:tc,letterSpacing:'.05em',textTransform:'uppercase',marginBottom:14}}>
                      {isDone?'✓':isActive?'▶':'🔒'} {t('arena.question_of', { n: gi+1, total: groupSteps.length })} · {isLocked?t('arena.mission_locked'):isDone?t('arena.mission_completed'):t('arena.mission_active')}
                    </div>

                    {/* Context */}
                    {s.context && (
                      <div style={{fontSize:'.78rem',color:'rgb(var(--text-muted))',background:`${tc}08`,border:`1px solid ${tc}18`,borderLeft:`3px solid ${tc}60`,borderRadius:'0 0.5rem 0.5rem 0',padding:'10px 14px',marginBottom:16,lineHeight:1.6}}>
                        📖 {s.context}
                      </div>
                    )}

                    {/* Question */}
                    <p style={{fontSize:'.95rem',fontWeight:500,color:'rgb(var(--text))',lineHeight:1.6,marginBottom:18,borderLeft:`3px solid ${tc}`,paddingLeft:14}}>
                      {s.question}
                    </p>

                    {/* Options */}
                    <div className={shake && isActive ? 'ap-shake' : ''} style={{display:'flex',flexDirection:'column',gap:8}}>
                      {s.options.map((opt,oi) => {
                        const isSelected   = aOptId === opt.id
                        const isOptCorrect = opt.correct
                        let cls = 'ap-opt'
                        if (sAnswered) {
                          if (isOptCorrect) cls += ' opt-correct' + (isOptCorrect ? ' ap-correct' : '')
                          else if (isSelected) cls += ' opt-wrong'
                          else cls += ' opt-disabled'
                        }
                        return (
                          <button
                            key={opt.id}
                            className={cls}
                            onClick={() => isActive && handleAnswer(opt.id)}
                            disabled={sAnswered || isLocked}
                          >
                            <span className="ap-key">{OPT_LABELS[oi]}</span>
                            <span style={{flex:1}}>{opt.text}</span>
                            {sAnswered && isOptCorrect && <span style={{fontSize:'.85rem'}}>✓</span>}
                            {sAnswered && isSelected && !isOptCorrect && <span style={{fontSize:'.85rem'}}>✗</span>}
                          </button>
                        )
                      })}
                    </div>

                    {/* Feedback */}
                    {sAnswered && sSelOpt?.explanation && (
                      <div style={{
                        marginTop:14,padding:'12px 16px',borderRadius:'0.75rem',
                        fontSize:'.8rem',lineHeight:1.55,
                        background:sCorrect?'rgba(16,212,81,0.08)':'rgba(239,68,68,0.07)',
                        border:`1px solid ${sCorrect?'rgba(16,212,81,0.25)':'rgba(239,68,68,0.22)'}`,
                        color:sCorrect?'#10D451':'#ef4444',
                        animation:'fadeUp .3s ease both',
                      }}>
                        {sCorrect?'✅':'❌'} {sSelOpt.explanation}
                      </div>
                    )}

                    {/* Next button — only within group or for last card of quiz */}
                    {showNextBtn && (
                      <div style={{marginTop:16,display:'flex',justifyContent:'flex-end'}}>
                        <button
                          onClick={handleNext}
                          style={{
                            display:'inline-flex',alignItems:'center',gap:8,
                            padding:'10px 24px',
                            background:`${tc}14`,
                            border:`1px solid ${tc}35`,
                            borderRadius:'0.75rem',
                            color:tc,fontSize:'.875rem',fontWeight:600,
                            cursor:'pointer',transition:'background .15s',
                            fontFamily:'inherit',
                          }}
                          onMouseEnter={e => {(e.currentTarget as HTMLElement).style.background=`${tc}28`}}
                          onMouseLeave={e => {(e.currentTarget as HTMLElement).style.background=`${tc}14`}}
                        >
                          {i >= quiz.steps.length-1 ? t('arena.see_result') : t('arena.next')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Siguiente ronda — solo si el grupo actual está completo y no es el último */}
          {allGroupAnswered && !isLastGroup && (
            <div style={{display:'flex',justifyContent:'center',marginTop:28}}>
              <button
                onClick={handleNextGroup}
                style={{
                  display:'inline-flex',alignItems:'center',gap:10,
                  padding:'13px 36px',
                  background:tc,
                  border:'none',
                  borderRadius:'0.75rem',
                  color:'#fff',fontSize:'.95rem',fontWeight:700,
                  cursor:'pointer',fontFamily:'inherit',
                  boxShadow:`0 4px 20px ${tc}50`,
                  transition:'opacity .15s',
                }}
                onMouseEnter={e => {(e.currentTarget as HTMLElement).style.opacity='0.85'}}
                onMouseLeave={e => {(e.currentTarget as HTMLElement).style.opacity='1'}}
              >
                {t('arena.next_round')}
              </button>
            </div>
          )}
        </section>

        {/* ══ XP POPUP ══ */}
        {xpPopup && (
          <div key={xpPopup.key} style={{
            position:'fixed',top:70,right:28,
            fontSize:'1.3rem',fontWeight:800,color:tc,
            textShadow:`0 0 12px ${tc}80`,
            animation:'xpRise 1.8s ease forwards',
            zIndex:9998,pointerEvents:'none',
          }}>
            +{xpPopup.val} XP
          </div>
        )}

        {/* ══ MISSION POPUP ══ */}
        {popup.show && (
          <div style={{
            position:'fixed',bottom:32,left:'50%',
            transform:'translateX(-50%)',
            background:'rgb(var(--surface))',
            border:`1px solid ${tc}40`,
            borderRadius:'1rem',padding:'18px 28px',
            textAlign:'center',minWidth:260,zIndex:9997,
            boxShadow:`0 8px 32px ${tc}20`,
            animation:'popShow .4s cubic-bezier(.2,.8,.4,1) both',
          }}>
            <div style={{fontSize:'2rem',marginBottom:8}}>{popup.icon}</div>
            <div style={{fontWeight:700,fontSize:'1rem',color:tc,marginBottom:4}}>{popup.title}</div>
            <div style={{fontSize:'.78rem',color:'rgb(var(--text-muted))'}}>{popup.text}</div>
          </div>
        )}

        {/* ══ COMPLETION ══ */}
        {showComplete && passed && (
          <div style={{
            position:'fixed',inset:0,zIndex:9990,
            background:'rgba(0,0,0,0.88)',backdropFilter:'blur(14px)',
            display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
            gap:24,textAlign:'center',padding:24,
            animation:'fadeUp .4s ease both',
          }}>
            {/* Confetti */}
            {[tc,'#ffd700','#ff6b6b','#4ecdc4','#a855f7','#f97316'].map((c,n) => (
              <div key={n} style={{
                position:'absolute',width:12,height:12,borderRadius:'50%',background:c,
                top:'50%',left:'50%',
                animation:`xpRise 1.2s ease-out ${n*.1}s both`,
              }} />
            ))}
            <div style={{fontSize:'4rem',animation:'spinIn .6s ease both'}}>🏆</div>
            <div style={{fontSize:'2.2rem',letterSpacing:6,lineHeight:1,animation:'fadeUp .5s .2s ease both'}}>
              <StarDisplay value={getStarsDisplay(scorePct)} size={32} />
            </div>
            <div>
              <h1 style={{margin:0,fontSize:'1.9rem',fontWeight:800,color:tc,letterSpacing:'-.5px'}}>
                {t('arena.completed_title')}
              </h1>
              <p style={{margin:'8px 0 0',fontSize:'.9rem',color:'rgb(var(--text-muted))'}}>
                {quiz.title} · {t(`themes.${quiz.theme_type}`, quiz.theme_type)}
              </p>
            </div>
            <div style={{
              display:'flex',gap:24,flexWrap:'wrap',justifyContent:'center',
              background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',
              borderRadius:16,padding:'20px 28px',
            }}>
              {[
                {val:xp,lbl:t('arena.stat_xp'),c:tc},
                {val:`${correctCount}/${quiz.steps.length}`,lbl:t('arena.stat_correct'),c:correctCount===quiz.steps.length?tc:'#f97316'},
                {val:`${scorePct}%`,lbl:t('arena.stat_score'),c:tc},
                {val:fmt(timerSecs),lbl:t('arena.stat_time'),c:'rgb(var(--text-muted))'},
              ].map((stat,i) => (
                <div key={i} style={{textAlign:'center'}}>
                  <div style={{fontSize:'1.6rem',fontWeight:800,color:stat.c}}>{stat.val}</div>
                  <div style={{fontSize:'.7rem',color:'rgb(var(--text-muted))',marginTop:2}}>{stat.lbl}</div>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:12,flexWrap:'wrap',justifyContent:'center'}}>
              <button
                onClick={() => window.location.reload()}
                style={{padding:'12px 28px',borderRadius:'0.75rem',border:'none',background:tc,color:'#fff',fontSize:'.9rem',fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
              >{t('arena.repeat')}</button>
              <button
                onClick={() => navigate(backPath, backNavOpts)}
                style={{padding:'12px 28px',borderRadius:'0.75rem',background:'transparent',color:'rgb(var(--text-muted))',border:'1px solid rgba(255,255,255,0.12)',fontSize:'.9rem',cursor:'pointer',fontFamily:'inherit'}}
              >{backPath === '/world' ? t('arena.back_map_btn') : backLabel}</button>
            </div>
          </div>
        )}

        {/* ══ FAILED ══ */}
        {showComplete && !passed && (
          <div style={{
            position:'fixed',inset:0,zIndex:9990,
            background:'rgba(0,0,0,0.88)',backdropFilter:'blur(14px)',
            display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
            gap:24,textAlign:'center',padding:24,
            animation:'fadeUp .4s ease both',
          }}>
            <div style={{fontSize:'4rem',animation:'spinIn .6s ease both'}}>😔</div>
            <div>
              <h1 style={{margin:0,fontSize:'1.9rem',fontWeight:800,color:'#ef4444',letterSpacing:'-.5px'}}>
                {t('arena.failed_title')}
              </h1>
              <p style={{margin:'8px 0 0',fontSize:'.9rem',color:'rgb(var(--text-muted))'}}>
                {quiz.title} · {t(`themes.${quiz.theme_type}`, quiz.theme_type)}
              </p>
            </div>
            <div style={{
              display:'flex',gap:24,flexWrap:'wrap',justifyContent:'center',
              background:'rgba(239,68,68,0.06)',border:'1px solid rgba(239,68,68,0.18)',
              borderRadius:16,padding:'20px 28px',
            }}>
              {[
                {val:`${scorePct}%`,lbl:t('arena.stat_your_score'),c:'#ef4444'},
                {val: (locationState?.minScorePct ?? quiz.min_score_pct) != null ? `${locationState?.minScorePct ?? quiz.min_score_pct}%` : '—', lbl:t('arena.stat_min_required'),c:'rgb(var(--text-muted))'},
                {val:`${correctCount}/${quiz.steps.length}`,lbl:t('arena.stat_correct'),c:'rgb(var(--text-muted))'},
              ].map((stat,i) => (
                <div key={i} style={{textAlign:'center'}}>
                  <div style={{fontSize:'1.6rem',fontWeight:800,color:stat.c}}>{stat.val}</div>
                  <div style={{fontSize:'.7rem',color:'rgb(var(--text-muted))',marginTop:2}}>{stat.lbl}</div>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:12,flexWrap:'wrap',justifyContent:'center'}}>
              <button
                onClick={() => window.location.reload()}
                style={{padding:'12px 28px',borderRadius:'0.75rem',border:'none',background:'#ef4444',color:'#fff',fontSize:'.9rem',fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}
              >{t('arena.retry')}</button>
              <button
                onClick={() => navigate(backPath, backNavOpts)}
                style={{padding:'12px 28px',borderRadius:'0.75rem',background:'transparent',color:'rgb(var(--text-muted))',border:'1px solid rgba(255,255,255,0.12)',fontSize:'.9rem',cursor:'pointer',fontFamily:'inherit'}}
              >{backPath === '/world' ? t('arena.back_map_btn') : backLabel}</button>
            </div>
          </div>
        )}

      </div>
    </>
  )
}