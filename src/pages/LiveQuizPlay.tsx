import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft, Check, X, Triangle, Circle, Square,
  Diamond, Volume2, VolumeX, Loader2, Star,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { toUtcMs } from '@/lib/datetime'
import { useAuth } from '@/hooks/useAuth'
import type { LiveQuiz, LiveQuizAnswer, QuizQuestion, QuizLeaderboardEntry } from '@/types/database'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ─── Motor de audio ─────────────────────────────────────────────────────────────
class QuizAudio {
  private ctx: AudioContext | null = null
  private _muted = false

  private ctx_() {
    if (this._muted) return null
    try {
      const AC = window.AudioContext ?? (window as unknown as Record<string, unknown>).webkitAudioContext as typeof AudioContext | undefined
      if (!this.ctx && AC) this.ctx = new AC()
      if (this.ctx?.state === 'suspended') void this.ctx.resume()
      return this.ctx
    } catch { return null }
  }

  private p(freq: number, t: number, dur: number, vol = 0.2, type: OscillatorType = 'sine') {
    const ctx = this.ctx_(); if (!ctx) return
    try {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime + t)
      g.gain.setValueAtTime(0, ctx.currentTime + t)
      g.gain.linearRampToValueAtTime(vol, ctx.currentTime + t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur)
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + dur + 0.05)
    } catch { /* AudioContext puede fallar en ciertos navegadores */ }
  }

  join()       { this.p(523, 0, 0.08, 0.22); this.p(784, 0.11, 0.2, 0.16) }
  start()      { [440, 554, 659, 880].forEach((f, i) => this.p(f, i * 0.15, 0.1, 0.2)) }
  question()   { this.p(440, 0, 0.05, 0.14); this.p(587, 0.08, 0.06, 0.1) }
  tap()        { this.p(660, 0, 0.05, 0.22) }
  correct()    { [523, 659, 784, 1047].forEach((f, i) => this.p(f, i * 0.1, 0.13, 0.22)) }
  wrong()      { this.p(294, 0, 0.1, 0.22, 'sawtooth'); this.p(220, 0.13, 0.22, 0.16, 'sawtooth') }
  tick()       { this.p(880, 0, 0.04, 0.07, 'square') }
  urgentTick() { this.p(1319, 0, 0.05, 0.12, 'square'); this.p(1760, 0.06, 0.04, 0.09, 'square') }
  board()      { [523, 587, 659, 784, 1047].forEach((f, i) => this.p(f, i * 0.09, 0.1, 0.18)) }
  podium()     { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.p(f, i * 0.12, 0.12, 0.2)) }

  toggle()     { this._muted = !this._muted; return this._muted }
  get muted()  { return this._muted }
}
const sfx = new QuizAudio()

// ─── Confeti ─────────────────────────────────────────────────────────────────
const CC = ['#10D451', '#3b82f6', '#fde68a', '#ef4444', '#a855f7', '#f97316', '#06b6d4']

function Confetti({ active }: { active: boolean }) {
  const ps = useMemo(() => Array.from({ length: 30 }, (_, i) => ({
    left: `${4 + (i * 3.22) % 92}%`,
    color: CC[i % 7],
    w: 5 + (i % 6), h: 6 + (i % 9),
    dur: 1.1 + (i % 5) * 0.2, delay: (i % 7) * 0.08,
    drift: -70 + (i * 31 % 140), rot: (i * 137 % 540) - 270,
    round: i % 4 === 0,
  })), [])
  if (!active) return null
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {ps.map((p, i) => (
        <motion.div
          key={i}
          style={{ position: 'fixed', left: p.left, top: 0, width: p.w, height: p.h, background: p.color, borderRadius: p.round ? '50%' : '2px' }}
          initial={{ y: -16, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: window.innerHeight + 40, x: p.drift, rotate: p.rot, opacity: [1, 1, 0.8, 0] }}
          transition={{ duration: p.dur, delay: p.delay, ease: 'easeIn' }}
        />
      ))}
    </div>
  )
}

