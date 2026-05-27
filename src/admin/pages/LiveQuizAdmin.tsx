import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, ChevronLeft, ChevronRight, Square, Play, Copy, Check,
  Loader2, Zap, X, BarChart2, RefreshCw,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { LiveQuiz, QuizQuestion, Campaign, QuizLeaderboardEntry, LiveQuizAnswer } from '@/types/database'
import type { RealtimeChannel } from '@supabase/supabase-js'

const OPTION_LABELS = ['A', 'B', 'C', 'D']
const OPTION_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#22c55e']
const MEDAL_COLORS = ['#ca8a04', '#6b7280', '#b45309']

function generatePin(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function emptyQuestion(): QuizQuestion {
  return { text: '', options: ['', '', '', ''], correctIndex: 0, timeLimitSec: 20 }
}

type View = 'list' | 'create' | 'session'
type AnswerCount = { option: number; count: number; is_correct: boolean }[]

export default function LiveQuizAdmin() {
  const { profile, campaignId, isAdmin } = useAuth()
  const [view, setView] = useState<View>('list')
  const [quizzes, setQuizzes] = useState<LiveQuiz[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [filterCampaign, setFilterCampaign] = useState<string>('all')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Formulario de creación
  const [formTitle, setFormTitle] = useState('')
  const [formCampaign, setFormCampaign] = useState(campaignId ?? '')
  const [formQuestions, setFormQuestions] = useState<QuizQuestion[]>([emptyQuestion()])
  const [creating, setCreating] = useState(false)

  // Sesión
  const [activeQuiz, setActiveQuiz] = useState<LiveQuiz | null>(null)
  const [answerCounts, setAnswerCounts] = useState<AnswerCount>([])
  const [totalAnswers, setTotalAnswers] = useState(0)
  const [participantCount, setParticipantCount] = useState(0)
  const [pinCopied, setPinCopied] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [leaderboard, setLeaderboard] = useState<QuizLeaderboardEntry[]>([])

  // ── Cargar lista ──────────────────────────────────────────────────────────────
  const loadQuizzes = useCallback(async () => {
    setLoadingList(true)
    const query = supabase.from('live_quizzes').select('*').order('created_at', { ascending: false })
    if (!isAdmin && campaignId) query.eq('campaign_id', campaignId)
    const { data } = await query
    setQuizzes((data ?? []) as unknown as LiveQuiz[])
    setLoadingList(false)
  }, [campaignId, isAdmin])

  useEffect(() => {
    void loadQuizzes()
    if (isAdmin) {
      supabase.from('campaigns').select('*').order('name').then(({ data }) => {
        setCampaigns(data ?? [])
      })
    }
  }, [loadQuizzes, isAdmin])

  // ── Conteo de respuestas + tiempo real para sesión activa ────────────────────
  const fetchAnswerCounts = useCallback(async (quiz: LiveQuiz) => {
    if (quiz.current_question < 0) return
    const { data } = await supabase
      .from('live_quiz_answers')
      .select('selected_option, is_correct')
      .eq('quiz_id', quiz.id)
      .eq('question_idx', quiz.current_question)

    if (!data) return
    const counts: AnswerCount = [0, 1, 2, 3].map((opt) => ({
      option: opt,
      count: data.filter((r) => r.selected_option === opt).length,
      is_correct: opt === quiz.questions[quiz.current_question]?.correctIndex,
    }))
    setAnswerCounts(counts)
    setTotalAnswers(data.length)
  }, [])

  const loadLeaderboard = useCallback(async (quizId: string) => {
    const { data } = await supabase
      .from('live_quiz_answers')
      .select('display_name, is_correct, question_idx, score')
      .eq('quiz_id', quizId)

    if (!data) return
    const map = new Map<string, { correct: number; total: number; score: number }>()
    for (const row of data) {
      const entry = map.get(row.display_name) ?? { correct: 0, total: 0, score: 0 }
      entry.total++
      if (row.is_correct) entry.correct++
      entry.score += (row as LiveQuizAnswer).score ?? 0
      map.set(row.display_name, entry)
    }
    const board = [...map.entries()]
      .map(([display_name, s]) => ({ display_name, ...s }))
      .sort((a, b) => b.score - a.score || b.correct - a.correct)
    setLeaderboard(board)
  }, [])

  useEffect(() => {
    if (!activeQuiz) return

    let channel: RealtimeChannel
    let presenceChannel: RealtimeChannel

    channel = supabase
      .channel(`admin-quiz-${activeQuiz.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'live_quizzes', filter: `id=eq.${activeQuiz.id}` },
        (payload) => {
          const updated = payload.new as LiveQuiz
          setActiveQuiz((prev) => ({ ...prev!, ...updated, questions: prev!.questions }))
          setAnswerCounts([])
          setTotalAnswers(0)
        },
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_quiz_answers', filter: `quiz_id=eq.${activeQuiz.id}` },
        () => { void fetchAnswerCounts(activeQuiz) },
      )
      .subscribe()

    presenceChannel = supabase
      .channel(`quiz-player-${activeQuiz.id}`)
      .on('presence', { event: 'sync' }, () => {
        setParticipantCount(Object.keys(presenceChannel.presenceState()).length)
      })
      .subscribe()

    void fetchAnswerCounts(activeQuiz)

    return () => {
      void supabase.removeChannel(channel)
      void supabase.removeChannel(presenceChannel)
    }
  }, [activeQuiz?.id, activeQuiz?.current_question, fetchAnswerCounts]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Crear ─────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!formTitle.trim() || formQuestions.some((q) => !q.text.trim())) return
    const targetCampaign = formCampaign || campaignId
    if (!targetCampaign || !profile?.id) return

    setCreating(true)
    const pin = generatePin()
    const { data, error } = await supabase
      .from('live_quizzes')
      .insert({
        title: formTitle.trim(),
        campaign_id: targetCampaign,
        created_by: profile.id,
        pin,
        questions: formQuestions as unknown as never,
      })
      .select()
      .single()

    setCreating(false)
    if (error || !data) return

    const quiz = { ...data, questions: formQuestions } as LiveQuiz
    setActiveQuiz(quiz)
    setView('session')
    void loadQuizzes()
  }

  // ── Eliminar ─────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    await supabase.from('live_quiz_answers').delete().eq('quiz_id', id)
    await supabase.from('live_quizzes').delete().eq('id', id)
    setDeleteConfirm(null)
    void loadQuizzes()
  }

  // ── Duplicar ──────────────────────────────────────────────────────────────
  const handleDuplicate = async (q: LiveQuiz) => {
    if (!profile?.id) return
    const pin = generatePin()
    await supabase.from('live_quizzes').insert({
      title: `${q.title} (copia)`,
      campaign_id: q.campaign_id,
      created_by: profile.id,
      pin,
      questions: q.questions as unknown as never,
    })
    void loadQuizzes()
  }

  // ── Controles de sesión ───────────────────────────────────────────────────────
  const startQuiz = async () => {
    if (!activeQuiz) return
    setAdvancing(true)
    const { data } = await supabase
      .from('live_quizzes')
      .update({ status: 'active', current_question: 0, question_started_at: new Date().toISOString() })
      .eq('id', activeQuiz.id)
      .select().single()
    if (data) setActiveQuiz((prev) => ({ ...prev!, ...(data as unknown as LiveQuiz) }))
    setAdvancing(false)
  }

  const nextQuestion = async () => {
    if (!activeQuiz) return
    setAdvancing(true)
    const nextIdx = activeQuiz.current_question + 1
    const isLast = nextIdx >= activeQuiz.questions.length
    const { data } = await supabase
      .from('live_quizzes')
      .update(isLast
        ? { status: 'ended', current_question: -1 }
        : { current_question: nextIdx, question_started_at: new Date().toISOString() })
      .eq('id', activeQuiz.id)
      .select().single()
    if (data) setActiveQuiz((prev) => ({ ...prev!, ...(data as unknown as LiveQuiz) }))
    setAdvancing(false)
  }

  const endQuiz = async () => {
    if (!activeQuiz) return
    setAdvancing(true)
    const { data } = await supabase
      .from('live_quizzes')
      .update({ status: 'ended', current_question: -1 })
      .eq('id', activeQuiz.id)
      .select().single()
    if (data) setActiveQuiz((prev) => ({ ...prev!, ...(data as unknown as LiveQuiz) }))
    setAdvancing(false)
  }

  const restartQuiz = async () => {
    if (!activeQuiz) return
    setAdvancing(true)
    const newPin = generatePin()
    await supabase.from('live_quiz_answers').delete().eq('quiz_id', activeQuiz.id)
    const { data } = await supabase
      .from('live_quizzes')
      .update({ status: 'lobby', current_question: -1, pin: newPin, question_started_at: null })
      .eq('id', activeQuiz.id)
      .select().single()
    if (data) {
      setActiveQuiz((prev) => ({ ...prev!, ...(data as unknown as LiveQuiz) }))
      setAnswerCounts([])
      setTotalAnswers(0)
      setLeaderboard([])
      setShowLeaderboard(false)
    }
    setAdvancing(false)
  }

  const copyPin = () => {
    if (activeQuiz) void navigator.clipboard.writeText(activeQuiz.pin)
    setPinCopied(true)
    setTimeout(() => setPinCopied(false), 2000)
  }

  // ── Helpers del constructor de preguntas ────────────────────────────────────
  const updateQuestion = (idx: number, patch: Partial<QuizQuestion>) =>
    setFormQuestions((prev) => prev.map((q, i) => i === idx ? { ...q, ...patch } : q))

  const updateOption = (qIdx: number, oIdx: number, val: string) =>
    setFormQuestions((prev) =>
      prev.map((q, i) =>
        i === qIdx ? { ...q, options: q.options.map((o, j) => j === oIdx ? val : o) as QuizQuestion['options'] } : q,
      ),
    )

  // ── Lista filtrada ──────────────────────────────────────────────────────────
  const filteredQuizzes = filterCampaign === 'all'
    ? quizzes
    : quizzes.filter((q) => q.campaign_id === filterCampaign)

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  // ── Vista de lista ──────────────────────────────────────────────────────────
  if (view === 'list') return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-text">Quiz en Vivo</h1>
          <p className="text-text-muted text-[13px] mt-1">Sesiones interactivas tipo Kahoot para tus participantes.</p>
        </div>
        <button
          onClick={() => { setFormTitle(''); setFormCampaign(campaignId ?? ''); setFormQuestions([emptyQuestion()]); setView('create') }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-medium text-black"
          style={{ background: '#00C228' }}
        >
          <Zap className="h-4 w-4" />
          Crear quiz
        </button>
      </div>

      {/* Filtro de campaña — solo superadmin */}
      {isAdmin && campaigns.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-5">
          <button
            onClick={() => setFilterCampaign('all')}
            className={`px-3 py-1 rounded-full text-[12px] transition-colors ${filterCampaign === 'all' ? 'text-[#00C228]' : 'bg-subtle text-text-muted hover:text-text'}`}
            style={filterCampaign === 'all' ? { background: 'rgba(0,194,40,0.12)', border: '1px solid rgba(0,194,40,0.3)' } : {}}
          >
            Todas
          </button>
          {campaigns.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilterCampaign(c.id)}
              className={`px-3 py-1 rounded-full text-[12px] transition-colors ${filterCampaign === c.id ? 'text-[#00C228]' : 'bg-subtle text-text-muted hover:text-text'}`}
              style={filterCampaign === c.id ? { background: 'rgba(0,194,40,0.12)', border: '1px solid rgba(0,194,40,0.3)' } : {}}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {loadingList ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 text-text-subtle animate-spin" /></div>
      ) : filteredQuizzes.length === 0 ? (
        <div className="text-center py-20 text-text-subtle text-[14px]">
          {quizzes.length === 0 ? 'No hay quizzes aun. ¡Crea el primero!' : 'No hay quizzes para esta campaña.'}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden border border-line">
          <div className={`grid ${isAdmin ? 'grid-cols-[1fr_auto_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto]'} gap-4 px-5 py-3 text-[11px] uppercase tracking-wider text-text-muted bg-subtle`}>
            <span>Titulo</span>
            {isAdmin && <span>Campaña</span>}
            <span>PIN</span>
            <span>Estado</span>
            <span />
          </div>
          {filteredQuizzes.map((q) => {
            const campName = campaigns.find((c) => c.id === q.campaign_id)?.name
            return (
              <div
                key={q.id}
                className={`grid ${isAdmin ? 'grid-cols-[1fr_auto_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto]'} gap-4 px-5 py-4 items-center border-t border-line`}
              >
                <div>
                  <div className="text-[13px] text-text">{q.title}</div>
                  <div className="text-[11px] text-text-subtle">{q.questions.length} pregunta{q.questions.length !== 1 ? 's' : ''}</div>
                </div>
                {isAdmin && (
                  <span className="text-[11px] text-text-muted truncate max-w-[120px]">{campName ?? '—'}</span>
                )}
                <span className="font-mono text-[13px] text-text-muted">{q.pin}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full whitespace-nowrap ${
                  q.status === 'lobby' ? 'bg-yellow-400/10 text-yellow-400' :
                  q.status === 'active' ? 'bg-green-400/10 text-green-400' :
                  'bg-subtle text-text-subtle'
                }`}>
                  {q.status === 'lobby' ? 'Lobby' : q.status === 'active' ? 'Activo' : 'Terminado'}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setActiveQuiz(q); setView('session') }}
                    className="text-[12px] text-text-muted hover:text-text px-3 py-1 rounded-lg hover:bg-subtle transition-colors whitespace-nowrap"
                  >
                    Gestionar →
                  </button>
                  <button
                    onClick={() => handleDuplicate(q)}
                    title="Duplicar"
                    className="p-1.5 rounded-lg text-text-subtle hover:text-text hover:bg-subtle transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {deleteConfirm === q.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(q.id)}
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-400/10 transition-colors"
                        title="Confirmar eliminación"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="p-1.5 rounded-lg text-text-subtle hover:text-text hover:bg-subtle transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(q.id)}
                      className="p-1.5 rounded-lg text-text-subtle hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  // ── Vista de creación ────────────────────────────────────────────────────────
  if (view === 'create') return (
    <div className="p-8 max-w-2xl">
      <button onClick={() => setView('list')} className="flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text mb-6 transition-colors">
        <ChevronLeft className="h-4 w-4" /> Volver
      </button>
      <h1 className="text-[22px] font-bold text-text mb-6">Crear quiz</h1>

      <div className="space-y-4 mb-6">
        <input
          type="text"
          placeholder="Titulo del quiz"
          value={formTitle}
          onChange={(e) => setFormTitle(e.target.value)}
          className="w-full rounded-xl px-4 py-2.5 text-[14px] text-text bg-subtle border border-line outline-none focus:border-[#00C228] transition-colors"
        />
        {isAdmin && campaigns.length > 0 && (
          <select
            value={formCampaign}
            onChange={(e) => setFormCampaign(e.target.value)}
            className="w-full rounded-xl px-4 py-2.5 text-[13px] text-text bg-subtle border border-line outline-none"
          >
            <option value="">Seleccionar campaña</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <div className="space-y-4 mb-6">
        {formQuestions.map((q, qi) => (
          <div key={qi} className="rounded-2xl p-5 bg-subtle border border-line">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-text-muted uppercase tracking-wider">Pregunta {qi + 1}</span>
              {formQuestions.length > 1 && (
                <button onClick={() => setFormQuestions((prev) => prev.filter((_, i) => i !== qi))}
                  className="text-text-subtle hover:text-red-400 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <input
              type="text"
              placeholder="Texto de la pregunta"
              value={q.text}
              onChange={(e) => updateQuestion(qi, { text: e.target.value })}
              className="w-full rounded-lg px-3 py-2 text-[13px] text-text bg-surface border border-line outline-none focus:border-[#00C228] transition-colors mb-3"
            />
            <div className="grid grid-cols-2 gap-2 mb-3">
              {q.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <button
                    onClick={() => updateQuestion(qi, { correctIndex: oi })}
                    className="h-5 w-5 rounded-full shrink-0 border-2 flex items-center justify-center transition-colors"
                    style={{
                      borderColor: OPTION_COLORS[oi],
                      background: q.correctIndex === oi ? OPTION_COLORS[oi] : 'transparent',
                    }}
                  >
                    {q.correctIndex === oi && <Check className="h-2.5 w-2.5 text-white" />}
                  </button>
                  <div className="flex-1 flex items-center gap-1.5">
                    <span className="text-[11px] font-bold shrink-0" style={{ color: OPTION_COLORS[oi] }}>
                      {OPTION_LABELS[oi]}
                    </span>
                    <input
                      type="text"
                      placeholder={`Opcion ${OPTION_LABELS[oi]}`}
                      value={opt}
                      onChange={(e) => updateOption(qi, oi, e.target.value)}
                      className="flex-1 rounded-lg px-2.5 py-1.5 text-[12px] text-text bg-surface border border-line outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-subtle">Tiempo:</span>
              {[10, 15, 20, 30, 45].map((t) => (
                <button
                  key={t}
                  onClick={() => updateQuestion(qi, { timeLimitSec: t })}
                  className="px-2.5 py-1 rounded-lg text-[11px] transition-colors"
                  style={{
                    background: q.timeLimitSec === t ? 'rgba(0,194,40,0.15)' : 'rgb(var(--line))',
                    color: q.timeLimitSec === t ? '#00C228' : 'rgb(var(--text-muted))',
                  }}
                >
                  {t}s
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          onClick={() => setFormQuestions((prev) => [...prev, emptyQuestion()])}
          className="w-full rounded-xl py-3 text-[13px] text-text-muted hover:text-text border border-dashed border-line hover:border-line transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="h-4 w-4" /> Agregar pregunta
        </button>
      </div>

      <button
        onClick={handleCreate}
        disabled={creating || !formTitle.trim() || formQuestions.some((q) => !q.text.trim())}
        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-[13px] font-medium text-black disabled:opacity-50"
        style={{ background: '#00C228' }}
      >
        {creating && <Loader2 className="h-4 w-4 animate-spin" />}
        Crear y abrir sesion
      </button>
    </div>
  )

  // ── Vista de sesión ───────────────────────────────────────────────────────────
  if (!activeQuiz) return null
  const q = activeQuiz.current_question >= 0 ? activeQuiz.questions[activeQuiz.current_question] : null
  const isLast = activeQuiz.current_question >= activeQuiz.questions.length - 1

  return (
    <div className="p-8 max-w-2xl relative">
      <button onClick={() => setView('list')} className="flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text mb-6 transition-colors">
        <ChevronLeft className="h-4 w-4" /> Volver a la lista
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-bold text-text">{activeQuiz.title}</h1>
          <span className={`text-[11px] px-2 py-0.5 rounded-full inline-block mt-1 ${
            activeQuiz.status === 'lobby' ? 'bg-yellow-400/10 text-yellow-400' :
            activeQuiz.status === 'active' ? 'bg-green-400/10 text-green-400' :
            'bg-subtle text-text-subtle'
          }`}>
            {activeQuiz.status === 'lobby' ? '● Esperando' : activeQuiz.status === 'active' ? '● Activo' : 'Terminado'}
          </span>
          {participantCount > 0 && (
            <div className="text-[11px] text-text-subtle mt-1">
              {participantCount} participante{participantCount !== 1 ? 's' : ''} en sala
              {totalAnswers > 0 && ` · ${totalAnswers} respondieron`}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[11px] text-text-subtle uppercase tracking-wider mb-1">PIN de acceso</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[28px] font-bold text-text tracking-widest">{activeQuiz.pin}</span>
            <button onClick={copyPin} className="text-text-subtle hover:text-text transition-colors">
              {pinCopied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <div className="text-[11px] text-text-subtle mt-1">
            {window.location.origin}/quiz
          </div>
        </div>
      </div>

      {/* Estado de lobby */}
      {activeQuiz.status === 'lobby' && (
        <div className="rounded-2xl p-8 text-center mb-6 bg-subtle border border-line">
          <div className="text-text-muted text-[14px] mb-4">Comparte el PIN con los participantes y luego inicia.</div>
          <button
            onClick={startQuiz}
            disabled={advancing}
            className="flex items-center gap-2 px-8 py-3 rounded-xl text-[14px] font-medium text-black mx-auto"
            style={{ background: '#00C228' }}
          >
            {advancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Iniciar quiz
          </button>
        </div>
      )}

      {/* Pregunta activa */}
      {activeQuiz.status === 'active' && q && (
        <div className="rounded-2xl p-5 mb-4 bg-subtle border border-line">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-text-muted uppercase tracking-wider">
              Pregunta {activeQuiz.current_question + 1} de {activeQuiz.questions.length}
            </span>
            <span className="text-[12px] text-text-subtle">{totalAnswers} respuesta{totalAnswers !== 1 ? 's' : ''}</span>
          </div>
          <p className="text-[16px] text-text font-medium mb-5">{q.text}</p>

          <div className="space-y-2">
            {q.options.map((opt, oi) => {
              const entry = answerCounts.find((a) => a.option === oi)
              const count = entry?.count ?? 0
              const pct = totalAnswers > 0 ? (count / totalAnswers) * 100 : 0
              const isCorrect = oi === q.correctIndex
              return (
                <div key={oi}>
                  <div className="flex items-center gap-3 mb-0.5">
                    <span className="text-[11px] font-bold w-5 shrink-0" style={{ color: OPTION_COLORS[oi] }}>{OPTION_LABELS[oi]}</span>
                    <span className="text-[12px] text-text-muted flex-1">{opt}</span>
                    {isCorrect && <span className="text-[11px] text-green-400">✓ Correcta</span>}
                    <span className="text-[12px] text-text-muted tabular-nums">{count}</span>
                  </div>
                  <div className="relative h-2 rounded-full bg-line overflow-hidden ml-8">
                    <motion.div
                      className="absolute left-0 top-0 h-full rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                      style={{ background: isCorrect ? '#22c55e' : OPTION_COLORS[oi] + '80' }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Controles activos */}
      {activeQuiz.status === 'active' && (
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={nextQuestion}
            disabled={advancing}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-medium text-black"
            style={{ background: '#00C228' }}
          >
            {advancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
            {isLast ? 'Finalizar quiz' : 'Siguiente pregunta'}
          </button>
          <button
            onClick={() => { void loadLeaderboard(activeQuiz.id); setShowLeaderboard(true) }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle transition-colors"
          >
            <BarChart2 className="h-3.5 w-3.5" />
            Clasificacion
          </button>
          <button
            onClick={endQuiz}
            disabled={advancing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle transition-colors"
          >
            <Square className="h-3.5 w-3.5" />
            Terminar
          </button>
        </div>
      )}

      {/* Estado terminado */}
      {activeQuiz.status === 'ended' && (
        <div className="rounded-2xl p-6 bg-subtle border border-line">
          <div className="text-[16px] font-semibold text-text mb-1">Quiz terminado</div>
          <div className="text-[13px] text-text-muted mb-5">Los participantes pueden ver su puntaje final.</div>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => { void loadLeaderboard(activeQuiz.id); setShowLeaderboard(true) }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium text-black"
              style={{ background: '#00C228' }}
            >
              <BarChart2 className="h-4 w-4" />
              Ver clasificacion final
            </button>
            <button
              onClick={restartQuiz}
              disabled={advancing}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle border border-line transition-colors"
            >
              {advancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Reiniciar con nuevo PIN
            </button>
          </div>
        </div>
      )}

      {/* Panel deslizante de clasificación */}
      <AnimatePresence>
        {showLeaderboard && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-20"
              onClick={() => setShowLeaderboard(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed right-0 top-0 h-full w-80 bg-bg border-l border-line z-30 flex flex-col"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
                <span className="text-[14px] font-semibold text-text">Clasificacion</span>
                <button onClick={() => setShowLeaderboard(false)} className="text-text-subtle hover:text-text transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto">
                {leaderboard.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-text-subtle text-[13px]">
                    Sin respuestas aun
                  </div>
                ) : leaderboard.map((entry, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center gap-3 px-5 py-3 border-b border-line"
                  >
                    <span
                      className="text-[13px] font-black w-5 text-right flex-shrink-0"
                      style={{ color: i < 3 ? MEDAL_COLORS[i] : 'rgb(var(--text-subtle))' }}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 text-[13px] text-text truncate">{entry.display_name}</span>
                    <span className="text-[12px] font-semibold tabular-nums" style={{ color: '#00C228' }}>
                      {entry.score}
                    </span>
                    <span className="text-[11px] text-text-subtle tabular-nums">
                      {entry.correct}/{activeQuiz.questions.length}
                    </span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
