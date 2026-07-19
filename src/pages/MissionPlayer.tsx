import { useEffect, useRef, useState, useCallback, Fragment } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion, animate } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

/* ══════════════════════════════════════════════════
   SkyLearn – Training Simulation · GLPI Module
   Convertido a React/TSX desde HTML/CSS/JS original
   Mantiene: HUD, XP, Timer, Sonidos, Steps, Quiz
══════════════════════════════════════════════════ */

/* ── SOUND ENGINE ── */
function useSFX() {
  const ctxRef = useRef<AudioContext | null>(null)
  const getCtx = () => {
    if (!ctxRef.current) {
      try { ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)() } catch {}
    }
    // El contexto arranca "suspended" por la política de autoplay; hay que
    // reanudarlo (tras el primer gesto del usuario ya prende) o queda mudo.
    if (ctxRef.current && ctxRef.current.state === 'suspended') void ctxRef.current.resume()
    return ctxRef.current
  }
  const play = useCallback((type: string) => {
    const ctx = getCtx(); if (!ctx) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    const t = ctx.currentTime
    const presets: Record<string, () => void> = {
      correct:  () => { o.type='sine';     o.frequency.setValueAtTime(523,t); o.frequency.setValueAtTime(659,t+.1); o.frequency.setValueAtTime(784,t+.2); g.gain.setValueAtTime(.18,t); g.gain.exponentialRampToValueAtTime(.001,t+.5); o.start(t); o.stop(t+.55) },
      wrong:    () => { o.type='sawtooth'; o.frequency.setValueAtTime(220,t); o.frequency.setValueAtTime(180,t+.12); g.gain.setValueAtTime(.14,t); g.gain.exponentialRampToValueAtTime(.001,t+.35); o.start(t); o.stop(t+.4) },
      step:     () => { o.type='sine';     o.frequency.setValueAtTime(392,t); o.frequency.setValueAtTime(523,t+.12); g.gain.setValueAtTime(.12,t); g.gain.exponentialRampToValueAtTime(.001,t+.4); o.start(t); o.stop(t+.45) },
      login:    () => { o.type='sine';     o.frequency.setValueAtTime(440,t); o.frequency.setValueAtTime(587,t+.1); o.frequency.setValueAtTime(880,t+.22); g.gain.setValueAtTime(.14,t); g.gain.exponentialRampToValueAtTime(.001,t+.6); o.start(t); o.stop(t+.65) },
      submit:   () => { o.type='triangle'; o.frequency.setValueAtTime(659,t); o.frequency.setValueAtTime(880,t+.15); o.frequency.setValueAtTime(1047,t+.3); g.gain.setValueAtTime(.13,t); g.gain.exponentialRampToValueAtTime(.001,t+.7); o.start(t); o.stop(t+.75) },
      complete: () => { o.type='sine'; [523,659,784,1047].forEach((f,i)=>{ o.frequency.setValueAtTime(f,t+i*.15) }); g.gain.setValueAtTime(.15,t); g.gain.exponentialRampToValueAtTime(.001,t+.9); o.start(t); o.stop(t+.95) },
      click:    () => { o.type='sine';     o.frequency.setValueAtTime(800,t); g.gain.setValueAtTime(.05,t); g.gain.exponentialRampToValueAtTime(.001,t+.08); o.start(t); o.stop(t+.1) },
    }
    if (presets[type]) presets[type]()
  }, [])
  return { play }
}

/* ── TYPES ── */
const STEPS = [
  { id: 'intro',       icon: '📋' },
  { id: 'login',       icon: '🔐' },
  { id: 'crear',       icon: '🎫' },
  { id: 'campos',      icon: '📝' },
  { id: 'seguimiento', icon: '🔍' },
  { id: 'sla',         icon: '⏱️' },
]

/* Quiz answer keys (text resolved via i18n at render time) */
const QUIZ_KEYS = [
  { key: 'q1', correct: 'b' },
  { key: 'q2', correct: 'c' },
  { key: 'q3', correct: 'c' },
  { key: 'q4', correct: 'b' },
] as const
const QUIZ_OPT_IDS = ['a', 'b', 'c', 'd'] as const

/* ── MISSION TYPE ── */
interface Mission {
  id: string
  title: string
  description: string
  category: string | null
  campaign_id: string | null
  status: string
  steps: { id: string; title: string; type: string }[]
}

