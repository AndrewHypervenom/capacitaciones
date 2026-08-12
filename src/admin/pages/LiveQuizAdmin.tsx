import { useState, useEffect, useCallback, useRef } from 'react'
import type { CSSProperties } from 'react'
import {
  Plus, Trash2, ChevronLeft, ChevronRight, Square, Play, Copy, Check,
  Loader2, Zap, X, BarChart2, RefreshCw, Pencil, Users, Clock, AlertTriangle,
} from 'lucide-react'
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { supabase } from '@/lib/supabase'
import { toUtcMs } from '@/lib/datetime'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { resolveCreationCampaignId } from '@/stores/campaignScopeStore'
import { requestDeletion } from '@/services/audit.service'
import { toast } from '@/stores/toastStore'
import { deletionToast } from '@/lib/deletionToast'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import type { LiveQuiz, QuizQuestion, Campaign, QuizLeaderboardEntry, LiveQuizAnswer } from '@/types/database'
import { FadeIn } from '@/components/ui/motion'
import type { RealtimeChannel } from '@supabase/supabase-js'

const OPTION_LABELS = ['A', 'B', 'C', 'D']
const OPTION_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#22c55e']
const MEDAL_COLORS = ['#ca8a04', '#6b7280', '#b45309']

function generatePin(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

// Vigencia del código (minutos). 0 = sin límite.
const DEFAULT_PIN_TTL_MIN = 120
const PIN_TTL_OPTIONS = [30, 60, 120, 240, 480, 0]

// Fecha ISO de expiración a partir de una vigencia en minutos (null = sin límite).
function expiryFromTtl(min: number): string | null {
  return min > 0 ? new Date(Date.now() + min * 60_000).toISOString() : null
}

// Formatea milisegundos restantes como "1h 05m" o "04:32".
function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function emptyQuestion(): QuizQuestion {
  return { text: '', options: ['', '', '', ''], correctIndex: 0, timeLimitSec: 20 }
}

// Traduce un error de Supabase/Postgres a algo que un capacitador entienda.
// Sin esto, cada fallo (RLS, red, PIN repetido) se veía igual: nada pasaba.
function dbReason(error: { code?: string; message?: string } | null): string {
  if (!error) return i18n.t('livequiz.db_unknown')
  const msg = error.message ?? ''
  if (error.code === '42501' || /row-level security|permission denied/i.test(msg)) return i18n.t('livequiz.db_denied')
  if (error.code === 'PGRST116') return i18n.t('livequiz.db_no_rows')
  if (error.code === '23505') return i18n.t('livequiz.db_duplicate')
  if (error.code === '23503') return i18n.t('livequiz.db_fk')
  if (/failed to fetch|network|fetch error/i.test(msg)) return i18n.t('livequiz.db_offline')
  return msg || i18n.t('livequiz.db_unknown')
}

// Requisitos del formulario, cumplidos y pendientes. Se muestran SIEMPRE (no
// solo al intentar guardar) para que nunca haya que adivinar por qué no deja crear.
type Step = { id: string; label: string; done: boolean; hint: string }
type FormCheck = { steps: Step[]; pending: Step[]; badTitle: boolean; badCampaign: boolean; badQuestions: Set<number> }

// Iniciales para el avatar del ranking
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Número que cuenta hasta su valor con animación suave
function CountUp({ value, className, style }: { value: number; className?: string; style?: CSSProperties }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString())
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.7, ease: [0.16, 1, 0.3, 1] })
    return controls.stop
  }, [value, mv])
  return <motion.span className={className} style={style}>{text}</motion.span>
}

type View = 'list' | 'create' | 'session'
type AnswerCount = { option: number; count: number; is_correct: boolean }[]