// ─── Configuración de opciones ────────────────────────────────────────────────
const OPTS = [
  { label: 'A', Icon: Triangle, color: '#ef4444', dim: 'rgba(239,68,68,0.82)',  glow: 'rgba(239,68,68,0.55)' },
  { label: 'B', Icon: Diamond,  color: '#3b82f6', dim: 'rgba(59,130,246,0.82)', glow: 'rgba(59,130,246,0.55)' },
  { label: 'C', Icon: Circle,   color: '#eab308', dim: 'rgba(234,179,8,0.82)',  glow: 'rgba(234,179,8,0.55)' },
  { label: 'D', Icon: Square,   color: '#22c55e', dim: 'rgba(34,197,94,0.82)',  glow: 'rgba(34,197,94,0.55)' },
] as const

const MEDALS = ['#ca8a04', '#6b7280', '#b45309']

type Phase = 'join' | 'lobby' | 'question' | 'answered' | 'leaderboard' | 'ended'

// ─── Componente ────────────────────────────────────────────────────────────────
export default function LiveQuizPlay() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { profile } = useAuth()

  // Unirse
  const [phase, setPhase]         = useState<Phase>('join')
  const [pin, setPin]             = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joining, setJoining]     = useState(false)

  // Estado del quiz
  const [quiz, setQuiz]               = useState<LiveQuiz | null>(null)
  const [campaign, setCampaign]       = useState<{ name: string; logo_url: string | null } | null>(null)
  const [currentQ, setCurrentQ]       = useState<QuizQuestion | null>(null)
  const [questionIdx, setQuestionIdx] = useState(-1)
  const [myAnswer, setMyAnswer]       = useState<number | null>(null)
  const [isCorrect, setIsCorrect]     = useState<boolean | null>(null)
  const [myScore, setMyScore]         = useState(0)
  const [questionScore, setQuestionScore] = useState<number | null>(null)
  const [timeLeft, setTimeLeft]       = useState(0)
  const [submitting, setSubmitting]   = useState(false)
  const [participantCount, setParticipantCount] = useState(0)

  // Interfaz
  const [muted, setMuted]           = useState(false)
  const [showFlash, setShowFlash]   = useState(false)
  const [confetti, setConfetti]     = useState(false)
  const [leaderboard, setLeaderboard] = useState<QuizLeaderboardEntry[]>([])

  const channelRef    = useRef<RealtimeChannel | null>(null)
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const lbTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confettiTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shownAtRef    = useRef<number>(0)  // marca de tiempo (ms) de cuándo apareció la pregunta

  // ── Temporizador ──────────────────────────────────────────────────────────────
  const startTimer = useCallback((secs: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    shownAtRef.current = Date.now()
    setTimeLeft(secs)
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        const next = t - 1
        if (next <= 0) { clearInterval(timerRef.current!); return 0 }
        if (next <= 5) sfx.urgentTick()
        else if (next <= 10) sfx.tick()
        return next
      })
    }, 1000)
  }, [])

  // ── Clasificación ───────────────────────────────────────────────────────────
  const loadLeaderboard = useCallback(async (quizId: string) => {
    // Ruta principal: RPC SECURITY DEFINER que agrega POR USUARIO y devuelve el
    // ranking completo a cualquier participante (no depende de la RLS del aprendiz).
    const { data: rpc, error } = await supabase.rpc('get_live_quiz_leaderboard', { p_quiz_id: quizId })
    if (!error && rpc) { setLeaderboard(rpc as QuizLeaderboardEntry[]); return }

    // Respaldo por si el RPC aún no está desplegado: agregación en cliente por usuario.
    const { data } = await supabase
      .from('live_quiz_answers')
      .select('user_id, display_name, is_correct, score')
      .eq('quiz_id', quizId)
    if (!data) return
    const map = new Map<string, QuizLeaderboardEntry>()
    for (const row of data) {
      const key = row.user_id ?? row.display_name
      const e = map.get(key) ?? { user_id: row.user_id, display_name: row.display_name, correct: 0, total: 0, score: 0 }
      e.total++; if (row.is_correct) e.correct++
      e.score += (row as LiveQuizAnswer).score ?? 0
      e.display_name = row.display_name
      map.set(key, e)
    }
    setLeaderboard([...map.values()].sort((a, b) => b.score - a.score || b.correct - a.correct))
  }, [])

  // ── Máquina de estados ─────────────────────────────────────────────────────────
  const applyQuizState = useCallback((q: LiveQuiz, resetAnswer: boolean) => {
    setQuiz(q)
    if (q.status === 'ended') {
      setPhase('ended')
      if (timerRef.current) clearInterval(timerRef.current)
      void loadLeaderboard(q.id).then(() => sfx.podium())
      return
    }
    if (q.current_question < 0) { setPhase('lobby'); return }
    const question = q.questions[q.current_question]
    if (!question) return
    setCurrentQ(question)
    setQuestionIdx(q.current_question)
    if (!resetAnswer) return

    if (timerRef.current) clearInterval(timerRef.current)
    if (lbTimerRef.current) clearTimeout(lbTimerRef.current)

    if (q.current_question === 0) {
      // Primera pregunta — omitir flash de clasificación
      setMyAnswer(null); setIsCorrect(null); setQuestionScore(null)
      setPhase('question')
      startTimer(question.timeLimitSec)
      sfx.start()
    } else {
      void loadLeaderboard(q.id).then(() => {
        setPhase('leaderboard')
        sfx.board()
        lbTimerRef.current = setTimeout(() => {
          setMyAnswer(null); setIsCorrect(null); setQuestionScore(null)
          setPhase('question')
          startTimer(question.timeLimitSec)
          sfx.question()
        }, 3200)
      })
    }
  }, [loadLeaderboard, startTimer])

  // ── Unirse ──────────────────────────────────────────────────────────────────
  const handleJoin = async () => {
    const code = pin.trim().toUpperCase()
    if (code.length !== 6) { setJoinError(t('livequiz.pin_length')); return }
    setJoining(true); setJoinError(null)

    const { data, error } = await supabase
      .from('live_quizzes').select('*')
      .eq('pin', code).neq('status', 'ended').maybeSingle()

    if (error || !data) {
      setJoinError(t('livequiz.pin_invalid'))
      setJoining(false); return
    }

    // El código caducó: no se permite (re)unirse.
    // Comparación en UTC absoluto para que la caducidad sea el mismo instante
    // en cualquier país (ver toUtcMs).
    const expiresMs = toUtcMs(data.pin_expires_at)
    if (expiresMs !== null && expiresMs < Date.now()) {
      setJoinError(t('livequiz.pin_expired'))
      setJoining(false); return
    }

    const joined = { ...data, questions: data.questions as unknown as QuizQuestion[] } as LiveQuiz
    sfx.join()

    if (joined.campaign_id) {
      supabase.from('campaigns').select('name, logo_url').eq('id', joined.campaign_id).single()
        .then(({ data: c }) => { if (c) setCampaign(c) })
    }

    const channel = supabase
      .channel(`quiz-player-${joined.id}`)
      .on('presence', { event: 'sync' }, () => {
        setParticipantCount(Object.keys(channel.presenceState()).length)
      })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'live_quizzes', filter: `id=eq.${joined.id}` },
        (payload) => {
          const updated = payload.new as LiveQuiz & { questions: QuizQuestion[] }
          setQuiz((prev) => {
            const merged = { ...updated, questions: prev?.questions ?? [] }
            const changed = prev?.current_question !== updated.current_question || prev?.status !== updated.status
            applyQuizState(merged, changed)
            return merged
          })
        },
      )
      .subscribe(async (s) => {
        if (s === 'SUBSCRIBED' && profile?.id) {
          await channel.track({
            user_id: profile.id,
            name: profile.display_name ?? profile.id.slice(0, 8),
          })
        }
      })

    channelRef.current = channel

    if (joined.current_question >= 0) {
      const q = joined.questions[joined.current_question]
      setCurrentQ(q); setQuestionIdx(joined.current_question)
      setPhase('question'); startTimer(q.timeLimitSec)
    } else {
      setPhase('lobby')
    }
    setQuiz(joined)
    setJoining(false)
  }

  // ── Enviar respuesta ────────────────────────────────────────────────────────────
  const submitAnswer = async (optionIdx: number) => {
    if (!quiz || !currentQ || !profile || myAnswer !== null || submitting) return
    setSubmitting(true)
    const correct = optionIdx === currentQ.correctIndex
    // Puntaje por velocidad con resolución de milisegundos (no el contador entero de segundos):
    // responder al instante ≈ 1000 pts, agotar el tiempo ≈ 500 pts.
    const elapsedSec = (Date.now() - (shownAtRef.current || Date.now())) / 1000
    const remainingFrac = Math.max(0, Math.min(1, 1 - elapsedSec / currentQ.timeLimitSec))
    const earned = correct ? Math.round(500 + 500 * remainingFrac) : 0

    setMyAnswer(optionIdx); setIsCorrect(correct); setQuestionScore(earned)
    if (correct) { setMyScore((s) => s + earned); sfx.correct() } else sfx.wrong()
    if (timerRef.current) clearInterval(timerRef.current)

    // Flash de pantalla
    setShowFlash(true)
    setTimeout(() => setShowFlash(false), 700)

    // Confetti en correcto
    if (correct) {
      setConfetti(true)
      if (confettiTimer.current) clearTimeout(confettiTimer.current)
      confettiTimer.current = setTimeout(() => setConfetti(false), 2000)
    }

    setPhase('answered')
    sfx.tap()

    await supabase.from('live_quiz_answers').insert({
      quiz_id: quiz.id, user_id: profile.id,
      display_name: profile.display_name ?? profile.id.slice(0, 8),
      question_idx: questionIdx, selected_option: optionIdx,
      is_correct: correct, score: earned,
    })
    setSubmitting(false)
  }

  // ── Tiempo agotado sin responder ────────────────────────────────────────────
  // Registra una respuesta nula (0 pts) para que el anfitrión cuente al jugador
  // y el aprendiz vea el resultado, igual que Kahoot.
  const handleTimeUp = useCallback(async () => {
    if (!quiz || !currentQ || !profile || myAnswer !== null) return
    setMyAnswer(-1); setIsCorrect(false); setQuestionScore(0)
    sfx.wrong()
    setShowFlash(true)
    setTimeout(() => setShowFlash(false), 700)
    setPhase('answered')
    await supabase.from('live_quiz_answers').insert({
      quiz_id: quiz.id, user_id: profile.id,
      display_name: profile.display_name ?? profile.id.slice(0, 8),
      question_idx: questionIdx, selected_option: -1,
      is_correct: false, score: 0,
    })
  }, [quiz, currentQ, profile, myAnswer, questionIdx])

  // Dispara handleTimeUp exactamente cuando el contador llega a 0 en una pregunta activa.
  useEffect(() => {
    if (phase === 'question' && currentQ && myAnswer === null && timeLeft === 0 && !submitting) {
      void handleTimeUp()
    }
  }, [phase, currentQ, myAnswer, timeLeft, submitting, handleTimeUp])

  // ── Limpieza ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    if (channelRef.current) void supabase.removeChannel(channelRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    if (lbTimerRef.current) clearTimeout(lbTimerRef.current)
    if (confettiTimer.current) clearTimeout(confettiTimer.current)
  }, [])

  // ── Valores derivados ───────────────────────────────────────────────────────────
  const myName   = profile?.display_name ?? profile?.id?.slice(0, 8) ?? ''
  // Coincidencia robusta por user_id (con respaldo por nombre si el RPC no lo trae).
  const isMe = useCallback(
    (e: QuizLeaderboardEntry) => (e.user_id ? e.user_id === profile?.id : e.display_name === myName),
    [profile?.id, myName],
  )
  const total    = quiz?.questions.length ?? 1
  const timerPct = currentQ ? timeLeft / currentQ.timeLimitSec : 0
  const timerColor = timeLeft > 10 ? '#10D451' : timeLeft > 5 ? '#fbbf24' : '#ef4444'

  // ══════════════════════════════════════════════════════════════════════════
  // UNIRSE
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === 'join') return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg relative overflow-hidden">
      {/* Resplandor radial de fondo */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 100%, rgba(16,212,81,0.07) 0%, transparent 70%)' }} />

      <button onClick={() => navigate('/dashboard')}
        className="absolute top-5 left-5 flex items-center gap-1.5 text-[13px] text-text-subtle hover:text-text transition-colors">
        <ArrowLeft className="h-4 w-4" /> {t('livequiz.dashboard')}
      </button>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-xs px-4 text-center"
      >
        <div className="text-[11px] uppercase tracking-[0.2em] text-text-subtle mb-2">{t('livequiz.tag')}</div>
        <h1 className="text-[30px] font-black text-text mb-8 tracking-tight">{t('livequiz.enter_pin')}</h1>

        {/* Entrada de PIN */}
        <div className="relative mb-3">
          <input
            autoFocus
            type="text"
            value={pin}
            onChange={(e) => { setPin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); setJoinError(null) }}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            placeholder="· · · · · ·"
            maxLength={6}
            className="w-full text-center font-mono text-[34px] font-black rounded-2xl px-6 py-5 text-text tracking-[0.4em] outline-none bg-subtle border-2 transition-all duration-200"
            style={{
              borderColor: pin.length === 6 ? '#10D451' : 'rgb(var(--line))',
              boxShadow: pin.length === 6 ? '0 0 24px rgba(16,212,81,0.2)' : undefined,
            }}
          />
          {pin.length > 0 && pin.length < 6 && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-0.5 w-5 rounded-full transition-all duration-150"
                  style={{ background: i < pin.length ? '#10D451' : 'rgb(var(--line))' }} />
              ))}
            </div>
          )}
        </div>

        <AnimatePresence>
          {joinError && (
            <motion.p
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-red-400 text-[13px] mb-3"
            >{joinError}</motion.p>
          )}
        </AnimatePresence>

        <motion.button
          onClick={handleJoin}
          disabled={joining || pin.length !== 6}
          whileTap={{ scale: 0.97 }}
          className="w-full py-4 rounded-2xl text-[15px] font-black text-black disabled:opacity-40 flex items-center justify-center gap-2 transition-opacity shadow-lg"
          style={{ background: 'linear-gradient(135deg, #10D451 0%, #00a821 100%)' }}
        >
          {joining ? <Loader2 className="h-5 w-5 animate-spin" /> : t('livequiz.join')}
        </motion.button>
      </motion.div>
    </div>
  )

  // ══════════════════════════════════════════════════════════════════════════
  // LOBBY
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === 'lobby') return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 40% at 50% 60%, rgba(16,212,81,0.06) 0%, transparent 70%)' }} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="text-center"
      >
        {campaign?.logo_url && (
          <img src={campaign.logo_url} alt={campaign.name} className="h-10 mx-auto mb-4 object-contain" />
        )}
        {campaign?.name && (
          <div className="text-[11px] uppercase tracking-widest text-text-subtle mb-2">{campaign.name}</div>
        )}
        <h2 className="text-[24px] font-black text-text mb-1 tracking-tight">{quiz?.title}</h2>
        <div className="flex items-center justify-center gap-2 mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-[#10D451] animate-pulse" />
          <span className="text-[13px] font-semibold" style={{ color: '#10D451' }}>{t('livequiz.you_are_in')}</span>
        </div>

        {/* Anillo pulsante de participantes */}
        <div className="relative flex items-center justify-center w-28 h-28 mx-auto mb-6">
          {[1, 2].map((ring) => (
            <motion.div key={ring}
              className="absolute inset-0 rounded-full border"
              style={{ borderColor: 'rgba(16,212,81,0.3)' }}
              animate={{ scale: [1, 1.6 + ring * 0.3], opacity: [0.4, 0] }}
              transition={{ duration: 2, delay: ring * 0.6, repeat: Infinity, ease: 'easeOut' }}
            />
          ))}
          <div className="relative w-20 h-20 rounded-full flex flex-col items-center justify-center"
            style={{ background: 'rgba(16,212,81,0.1)', border: '2px solid rgba(16,212,81,0.3)' }}>
            {participantCount > 0 ? (
              <>
                <span className="text-[26px] font-black" style={{ color: '#10D451' }}>{participantCount}</span>
                <span className="text-[9px] text-text-subtle uppercase tracking-wide">
                  {t('livequiz.player', { count: participantCount })}
                </span>
              </>
            ) : (
              <Loader2 className="h-7 w-7 animate-spin" style={{ color: '#10D451' }} />
            )}
          </div>
        </div>

        <p className="text-text-muted text-[14px] mb-1">{t('livequiz.waiting_host')}</p>
        <div className="flex items-center justify-center gap-1 mt-1">
          {[0, 1, 2].map((i) => (
            <motion.div key={i} className="h-1.5 w-1.5 rounded-full bg-text-subtle"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, delay: i * 0.2, repeat: Infinity }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  )

  // ══════════════════════════════════════════════════════════════════════════
  // FLASH DE CLASIFICACIÓN
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === 'leaderboard') {
    const top3 = leaderboard.slice(0, 3)
    // Orden del podio: plata(1), oro(0), bronce(2)
    const order = [1, 0, 2]
    const podiumH = [88, 120, 64]
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-4 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 50% 40% at 50% 80%, rgba(16,212,81,0.05) 0%, transparent 70%)' }} />

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full max-w-sm text-center">
          <div className="text-[11px] uppercase tracking-[0.18em] text-text-subtle mb-1">{t('livequiz.ranking')}</div>
          <h2 className="text-[22px] font-black text-text mb-8 tracking-tight">{t('livequiz.top_players')}</h2>

          {top3.length > 0 ? (
            <div className="flex items-end justify-center gap-3 mb-8">
              {order.map((rank) => {
                const entry = top3[rank]
                if (!entry) return <div key={rank} className="w-20" />
                const mine = isMe(entry)
                const h = podiumH[rank]
                return (
                  <motion.div key={rank}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: rank * 0.14, type: 'spring', stiffness: 280, damping: 22 }}
                    className="flex flex-col items-center gap-1.5"
                  >
                    <div className={`text-[12px] font-semibold text-text truncate max-w-[70px] ${mine ? 'text-[#10D451]' : ''}`}>
                      {entry.display_name}
                    </div>
                    <div className="text-[11px] font-bold tabular-nums" style={{ color: MEDALS[rank] }}>
                      {entry.score.toLocaleString()}
                    </div>
                    <motion.div
                      className="w-20 rounded-t-xl flex items-end justify-center pb-2"
                      style={{
                        height: h,
                        background: mine
                          ? `linear-gradient(180deg, ${MEDALS[rank]}33, ${MEDALS[rank]}18)`
                          : `${MEDALS[rank]}18`,
                        border: `1.5px solid ${MEDALS[rank]}50`,
                      }}
                      initial={{ height: 0 }}
                      animate={{ height: h }}
                      transition={{ delay: rank * 0.14 + 0.1, type: 'spring', stiffness: 260, damping: 28 }}
                    >
                      <span className="text-[20px] font-black" style={{ color: MEDALS[rank] }}>{rank + 1}</span>
                    </motion.div>
                  </motion.div>
                )
              })}
            </div>
          ) : (
            <div className="mb-8 text-text-subtle text-[14px]">{t('livequiz.no_answers_yet')}</div>
          )}

          <div className="flex items-center justify-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <motion.div key={i} className="h-1.5 w-1.5 rounded-full bg-text-subtle"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 0.9, delay: i * 0.18, repeat: Infinity }}
              />
            ))}
          </div>
          <p className="text-text-subtle text-[12px] mt-2">{t('livequiz.next_question_soon')}</p>
        </motion.div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PREGUNTA + RESPONDIDO
  // ══════════════════════════════════════════════════════════════════════════
  if ((phase === 'question' || phase === 'answered') && currentQ) {
    return (
      <div className="min-h-screen flex flex-col bg-bg select-none">

        {/* Confeti y destello */}
        <Confetti active={confetti} />
        <AnimatePresence>
          {showFlash && (
            <motion.div
              className="fixed inset-0 z-40 pointer-events-none"
              initial={{ opacity: 0.75 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.65, ease: 'easeOut' }}
              style={{ background: isCorrect ? '#10D451' : '#ef4444' }}
            />
          )}
        </AnimatePresence>

        {/* Barra del temporizador — franja a todo el ancho en la parte superior */}
        <div className="w-full h-1.5 bg-line flex-shrink-0">
          <div
            className="h-full transition-all ease-linear"
            style={{
              width: `${timerPct * 100}%`,
              background: timerColor,
              transition: `width 1s linear, background-color 0.5s`,
              boxShadow: timeLeft <= 5 ? `0 0 8px ${timerColor}` : undefined,
            }}
          />
        </div>

        {/* Encabezado */}
        <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 border-b border-line">
          {/* Puntuación */}
          <div className="flex items-center gap-1.5 min-w-[80px]">
            {myScore > 0 && (
              <motion.div
                key={myScore}
                initial={{ scale: 1.3, color: '#10D451' }}
                animate={{ scale: 1, color: 'rgb(var(--text-muted))' }}
                transition={{ duration: 0.4 }}
                className="flex items-center gap-1 text-[13px] font-bold tabular-nums text-text-muted"
              >
                <Star className="h-3.5 w-3.5 fill-current" style={{ color: '#d97706' }} />
                {myScore.toLocaleString()}
              </motion.div>
            )}
          </div>

          {/* Contador de preguntas */}
          <span className="text-[13px] font-semibold text-text">
            {questionIdx + 1} <span className="text-text-subtle font-normal">/ {total}</span>
          </span>

          {/* Temporizador + silencio */}
          <div className="flex items-center gap-3 min-w-[80px] justify-end">
            <motion.span
              key={timeLeft}
              initial={{ scale: timeLeft <= 5 ? 1.2 : 1 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.15 }}
              className="text-[16px] font-black tabular-nums w-8 text-right"
              style={{ color: timerColor }}
            >
              {timeLeft}
            </motion.span>
            <button
              onClick={() => { const m = sfx.toggle(); setMuted(m) }}
              className="text-text-subtle hover:text-text transition-colors p-1"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Tarjeta de pregunta */}
        <div className="flex-shrink-0 px-3 pt-3 pb-2">
          <AnimatePresence mode="wait">
            {phase === 'answered' ? (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="rounded-2xl px-4 py-4 flex flex-col items-center gap-1.5"
                style={{
                  background: isCorrect ? 'rgba(16,212,81,0.1)' : 'rgba(239,68,68,0.08)',
                  border: `1px solid ${isCorrect ? 'rgba(16,212,81,0.35)' : 'rgba(239,68,68,0.3)'}`,
                }}
              >
                <div className="flex items-center gap-2.5">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                  >
                    {isCorrect
                      ? <Check className="h-6 w-6" style={{ color: '#10D451' }} />
                      : <X className="h-6 w-6 text-red-400" />
                    }
                  </motion.div>
                  <span className="text-[17px] font-black" style={{ color: isCorrect ? '#10D451' : '#ef4444' }}>
                    {isCorrect ? t('livequiz.correct') : t('livequiz.incorrect')}
                  </span>
                  {questionScore != null && questionScore > 0 && (
                    <motion.span
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 }}
                      className="text-[14px] font-bold text-text-muted"
                    >
                      {t('livequiz.points', { points: questionScore.toLocaleString() })}
                    </motion.span>
                  )}
                </div>
                {!isCorrect && (
                  <p className="text-[12px] text-text-subtle">
                    {t('livequiz.correct_label')}{' '}
                    <strong style={{ color: OPTS[currentQ.correctIndex].color }}>
                      {OPTS[currentQ.correctIndex].label}
                    </strong>
                  </p>
                )}
                <p className="text-[11px] text-text-subtle">{t('livequiz.waiting_host_short')}</p>
              </motion.div>
            ) : (
              <motion.div
                key={`q-${questionIdx}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl px-4 py-4 bg-subtle border border-line"
              >
                <p className="text-[18px] md:text-[22px] font-bold text-text text-center leading-snug">
                  {currentQ.text}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Cuadrícula 2×2 de opciones */}
        <div className="flex-1 grid grid-cols-2 gap-0.5 min-h-0">
          {currentQ.options.map((opt, oi) => {
            const { label, Icon, color, glow } = OPTS[oi]
            const isSelected   = myAnswer === oi
            const isCorrectOpt = oi === currentQ.correctIndex
            const inAnswered   = phase === 'answered'

            let bg: string = color
            let opacity = 1
            let shadow: string | undefined
            let scale = 1

            if (inAnswered) {
              if (isSelected && isCorrect) {
                bg = '#10D451'; shadow = `0 0 32px rgba(16,212,81,0.6), inset 0 0 16px rgba(255,255,255,0.08)`; scale = 1.01
              } else if (isSelected && !isCorrect) {
                bg = '#ef4444'; opacity = 0.9; scale = 0.98
              } else if (isCorrectOpt) {
                shadow = `0 0 28px ${glow}, inset 0 0 12px rgba(255,255,255,0.06)`; scale = 1.01
              } else {
                opacity = 0.18
              }
            }

            return (
              <motion.button
                key={oi}
                onClick={() => { if (phase === 'question') { sfx.tap(); void submitAnswer(oi) } }}
                disabled={inAnswered || myAnswer !== null || timeLeft === 0 || submitting}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity, y: 0, scale }}
                transition={
                  inAnswered
                    ? { duration: 0.35, ease: [0.16, 1, 0.3, 1] }
                    : { delay: 0.06 + oi * 0.06, type: 'spring', stiffness: 400, damping: 28 }
                }
                whileTap={!inAnswered ? { scale: 0.96 } : undefined}
                className="relative flex flex-col p-4 gap-2 items-start justify-start transition-shadow"
                style={{ background: bg, boxShadow: shadow }}
              >
                {/* Ícono + etiqueta */}
                <div className="flex items-center gap-2">
                  <Icon className="h-6 w-6 text-white/85 flex-shrink-0" />
                  <span className="text-[11px] font-black text-white/65">{label}</span>
                </div>
                {/* Texto de opción */}
                <span className="text-[14px] md:text-[16px] font-semibold text-white leading-snug">
                  {opt}
                </span>
                {/* Ícono de estado arriba a la derecha */}
                {inAnswered && isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                    className="absolute top-3 right-3"
                  >
                    {isCorrect
                      ? <Check className="h-5 w-5 text-white" />
                      : <X className="h-5 w-5 text-white" />
                    }
                  </motion.div>
                )}
                {inAnswered && !isSelected && isCorrectOpt && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.15 }}
                    className="absolute top-3 right-3"
                  >
                    <Check className="h-5 w-5 text-white/90" />
                  </motion.div>
                )}
              </motion.button>
            )
          })}
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TERMINADO
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === 'ended') {
    const myPos = leaderboard.findIndex(isMe)
    // Puntaje final autoritativo desde la BD (robusto ante recargas); respaldo al local.
    const myFinalScore = myPos >= 0 ? leaderboard[myPos].score : myScore
    const inTop3 = myPos >= 0 && myPos < 3
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg px-4 py-10 relative overflow-hidden">
        {inTop3 && <Confetti active />}

        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 90%, rgba(16,212,81,0.06) 0%, transparent 70%)' }} />

        <button onClick={() => navigate('/dashboard')}
          className="absolute top-5 left-5 flex items-center gap-1.5 text-[13px] text-text-subtle hover:text-text transition-colors">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </button>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm"
        >
          <div className="text-center mb-6">
            {campaign?.name && (
              <div className="text-[11px] uppercase tracking-widest text-text-subtle mb-1">{campaign.name}</div>
            )}
            <h1 className="text-[26px] font-black text-text tracking-tight">{t('livequiz.final_results')}</h1>
            {myPos >= 0 && (
              <p className="text-[13px] text-text-muted mt-1.5">
                {t('livequiz.your_position')}{' '}
                <span className="font-black text-text">#{myPos + 1}</span>
                {'  ·  '}
                <span className="font-bold" style={{ color: '#10D451' }}>{t('livequiz.points_suffix', { points: myFinalScore.toLocaleString() })}</span>
              </p>
            )}
          </div>

          <div className="rounded-2xl overflow-hidden border border-line">
            {leaderboard.slice(0, 10).map((entry, i) => {
              const mine = isMe(entry)
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{
                    background: mine
                      ? 'rgba(16,212,81,0.07)'
                      : i % 2 === 0 ? 'rgb(var(--subtle))' : 'transparent',
                    borderTop: i > 0 ? '1px solid rgb(var(--line))' : undefined,
                  }}
                >
                  <span className="text-[14px] font-black w-6 text-right flex-shrink-0"
                    style={{ color: i < 3 ? MEDALS[i] : 'rgb(var(--text-subtle))' }}>
                    {i + 1}
                  </span>
                  <span className={`flex-1 text-[13px] truncate ${mine ? 'font-bold text-text' : 'text-text'}`}>
                    {entry.display_name}
                    {mine && <span className="text-[11px] text-text-subtle ml-1">{t('livequiz.you')}</span>}
                  </span>
                  <span className="text-[13px] font-bold tabular-nums" style={{ color: '#10D451' }}>
                    {entry.score.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-text-subtle tabular-nums">
                    {entry.correct}/{quiz?.questions.length}
                  </span>
                </motion.div>
              )
            })}
            {leaderboard.length === 0 && (
              <div className="py-8 text-center text-text-subtle text-[13px]">{t('livequiz.no_answers_recorded')}</div>
            )}
          </div>

          <motion.button
            onClick={() => navigate('/dashboard')}
            whileTap={{ scale: 0.97 }}
            className="mt-5 w-full py-3 rounded-xl text-[13px] font-semibold text-text-muted hover:text-text bg-subtle hover:bg-line/50 transition-colors border border-line"
          >
            {t('livequiz.back_dashboard')}
          </motion.button>
        </motion.div>
      </div>
    )
  }

  return null
}