/* ══════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════ */
export default function MissionPlayer() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { play } = useSFX()

  const [mission, setMission] = useState<Mission | null>(null)
  const [missionLoading, setMissionLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    supabase
      .from('guided_missions')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (!error && data) setMission(data as unknown as Mission)
        setMissionLoading(false)
      })
  }, [id])

  const [currentStep, setCurrentStep] = useState(0)
  const [xp, setXp] = useState(0)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [stepDone, setStepDone] = useState<Record<number, boolean>>({})
  const [logs, setLogs] = useState<{ ts: string; msg: string; type: string }[]>([])
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null)
  const [xpPopup, setXpPopup] = useState<{ val: number; key: number } | null>(null)
  const [showCompletion, setShowCompletion] = useState(false)
  const [quizAnswers, setQuizAnswers] = useState<Record<number, boolean | null>>({})
  // Opción elegida por el aprendiz (solo para pintar su elección incorrecta en
  // rojo); no altera la lógica de puntaje, que sigue en quizAnswers.
  const [quizChosen, setQuizChosen] = useState<Record<number, string>>({})
  const reduce = !!useReducedMotion()

  /* Login state */
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginOrigin, setLoginOrigin] = useState('')
  const [loginDone, setLoginDone] = useState(false)
  const [loginShake, setLoginShake] = useState<string | null>(null)

  /* Catalog step state */
  const [menuOpen, setMenuOpen] = useState(false)
  const [catalogVisible, setCatalogVisible] = useState(false)
  const [formVisible, setFormVisible] = useState(false)

  /* Campos step state */
  const [fTipo, setFTipo] = useState('')
  const [fAeropuerto, setFAeropuerto] = useState('')
  const [fReportado, setFReportado] = useState('')
  const [fCategoria, setFCategoria] = useState('')
  const [fTipoInc, setFTipoInc] = useState('')
  const [fDesc, setFDesc] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitResult, setSubmitResult] = useState<number | null>(null)

  /* Seguimiento state */
  const [ticketDetailVisible, setTicketDetailVisible] = useState(false)
  const [validationFeedback, setValidationFeedback] = useState<{ type: 'ok' | 'fail'; msg: string } | null>(null)

  const xpTarget = 300

  /* Toast — declared early (used by save-progress effect) */
  const showToast = useCallback((msg: string, type = 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  /* Save progress on completion */
  const progressSaved = useRef(false)
  useEffect(() => {
    if (!showCompletion || progressSaved.current || !user?.id || !mission || !id) return
    progressSaved.current = true
    const quizCorrect = Object.values(quizAnswers).filter(Boolean).length
    ;(async () => {
      const { error } = await supabase.from('mission_progress').insert({
        user_id: user.id,
        mission_id: id,
        campaign_id: mission.campaign_id,
        xp_earned: xp,
        completed: true,
        time_seconds: timerSeconds,
        quiz_score: quizCorrect,
      })
      if (error) {
        console.error('mission_progress insert error:', error, { userId: user.id, missionId: id })
        showToast(t('mission_sim.toast.save_error'), 'err')
      }
    })()
  }, [showCompletion, user, mission, quizAnswers, xp, timerSeconds, id, showToast])

  /* Timer */
  useEffect(() => {
    const iv = setInterval(() => setTimerSeconds(s => s + 1), 1000)
    return () => clearInterval(iv)
  }, [])

  const formatTimer = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  /* Log */
  const addLog = useCallback((msg: string, type = 'dim') => {
    const now = new Date()
    const ts = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`
    setLogs(l => [{ ts, msg, type }, ...l].slice(0, 20))
  }, [])

  /* XP */
  const addXP = useCallback((amount: number) => {
    setXp(prev => Math.min(prev + amount, xpTarget))
    setXpPopup({ val: amount, key: Date.now() })
    setTimeout(() => setXpPopup(null), 1600)
  }, [])

  /* Mark step done */
  const markStepDone = useCallback((idx: number, xpEarned: number) => {
    setStepDone(prev => {
      if (prev[idx]) return prev
      addXP(xpEarned)
      addLog(t('mission_sim.log.step_done', { xp: xpEarned }), 'ok')
      return { ...prev, [idx]: true }
    })
  }, [addXP, addLog, t])

  /* Navigation */
  const goStep = useCallback((idx: number) => {
    if (idx < 0 || idx >= STEPS.length) return
    setCurrentStep(idx)
    play('step')
    addLog(t('mission_sim.log.starting', { label: t(`mission_sim.steps.${STEPS[idx].id}`) }), 'new')
  }, [play, addLog, t])

  const nextStep = useCallback(() => {
    if (currentStep >= STEPS.length - 1) {
      setShowCompletion(true)
      play('complete')
      addLog(t('mission_sim.log.completed'), 'ok')
    } else {
      goStep(currentStep + 1)
    }
  }, [currentStep, goStep, play, addLog, t])

  /* Init log — re-seed when the resolved language changes so the system
     log doesn't stay in the language active at mount (the profile language
     syncs in a later effect, after this component first renders). */
  useEffect(() => {
    setLogs([])
    addLog(t('mission_sim.log.init1'), 'new')
    addLog(t('mission_sim.log.init2'), 'dim')
    addLog(t('mission_sim.log.init3'), 'dim')
  }, [i18n.resolvedLanguage, t, addLog])

  /* ── LOGIN ── */
  const handleLogin = () => {
    if (!loginUser.trim()) { setLoginShake('user'); showToast(t('mission_sim.toast.login_user'), 'err'); return }
    if (!loginPass.trim()) { setLoginShake('pass'); showToast(t('mission_sim.toast.login_pass'), 'err'); return }
    if (loginOrigin !== 'db_interna') { setLoginShake('origin'); showToast(t('mission_sim.toast.login_origin'), 'err'); addLog(t('mission_sim.log.login_err_origin'), 'err'); return }
    setLoginDone(true)
    setLoginShake(null)
    showToast(t('mission_sim.toast.login_ok'), 'ok')
    addLog(t('mission_sim.log.login_ok'), 'ok')
    play('login')
    markStepDone(1, 40)
  }

  /* ── CAMPOS VALIDATION ── */
  const validateField = (val: string, correct: string, key: string) => {
    if (!val) { setFieldErrors(e => ({ ...e, [key]: t('mission_sim.field_err.required') })); return false }
    const ok = val === correct
    setFieldErrors(e => ({ ...e, [key]: ok ? '' : t('mission_sim.field_err.incorrect') }))
    return ok
  }

  const validateForm = () => {
    const checks = [
      validateField(fTipo, 'incidente', 'tipo'),
      validateField(fAeropuerto, 'NLU', 'aeropuerto'),
      validateField(fReportado, 'aerolinea', 'reportado'),
      validateField(fCategoria, 'software', 'categoria'),
      validateField(fTipoInc, 'falla_critica', 'tipo_inc'),
    ]
    const descOk = fDesc.trim().length >= 20
    if (!descOk) showToast(t('mission_sim.toast.desc_min'), 'err')
    const allOk = checks.every(Boolean) && descOk
    if (allOk) {
      play('submit')
      const ticketId = Math.floor(800 + Math.random() * 200)
      setSubmitResult(ticketId)
      showToast(t('mission_sim.toast.ticket_ok', { id: ticketId }), 'ok')
      addLog(t('mission_sim.log.ticket_created', { id: ticketId }), 'ok')
      markStepDone(3, 60)
    } else {
      play('wrong')
      showToast(t('mission_sim.toast.fields_red'), 'err')
    }
  }

  /* ── QUIZ ── */
  const answerQuiz = (qIdx: number, optId: string) => {
    if (quizAnswers[qIdx] !== undefined) return
    const isCorrect = QUIZ_KEYS[qIdx].correct === optId
    setQuizChosen(prev => ({ ...prev, [qIdx]: optId }))
    setQuizAnswers(prev => {
      const next = { ...prev, [qIdx]: isCorrect }
      if (Object.keys(next).length >= QUIZ_KEYS.length) {
        setTimeout(() => markStepDone(5, 50), 500)
      }
      return next
    })
    const xpEarned = isCorrect ? 30 : 5
    play(isCorrect ? 'correct' : 'wrong')
    addXP(xpEarned)
    showToast(isCorrect ? t('mission_sim.toast.quiz_correct', { xp: xpEarned }) : t('mission_sim.toast.quiz_incorrect'), isCorrect ? 'ok' : 'err')
    addLog(t('mission_sim.log.quiz_result', { n: qIdx+1, result: isCorrect ? t('mission_sim.log.quiz_correct') : t('mission_sim.log.quiz_incorrect'), xp: xpEarned }), isCorrect ? 'ok' : 'warn')
  }

  const title = t(`mission_sim.step_titles.${STEPS[currentStep].id}_t`)
  const desc  = t(`mission_sim.step_titles.${STEPS[currentStep].id}_s`)
  const xpPct = (xp / xpTarget) * 100

  if (missionLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'rgb(var(--bg))', color: '#10D451', fontFamily: 'Poppins, sans-serif', fontSize: '.85rem' }}>
        {t('mission_sim.loading')}
      </div>
    )
  }

  if (!mission) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'rgb(var(--bg))', color: '#ff3b5c', fontFamily: 'Poppins, sans-serif', fontSize: '.85rem', gap: 16 }}>
        <div>{t('mission_sim.not_found')}</div>
        <button onClick={() => navigate('/admin/missions')} style={{ color: '#10D451', background: 'transparent', border: '1px solid #10D451', borderRadius: 8, padding: '8px 20px', cursor: 'pointer', fontFamily: 'Poppins, sans-serif' }}>{t('mission_sim.back')}</button>
      </div>
    )
  }

  const isGLPIMission =
    mission.title?.toLowerCase().includes('glpi') ||
    mission.title?.toLowerCase().includes('amadeus') ||
    mission.category?.toLowerCase().includes('glpi') ||
    mission.category?.toLowerCase().includes('amadeus')

  if (!isGLPIMission) {
    return (
      <div style={{ background: 'rgb(var(--bg))', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Poppins, sans-serif', color: 'rgb(var(--text))', gap: 16 }}>
        <div style={{ fontSize: '3rem' }}>🚧</div>
        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600 }}>{t('mission_sim.under_construction_title')}</h2>
        <p style={{ margin: 0, color: 'rgb(var(--text-muted))', fontSize: '1rem' }}>{t('mission_sim.under_construction_sub')}</p>
        <button onClick={() => navigate('/admin/missions')} style={{ marginTop: 8, background: '#10D451', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 28px', fontSize: '1rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'Poppins, sans-serif' }}>{t('mission_sim.back_missions')}</button>
      </div>
    )
  }

  /* ══════════════════════════════════════════════════
     STYLES (inline — preserva look original)
  ══════════════════════════════════════════════════ */
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap');
    .sim-root { font-family:'Poppins',sans-serif; background:rgb(var(--bg)); color:rgb(var(--text)); min-height:100vh; display:grid; grid-template-rows:56px 1fr; grid-template-columns:220px 1fr 260px; grid-template-areas:"hud hud hud" "nav scene log"; position:relative; }
    .hud { grid-area:hud; display:flex; align-items:center; justify-content:space-between; padding:0 24px; background:rgb(var(--surface)); border-bottom:1px solid rgb(var(--line)); position:sticky; top:0; z-index:100; }
    .hud-brand { font-family:'Poppins',sans-serif; font-weight:600; font-size:1rem; color:rgb(var(--text)); letter-spacing:.25px; }
    .hud-brand span { color:rgb(var(--text-muted)); font-weight:400; }
    .hud-center { display:flex; align-items:center; gap:24px; }
    .hud-mission { font-family:'Poppins',sans-serif; font-size:.78rem; color:rgb(var(--text-muted)); }
    .hud-timer { font-family:'Poppins',sans-serif; font-size:.95rem; font-weight:600; color:#00d4e8; background:rgba(0,212,232,0.1); border:1px solid rgba(0,212,232,0.2); padding:4px 14px; border-radius:6px; letter-spacing:2px; min-width:90px; text-align:center; }
    .hud-right { display:flex; align-items:center; gap:16px; }
    .xp-bar-wrap { display:flex; align-items:center; gap:8px; font-family:'Poppins',sans-serif; font-size:.85rem; color:#10D451; }
    .xp-track { width:90px; height:6px; background:rgba(16,212,81,0.12); border-radius:3px; overflow:hidden; }
    .xp-fill { height:100%; background:#10D451; border-radius:3px; transition:width .6s ease; }
    .step-badge { font-family:'Poppins',sans-serif; font-size:.72rem; color:rgb(var(--text-muted)); letter-spacing:.5px; }
    .sim-nav { grid-area:nav; padding:20px 14px; background:rgb(var(--surface)); border-right:1px solid rgb(var(--line)); display:flex; flex-direction:column; gap:6px; overflow-y:auto; }
    .nav-label { font-family:'Poppins',sans-serif; font-size:.55rem; color:rgb(var(--text-muted)); letter-spacing:2px; text-transform:uppercase; padding:14px 8px 6px; border-top:1px solid rgb(var(--line)); margin-top:8px; }
    .nav-label:first-child { border-top:none; margin-top:0; padding-top:4px; }
    .nav-btn { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid transparent; border-radius:0.75rem; background:transparent; color:rgb(var(--text-muted)); font-family:'Poppins',sans-serif; font-size:.85rem; font-weight:500; cursor:pointer; transition:.2s; text-align:left; width:100%; position:relative; }
    .nav-btn.active { background:rgba(16,212,81,0.08); border-color:rgba(16,212,81,0.25); color:#10D451; }
    .nav-btn.done { color:#10D451; }
    .nav-btn.locked { opacity:.35; cursor:not-allowed; pointer-events:none; }
    .scene { grid-area:scene; padding:28px; overflow-y:auto; display:flex; flex-direction:column; gap:0; background:rgb(var(--bg)); }
    .mission-header { margin-bottom:24px; padding-bottom:18px; border-bottom:1px solid rgb(var(--line)); }
    .mission-tag { font-family:'Poppins',sans-serif; font-size:.65rem; color:#10D451; letter-spacing:2px; text-transform:uppercase; margin-bottom:6px; }
    .mission-title-h { font-family:'Poppins',sans-serif; font-size:1.4rem; font-weight:700; color:rgb(var(--text)); line-height:1.2; }
    .mission-desc-p { font-size:.85rem; color:rgb(var(--text-muted)); margin-top:6px; line-height:1.6; max-width:560px; }
    .cp-strip { display:flex; align-items:center; padding:14px 0; }
    .cp-item { display:flex; flex-direction:column; align-items:center; gap:4px; flex:1; }
    .cp-dot { width:28px; height:28px; border-radius:50%; border:2px solid rgb(var(--line)); background:transparent; display:flex; align-items:center; justify-content:center; font-size:.7rem; color:rgb(var(--text-muted)); transition:.3s; }
    .cp-dot.done { background:#10D451; border-color:#10D451; color:#fff; font-weight:700; }
    .cp-dot.active { background:rgba(16,212,81,0.08); border-color:#10D451; color:#10D451; }
    .cp-label { font-family:'Poppins',sans-serif; font-size:.52rem; color:rgb(var(--text-muted)); text-align:center; max-width:60px; line-height:1.3; }
    .cp-label.active-lbl { color:#10D451; }
    .cp-label.done-lbl { color:#10D451; }
    .cp-line { flex:1; height:2px; background:rgb(var(--line)); margin-bottom:20px; transition:.3s; }
    .cp-line.done-line { background:#10D451; }
    .step-panel { display:none; flex-direction:column; gap:18px; animation:fadeSlide .45s cubic-bezier(0.22,1,0.36,1); }
    .step-panel.active { display:flex; }
    @keyframes fadeSlide { from{opacity:0;transform:translateY(18px);} to{opacity:1;transform:translateY(0);} }
    .info-card { background:rgb(var(--surface)); border:1px solid rgb(var(--line)); border-radius:1rem; padding:20px 24px; }
    .info-card-hdr { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
    .info-card-icon { width:36px; height:36px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.1rem; }
    .icon-aqua { background:rgba(16,212,81,0.1); }
    .icon-amber { background:rgba(255,184,0,0.15); }
    .info-card-title { font-family:'Poppins',sans-serif; font-size:1rem; font-weight:600; color:rgb(var(--text)); }
    .info-card-subtitle { font-size:.72rem; color:rgb(var(--text-muted)); }
    .info-list { display:flex; flex-direction:column; gap:8px; }
    .info-item { display:flex; align-items:flex-start; gap:10px; padding:10px 12px; background:rgba(255,255,255,0.02); border-radius:7px; border-left:2px solid transparent; font-size:.8rem; line-height:1.5; }
    .info-item:hover { background:rgba(16,212,81,0.04); border-left-color:#10D451; }
    .info-item-label { font-weight:600; color:#10D451; min-width:80px; }
    .info-item-desc { color:rgb(var(--text-muted)); }
    .next-btn { display:inline-flex; align-items:center; gap:10px; padding:10px 24px; background:rgba(16,212,81,0.08); border:1px solid rgba(16,212,81,0.25); border-radius:0.75rem; color:#10D451; font-family:'Poppins',sans-serif; font-size:.9rem; font-weight:600; cursor:pointer; transition:.25s; margin-top:6px; }
    .next-btn:hover { background:rgba(16,212,81,0.15); border-color:rgba(16,212,81,0.4); transform:translateY(-1px); }
    .next-btn:active,.glpi-submit-btn:active,.completion-btn:active,.completion-btn-sec:active { transform:scale(.97); }
    .nav-btn:not(.locked):not(.active):hover { background:rgba(16,212,81,0.04); color:rgb(var(--text)); }
    .nav-btn:not(.locked):active { transform:scale(.98); }
    .glpi-screen { background:rgb(var(--surface)); border:1px solid rgb(var(--line)); border-radius:1rem; overflow:hidden; }
    .glpi-topbar { background:rgb(var(--bg)); padding:10px 18px; display:flex; align-items:center; gap:12px; border-bottom:1px solid rgb(var(--line)); }
    .browser-dots { display:flex; gap:6px; }
    .dot-r { width:11px; height:11px; border-radius:50%; background:#ff5f57; }
    .dot-y { width:11px; height:11px; border-radius:50%; background:#ffbd2e; }
    .dot-g { width:11px; height:11px; border-radius:50%; background:#28c840; }
    .browser-url { flex:1; background:rgba(255,255,255,0.04); border:1px solid rgb(var(--line)); border-radius:5px; padding:4px 12px; font-family:'Poppins',sans-serif; font-size:.65rem; color:rgb(var(--text-muted)); }
    .glpi-body { display:grid; grid-template-columns:200px 1fr; min-height:360px; }
    .glpi-sidebar { background:#111827; padding:16px 0; border-right:1px solid rgba(255,255,255,0.05); }
    .glpi-logo { padding:8px 16px 16px; font-family:'Poppins',sans-serif; font-size:1.4rem; font-weight:700; color:#4ade80; border-bottom:1px solid rgba(255,255,255,0.05); margin-bottom:8px; }
    .glpi-menu-item { padding:8px 16px; font-size:.75rem; color:#6b7280; cursor:pointer; display:flex; align-items:center; gap:8px; transition:.2s; border-left:2px solid transparent; font-family:'Poppins',sans-serif; }
    .glpi-menu-item:hover { color:#e5e7eb; background:rgba(255,255,255,0.03); }
    .glpi-menu-item.gm-active { color:#60a5fa; border-left-color:#60a5fa; background:rgba(96,165,250,0.08); }
    .glpi-menu-item.gm-highlight { color:#fbbf24; border-left-color:#fbbf24; background:rgba(251,191,36,0.08); }
    .glpi-content { padding:20px 24px; }
    .glpi-breadcrumb { font-size:.7rem; color:#6b7280; margin-bottom:14px; font-family:'Poppins',sans-serif; }
    .glpi-breadcrumb span { color:#60a5fa; }
    .form-label { display:block; font-size:.72rem; color:#9ca3af; margin-bottom:5px; font-weight:500; font-family:'Poppins',sans-serif; }
    .form-select,.form-input,.form-textarea { width:100%; padding:8px 12px; background:#1f2937; border:1px solid #374151; border-radius:5px; color:#f9fafb; font-family:'Poppins',sans-serif; font-size:.8rem; appearance:none; cursor:pointer; transition:.2s; }
    .form-select.correct { border-color:#059669; background:#dcfce7; color:#14532d; }
    .form-select.incorrect,.form-textarea.incorrect { border-color:#dc2626; background:#fee2e2; color:#7f1d1d; }
    .form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .form-group { margin-bottom:14px; }
    .field-err { font-size:.62rem; color:#dc2626; font-weight:600; margin-top:3px; }
    .glpi-submit-btn { background:#1d4ed8; color:white; border:none; padding:9px 24px; border-radius:5px; font-size:.82rem; font-weight:600; cursor:pointer; transition:.2s; font-family:'Poppins',sans-serif; }
    .glpi-submit-btn:hover { background:#2563eb; transform:translateY(-1px); }
    .ticket-table { width:100%; border-collapse:collapse; font-size:.75rem; }
    .ticket-table th { padding:8px 10px; background:#0d1117; color:#6b7280; text-align:left; border-bottom:1px solid rgba(255,255,255,0.05); font-weight:500; font-family:'Poppins',sans-serif; font-size:.62rem; letter-spacing:.5px; text-transform:uppercase; }
    .ticket-table td { padding:9px 10px; border-bottom:1px solid rgba(255,255,255,0.04); color:#e5e7eb; vertical-align:middle; }
    .ticket-row { cursor:pointer; transition:.15s; }
    .ticket-row:hover { background:rgba(96,165,250,0.06); }
    .status-dot { display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:20px; font-size:.65rem; font-weight:600; }
    .s-assigned { background:rgba(16,185,129,0.15); color:#34d399; }
    .s-waiting { background:rgba(251,191,36,0.15); color:#fbbf24; }
    .s-new { background:rgba(96,165,250,0.15); color:#60a5fa; }
    .p-badge { font-size:.62rem; font-weight:700; padding:2px 6px; border-radius:3px; }
    .p-alto { background:rgba(239,68,68,0.2); color:#f87171; }
    .p-medio { background:rgba(251,191,36,0.2); color:#fbbf24; }
    .p-bajo { background:rgba(107,114,128,0.2); color:#9ca3af; }
    .sla-table { width:100%; border-collapse:collapse; font-size:.8rem; }
    .sla-table th { padding:9px 14px; background:rgba(16,212,81,0.06); color:#10D451; text-align:left; font-family:'Poppins',sans-serif; font-weight:600; border-bottom:1px solid rgb(var(--line)); }
    .sla-table td { padding:10px 14px; border-bottom:1px solid rgb(var(--line)); color:rgb(var(--text)); }
    .sla-alto { color:#ff3b5c; font-weight:700; }
    .sla-medio { color:#ffb800; font-weight:700; }
    .sla-bajo { color:#10D451; font-weight:700; }
    .quiz-card { background:rgb(var(--surface)); border:1px solid rgb(var(--line)); border-radius:1rem; padding:22px 24px; }
    .quiz-q { font-size:.95rem; font-weight:500; color:rgb(var(--text)); margin-bottom:16px; line-height:1.5; padding-left:10px; border-left:3px solid #10D451; }
    .quiz-options { display:flex; flex-direction:column; gap:9px; }
    .quiz-opt { padding:10px 16px; background:transparent; border:1px solid rgb(var(--line)); border-radius:0.5rem; color:rgb(var(--text)); font-family:'Poppins',sans-serif; font-size:.82rem; cursor:pointer; transition:.2s; text-align:left; width:100%; display:flex; align-items:center; gap:10px; }
    .quiz-opt:hover { border-color:rgba(16,212,81,0.4); background:rgba(16,212,81,0.06); }
    .quiz-opt.opt-correct { border-color:#10D451; background:rgba(16,212,81,0.1); color:#10D451; pointer-events:none; }
    .quiz-opt.opt-wrong { border-color:#ff3b5c; background:rgba(255,59,92,0.08); color:#ff3b5c; pointer-events:none; }
    .quiz-opt.opt-disabled { pointer-events:none; opacity:.5; }
    .opt-letter { width:22px; height:22px; border-radius:50%; background:rgba(16,212,81,0.08); border:1px solid rgba(16,212,81,0.2); display:flex; align-items:center; justify-content:center; font-size:.7rem; font-weight:700; font-family:'Poppins',sans-serif; flex-shrink:0; }
    .quiz-fb { margin-top:14px; padding:12px 16px; border-radius:8px; font-size:.8rem; display:flex; align-items:flex-start; gap:10px; line-height:1.5; }
    .fb-ok { background:rgba(16,212,81,0.1); border:1px solid rgba(16,212,81,0.3); color:#10D451; }
    .fb-fail { background:rgba(255,59,92,0.08); border:1px solid rgba(255,59,92,0.25); color:#ff3b5c; }
    .log-panel { grid-area:log; padding:18px 14px; background:rgb(var(--surface)); border-left:1px solid rgb(var(--line)); display:flex; flex-direction:column; gap:12px; overflow-y:auto; }
    .log-title { font-family:'Poppins',sans-serif; font-size:.6rem; color:rgb(var(--text-muted)); letter-spacing:2px; text-transform:uppercase; padding-bottom:10px; border-bottom:1px solid rgb(var(--line)); }
    .log-entry { font-family:'Poppins',sans-serif; font-size:.62rem; line-height:1.7; padding-left:10px; border-left:2px solid rgb(var(--line)); color:rgb(var(--text-muted)); }
    .log-entry.new { color:#10D451; border-left-color:#10D451; }
    .log-entry.ok { color:#10D451; border-left-color:#10D451; }
    .log-entry.warn { color:#ffb800; border-left-color:#ffb800; }
    .log-entry.err { color:#ff3b5c; border-left-color:#ff3b5c; }
    .log-entry.dim { color:rgb(var(--text-muted)); border-left-color:rgb(var(--line)); }
    .log-time { color:rgb(var(--text-muted)); font-size:.58rem; }
    .toast-wrap { position:fixed; bottom:28px; right:28px; padding:14px 22px; border-radius:0.75rem; font-family:'Poppins',sans-serif; font-size:.85rem; font-weight:600; display:flex; align-items:center; gap:10px; z-index:9998; max-width:320px; backdrop-filter:blur(10px); }
    .t-ok { background:rgba(16,212,81,0.1); border:1px solid rgba(16,212,81,0.35); color:#10D451; }
    .t-err { background:rgba(255,59,92,0.1); border:1px solid rgba(255,59,92,0.3); color:#ff3b5c; }
    .t-info { background:rgba(255,255,255,0.06); border:1px solid rgb(var(--line)); color:rgb(var(--text)); }
    .xp-popup { position:fixed; top:70px; right:28px; font-family:'Poppins',sans-serif; font-size:1.2rem; font-weight:700; color:#10D451; z-index:9997; }
    .completion-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.88); backdrop-filter:blur(10px); z-index:9990; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:24px; text-align:center; overflow:hidden; padding:24px; }
    .completion-icon { font-size:4rem; filter:drop-shadow(0 0 30px rgba(16,212,81,0.5)); }
    .completion-title { font-family:'Poppins',sans-serif; font-size:2rem; font-weight:700; color:#10D451; }
    .completion-sub { font-size:.9rem; color:rgb(var(--text-muted)); max-width:400px; line-height:1.6; }
    .completion-xp { font-family:'Poppins',sans-serif; font-size:1.5rem; color:#ffb800; font-weight:700; }
    .completion-btn { padding:12px 36px; background:#10D451; border:none; border-radius:0.75rem; color:#fff; font-family:'Poppins',sans-serif; font-size:1rem; font-weight:600; cursor:pointer; transition:.2s; margin-top:8px; }
    .completion-btn:hover { opacity:.88; }
    .completion-btn-sec { padding:12px 36px; background:transparent; color:rgb(var(--text)); border:1px solid rgb(var(--line)); border-radius:0.75rem; font-family:'Poppins',sans-serif; font-size:1rem; font-weight:500; cursor:pointer; margin-top:8px; transition:.2s; }
    .completion-btn-sec:hover { border-color:rgba(16,212,81,0.4); color:#10D451; }
    @media(max-width:860px){.sim-root{grid-template-columns:1fr;grid-template-rows:56px auto 1fr auto;grid-template-areas:"hud""nav""scene""log";}.sim-nav{flex-direction:row;flex-wrap:wrap;padding:12px;border-right:none;border-bottom:1px solid rgb(var(--line));}.log-panel{max-height:160px;}.glpi-body{grid-template-columns:1fr;}.glpi-sidebar{display:none;}.form-row{grid-template-columns:1fr;}.hud-center{display:none;}}
    @media(max-width:400px){.hud-training{display:none;}.hud-brand{font-size:.82rem;}.scene{padding:14px!important;}.ticket-table-scroll{overflow-x:auto;}}
  `

  return (
    <>
      <style>{css}</style>

      <div className="sim-root">

        {/* ══ HUD ══ */}
        <header className="hud">
          <div className="hud-brand">{mission.title}<span className="hud-training"> / {t('mission_sim.training')}</span></div>
          <div className="hud-center">
            <div className="hud-mission">🎯 {(mission.category || mission.description).slice(0, 60)}</div>
            <div className="hud-timer">{formatTimer(timerSeconds)}</div>
          </div>
          <div className="hud-right">
            <div className="xp-bar-wrap">
              <span style={{ fontSize:'.78rem', fontWeight:700 }}>{xp} XP</span>
              <div className="xp-track">
                <motion.div
                  className="xp-fill"
                  initial={false}
                  animate={{ width:`${xpPct}%` }}
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 20 }}
                  style={{ boxShadow: '0 0 8px rgba(16,212,81,0.7)' }}
                />
              </div>
              <span style={{ fontSize:'.7rem', color:'#5a7f8f' }}>{xpTarget}</span>
            </div>
            <div className="step-badge">{t('mission_sim.step_word')} {currentStep + 1}/{STEPS.length}</div>
          </div>
        </header>

        {/* ══ NAV ══ */}
        <nav className="sim-nav">
          <div className="nav-label">{t('mission_sim.mission_label', { title: mission.title })}</div>
          {STEPS.map((s, i) => {
            const clickable = i <= currentStep
            return (
              <motion.button
                key={s.id}
                className={`nav-btn ${i < currentStep ? 'done' : i === currentStep ? 'active' : 'locked'}`}
                onClick={() => clickable && goStep(i)}
                whileHover={clickable && !reduce ? { x: 3 } : undefined}
                whileTap={clickable && !reduce ? { scale: 0.97 } : undefined}
                transition={{ type: 'spring', stiffness: 400, damping: 26 }}
              >
                <span>{s.icon}</span> {t(`mission_sim.steps.${s.id}`)}
                {i < currentStep && <span style={{ position:'absolute', right:10, fontSize:'.75rem', color:'#10D451' }}>✓</span>}
                {i > currentStep && <span style={{ position:'absolute', right:8, fontSize:'.7rem' }}>🔒</span>}
              </motion.button>
            )
          })}
          <div style={{ flex:1 }} />
          <div className="nav-label">{t('mission_sim.system')}</div>
          <button className="nav-btn" onClick={() => navigate('/admin/missions')} style={{ fontSize:'.8rem' }}>
            <span>←</span> {t('mission_sim.nav_back')}
          </button>
        </nav>

        {/* ══ SCENE ══ */}
        <main className="scene">

          {/* Mission header — transiciona al cambiar de paso */}
          <div className="mission-header">
            <div className="mission-tag">{t('mission_sim.sim_active')}</div>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={reduce ? false : { opacity: 0, y: 12, filter: 'blur(4px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={reduce ? undefined : { opacity: 0, y: -8, filter: 'blur(4px)' }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <h1 className="mission-title-h">{title}</h1>
                <p className="mission-desc-p">{desc}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Checkpoints */}
          <div className="cp-strip">
            {STEPS.map((s, i) => (
              <Fragment key={s.id}>
                {i > 0 && <div className={`cp-line${i <= currentStep ? ' done-line' : ''}`} />}
                <div className="cp-item">
                  <motion.div
                    className={`cp-dot${i < currentStep ? ' done' : i === currentStep ? ' active' : ''}`}
                    initial={false}
                    animate={reduce ? undefined : (i < currentStep ? { scale: [1, 1.3, 1] } : { scale: 1 })}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {i < currentStep ? '✓' : i + 1}
                  </motion.div>
                  <div className={`cp-label${i < currentStep ? ' done-lbl' : i === currentStep ? ' active-lbl' : ''}`}>{t(`mission_sim.steps.${s.id}`)}</div>
                </div>
              </Fragment>
            ))}
          </div>

          {/* ══ STEP 0: BRIEFING ══ */}
          <div className={`step-panel${currentStep === 0 ? ' active' : ''}`}>
            <div className="info-card">
              <div className="info-card-hdr">
                <div className="info-card-icon icon-aqua">📋</div>
                <div>
                  <div className="info-card-title">{t('mission_sim.briefing.situation_title')}</div>
                  <div className="info-card-subtitle">{t('mission_sim.briefing.situation_sub')}</div>
                </div>
              </div>
              <p style={{ fontSize:'.83rem', color:'rgb(var(--text-muted))', lineHeight:1.7, marginBottom:14 }}>
                {t('mission_sim.briefing.p_a')}<strong style={{ color:'#ffb800' }}>{t('mission_sim.briefing.p_bold')}</strong>{t('mission_sim.briefing.p_b')}
              </p>
              <div className="info-list">
                {[
                  ['🎯', t('mission_sim.briefing.item_mission_label'), t('mission_sim.briefing.item_mission_desc')],
                  ['📍', t('mission_sim.briefing.item_airport_label'), t('mission_sim.briefing.item_airport_desc')],
                  ['🚨', t('mission_sim.briefing.item_type_label'), t('mission_sim.briefing.item_type_desc')],
                  ['⏱️', t('mission_sim.briefing.item_sla_label'), t('mission_sim.briefing.item_sla_desc')],
                ].map(([dot, label, d]) => (
                  <div key={label} className="info-item">
                    <span>{dot}</span>
                    <div><span className="info-item-label">{label}</span> <span className="info-item-desc">{d}</span></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="info-card" style={{ borderColor:'rgba(255,184,0,0.2)' }}>
              <div className="info-card-hdr">
                <div className="info-card-icon icon-amber">📖</div>
                <div>
                  <div className="info-card-title">{t('mission_sim.briefing.learn_title')}</div>
                  <div className="info-card-subtitle">{t('mission_sim.briefing.learn_sub')}</div>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:'.78rem' }}>
                {[t('mission_sim.briefing.learn_1'),t('mission_sim.briefing.learn_2'),t('mission_sim.briefing.learn_3'),t('mission_sim.briefing.learn_4'),t('mission_sim.briefing.learn_5'),t('mission_sim.briefing.learn_6')].map(item => (
                  <div key={item} style={{ padding:8, background:'rgba(255,255,255,0.03)', borderRadius:6, color:'rgb(var(--text-muted))' }}>{item}</div>
                ))}
              </div>
            </div>
            <motion.button className="next-btn" onClick={() => { markStepDone(0, 20); nextStep() }} whileHover={reduce ? undefined : { scale: 1.03, y: -1 }} whileTap={reduce ? undefined : { scale: 0.97 }} transition={{ type: 'spring', stiffness: 400, damping: 24 }}>{t('mission_sim.briefing.start_btn')}</motion.button>
          </div>

          {/* ══ STEP 1: LOGIN ══ */}
          <div className={`step-panel${currentStep === 1 ? ' active' : ''}`}>
            <div className="info-card" style={{ borderColor:'rgba(255,184,0,0.2)', padding:'12px 16px' }}>
              <p style={{ fontSize:'.78rem', color:'#ffb800' }}><strong>{t('mission_sim.instruction_word')}</strong> {t('mission_sim.login.instruction')}</p>
            </div>
            <div className="glpi-screen">
              <div className="glpi-topbar">
                <div className="browser-dots"><div className="dot-r"/><div className="dot-y"/><div className="dot-g"/></div>
                <div className="browser-url">https://glpi.amadeus.aeropuerto.mx/</div>
              </div>
              <div style={{ background:'#f9fafb', padding:'40px 30px', display:'flex', flexDirection:'column', alignItems:'center', gap:18, minHeight:380 }}>
                <div style={{ textAlign:'center', marginBottom:10 }}>
                  <div style={{ fontSize:'2rem', fontWeight:800, color:'#111827', letterSpacing:-1 }}>GLPI</div>
                  <div style={{ fontSize:'.8rem', color:'#6b7280', marginTop:4 }}>{t('mission_sim.login.sign_in_account')}</div>
                </div>
                <div style={{ width:'100%', maxWidth:340, display:'flex', flexDirection:'column', gap:14 }}>
                  <div>
                    <label style={{ fontSize:'.72rem', color:'#374151', fontWeight:500, display:'block', marginBottom:4 }}>{t('mission_sim.login.user_label')}</label>
                    <input
                      type="text" placeholder={t('mission_sim.login.user_placeholder')}
                      value={loginUser} onChange={e => setLoginUser(e.target.value)}
                      disabled={loginDone}
                      className={loginShake === 'user' ? 'form-select incorrect' : 'form-select'}
                      style={{ background:'white', color:'#111827', border:`1px solid ${loginShake==='user'?'#dc2626':'#d1d5db'}` }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize:'.72rem', color:'#374151', fontWeight:500, display:'block', marginBottom:4 }}>{t('mission_sim.login.pass_label')}</label>
                    <input
                      type="password" placeholder="••••••••"
                      value={loginPass} onChange={e => setLoginPass(e.target.value)}
                      disabled={loginDone}
                      className={loginShake === 'pass' ? 'form-select incorrect' : 'form-select'}
                      style={{ background:'white', color:'#111827', border:`1px solid ${loginShake==='pass'?'#dc2626':'#d1d5db'}` }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize:'.72rem', color:'#374151', fontWeight:500, display:'block', marginBottom:4 }}>{t('mission_sim.login.origin_label')} <span style={{ color:'#dc2626' }}>*</span></label>
                    <select
                      value={loginOrigin} onChange={e => setLoginOrigin(e.target.value)}
                      disabled={loginDone}
                      className={loginShake === 'origin' ? 'form-select incorrect' : 'form-select'}
                      style={{ background:'white', color:'#374151', border:`1px solid ${loginShake==='origin'?'#dc2626':'#d1d5db'}` }}
                    >
                      <option value="">{t('mission_sim.login.select')}</option>
                      <option value="ldap">{t('mission_sim.login.opt_ldap')}</option>
                      <option value="db_interna">{t('mission_sim.login.opt_db')}</option>
                      <option value="sso">{t('mission_sim.login.opt_sso')}</option>
                    </select>
                  </div>
                  <button
                    onClick={handleLogin}
                    disabled={loginDone}
                    style={{ width:'100%', padding:11, background:loginDone?'linear-gradient(135deg,#059669,#10b981)':'linear-gradient(135deg,#1d4ed8,#2563eb)', color:'white', border:'none', borderRadius:5, fontWeight:600, fontSize:'.85rem', cursor:loginDone?'default':'pointer' }}
                  >
                    {loginDone ? t('mission_sim.login.granted') : t('mission_sim.login.sign_in')}
                  </button>
                </div>
              </div>
            </div>
            {loginDone && (
              <div className="glpi-screen" style={{ marginTop:16, opacity:1, animation:'fadeSlide .5s ease' }}>
                <div className="glpi-topbar">
                  <div className="browser-dots"><div className="dot-r"/><div className="dot-y"/><div className="dot-g"/></div>
                  <div className="browser-url">https://glpi.amadeus.aeropuerto.mx/front/central.php</div>
                </div>
                <div className="glpi-body">
                  <div className="glpi-sidebar">
                    <div className="glpi-logo">GLPI</div>
                    {[t('mission_sim.login.menu_activos'),t('mission_sim.login.menu_asistencia'),t('mission_sim.login.menu_gestion'),t('mission_sim.login.menu_herramientas'),t('mission_sim.login.menu_config')].map(m => (
                      <div key={m} className="glpi-menu-item">{m}</div>
                    ))}
                  </div>
                  <div className="glpi-content">
                    <div className="glpi-breadcrumb">{t('mission_sim.login.home')}</div>
                    <div style={{ fontSize:'1.1rem', fontWeight:600, color:'#f9fafb', marginBottom:18 }}>{t('mission_sim.login.main_panel')}</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                      {[t('mission_sim.login.planning'),t('mission_sim.login.reminders')].map(card => (
                        <div key={card} style={{ background:'#f3f4f6', borderRadius:8, padding:14, fontSize:'.75rem', color:'#6b7280' }}>
                          <div style={{ fontWeight:600, color:'#111827', marginBottom:6 }}>{card}</div>
                          <div style={{ color:'#9ca3af', fontSize:'.7rem' }}>{t('mission_sim.login.no_items')}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {stepDone[1] && <motion.button className="next-btn" onClick={nextStep} whileHover={reduce ? undefined : { scale: 1.03, y: -1 }} whileTap={reduce ? undefined : { scale: 0.97 }} transition={{ type: 'spring', stiffness: 400, damping: 24 }}>{t('mission_sim.next_btn')}</motion.button>}
          </div>

          {/* ══ STEP 2: CREAR CASO ══ */}
          <div className={`step-panel${currentStep === 2 ? ' active' : ''}`}>
            <div className="info-card" style={{ borderColor:'rgba(255,184,0,0.2)', padding:'12px 16px' }}>
              <p style={{ fontSize:'.78rem', color:'#ffb800' }}><strong>{t('mission_sim.instruction_word')}</strong> {t('mission_sim.crear.instruction_a')}<strong>{t('mission_sim.crear.instruction_asistencia')}</strong>{t('mission_sim.crear.instruction_b')}<strong>{t('mission_sim.crear.instruction_catalog')}</strong>{t('mission_sim.crear.instruction_c')}<strong>{t('mission_sim.crear.instruction_amadeus')}</strong>{t('mission_sim.crear.instruction_d')}</p>
            </div>
            <div className="glpi-screen">
              <div className="glpi-topbar">
                <div className="browser-dots"><div className="dot-r"/><div className="dot-y"/><div className="dot-g"/></div>
                <div className="browser-url">{formVisible ? 'glpi.amadeus.aeropuerto.mx / Reporte_Amadeus' : catalogVisible ? 'glpi.amadeus.aeropuerto.mx/front/servicecatalog.php' : 'glpi.amadeus.aeropuerto.mx/front/central.php'}</div>
              </div>
              <div className="glpi-body">
                <div className="glpi-sidebar">
                  <div className="glpi-logo">GLPI</div>
                  <div className="glpi-menu-item" onClick={() => { showToast(t('mission_sim.toast.first_asistencia'),'info') }}>{t('mission_sim.login.menu_activos')}</div>
                  <div className={`glpi-menu-item${menuOpen?' gm-active':' gm-highlight'}`} onClick={() => { setMenuOpen(true); showToast(t('mission_sim.toast.now_catalog'),'info'); addLog(t('mission_sim.log.nav_asistencia'),'new') }}>{t('mission_sim.login.menu_asistencia')} ▾</div>
                  {menuOpen && (
                    <>
                      <div className="glpi-menu-item" style={{ paddingLeft:24 }}>{t('mission_sim.crear.casos')}</div>
                      <div className="glpi-menu-item" style={{ paddingLeft:24 }}>{t('mission_sim.crear.crear_ticket')}</div>
                      <div className={`glpi-menu-item${catalogVisible?' gm-active':' gm-highlight'}`} style={{ paddingLeft:24 }} onClick={() => { setCatalogVisible(true); showToast(t('mission_sim.toast.catalog_open'),'ok'); addLog(t('mission_sim.log.catalog_open'),'ok') }}>{t('mission_sim.crear.service_catalog_link')}</div>
                    </>
                  )}
                  <div className="glpi-menu-item">{t('mission_sim.login.menu_gestion')}</div>
                  <div className="glpi-menu-item">{t('mission_sim.login.menu_herramientas')}</div>
                </div>
                <div className="glpi-content">
                  <div className="glpi-breadcrumb">{t('mission_sim.login.home')} {menuOpen&&<>/ <span>{t('mission_sim.crear.instruction_asistencia')}</span></>} {catalogVisible&&<>/ <span>{t('mission_sim.crear.service_catalog')}</span></>}</div>
                  {!catalogVisible && <p style={{ fontSize:'.75rem', color:'#9ca3af' }}>{t('mission_sim.crear.select_asistencia_hint')}</p>}
                  {catalogVisible && !formVisible && (
                    <div style={{ marginTop:14 }}>
                      <div style={{ fontSize:'1rem', fontWeight:600, color:'#f9fafb', margin:'10px 0 16px' }}>{t('mission_sim.crear.service_catalog')}</div>
                      <div
                        onClick={() => { setFormVisible(true); addLog(t('mission_sim.log.amadeus_selected'),'ok'); showToast(t('mission_sim.toast.form_open'),'ok'); markStepDone(2, 30) }}
                        style={{ display:'inline-flex', alignItems:'center', gap:12, padding:'14px 18px', background:'#1f2937', border:'2px solid #3b82f6', borderRadius:8, cursor:'pointer', maxWidth:260 }}
                      >
                        <div style={{ width:42, height:42, background:'#374151', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'1.2rem' }}>📋</div>
                        <div>
                          <div style={{ fontWeight:600, fontSize:'.85rem', color:'#f9fafb' }}>Reporte_Amadeus</div>
                          <div style={{ fontSize:'.65rem', color:'#9ca3af', marginTop:2 }}>{t('mission_sim.crear.amadeus_desc')}</div>
                        </div>
                      </div>
                    </div>
                  )}
                  {formVisible && (
                    <div style={{ marginTop:16 }}>
                      <div style={{ background:'#10b981', color:'#fff', fontSize:'.75rem', fontWeight:600, padding:'8px 14px', borderRadius:6, display:'inline-block', margin:'10px 0' }}>
                        {t('mission_sim.crear.form_opened')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {stepDone[2] && <motion.button className="next-btn" onClick={nextStep} whileHover={reduce ? undefined : { scale: 1.03, y: -1 }} whileTap={reduce ? undefined : { scale: 0.97 }} transition={{ type: 'spring', stiffness: 400, damping: 24 }}>{t('mission_sim.next_btn')}</motion.button>}
          </div>

          {/* ══ STEP 3: CAMPOS ══ */}
          <div className={`step-panel${currentStep === 3 ? ' active' : ''}`}>
            <div className="info-card" style={{ borderColor:'rgba(255,184,0,0.2)', padding:'12px 16px' }}>
              <p style={{ fontSize:'.78rem', color:'#ffb800' }}><strong>{t('mission_sim.instruction_word')}</strong> {t('mission_sim.campos.instruction')}</p>
            </div>
            <div style={{ display:'flex', gap:16, flexWrap:'wrap', alignItems:'flex-start' }}>
              <div style={{ background:'linear-gradient(135deg,#fffbeb,#fef3c7)', color:'#1c1917', borderRadius:8, padding:14, width:160, boxShadow:'3px 3px 0 rgba(0,0,0,0.3)', fontSize:'.7rem' }}>
                <div style={{ fontSize:'.55rem', fontWeight:700, color:'#dc2626', letterSpacing:1, textTransform:'uppercase', border:'1.5px solid #dc2626', display:'inline-block', padding:'1px 5px', borderRadius:2, marginBottom:6 }}>{t('mission_sim.campos.urgent')}</div>
                <div style={{ fontWeight:700, color:'#92400e', marginBottom:4 }}>{t('mission_sim.campos.field_report')}</div>
                {[[t('mission_sim.campos.fr_place'),t('mission_sim.campos.fr_place_v')],[t('mission_sim.campos.fr_system'),t('mission_sim.campos.fr_system_v')],[t('mission_sim.campos.fr_who'),t('mission_sim.campos.fr_who_v')],[t('mission_sim.campos.fr_fail'),t('mission_sim.campos.fr_fail_v')],[t('mission_sim.campos.fr_impact'),t('mission_sim.campos.fr_impact_v')]].map(([k,v]) => (
                  <div key={k} style={{ color:'#57534e', marginBottom:2 }}><strong style={{ color:'#1c1917' }}>{k}</strong> {v}</div>
                ))}
              </div>
              <div className="glpi-screen" style={{ flex:1, minWidth:280 }}>
                <div className="glpi-topbar">
                  <div className="browser-dots"><div className="dot-r"/><div className="dot-y"/><div className="dot-g"/></div>
                  <div className="browser-url">glpi.amadeus.aeropuerto.mx / Reporte_Amadeus</div>
                </div>
                <div style={{ padding:'20px 24px', background:'#f9fafb' }}>
                  <div style={{ fontSize:'1rem', fontWeight:700, color:'#111827', marginBottom:16 }}>Reporte_Amadeus</div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">{t('mission_sim.campos.type_label')} <span style={{ color:'#f59e0b' }}>*</span></label>
                      <select className={`form-select${fTipo&&fTipo!=='incidente'?' incorrect':fTipo==='incidente'?' correct':''}`} value={fTipo} onChange={e => setFTipo(e.target.value)} disabled={!!submitResult}>
                        <option value="">-----</option>
                        <option value="incidente">{t('mission_sim.campos.type_inc')}</option>
                        <option value="solicitud">{t('mission_sim.campos.type_sol')}</option>
                      </select>
                      {fieldErrors.tipo && <div className="field-err">{fieldErrors.tipo}</div>}
                      <div style={{ fontSize:'.65rem', color:'#9ca3af', marginTop:3 }}>{t('mission_sim.campos.type_hint')}</div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('mission_sim.campos.airport_label')} <span style={{ color:'#f59e0b' }}>*</span></label>
                      <select className={`form-select${fAeropuerto&&fAeropuerto!=='NLU'?' incorrect':fAeropuerto==='NLU'?' correct':''}`} value={fAeropuerto} onChange={e => setFAeropuerto(e.target.value)} disabled={!!submitResult}>
                        <option value="">-----</option>
                        <option value="NLU">» NLU — Felipe Ángeles</option>
                        <option value="PXM">» PXM — Puerto Escondido</option>
                        <option value="SLW">» SLW — Plan de Guadalupe</option>
                        <option value="TPQ">» TPQ — Tepic</option>
                      </select>
                      {fieldErrors.aeropuerto && <div className="field-err">{fieldErrors.aeropuerto}</div>}
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">{t('mission_sim.campos.reported_label')} <span style={{ color:'#f59e0b' }}>*</span></label>
                      <select className={`form-select${fReportado&&fReportado!=='aerolinea'?' incorrect':fReportado==='aerolinea'?' correct':''}`} value={fReportado} onChange={e => setFReportado(e.target.value)} disabled={!!submitResult}>
                        <option value="">-----</option>
                        <option value="aerolinea">{t('mission_sim.campos.reported_airline')}</option>
                        <option value="aeropuerto">{t('mission_sim.campos.reported_airport')}</option>
                        <option value="proveedor">{t('mission_sim.campos.reported_provider')}</option>
                      </select>
                      {fieldErrors.reportado && <div className="field-err">{fieldErrors.reportado}</div>}
                    </div>
                    <div className="form-group">
                      <label className="form-label">{t('mission_sim.campos.category_label')} <span style={{ color:'#f59e0b' }}>*</span></label>
                      <select className={`form-select${fCategoria&&fCategoria!=='software'?' incorrect':fCategoria==='software'?' correct':''}`} value={fCategoria} onChange={e => setFCategoria(e.target.value)} disabled={!!submitResult}>
                        <option value="">-----</option>
                        <option value="hardware">{t('mission_sim.campos.cat_hardware')}</option>
                        <option value="software">{t('mission_sim.campos.cat_software')}</option>
                        <option value="mixta">{t('mission_sim.campos.cat_mixed')}</option>
                      </select>
                      {fieldErrors.categoria && <div className="field-err">{fieldErrors.categoria}</div>}
                      <div style={{ fontSize:'.65rem', color:'#9ca3af', marginTop:3 }}>{t('mission_sim.campos.cat_hint')}</div>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('mission_sim.campos.inctype_label')} <span style={{ color:'#f59e0b' }}>*</span></label>
                    <select className={`form-select${fTipoInc&&fTipoInc!=='falla_critica'?' incorrect':fTipoInc==='falla_critica'?' correct':''}`} value={fTipoInc} onChange={e => setFTipoInc(e.target.value)} disabled={!!submitResult}>
                      <option value="">-----</option>
                      <option value="error_integracion">{t('mission_sim.campos.inc_integration')}</option>
                      <option value="error_funcional">{t('mission_sim.campos.inc_functional')}</option>
                      <option value="falla_critica">{t('mission_sim.campos.inc_critical')}</option>
                      <option value="lentitud">{t('mission_sim.campos.inc_slow')}</option>
                    </select>
                    {fieldErrors.tipo_inc && <div className="field-err">{fieldErrors.tipo_inc}</div>}
                    <div style={{ fontSize:'.65rem', color:'#9ca3af', marginTop:3 }}>{t('mission_sim.campos.inctype_hint')}</div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('mission_sim.campos.desc_label')} <span style={{ color:'#f59e0b' }}>*</span></label>
                    <textarea
                      className={`form-textarea${fieldErrors.desc?' incorrect':''}`}
                      placeholder={t('mission_sim.campos.desc_placeholder')}
                      value={fDesc} onChange={e => setFDesc(e.target.value)}
                      disabled={!!submitResult}
                      style={{ minHeight:70, resize:'vertical', lineHeight:1.5 }}
                    />
                  </div>
                  {!submitResult && (
                    <div style={{ display:'flex', justifyContent:'flex-end', marginTop:8 }}>
                      <button className="glpi-submit-btn" onClick={validateForm}>{t('mission_sim.campos.submit')}</button>
                    </div>
                  )}
                  {submitResult && (
                    <div style={{ marginTop:16, background:'#ecfdf5', border:'1px solid #6ee7b7', borderRadius:8, padding:16, textAlign:'center' }}>
                      <div style={{ fontSize:'1.5rem', marginBottom:6 }}>✅</div>
                      <div style={{ fontWeight:700, color:'#065f46', fontSize:'.9rem' }}>{t('mission_sim.campos.sent_title')}</div>
                      <div style={{ fontSize:'.75rem', color:'#6b7280', margin:'4px 0 10px' }}>{t('mission_sim.campos.sent_sub')}</div>
                      <div style={{ fontSize:'.75rem', color:'#374151' }}>{t('mission_sim.campos.ticket_assigned')} <strong style={{ color:'#1d4ed8' }}>#{submitResult}</strong></div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {stepDone[3] && <motion.button className="next-btn" onClick={nextStep} whileHover={reduce ? undefined : { scale: 1.03, y: -1 }} whileTap={reduce ? undefined : { scale: 0.97 }} transition={{ type: 'spring', stiffness: 400, damping: 24 }}>{t('mission_sim.next_btn')}</motion.button>}
          </div>

          {/* ══ STEP 4: SEGUIMIENTO ══ */}
          <div className={`step-panel${currentStep === 4 ? ' active' : ''}`}>
            <div className="info-card" style={{ borderColor:'rgba(255,184,0,0.2)', padding:'12px 16px' }}>
              <p style={{ fontSize:'.78rem', color:'#ffb800' }}><strong>{t('mission_sim.instruction_word')}</strong> {t('mission_sim.seguimiento.instruction_a')}<strong>{t('mission_sim.seguimiento.instruction_bold')}</strong>{t('mission_sim.seguimiento.instruction_b')}</p>
            </div>
            <div className="glpi-screen">
              <div className="glpi-topbar">
                <div className="browser-dots"><div className="dot-r"/><div className="dot-y"/><div className="dot-g"/></div>
                <div className="browser-url">glpi.amadeus.aeropuerto.mx / Asistencia / Casos</div>
              </div>
              <div style={{ padding:'16px 20px', background:'#f9fafb' }}>
                <div className="glpi-breadcrumb" style={{ color:'#6b7280' }}>{t('mission_sim.login.home')} / <span>{t('mission_sim.crear.instruction_asistencia')}</span> / <span>{t('mission_sim.seguimiento.cases')}</span></div>
                <div className="ticket-table-scroll">
                <table className="ticket-table">
                  <thead>
                    <tr>{[t('mission_sim.seguimiento.th_id'),t('mission_sim.seguimiento.th_title'),t('mission_sim.seguimiento.th_airport'),t('mission_sim.seguimiento.th_status'),t('mission_sim.seguimiento.th_lastmod'),t('mission_sim.seguimiento.th_priority'),t('mission_sim.seguimiento.th_requester')].map(h => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr className="ticket-row" style={{ animation:'fadeSlide .5s ease' }} onClick={() => { setTicketDetailVisible(true); markStepDone(4, 50); addLog(t('mission_sim.log.opening_ticket'),'new') }}>
                      <td style={{ color:'#60a5fa', fontWeight:600, fontSize:'.7rem' }}>#823</td>
                      <td><div style={{ color:'#fbbf24', fontWeight:600, fontSize:'.72rem' }}>{t('mission_sim.seguimiento.r1_title')}</div><div style={{ fontSize:'.62rem', color:'#9ca3af' }}>{t('mission_sim.seguimiento.r1_sub')}</div></td>
                      <td style={{ fontSize:'.7rem', color:'#9ca3af' }}>NLU</td>
                      <td><span className="status-dot s-assigned">{t('mission_sim.seguimiento.r1_status')}</span></td>
                      <td style={{ fontSize:'.65rem', color:'#9ca3af' }}>2026-02-16 15:12</td>
                      <td><span className="p-badge p-alto">{t('mission_sim.seguimiento.prio_high')}</span></td>
                      <td style={{ fontSize:'.7rem', color:'#e5e7eb' }}>Hernandez G.</td>
                    </tr>
                    {[['#796',t('mission_sim.seguimiento.r2_title'),'NLU','s-waiting',t('mission_sim.seguimiento.r2_status'),'2026-02-16 14:52','p-alto',t('mission_sim.seguimiento.prio_high'),'Mancilla M.'],
                      ['#747',t('mission_sim.seguimiento.r3_title'),'PXM','s-waiting',t('mission_sim.seguimiento.r2_status'),'2026-02-16 07:51','p-medio',t('mission_sim.seguimiento.prio_medium'),'Esmeralda S.'],
                      ['#644',t('mission_sim.seguimiento.r4_title'),'NLU','s-new',t('mission_sim.seguimiento.status_new'),'2026-02-05 11:42','p-bajo',t('mission_sim.seguimiento.prio_low'),'Granados L.']
                    ].map(([id,title,aero,sClass,sLabel,date,pClass,pLabel,sol]) => (
                      <tr key={id} className="ticket-row" onClick={() => showToast(t('mission_sim.toast.click_yellow'),'info')}>
                        <td style={{ color:'#60a5fa', fontWeight:600, fontSize:'.7rem' }}>{id}</td>
                        <td><div style={{ fontSize:'.72rem', color:'#e5e7eb' }}>{title}</div></td>
                        <td style={{ fontSize:'.7rem', color:'#9ca3af' }}>{aero}</td>
                        <td><span className={`status-dot ${sClass}`}>● {sLabel}</span></td>
                        <td style={{ fontSize:'.65rem', color:'#9ca3af' }}>{date}</td>
                        <td><span className={`p-badge ${pClass}`}>{pLabel}</span></td>
                        <td style={{ fontSize:'.7rem', color:'#e5e7eb' }}>{sol}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
            {ticketDetailVisible && (
              <div className="glpi-screen">
                <div className="glpi-topbar">
                  <div className="browser-dots"><div className="dot-r"/><div className="dot-y"/><div className="dot-g"/></div>
                  <div className="browser-url">glpi / Asistencia / Casos / NLU-COUNTER 13,16 (823)</div>
                </div>
                <div style={{ padding:'18px 22px', background:'#f9fafb' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
                    <span style={{ width:10, height:10, borderRadius:'50%', background:'#10b981', display:'inline-block' }} />
                    <span style={{ fontWeight:700, color:'#111827', fontSize:'.9rem' }}>{t('mission_sim.seguimiento.detail_title')}</span>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
                    <div style={{ background:'white', border:'1px solid #e5e7eb', borderRadius:8, padding:'12px 14px' }}>
                      <div style={{ fontSize:'.65rem', color:'#9ca3af', marginBottom:4 }}>{t('mission_sim.seguimiento.created_by')} <strong style={{ color:'#374151' }}>{t('mission_sim.seguimiento.created_name')}</strong></div>
                      <div style={{ fontSize:'.78rem', color:'#374151', lineHeight:1.5 }}>{t('mission_sim.seguimiento.detail_desc')}</div>
                    </div>
                    <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'12px 14px', alignSelf:'flex-end', maxWidth:'80%' }}>
                      <div style={{ fontSize:'.65rem', color:'#9ca3af', marginBottom:4 }}>{t('mission_sim.seguimiento.support_time')} <strong style={{ color:'#374151' }}>{t('mission_sim.seguimiento.support_name')}</strong></div>
                      <div style={{ fontSize:'.78rem', color:'#1e40af', lineHeight:1.5 }}>{t('mission_sim.seguimiento.support_msg')}</div>
                    </div>
                  </div>
                  {!validationFeedback && (
                    <div style={{ background:'#fef3c7', border:'1px solid #fcd34d', borderRadius:8, padding:14, marginBottom:12 }}>
                      <div style={{ fontWeight:600, color:'#92400e', fontSize:'.82rem', marginBottom:8 }}>{t('mission_sim.seguimiento.validation_title')}</div>
                      <div style={{ fontSize:'.75rem', color:'#78350f', marginBottom:10 }}>{t('mission_sim.seguimiento.validation_q')}</div>
                      <div style={{ display:'flex', gap:10 }}>
                        <button onClick={() => { setValidationFeedback({ type:'fail', msg:t('mission_sim.seguimiento.fb_fail') }); showToast(t('mission_sim.toast.reject_registered'),'info'); addLog(t('mission_sim.log.sol_rejected'),'warn') }} style={{ padding:'7px 18px', background:'white', border:'1px solid #ef4444', borderRadius:5, color:'#ef4444', fontSize:'.78rem', fontWeight:600, cursor:'pointer' }}>{t('mission_sim.seguimiento.reject')}</button>
                        <button onClick={() => { setValidationFeedback({ type:'ok', msg:t('mission_sim.seguimiento.fb_ok') }); showToast(t('mission_sim.toast.approve_ok'),'ok'); addLog(t('mission_sim.log.ticket_closed'),'ok') }} style={{ padding:'7px 18px', background:'#10b981', border:'none', borderRadius:5, color:'white', fontSize:'.78rem', fontWeight:600, cursor:'pointer' }}>{t('mission_sim.seguimiento.approve')}</button>
                      </div>
                    </div>
                  )}
                  {validationFeedback && (
                    <div className={`quiz-fb ${validationFeedback.type === 'ok' ? 'fb-ok' : 'fb-fail'}`}>{validationFeedback.msg}</div>
                  )}
                </div>
              </div>
            )}
            {stepDone[4] && <motion.button className="next-btn" onClick={nextStep} whileHover={reduce ? undefined : { scale: 1.03, y: -1 }} whileTap={reduce ? undefined : { scale: 0.97 }} transition={{ type: 'spring', stiffness: 400, damping: 24 }}>{t('mission_sim.next_btn')}</motion.button>}
          </div>

          {/* ══ STEP 5: SLA QUIZ ══ */}
          <div className={`step-panel${currentStep === 5 ? ' active' : ''}`}>
            <div className="info-card">
              <div className="info-card-hdr">
                <div className="info-card-icon icon-amber">⏱️</div>
                <div>
                  <div className="info-card-title">{t('mission_sim.sla.title')}</div>
                  <div className="info-card-subtitle">{t('mission_sim.sla.sub')}</div>
                </div>
              </div>
              <table className="sla-table">
                <thead><tr><th>{t('mission_sim.sla.th_impact')}</th><th>{t('mission_sim.sla.th_response')}</th><th>{t('mission_sim.sla.th_solution')}</th></tr></thead>
                <tbody>
                  <tr><td className="sla-alto">{t('mission_sim.sla.high')}</td><td><strong>{t('mission_sim.sla.min5')}</strong></td><td>{t('mission_sim.sla.h24')}</td></tr>
                  <tr><td className="sla-medio">{t('mission_sim.sla.medium')}</td><td><strong>{t('mission_sim.sla.min15')}</strong></td><td>{t('mission_sim.sla.h24')}</td></tr>
                  <tr><td className="sla-bajo">{t('mission_sim.sla.low')}</td><td><strong>{t('mission_sim.sla.min15')}</strong></td><td>{t('mission_sim.sla.h24')}</td></tr>
                </tbody>
              </table>
            </div>
            {QUIZ_KEYS.map((item, qIdx) => (
              <div key={item.key} className="quiz-card">
                <div className="quiz-q">{t(`mission_sim.quiz.${item.key}.q`)}</div>
                <div className="quiz-options">
                  {QUIZ_OPT_IDS.map(optId => {
                    const answered = quizAnswers[qIdx] !== undefined
                    const isCorrect = item.correct === optId
                    const chosenWrong = answered && quizChosen[qIdx] === optId && !isCorrect
                    let cls = 'quiz-opt'
                    if (answered) {
                      if (isCorrect) cls += ' opt-correct'
                      else if (chosenWrong) cls += ' opt-wrong'
                      else cls += ' opt-disabled'
                    }
                    return (
                      <motion.button
                        key={optId}
                        className={cls}
                        onClick={() => answerQuiz(qIdx, optId)}
                        whileHover={!answered && !reduce ? { scale: 1.015, x: 3 } : undefined}
                        whileTap={!answered && !reduce ? { scale: 0.97 } : undefined}
                        animate={
                          reduce
                            ? undefined
                            : isCorrect && answered
                              ? { scale: [1, 1.05, 1] }
                              : chosenWrong
                                ? { x: [0, -7, 7, -5, 5, 0] }
                                : undefined
                        }
                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <span className="opt-letter">{optId.toUpperCase()}</span>
                        {t(`mission_sim.quiz.${item.key}.${optId}`)}
                      </motion.button>
                    )
                  })}
                </div>
                <AnimatePresence>
                  {quizAnswers[qIdx] !== undefined && (
                    <motion.div
                      className={`quiz-fb ${quizAnswers[qIdx] ? 'fb-ok' : 'fb-fail'}`}
                      initial={reduce ? false : { opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginTop: 14 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      style={{ overflow: 'hidden' }}
                    >
                      {quizAnswers[qIdx] ? t(`mission_sim.quiz.${item.key}.ok`) : t(`mission_sim.quiz.${item.key}.fail`)}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
            {stepDone[5] && <motion.button className="next-btn" onClick={nextStep} whileHover={reduce ? undefined : { scale: 1.03, y: -1 }} whileTap={reduce ? undefined : { scale: 0.97 }} transition={{ type: 'spring', stiffness: 400, damping: 24 }}>{t('mission_sim.sla.finish_btn')}</motion.button>}
          </div>

        </main>

        {/* ══ LOG ══ */}
        <aside className="log-panel">
          <div className="log-title">{t('mission_sim.log.title')}</div>
          {logs.map((l, i) => (
            <div key={i} className={`log-entry ${l.type}`}>
              <div className="log-time">{l.ts}</div>
              {l.msg}
            </div>
          ))}
        </aside>

      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key="toast"
            className={`toast-wrap t-${toast.type}`}
            initial={reduce ? false : { opacity: 0, x: 40, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: 40, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* XP Popup */}
      <AnimatePresence>
        {xpPopup && (
          <motion.div
            key={xpPopup.key}
            className="xp-popup"
            initial={reduce ? false : { opacity: 0, y: 8, scale: 0.8 }}
            animate={reduce ? { opacity: 1 } : { opacity: [0, 1, 1, 0], y: [8, -6, -26, -40], scale: [0.8, 1.15, 1, 1] }}
            transition={{ duration: 1.5, ease: 'easeOut', times: [0, 0.2, 0.8, 1] }}
          >
            +{xpPopup.val} XP
          </motion.div>
        )}
      </AnimatePresence>

      {/* Completion */}
      <AnimatePresence>
        {showCompletion && (
          <motion.div
            className="completion-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            {/* Confeti */}
            {!reduce && [...Array(22)].map((_, i) => {
              const angle = (i / 22) * 360
              const dist = 140 + Math.random() * 160
              const tx = Math.cos((angle * Math.PI) / 180) * dist
              const ty = Math.sin((angle * Math.PI) / 180) * dist
              const col = ['#10D451', '#ffb800', '#00d4e8', '#ff3b5c', '#a855f7'][i % 5]
              return (
                <motion.span
                  key={i}
                  style={{ position: 'absolute', top: '42%', left: '50%', width: 9, height: 9, borderRadius: i % 2 ? '50%' : 2, background: col }}
                  initial={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
                  animate={{ opacity: [1, 1, 0], x: tx, y: [0, ty, ty + 120], scale: [1, 1, 0.5], rotate: Math.random() * 720 - 360 }}
                  transition={{ duration: 1.6 + Math.random() * 0.6, ease: 'easeOut', delay: 0.1 + i * 0.02 }}
                />
              )
            })}

            <motion.div
              className="completion-icon"
              initial={reduce ? false : { scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.1 }}
            >🏆</motion.div>
            <motion.div className="completion-title"
              initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              {t('mission_sim.completion.title')}
            </motion.div>
            <motion.div className="completion-sub"
              initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.33 }}>
              {t('mission_sim.completion.sub')}
            </motion.div>
            <motion.div className="completion-xp"
              initial={reduce ? false : { opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.4 }}>
              <CountUpXP to={xp} reduce={reduce} /> / {xpTarget} XP
            </motion.div>
            <motion.div style={{ fontSize:'.8rem', color:'#5a7f8f' }}
              initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}>
              {t('mission_sim.completion.results', { correct: Object.values(quizAnswers).filter(Boolean).length, total: QUIZ_KEYS.length, time: formatTimer(timerSeconds) })}
            </motion.div>
            <motion.button className="completion-btn" onClick={() => window.location.reload()}
              initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.58 }}
              whileHover={reduce ? undefined : { scale: 1.04 }} whileTap={reduce ? undefined : { scale: 0.96 }}>
              {t('mission_sim.completion.repeat')}
            </motion.button>
            <motion.button className="completion-btn-sec" onClick={() => navigate('/admin/missions')}
              initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.64 }}
              whileHover={reduce ? undefined : { scale: 1.04 }} whileTap={reduce ? undefined : { scale: 0.96 }}>
              {t('mission_sim.completion.back')}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/* Contador que sube de 0 al XP final en la pantalla de completado. */
function CountUpXP({ to, reduce }: { to: number; reduce: boolean }) {
  const [v, setV] = useState(reduce ? to : 0)
  useEffect(() => {
    if (reduce) { setV(to); return }
    const controls = animate(0, to, {
      duration: 1.2,
      ease: [0.16, 1, 0.3, 1],
      delay: 0.4,
      onUpdate: (x) => setV(Math.round(x)),
    })
    return () => controls.stop()
  }, [to, reduce])
  return <>{v}</>
}