export default function LiveQuizAdmin() {
  const { profile, campaignId, isSuperAdmin, user } = useAuth()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [view, setView] = useState<View>('list')
  const [quizzes, setQuizzes] = useState<LiveQuiz[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [filterCampaign, setFilterCampaign] = useState<string>('all')

  // Formulario de creación / edición
  const [formTitle, setFormTitle] = useState('')
  // Se resuelve al cargar las campañas accesibles. NO se parte de la campaña
  // "casa": creando desde la campaña B, el quiz se guardaba en la casa A.
  const [formCampaign, setFormCampaign] = useState('')
  const [formQuestions, setFormQuestions] = useState<QuizQuestion[]>([emptyQuestion()])
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showIssues, setShowIssues] = useState(false)   // marca en rojo lo que falta, tras intentar guardar
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [formTtlMin, setFormTtlMin] = useState(DEFAULT_PIN_TTL_MIN)  // vigencia del código, en minutos (0 = sin límite)

  // Sesión
  const [activeQuiz, setActiveQuiz] = useState<LiveQuiz | null>(null)
  const [answerCounts, setAnswerCounts] = useState<AnswerCount>([])
  const [totalAnswers, setTotalAnswers] = useState(0)
  const [participantCount, setParticipantCount] = useState(0)
  const [participants, setParticipants] = useState<string[]>([])
  const [answeredNames, setAnsweredNames] = useState<string[]>([])
  const [pinCopied, setPinCopied] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [leaderboard, setLeaderboard] = useState<QuizLeaderboardEntry[]>([])
  const showLeaderboardRef = useRef(false)
  useEffect(() => { showLeaderboardRef.current = showLeaderboard }, [showLeaderboard])
  const autoRevealedQ = useRef(-1)

  // Reloj para la cuenta regresiva de vigencia del código
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    if (view !== 'session') return
    const id = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [view])

  // Campañas accesibles (superadmin: todas; capacitador: casa + colaboraciones).
  const accessibleIds = campaigns.map((c) => c.id)
  const accessibleKey = accessibleIds.join(',')

  // ── Cargar lista ──────────────────────────────────────────────────────────────
  const loadQuizzes = useCallback(async () => {
    setLoadingList(true)
    const query = supabase.from('live_quizzes').select('*').order('created_at', { ascending: false })
    // El capacitador ve los quizzes de todas sus campañas (casa + colaboraciones).
    if (!isSuperAdmin) {
      const ids = accessibleKey ? accessibleKey.split(',') : (campaignId ? [campaignId] : [])
      if (ids.length === 0) { setQuizzes([]); setLoadingList(false); return }
      query.in('campaign_id', ids)
    }
    const { data, error } = await query
    if (error) toast.error(t('livequiz.err_list'), dbReason(error))
    setQuizzes((data ?? []) as unknown as LiveQuiz[])
    setLoadingList(false)
  }, [isSuperAdmin, accessibleKey, campaignId, t])

  // Superadmin: todas. Capacitador: su campaña casa + donde colabora (equipos).
  useEffect(() => {
    getAccessibleCampaigns({
      isSuperAdmin,
      homeCampaignId: campaignId,
      userId: user?.id ?? null,
    })
      .then((data) => {
        setCampaigns(data)
        const ids = data.map((c) => c.id)
        // Editando un quiz existente se respeta la suya (la fija startEdit).
        setFormCampaign((prev) =>
          prev && ids.includes(prev) ? prev : resolveCreationCampaignId(null, ids),
        )
      })
      .catch((e: { code?: string; message?: string }) => {
        // Sin campañas no se puede crear nada: hay que decirlo, no quedarse mudo.
        toast.error(t('livequiz.err_campaigns'), dbReason(e))
      })
  }, [isSuperAdmin, campaignId, user?.id, t])

  useEffect(() => {
    void loadQuizzes()
  }, [loadQuizzes])

  // ── Conteo de respuestas + tiempo real para sesión activa ────────────────────
  const fetchAnswerCounts = useCallback(async (quiz: LiveQuiz) => {
    if (quiz.current_question < 0) return
    const { data } = await supabase
      .from('live_quiz_answers')
      .select('selected_option, is_correct, display_name')
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
    setAnsweredNames([...new Set(data.map((r) => r.display_name))])
  }, [])

  const loadLeaderboard = useCallback(async (quizId: string) => {
    // Ranking agregado por usuario vía RPC (mismo cálculo para anfitrión y aprendiz).
    const { data: rpc, error } = await supabase.rpc('get_live_quiz_leaderboard', { p_quiz_id: quizId })
    if (!error && rpc) { setLeaderboard(rpc as QuizLeaderboardEntry[]); return }

    // Respaldo si el RPC aún no está desplegado.
    const { data } = await supabase
      .from('live_quiz_answers')
      .select('user_id, display_name, is_correct, score')
      .eq('quiz_id', quizId)
    if (!data) return
    const map = new Map<string, QuizLeaderboardEntry>()
    for (const row of data) {
      const key = row.user_id ?? row.display_name
      const entry = map.get(key) ?? { user_id: row.user_id, display_name: row.display_name, correct: 0, total: 0, score: 0 }
      entry.total++
      if (row.is_correct) entry.correct++
      entry.score += (row as LiveQuizAnswer).score ?? 0
      entry.display_name = row.display_name
      map.set(key, entry)
    }
    setLeaderboard([...map.values()].sort((a, b) => b.score - a.score || b.correct - a.correct))
  }, [])

  useEffect(() => {
    if (!activeQuiz) return

    let presenceChannel: RealtimeChannel

    const channel = supabase
      .channel(`admin-quiz-${activeQuiz.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'live_quizzes', filter: `id=eq.${activeQuiz.id}` },
        (payload) => {
          const updated = payload.new as LiveQuiz
          setActiveQuiz((prev) => ({ ...prev!, ...updated, questions: prev!.questions }))
          setAnswerCounts([])
          setTotalAnswers(0)
          setAnsweredNames([])
          setShowLeaderboard(false)  // ocultar ranking al cambiar de pregunta
        },
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_quiz_answers', filter: `quiz_id=eq.${activeQuiz.id}` },
        () => {
          void fetchAnswerCounts(activeQuiz)
          if (showLeaderboardRef.current) void loadLeaderboard(activeQuiz.id)
        },
      )
      .subscribe()

    const syncParticipants = () => {
      const state = presenceChannel.presenceState() as Record<string, { user_id?: string; name?: string }[]>
      const seen = new Map<string, string>()
      Object.values(state).flat().forEach((m) => {
        if (m?.user_id) seen.set(m.user_id, m.name ?? 'Participante')
      })
      const names = [...seen.values()].sort((a, b) => a.localeCompare(b))
      setParticipants(names)
      setParticipantCount(names.length)
    }

    presenceChannel = supabase
      .channel(`quiz-player-${activeQuiz.id}`)
      .on('presence', { event: 'sync' }, syncParticipants)
      .subscribe()

    void fetchAnswerCounts(activeQuiz)

    return () => {
      void supabase.removeChannel(channel)
      void supabase.removeChannel(presenceChannel)
    }
  }, [activeQuiz?.id, activeQuiz?.current_question, fetchAnswerCounts]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Revelar el ranking automáticamente cuando todos respondieron ────────────
  useEffect(() => {
    if (activeQuiz?.status !== 'active' || activeQuiz.current_question < 0) return
    if (participantCount > 0 &&
        answeredNames.length >= participantCount &&
        autoRevealedQ.current !== activeQuiz.current_question) {
      autoRevealedQ.current = activeQuiz.current_question
      void loadLeaderboard(activeQuiz.id)
      setShowLeaderboard(true)
    }
  }, [answeredNames.length, participantCount, activeQuiz?.status, activeQuiz?.current_question, activeQuiz?.id, loadLeaderboard])

  // ── Revisión del formulario ────────────────────────────────────────────────
  // Se calcula en cada render: alimenta tanto el aviso de "qué falta" como el
  // resaltado en rojo de los campos incompletos.
  const check: FormCheck = (() => {
    const badQuestions = new Set<number>()
    const badTitle = !formTitle.trim()
    const badCampaign = !formCampaign

    const steps: Step[] = [
      { id: 'title', label: t('livequiz.step_title'), done: !badTitle, hint: t('livequiz.issue_title') },
      {
        id: 'campaign',
        label: t('livequiz.step_campaign'),
        done: !badCampaign,
        hint: campaigns.length === 0 ? t('livequiz.issue_no_campaign') : t('livequiz.issue_campaign'),
      },
    ]

    formQuestions.forEach((q, i) => {
      // Un solo motivo por pregunta: el primero que la bloquea.
      let hint = ''
      if (!q.text.trim()) hint = t('livequiz.issue_question_text', { n: i + 1 })
      else if (q.options.filter((o) => o.trim()).length < 2) hint = t('livequiz.issue_question_options', { n: i + 1 })
      else if (!q.options[q.correctIndex]?.trim()) hint = t('livequiz.issue_correct_option', { n: i + 1 })
      if (hint) badQuestions.add(i)
      steps.push({ id: `q${i}`, label: t('livequiz.step_question', { n: i + 1 }), done: !hint, hint })
    })

    return { steps, pending: steps.filter((s) => !s.done), badTitle, badCampaign, badQuestions }
  })()

  // ── Abrir el formulario en blanco ──────────────────────────────────────────
  const startCreate = () => {
    setEditingId(null)
    setShowIssues(false)
    setFormTitle('')
    // Ojo: NO usar la campaña "casa" a secas. Si el usuario no la tiene entre
    // las accesibles (superadmin sin casa, capacitador invitado), el formulario
    // quedaba con una campaña inválida y el botón Crear no hacía nada.
    setFormCampaign(resolveCreationCampaignId(null, accessibleIds))
    setFormQuestions([emptyQuestion()])
    setFormTtlMin(DEFAULT_PIN_TTL_MIN)
    setView('create')
  }

  // ── Abrir la sesión de un quiz de la lista ─────────────────────────────────
  // Se relee de la BD: así el estado/PIN están frescos y, si la fila ya no es
  // visible (borrada o sin permiso), se dice en vez de abrir una pantalla muerta.
  const openSession = async (quiz: LiveQuiz) => {
    setOpeningId(quiz.id)
    const { data, error } = await supabase.from('live_quizzes').select('*').eq('id', quiz.id).maybeSingle()
    setOpeningId(null)
    if (error) { toast.error(t('livequiz.err_open'), dbReason(error)); return }
    if (!data) {
      toast.error(t('livequiz.err_open'), t('livequiz.err_open_gone'))
      void loadQuizzes()
      return
    }
    const fresh = { ...data, questions: (data.questions ?? []) as unknown as QuizQuestion[] } as LiveQuiz
    if (fresh.questions.length === 0) toast.info(t('livequiz.err_no_questions'))
    setActiveQuiz(fresh)
    setView('session')
  }

  // ── Abrir formulario en modo edición ───────────────────────────────────────
  const startEdit = (quiz: LiveQuiz) => {
    if (quiz.status === 'active') {
      toast.info(t('admin.livequiz.edit_locked'), t('livequiz.edit_locked_hint'))
      return
    }
    setShowIssues(false)
    setEditingId(quiz.id)
    setFormTitle(quiz.title)
    setFormCampaign(quiz.campaign_id)
    setFormQuestions(quiz.questions.length ? quiz.questions : [emptyQuestion()])
    setView('create')
  }

  // ── Guardar cambios de un quiz existente ────────────────────────────────────
  const handleUpdate = async () => {
    if (!editingId) return
    if (check.pending.length > 0) {
      // Además de marcar en rojo, se nombra el primer motivo: el usuario no
      // tiene que buscar qué campo se puso rojo.
      setShowIssues(true)
      toast.error(t('livequiz.toast_missing'), check.pending[0].hint)
      return
    }
    setCreating(true)
    const { data, error } = await supabase
      .from('live_quizzes')
      .update({
        title: formTitle.trim(),
        campaign_id: formCampaign || undefined,
        questions: formQuestions as unknown as never,
      })
      .eq('id', editingId)
      .select()
    setCreating(false)
    if (error) { toast.error(t('livequiz.err_update'), dbReason(error)); return }
    // 0 filas = la RLS dejó pasar la consulta pero no la fila. Sin este aviso
    // parecía que se guardaba y al volver estaba igual.
    if (!data || data.length === 0) { toast.error(t('livequiz.err_update'), t('livequiz.db_no_rows')); return }
    toast.success(t('livequiz.saved_ok'))
    setEditingId(null)
    setView('list')
    void loadQuizzes()
  }

  // ── Crear ─────────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (editingId) return handleUpdate()
    if (check.pending.length > 0) {
      // Además de marcar en rojo, se nombra el primer motivo: el usuario no
      // tiene que buscar qué campo se puso rojo.
      setShowIssues(true)
      toast.error(t('livequiz.toast_missing'), check.pending[0].hint)
      return
    }
    if (!profile?.id) { toast.error(t('livequiz.err_create'), t('livequiz.err_no_profile')); return }

    setCreating(true)
    const pin = generatePin()
    const { data, error } = await supabase
      .from('live_quizzes')
      .insert({
        title: formTitle.trim(),
        campaign_id: formCampaign,
        created_by: profile.id,
        pin,
        pin_expires_at: expiryFromTtl(formTtlMin),
        questions: formQuestions as unknown as never,
      })
      .select()
      .single()

    setCreating(false)
    if (error || !data) { toast.error(t('livequiz.err_create'), dbReason(error)); return }

    const quiz = { ...data, questions: formQuestions } as LiveQuiz
    toast.success(t('livequiz.created_ok'), t('livequiz.created_ok_hint', { pin: quiz.pin }))
    setShowIssues(false)
    setActiveQuiz(quiz)
    setView('session')
    void loadQuizzes()
  }

  // ── Eliminar ─────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: t('confirm.delete_quiz_title'),
      description: t('confirm.delete_quiz_desc'),
    })
    if (!ok) return
    try {
      const result = await requestDeletion('live_quizzes', id)
      toast.success(deletionToast(result, t('livequiz.deleted_ok')))
    } catch (e) {
      // Antes esto reventaba la promesa y el quiz seguía en pantalla sin explicación.
      toast.error(t('livequiz.err_delete'), dbReason(e as { code?: string; message?: string }))
    }
    void loadQuizzes()
  }

  // ── Duplicar ──────────────────────────────────────────────────────────────
  const handleDuplicate = async (q: LiveQuiz) => {
    if (!profile?.id) { toast.error(t('livequiz.err_duplicate'), t('livequiz.err_no_profile')); return }
    const pin = generatePin()
    const { error } = await supabase.from('live_quizzes').insert({
      title: `${q.title} (copia)`,
      campaign_id: q.campaign_id,
      created_by: profile.id,
      pin,
      questions: q.questions as unknown as never,
    })
    if (error) { toast.error(t('livequiz.err_duplicate'), dbReason(error)); return }
    toast.success(t('livequiz.duplicated_ok'))
    void loadQuizzes()
  }

  // ── Controles de sesión ───────────────────────────────────────────────────────
  // Toda actualización pasa por aquí: si la BD no cambió ninguna fila (RLS,
  // quiz borrado) el anfitrión se entera en vez de ver un botón que no responde.
  const applySessionUpdate = async (
    patch: Partial<Pick<LiveQuiz, 'status' | 'current_question' | 'pin' | 'question_started_at' | 'pin_expires_at'>>,
    errTitle: string,
  ): Promise<LiveQuiz | null> => {
    if (!activeQuiz) return null
    const { data, error } = await supabase
      .from('live_quizzes')
      .update(patch)
      .eq('id', activeQuiz.id)
      .select()
    if (error) { toast.error(errTitle, dbReason(error)); return null }
    const row = data?.[0] as unknown as LiveQuiz | undefined
    if (!row) { toast.error(errTitle, t('livequiz.db_no_rows')); return null }
    setActiveQuiz((prev) => ({ ...prev!, ...row }))
    return row
  }

  const startQuiz = async () => {
    if (!activeQuiz) return
    if (activeQuiz.questions.length === 0) {
      toast.error(t('livequiz.err_start'), t('livequiz.err_no_questions'))
      return
    }
    setAdvancing(true)
    await applySessionUpdate(
      { status: 'active', current_question: 0, question_started_at: new Date().toISOString() },
      t('livequiz.err_start'),
    )
    setAdvancing(false)
  }

  const nextQuestion = async () => {
    if (!activeQuiz) return
    setAdvancing(true)
    const nextIdx = activeQuiz.current_question + 1
    const isLast = nextIdx >= activeQuiz.questions.length
    await applySessionUpdate(
      isLast
        ? { status: 'ended', current_question: -1 }
        : { current_question: nextIdx, question_started_at: new Date().toISOString() },
      t('livequiz.err_advance'),
    )
    setAdvancing(false)
  }

  const endQuiz = async () => {
    if (!activeQuiz) return
    setAdvancing(true)
    await applySessionUpdate({ status: 'ended', current_question: -1 }, t('livequiz.err_end'))
    setAdvancing(false)
  }

  const restartQuiz = async () => {
    if (!activeQuiz) return
    const ok = await confirm({
      title: t('confirm.restart_quiz_title'),
      description: t('confirm.restart_quiz_desc'),
      confirmLabel: t('confirm.restart'),
      tone: 'default',
    })
    if (!ok) return
    setAdvancing(true)
    const newPin = generatePin()
    const { error: delError } = await supabase.from('live_quiz_answers').delete().eq('quiz_id', activeQuiz.id)
    if (delError) { toast.error(t('livequiz.err_restart'), dbReason(delError)); setAdvancing(false); return }
    const row = await applySessionUpdate(
      { status: 'lobby', current_question: -1, pin: newPin, question_started_at: null, pin_expires_at: expiryFromTtl(DEFAULT_PIN_TTL_MIN) },
      t('livequiz.err_restart'),
    )
    if (row) {
      setAnswerCounts([])
      setTotalAnswers(0)
      setLeaderboard([])
      setShowLeaderboard(false)
      autoRevealedQ.current = -1
      toast.success(t('livequiz.restarted_ok'), t('livequiz.created_ok_hint', { pin: row.pin }))
    }
    setAdvancing(false)
  }

  // ── Renovar código: nuevo PIN + nueva vigencia, sin borrar respuestas ────────
  const renewPin = async () => {
    if (!activeQuiz) return
    setAdvancing(true)
    const row = await applySessionUpdate(
      { pin: generatePin(), pin_expires_at: expiryFromTtl(DEFAULT_PIN_TTL_MIN) },
      t('livequiz.err_renew'),
    )
    if (row) toast.success(t('livequiz.renewed_ok'), t('livequiz.created_ok_hint', { pin: row.pin }))
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

  // Mostrar filtro/columna de campaña cuando el usuario abarca más de una
  // (superadmin, o capacitador con campañas compartidas).
  const showCampaignCol = campaigns.length > 1

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  // ── Vista de lista ──────────────────────────────────────────────────────────
  if (view === 'list') return (
    <div className="p-4 sm:p-8">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-text">{i18n.t('livequiz.tag')}</h1>
          <p className="text-text-muted text-[13px] mt-1">{i18n.t('admin.livequiz.subtitle')}</p>
        </div>
        <button
          onClick={startCreate}
          className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl text-[13px] font-medium text-black shrink-0"
          style={{ background: '#10D451' }}
        >
          <Zap className="h-4 w-4" />
          {i18n.t('admin.livequiz.create_quiz')}
        </button>
      </div>

      {/* Sin campañas accesibles no se puede crear: se explica en vez de dejar
          que el botón Crear no haga nada. */}
      {!loadingList && campaigns.length === 0 && (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3 mb-5 border"
          style={{ background: 'rgba(250,204,21,0.08)', borderColor: 'rgba(250,204,21,0.35)' }}>
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
          <div>
            <div className="text-[13px] font-medium text-text">{i18n.t('livequiz.no_campaign_title')}</div>
            <p className="text-[12px] text-text-muted mt-0.5">{i18n.t('livequiz.issue_no_campaign')}</p>
          </div>
        </div>
      )}

      {/* Filtro de campaña (cuando el usuario abarca más de una) */}
      {showCampaignCol && (
        <div className="flex gap-2 flex-wrap mb-5">
          <button
            onClick={() => setFilterCampaign('all')}
            className={`inline-flex items-center justify-center min-h-[36px] px-3 py-1 rounded-full text-[12px] transition-colors ${filterCampaign === 'all' ? 'text-[#10D451]' : 'bg-subtle text-text-muted hover:text-text'}`}
            style={filterCampaign === 'all' ? { background: 'rgba(16,212,81,0.12)', border: '1px solid rgba(16,212,81,0.3)' } : {}}
          >
            {i18n.t('livequiz.filter_all')}
          </button>
          {campaigns.map((c) => (
            <button
              key={c.id}
              onClick={() => setFilterCampaign(c.id)}
              className={`inline-flex items-center justify-center min-h-[36px] px-3 py-1 rounded-full text-[12px] transition-colors ${filterCampaign === c.id ? 'text-[#10D451]' : 'bg-subtle text-text-muted hover:text-text'}`}
              style={filterCampaign === c.id ? { background: 'rgba(16,212,81,0.12)', border: '1px solid rgba(16,212,81,0.3)' } : {}}
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
          {quizzes.length === 0 ? i18n.t('livequiz.empty_none') : i18n.t('livequiz.empty_campaign')}
        </div>
      ) : (
        <FadeIn className="rounded-2xl border border-line overflow-x-auto" y={14}>
        <div className="min-w-[720px]">
          <div className={`grid ${showCampaignCol ? 'grid-cols-[1fr_auto_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto]'} gap-4 px-5 py-3 text-[11px] uppercase tracking-wider text-text-muted bg-subtle`}>
            <span>{i18n.t('admin.livequiz.col_title')}</span>
            {showCampaignCol && <span>{i18n.t('admin.worlds.campaign')}</span>}
            <span>PIN</span>
            <span>{i18n.t('admin.livequiz.col_status')}</span>
            <span />
          </div>
          {filteredQuizzes.map((q) => {
            const campName = campaigns.find((c) => c.id === q.campaign_id)?.name
            return (
              <div
                key={q.id}
                className={`grid ${showCampaignCol ? 'grid-cols-[1fr_auto_auto_auto_auto]' : 'grid-cols-[1fr_auto_auto_auto]'} gap-4 px-5 py-4 items-center border-t border-line transition-colors hover:bg-subtle/40`}
              >
                <div>
                  <div className="text-[13px] text-text">{q.title}</div>
                  <div className="text-[11px] text-text-subtle">{q.questions.length} pregunta{q.questions.length !== 1 ? 's' : ''}</div>
                </div>
                {showCampaignCol && (
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
                    onClick={() => void openSession(q)}
                    disabled={openingId === q.id}
                    className="inline-flex items-center gap-1.5 min-h-[36px] text-[12px] text-text-muted hover:text-text px-3 py-1 rounded-lg hover:bg-subtle transition-colors whitespace-nowrap disabled:opacity-60"
                  >
                    {openingId === q.id && <Loader2 className="h-3 w-3 animate-spin" />}
                    {i18n.t('admin.livequiz.manage')} →
                  </button>
                  <button
                    onClick={() => startEdit(q)}
                    title={q.status === 'active' ? i18n.t('admin.livequiz.edit_locked') : i18n.t('common.edit')}
                    className={`h-10 w-10 flex items-center justify-center rounded-lg transition-colors ${q.status === 'active' ? 'text-text-subtle/40 hover:bg-subtle' : 'text-text-subtle hover:text-text hover:bg-subtle'}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDuplicate(q)}
                    title={i18n.t('admin.livequiz.duplicate')}
                    className="h-10 w-10 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-subtle transition-colors"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(q.id)}
                    className="h-10 w-10 flex items-center justify-center rounded-lg text-text-subtle hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    title={i18n.t('confirm.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        </FadeIn>
      )}
    </div>
  )

  // ── Vista de creación ────────────────────────────────────────────────────────
  if (view === 'create') return (
    <div className="p-4 sm:p-8 max-w-2xl">
      <button onClick={() => { setEditingId(null); setShowIssues(false); setView('list') }} className="flex items-center gap-1.5 min-h-[44px] text-[13px] text-text-muted hover:text-text mb-6 transition-colors">
        <ChevronLeft className="h-4 w-4" /> {i18n.t('common.back')}
      </button>
      <h1 className="text-[22px] font-bold text-text mb-4">{editingId ? i18n.t('common.edit_quiz') : i18n.t('admin.livequiz.create_quiz')}</h1>

      {/* Sin campaña accesible no hay nada que hacer: se dice de entrada, con
          el motivo y a quién pedírselo, en vez de dejar morir el botón Crear. */}
      {campaigns.length === 0 && (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3 mb-5 border"
          style={{ background: 'rgba(250,204,21,0.08)', borderColor: 'rgba(250,204,21,0.35)' }}>
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
          <div>
            <div className="text-[13px] font-medium text-text">{i18n.t('livequiz.no_campaign_title')}</div>
            <p className="text-[12px] text-text-muted mt-0.5">{i18n.t('livequiz.issue_no_campaign')}</p>
          </div>
        </div>
      )}

      {/* Lista de requisitos en vivo: qué falta y por qué, antes de tocar nada */}
      <div
        className="rounded-2xl px-4 py-3 mb-6 border transition-colors"
        style={
          check.pending.length === 0
            ? { background: 'rgba(16,212,81,0.07)', borderColor: 'rgba(16,212,81,0.35)' }
            : showIssues
              ? { background: 'rgba(239,68,68,0.07)', borderColor: 'rgba(239,68,68,0.35)' }
              : { background: 'rgb(var(--subtle))', borderColor: 'rgb(var(--line))' }
        }
      >
        <div className="flex items-center gap-2">
          {check.pending.length === 0
            ? <Check className="h-4 w-4 shrink-0" style={{ color: '#10D451' }} />
            : <AlertTriangle className={`h-4 w-4 shrink-0 ${showIssues ? 'text-red-400' : 'text-text-subtle'}`} />}
          <span className="text-[13px] font-medium text-text">
            {check.pending.length === 0
              ? i18n.t(editingId ? 'livequiz.checklist_ready_edit' : 'livequiz.checklist_ready')
              : i18n.t(editingId ? 'livequiz.checklist_title_edit' : 'livequiz.checklist_title')}
          </span>
        </div>

        {check.pending.length === 0 ? (
          !editingId && <p className="text-[12px] text-text-muted mt-1 ml-6">{i18n.t('livequiz.checklist_ready_hint')}</p>
        ) : (
          <ul className="mt-2 ml-0.5 space-y-1">
            {check.steps.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-[12px]">
                {s.done ? (
                  <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: '#10D451' }} />
                ) : (
                  <span className={`h-3 w-3 mt-1 shrink-0 rounded-full border-2 ${showIssues ? 'border-red-400' : 'border-text-subtle'}`} />
                )}
                <span className={s.done ? 'text-text-subtle line-through' : 'text-text'}>
                  {s.label}
                  {!s.done && <span className="text-text-muted"> — {s.hint}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4 mb-6">
        <div>
          <input
            type="text"
            placeholder={i18n.t('admin.livequiz.ph_quiz_title')}
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            className="w-full rounded-xl px-4 py-2.5 min-h-[44px] text-[14px] text-text bg-subtle border outline-none focus:border-[#10D451] transition-colors"
            style={{ borderColor: showIssues && check.badTitle ? '#ef4444' : 'rgb(var(--line))' }}
          />
          {showIssues && check.badTitle && (
            <p className="text-[11px] text-red-400 mt-1.5">{i18n.t('livequiz.issue_title')}</p>
          )}
        </div>
        {campaigns.length > 1 ? (
          <div>
            <FilterDropdown
              value={formCampaign}
              onChange={setFormCampaign}
              options={[
                { value: '', label: i18n.t('livequiz.select_campaign') },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            {showIssues && check.badCampaign && (
              <p className="text-[11px] text-red-400 mt-1.5">{i18n.t('livequiz.issue_campaign')}</p>
            )}
          </div>
        ) : (
          // Con una sola campaña no hay nada que elegir, pero sí que confirmar:
          // el capacitador debe saber dónde va a quedar el quiz.
          <p className="text-[11px] text-text-subtle">
            {campaigns.length === 1
              ? i18n.t('livequiz.create_target', { name: campaigns[0].name })
              : i18n.t('livequiz.issue_no_campaign')}
          </p>
        )}

        {/* Vigencia del código — solo al crear */}
        {!editingId && (
          <div className="rounded-xl px-4 py-3 bg-subtle border border-line">
            <div className="flex items-center gap-1.5 mb-2">
              <Clock className="h-3.5 w-3.5 text-text-subtle" />
              <span className="text-[12px] font-medium text-text">{i18n.t('admin.livequiz.code_validity')}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PIN_TTL_OPTIONS.map((min) => (
                <button
                  key={min}
                  onClick={() => setFormTtlMin(min)}
                  className="flex items-center justify-center min-h-[36px] px-3 py-1 rounded-lg text-[12px] transition-colors"
                  style={{
                    background: formTtlMin === min ? 'rgba(16,212,81,0.15)' : 'rgb(var(--line))',
                    color: formTtlMin === min ? '#10D451' : 'rgb(var(--text-muted))',
                  }}
                >
                  {min === 0 ? i18n.t('admin.livequiz.ttl_none') : i18n.t('admin.livequiz.ttl_value', { label: min < 60 ? `${min} min` : `${min / 60} h` })}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-text-subtle mt-2">{i18n.t('admin.livequiz.code_validity_hint')}</p>
          </div>
        )}
      </div>

      <div className="space-y-4 mb-6">
        {formQuestions.map((q, qi) => (
          <div
            key={qi}
            className="rounded-2xl p-4 sm:p-5 bg-subtle border"
            style={{ borderColor: showIssues && check.badQuestions.has(qi) ? 'rgba(239,68,68,0.6)' : 'rgb(var(--line))' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-text-muted uppercase tracking-wider">{i18n.t('common.question_n', { n: qi + 1 })}</span>
              {formQuestions.length > 1 && (
                <button onClick={async () => {
                    if (await confirm({ title: t('confirm.delete_question_title'), description: t('confirm.delete_question_desc') }))
                      setFormQuestions((prev) => prev.filter((_, i) => i !== qi))
                  }}
                  className="text-text-subtle hover:text-red-400 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <input
              type="text"
              placeholder={i18n.t('admin.livequiz.ph_question')}
              value={q.text}
              onChange={(e) => updateQuestion(qi, { text: e.target.value })}
              className="w-full rounded-lg px-3 py-2 text-[13px] text-text bg-surface border border-line outline-none focus:border-[#10D451] transition-colors mb-3"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
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
                      placeholder={i18n.t('livequiz.option_label_ph', { label: OPTION_LABELS[oi] })}
                      value={opt}
                      onChange={(e) => updateOption(qi, oi, e.target.value)}
                      className="flex-1 rounded-lg px-2.5 py-1.5 text-[12px] text-text bg-surface border border-line outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
            {/* Aviso por pregunta: dice exactamente qué le falta a ESTA */}
            {showIssues && check.badQuestions.has(qi) && (
              <p className="text-[11px] text-red-400 mb-3">
                {!formQuestions[qi].text.trim()
                  ? i18n.t('livequiz.issue_question_text', { n: qi + 1 })
                  : formQuestions[qi].options.filter((o) => o.trim()).length < 2
                    ? i18n.t('livequiz.issue_question_options', { n: qi + 1 })
                    : i18n.t('livequiz.issue_correct_option', { n: qi + 1 })}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-text-subtle">{i18n.t('admin.livequiz.time_label')}</span>
              {[10, 15, 20, 30, 45].map((t) => (
                <button
                  key={t}
                  onClick={() => updateQuestion(qi, { timeLimitSec: t })}
                  className="flex items-center justify-center min-h-[36px] px-2.5 py-1 rounded-lg text-[11px] transition-colors"
                  style={{
                    background: q.timeLimitSec === t ? 'rgba(16,212,81,0.15)' : 'rgb(var(--line))',
                    color: q.timeLimitSec === t ? '#10D451' : 'rgb(var(--text-muted))',
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
          className="w-full rounded-xl py-3 min-h-[44px] text-[13px] text-text-muted hover:text-text border border-dashed border-line hover:border-line transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="h-4 w-4" /> {i18n.t('common.add_question')}
        </button>
      </div>

      {/* El botón nunca se deshabilita sin decir por qué: se puede pulsar
          siempre y, si falta algo, el texto de abajo lo nombra. */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleCreate}
          disabled={creating}
          title={check.pending.length > 0 ? check.pending[0].hint : undefined}
          className="flex items-center gap-2 px-6 py-2.5 min-h-[44px] rounded-xl text-[13px] font-medium text-black disabled:opacity-50 transition-opacity"
          style={{ background: '#10D451', opacity: check.pending.length > 0 ? 0.6 : 1 }}
        >
          {creating && <Loader2 className="h-4 w-4 animate-spin" />}
          {editingId ? i18n.t('common.save_changes') : i18n.t('livequiz.create_open')}
        </button>
        {check.pending.length > 0 && (
          <span className={`text-[12px] ${showIssues ? 'text-red-400' : 'text-text-muted'}`}>
            {i18n.t('livequiz.missing_count', { count: check.pending.length })}
          </span>
        )}
      </div>
    </div>
  )

  // ── Vista de sesión ───────────────────────────────────────────────────────────
  if (!activeQuiz) return null
  const q = activeQuiz.current_question >= 0 ? activeQuiz.questions[activeQuiz.current_question] : null
  const isLast = activeQuiz.current_question >= activeQuiz.questions.length - 1
  const pinExpiresMs = toUtcMs(activeQuiz.pin_expires_at)
  const pinRemainingMs = pinExpiresMs !== null ? pinExpiresMs - nowTs : null
  const pinExpired = pinRemainingMs !== null && pinRemainingMs <= 0
  const pinUrgent = pinRemainingMs !== null && pinRemainingMs > 0 && pinRemainingMs < 5 * 60_000

  return (
    <div className="p-4 sm:p-8 max-w-2xl relative">
      <button onClick={() => setView('list')} className="flex items-center gap-1.5 min-h-[44px] text-[13px] text-text-muted hover:text-text mb-6 transition-colors">
        <ChevronLeft className="h-4 w-4" /> {i18n.t('livequiz.back_to_list')}
      </button>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold text-text break-words">{activeQuiz.title}</h1>
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
        <div className="sm:text-right">
          <div className="text-[11px] text-text-subtle uppercase tracking-wider mb-1">{i18n.t('admin.livequiz.access_pin')}</div>
          <div className="flex items-center gap-2 sm:justify-end">
            <span className="font-mono text-[28px] font-bold text-text tracking-widest">{activeQuiz.pin}</span>
            <button onClick={copyPin} className="h-10 w-10 flex items-center justify-center text-text-subtle hover:text-text transition-colors">
              {pinCopied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <div className="text-[11px] text-text-subtle mt-1 break-all">
            {window.location.origin}/quiz
          </div>

          {/* Vigencia del código */}
          <div className="flex items-center gap-2 sm:justify-end mt-2">
            {pinRemainingMs === null ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-text-subtle">
                <Clock className="h-3 w-3" /> {i18n.t('admin.livequiz.ttl_none')}
              </span>
            ) : pinExpired ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-400">
                <Clock className="h-3 w-3" /> {i18n.t('admin.livequiz.code_expired')}
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium tabular-nums"
                style={{ color: pinUrgent ? '#ef4444' : 'rgb(var(--text-subtle))' }}
              >
                <Clock className="h-3 w-3" />
                {i18n.t('admin.livequiz.code_expires_in', { time: formatRemaining(pinRemainingMs) })}
              </span>
            )}
            <button
              onClick={renewPin}
              disabled={advancing}
              title={i18n.t('admin.livequiz.renew_code')}
              className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text px-2 py-1 rounded-lg hover:bg-subtle transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${advancing ? 'animate-spin' : ''}`} />
              {i18n.t('admin.livequiz.renew_code')}
            </button>
          </div>
        </div>
      </div>

      {/* Un quiz sin preguntas no se puede iniciar: se avisa antes de intentarlo */}
      {activeQuiz.questions.length === 0 && (
        <div className="flex items-start gap-3 rounded-2xl px-4 py-3 mb-4 border"
          style={{ background: 'rgba(250,204,21,0.08)', borderColor: 'rgba(250,204,21,0.35)' }}>
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
          <div>
            <div className="text-[13px] font-medium text-text">{i18n.t('livequiz.err_no_questions')}</div>
            <button
              onClick={() => startEdit(activeQuiz)}
              className="text-[12px] mt-0.5 underline underline-offset-2"
              style={{ color: '#10D451' }}
            >
              {i18n.t('livequiz.add_questions_cta')}
            </button>
          </div>
        </div>
      )}

      {/* Estado de lobby */}
      {activeQuiz.status === 'lobby' && (
        <div className="rounded-2xl p-4 sm:p-8 mb-6 bg-subtle border border-line">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Users className="h-4 w-4" style={{ color: '#10D451' }} />
            <span className="text-[15px] font-bold text-text tabular-nums">{participantCount}</span>
            <span className="text-[13px] text-text-muted">
              {i18n.t('admin.livequiz.in_room', { count: participantCount })}
            </span>
          </div>
          <div className="text-text-subtle text-[12px] text-center mb-5">{i18n.t('admin.livequiz.share_pin')}</div>

          {/* Rejilla de participantes que van entrando */}
          {participants.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-text-subtle text-[13px] gap-3">
              <Loader2 className="h-6 w-6 animate-spin" style={{ color: '#10D451' }} />
              {i18n.t('admin.livequiz.waiting_players')}
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-2 mb-6">
              <AnimatePresence>
                {participants.map((name) => (
                  <motion.span
                    key={name}
                    layout
                    initial={{ opacity: 0, scale: 0.5, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                    className="px-3 py-1.5 rounded-full text-[13px] font-semibold text-text max-w-[160px] truncate"
                    style={{ background: 'rgba(16,212,81,0.12)', border: '1px solid rgba(16,212,81,0.3)' }}
                  >
                    {name}
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
          )}

          <button
            onClick={startQuiz}
            disabled={advancing}
            className="flex items-center gap-2 px-8 py-3 rounded-xl text-[14px] font-medium text-black mx-auto"
            style={{ background: '#10D451' }}
          >
            {advancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {i18n.t('admin.livequiz.start_quiz')}
          </button>
        </div>
      )}

      {/* Pregunta activa */}
      {activeQuiz.status === 'active' && q && (
        <div className="rounded-2xl p-4 sm:p-5 mb-4 bg-subtle border border-line">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-text-muted uppercase tracking-wider">
              {i18n.t('livequiz.question_of', { n: activeQuiz.current_question + 1, total: activeQuiz.questions.length })}
            </span>
            <span className="text-[12px] text-text-subtle">{i18n.t('livequiz.answers_count', { count: totalAnswers })}</span>
          </div>
          <p className="text-[16px] text-text font-medium mb-5">{q.text}</p>

          <div className="space-y-2.5">
            {q.options.map((opt, oi) => {
              const entry = answerCounts.find((a) => a.option === oi)
              const count = entry?.count ?? 0
              const pct = totalAnswers > 0 ? (count / totalAnswers) * 100 : 0
              const isCorrect = oi === q.correctIndex
              return (
                <motion.div
                  key={oi}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: oi * 0.06, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="flex items-center gap-3 mb-1">
                    <span
                      className="h-5 w-5 rounded-md flex items-center justify-center text-[10px] font-black text-white shrink-0"
                      style={{ background: OPTION_COLORS[oi] }}
                    >
                      {OPTION_LABELS[oi]}
                    </span>
                    <span className="text-[12px] text-text-muted flex-1 min-w-0 truncate">{opt}</span>
                    {isCorrect && (
                      <motion.span
                        initial={{ scale: 0 }} animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 18, delay: 0.2 }}
                        className="text-[11px] font-semibold text-green-400"
                      >
                        {i18n.t('admin.livequiz.correct_mark')}
                      </motion.span>
                    )}
                    <CountUp value={count} className="text-[12px] font-semibold text-text-muted tabular-nums w-6 text-right" />
                  </div>
                  <div className="relative h-2.5 rounded-full bg-line overflow-hidden ml-8">
                    <motion.div
                      className="absolute left-0 top-0 h-full rounded-full"
                      initial={{ width: '0%' }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                      style={{
                        background: isCorrect ? '#22c55e' : OPTION_COLORS[oi] + '99',
                        boxShadow: isCorrect && pct > 0 ? '0 0 10px rgba(34,197,94,0.5)' : undefined,
                      }}
                    />
                  </div>
                </motion.div>
              )
            })}
          </div>
        </div>
      )}

      {/* Quién está respondiendo — en vivo */}
      {activeQuiz.status === 'active' && q && (
        <div className="rounded-2xl p-4 sm:p-5 mb-4 bg-subtle border border-line">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
              <Users className="h-3.5 w-3.5" style={{ color: '#10D451' }} />
              {i18n.t('admin.livequiz.who_answered')}
            </span>
            <span className="text-[12px] font-bold tabular-nums" style={{ color: '#10D451' }}>
              {answeredNames.length}<span className="text-text-subtle font-normal"> / {participantCount || answeredNames.length}</span>
            </span>
          </div>
          {participants.length === 0 && answeredNames.length === 0 ? (
            <div className="text-center py-4 text-text-subtle text-[12px]">{i18n.t('admin.livequiz.no_one_yet')}</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {/* Participantes en sala: verde si ya respondieron (van al frente), gris pulsante si no */}
              {[...(participants.length > 0 ? participants : answeredNames)]
                .sort((a, b) =>
                  (answeredNames.includes(b) ? 1 : 0) - (answeredNames.includes(a) ? 1 : 0) ||
                  a.localeCompare(b))
                .map((name) => {
                const done = answeredNames.includes(name)
                return (
                  <motion.span
                    key={name}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium max-w-[150px] truncate transition-colors"
                    style={done
                      ? { background: 'rgba(16,212,81,0.14)', border: '1px solid rgba(16,212,81,0.4)', color: '#10D451' }
                      : { background: 'rgb(var(--line))', color: 'rgb(var(--text-subtle))' }}
                  >
                    {done
                      ? <Check className="h-3 w-3 flex-shrink-0" />
                      : <motion.span className="h-1.5 w-1.5 rounded-full bg-text-subtle flex-shrink-0"
                          animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} />}
                    <span className="truncate">{name}</span>
                  </motion.span>
                )
              })}
              {/* Nombres que respondieron pero no aparecen en presencia (p. ej. reconexión) */}
              {answeredNames.filter((n) => !participants.includes(n) && participants.length > 0).map((name) => (
                <span key={`extra-${name}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium max-w-[150px] truncate"
                  style={{ background: 'rgba(16,212,81,0.14)', border: '1px solid rgba(16,212,81,0.4)', color: '#10D451' }}>
                  <Check className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Controles activos */}
      {activeQuiz.status === 'active' && (
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={nextQuestion}
            disabled={advancing}
            className="flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-xl text-[13px] font-medium text-black"
            style={{ background: '#10D451' }}
          >
            {advancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
            {isLast ? i18n.t('livequiz.finish_quiz') : i18n.t('livequiz.next_question')}
          </button>
          <button
            onClick={() => { void loadLeaderboard(activeQuiz.id); setShowLeaderboard(true) }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle transition-colors"
          >
            <BarChart2 className="h-3.5 w-3.5" />
            Clasificacion
          </button>
          <button
            onClick={endQuiz}
            disabled={advancing}
            className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle transition-colors"
          >
            <Square className="h-3.5 w-3.5" />
            Terminar
          </button>
        </div>
      )}

      {/* Estado terminado */}
      {activeQuiz.status === 'ended' && (
        <div className="rounded-2xl p-4 sm:p-6 bg-subtle border border-line">
          <div className="text-[16px] font-semibold text-text mb-1">{i18n.t('admin.livequiz.quiz_finished')}</div>
          <div className="text-[13px] text-text-muted mb-5">{i18n.t('admin.livequiz.finished_sub')}</div>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => { void loadLeaderboard(activeQuiz.id); setShowLeaderboard(true) }}
              className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-[13px] font-medium text-black"
              style={{ background: '#10D451' }}
            >
              <BarChart2 className="h-4 w-4" />
              Ver clasificacion final
            </button>
            <button
              onClick={restartQuiz}
              disabled={advancing}
              className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-[13px] text-text-muted hover:text-text bg-subtle border border-line transition-colors"
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
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed right-0 top-0 h-full w-[88vw] max-w-sm bg-bg border-l border-line z-30 flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0"
                style={{ background: 'linear-gradient(180deg, rgba(16,212,81,0.08), transparent)' }}>
                <div>
                  <span className="text-[15px] font-bold text-text">{i18n.t('livequiz.ranking')}</span>
                  {leaderboard.length > 0 && (
                    <div className="text-[11px] text-text-subtle">
                      {i18n.t('livequiz.player', { count: leaderboard.length })}
                    </div>
                  )}
                </div>
                <button onClick={() => setShowLeaderboard(false)} className="h-10 w-10 flex items-center justify-center rounded-lg text-text-subtle hover:text-text hover:bg-subtle transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-2">
                {leaderboard.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-text-subtle text-[13px] gap-3">
                    <BarChart2 className="h-8 w-8 opacity-40" />
                    {i18n.t('livequiz.no_answers_yet')}
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {leaderboard.map((entry, i) => {
                      const medal = i < 3 ? MEDAL_COLORS[i] : null
                      return (
                        <motion.div
                          key={entry.user_id ?? entry.display_name}
                          layout
                          initial={{ opacity: 0, x: 24, scale: 0.96 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          transition={{ layout: { type: 'spring', stiffness: 500, damping: 34 }, delay: Math.min(i, 8) * 0.035, ease: [0.16, 1, 0.3, 1] }}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                          style={{
                            background: medal ? `${medal}14` : 'rgb(var(--subtle))',
                            border: `1px solid ${medal ? medal + '55' : 'transparent'}`,
                          }}
                        >
                          {/* Posición */}
                          <span
                            className="text-[15px] font-black w-6 text-center flex-shrink-0 tabular-nums"
                            style={{ color: medal ?? 'rgb(var(--text-subtle))' }}
                          >
                            {i + 1}
                          </span>
                          {/* Avatar con iniciales */}
                          <div
                            className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                            style={{
                              background: medal ? `${medal}22` : 'rgb(var(--line))',
                              color: medal ?? 'rgb(var(--text-muted))',
                              border: medal ? `1.5px solid ${medal}` : '1.5px solid transparent',
                            }}
                          >
                            {initials(entry.display_name)}
                          </div>
                          {/* Nombre + aciertos */}
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold text-text truncate">{entry.display_name}</div>
                            <div className="text-[11px] text-text-subtle tabular-nums">
                              {i18n.t('admin.livequiz.correct_of', { correct: entry.correct, total: activeQuiz.questions.length })}
                            </div>
                          </div>
                          {/* Puntaje con conteo animado */}
                          <CountUp
                            value={entry.score}
                            className="text-[14px] font-black tabular-nums flex-shrink-0"
                            style={{ color: '#10D451' }}
                          />
                        </motion.div>
                      )
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
