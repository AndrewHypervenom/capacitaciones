import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MessageCircle, X, Send, Sparkles, Trash2, RefreshCw, Zap, Bot } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useHelpChatStore } from '@/stores/helpChatStore'
import { sendHelpMessage } from '@/services/help.service'
import { logHelpInteraction } from '@/services/helpLog.service'
import { getSuggestionKeys } from './suggestions'
import { matchFaq } from './faq'
import { aiDailyLimit, aiUnlockAfter, todayKey } from './config'
import { ChatMarkdown } from './ChatMarkdown'
import { cn } from '@/lib/cn'

export function HelpWidget() {
  const { t, i18n } = useTranslation()
  const { isAuthenticated, isAdminOrCapacitador, displayName, role, campaignId } = useAuth()
  const location = useLocation()
  const {
    isOpen, messages, loading, aiUsage,
    open, close, toggle, nextId, addMessage, updateMessage, setLoading, clear,
    aiUsedToday, recordAiUse, markAiExhausted,
  } = useHelpChatStore()

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const lang = (i18n.resolvedLanguage ?? 'es') as 'es' | 'en' | 'pt'

  // Auto-scroll al último mensaje
  useEffect(() => {
    if (isOpen) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isOpen, loading])

  // Foco al abrir
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 250)
  }, [isOpen])

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  if (!isAuthenticated) return null

  const suggestionKeys = getSuggestionKeys({ isStaff: isAdminOrCapacitador, pathname: location.pathname })

  // ── Control de costo (diferenciado por rol) ─────────────────
  const dailyLimit = aiDailyLimit(isAdminOrCapacitador)
  const usedToday = aiUsage.day === todayKey() ? aiUsage.count : 0
  const quotaLeft = Math.max(0, dailyLimit - usedToday)
  // La opción de IA se "gana": para el aprendiz, solo tras varias preguntas;
  // para el staff, está disponible de inmediato (unlockAfter = 0).
  const userQuestions = messages.filter((m) => m.role === 'user').length
  const aiUnlocked = userQuestions >= aiUnlockAfter(isAdminOrCapacitador)

  /** Nunca llama a la IA: solo base local. Si no hay match, sugiere reformular. */
  function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setInput('')

    addMessage({ id: nextId(), role: 'user', content: trimmed })

    const match = matchFaq(trimmed, { isStaff: isAdminOrCapacitador })
    const logBase = { role, campaignId, lang, page: location.pathname }
    if (match) {
      const answer = match.entry.answer[lang]
      addMessage({ id: nextId(), role: 'assistant', content: answer, faq: true, question: trimmed })
      void logHelpInteraction({ ...logBase, source: 'faq', faqId: match.entry.id, question: trimmed, answer })
    } else {
      const answer = t('help.no_match', 'No encontré una respuesta exacta a eso. Prueba a reformular tu pregunta o revisa los temas sugeridos abajo.')
      addMessage({ id: nextId(), role: 'assistant', content: answer, faq: true, noMatch: true, question: trimmed })
      void logHelpInteraction({ ...logBase, source: 'no_match', question: trimmed, answer })
    }
  }

  /** Llama a la IA (Edge Function). Solo se dispara desde el botón de escalar,
   *  y respeta el tope diario (validado también en el servidor). */
  async function askAI() {
    if (loading) return
    if (aiUsedToday() >= dailyLimit) {
      addMessage({ id: nextId(), role: 'assistant', content: t('help.ai_limit_reached', 'Alcanzaste tu límite de consultas al asistente por hoy. Vuelve mañana o pídele ayuda a tu capacitador.'), notice: true })
      return
    }

    const assistantId = nextId()
    addMessage({ id: assistantId, role: 'assistant', content: '', pending: true })
    setLoading(true)

    // Historial para la IA: sin respuestas locales, para que la última vuelta
    // sea la pregunta real del usuario.
    const history = [...useHelpChatStore.getState().messages]
      .filter((m) => m.content && !m.pending && !m.faq && !m.notice)
      .map((m) => ({ role: m.role, content: m.content }))

    try {
      const { reply } = await sendHelpMessage({
        messages: history,
        page: pageLabel(location.pathname),
        lang,
      })
      recordAiUse()
      updateMessage(assistantId, { content: reply, pending: false })
      const q = [...useHelpChatStore.getState().messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      void logHelpInteraction({ role, campaignId, lang, page: location.pathname, source: 'ai', question: q, answer: reply })
    } catch (e) {
      if ((e as Error).message === 'AI_DAILY_LIMIT') {
        markAiExhausted()
        updateMessage(assistantId, {
          content: t('help.ai_limit_reached', 'Alcanzaste tu límite de consultas al asistente por hoy. Vuelve mañana o pídele ayuda a tu capacitador.'),
          pending: false,
          notice: true,
        })
      } else {
        updateMessage(assistantId, {
          content: t('help.error', 'No pude responder ahora mismo. Revisa tu conexión e inténtalo de nuevo.'),
          pending: false,
          error: true,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  /** El usuario no quedó satisfecho con la respuesta local → escala a la IA. */
  function escalate(msgId: string) {
    if (loading) return
    updateMessage(msgId, { escalated: true })
    void askAI()
  }

  const greeting = t('help.greeting', { name: displayName?.split(' ')[0] || '' })

  return createPortal(
    <>
      {/* Botón flotante */}
      <motion.button
        onClick={toggle}
        aria-label={t('help.title', 'Asistente de ayuda')}
        className={cn(
          'fixed bottom-5 right-5 z-[9990] h-14 w-14 rounded-full',
          'flex items-center justify-center shadow-xl shadow-black/25',
          'bg-neon-green text-black transition-transform hover:scale-105 active:scale-95',
        )}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.4, type: 'spring', stiffness: 260, damping: 20 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isOpen ? (
            <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
              <X className="h-6 w-6" />
            </motion.span>
          ) : (
            <motion.span key="chat" initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}>
              <MessageCircle className="h-6 w-6" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'fixed z-[9990] flex flex-col overflow-hidden',
              'glass-strong border border-glass-border/10 shadow-2xl shadow-black/40',
              'bottom-0 right-0 left-0 h-[85vh] rounded-t-3xl',
              'sm:bottom-24 sm:right-5 sm:left-auto sm:h-[600px] sm:max-h-[75vh] sm:w-[400px] sm:rounded-3xl',
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-neon-green/15 text-neon-green">
                <Sparkles className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-text leading-tight">{t('help.title', 'Asistente de ayuda')}</p>
                <p className="text-[11.5px] text-text-muted leading-tight">{t('help.subtitle', 'Resuelve tus dudas al instante')}</p>
              </div>
              {messages.length > 0 && (
                <button
                  onClick={clear}
                  aria-label={t('help.clear', 'Limpiar conversación')}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-text-subtle hover:bg-subtle hover:text-text transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={close}
                aria-label={t('help.close', 'Cerrar')}
                className="flex h-10 w-10 items-center justify-center rounded-full text-text-subtle hover:bg-subtle hover:text-text transition-colors sm:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Mensajes */}
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center gap-2 pt-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-neon-green/15 text-neon-green">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <p className="text-[15px] font-semibold text-text">{greeting}</p>
                  <p className="max-w-[280px] text-[13px] text-text-muted">
                    {t('help.empty', 'Pregúntame cómo usar la plataforma, sobre tus cursos o cualquier duda.')}
                  </p>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5',
                      m.role === 'user'
                        ? 'bg-neon-green/15 text-text rounded-br-md'
                        : cn('bg-subtle text-text rounded-bl-md', m.error && 'text-red-400'),
                    )}
                  >
                    {m.pending ? (
                      <TypingDots />
                    ) : m.role === 'assistant' ? (
                      <>
                        {m.faq && !m.noMatch && !m.notice && (
                          <span className="mb-1.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-neon-green">
                            <Zap className="h-3 w-3" />
                            {t('help.faq_badge', 'Respuesta rápida')}
                          </span>
                        )}
                        <ChatMarkdown text={m.content} onNavigate={close} />
                        {m.faq && !m.notice && !m.escalated && aiUnlocked && (
                          <div className="mt-2 border-t border-line/60 pt-2">
                            {quotaLeft > 0 ? (
                              <>
                                <p className="mb-1 text-[11.5px] text-text-muted">{t('help.faq_escalate_q', '¿No es lo que buscabas?')}</p>
                                <button
                                  onClick={() => escalate(m.id)}
                                  disabled={loading}
                                  className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-text-muted hover:border-neon-green/40 hover:text-text transition-colors disabled:opacity-50"
                                >
                                  <Bot className="h-3 w-3" />
                                  {t('help.faq_escalate_btn', 'Preguntar al asistente IA')}
                                  <span className="text-text-subtle">· {quotaLeft}/{dailyLimit}</span>
                                </button>
                              </>
                            ) : (
                              <p className="text-[11.5px] text-text-subtle">{t('help.ai_limit_reached', 'Alcanzaste tu límite de consultas al asistente por hoy.')}</p>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{m.content}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Sugerencias */}
            {!loading && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-2">
                {suggestionKeys.map((key) => {
                  const label = t(`help.suggest.${key}`)
                  return (
                    <button
                      key={key}
                      onClick={() => submit(label)}
                      className="rounded-full border border-line bg-subtle/40 px-2.5 py-1 text-[11.5px] text-text-muted hover:border-neon-green/40 hover:text-text transition-colors"
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Input */}
            <div className="border-t border-line p-3">
              <div className="flex items-end gap-2 rounded-2xl border border-line bg-subtle/40 px-3 py-2 focus-within:border-neon-green/50 transition-colors">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input) }
                  }}
                  rows={1}
                  placeholder={t('help.placeholder', 'Escribe tu pregunta…')}
                  className="max-h-28 flex-1 resize-none bg-transparent text-[13.5px] text-text placeholder:text-text-subtle focus:outline-none"
                  style={{ minHeight: 22 }}
                />
                <button
                  onClick={() => submit(input)}
                  disabled={!input.trim() || loading}
                  aria-label={t('help.send', 'Enviar')}
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
                    input.trim() && !loading
                      ? 'bg-neon-green text-black hover:opacity-90'
                      : 'bg-line text-text-subtle',
                  )}
                >
                  {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1.5 text-center text-[10.5px] text-text-subtle">{t('help.disclaimer', 'Respuestas generadas por IA · pueden contener errores')}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  )
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-text-subtle"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </div>
  )
}

function pageLabel(pathname: string): string {
  const map: Array<[RegExp, string]> = [
    [/^\/dashboard/, 'Panel del aprendiz (/dashboard)'],
    [/^\/courses\//, 'Detalle de un curso (/courses/:slug)'],
    [/^\/courses/, 'Catálogo de cursos (/courses)'],
    [/^\/modules/, 'Un módulo de aprendizaje (/modules/:id)'],
    [/^\/simulator\/choice/, 'Simulación de opciones (/simulator/choice)'],
    [/^\/simulator\/run/, 'Simulación de diálogo (/simulator/run)'],
    [/^\/simulator\/result/, 'Resultado de simulación (/simulator/result)'],
    [/^\/simulator/, 'Setup del simulador (/simulator)'],
    [/^\/certificate/, 'Certificado (/certificate)'],
    [/^\/quiz/, 'Quiz en vivo (/quiz)'],
    [/^\/admin\/modules/, 'Editor de módulos (/admin/modules)'],
    [/^\/admin\/courses/, 'Editor de cursos (/admin/courses)'],
    [/^\/admin\/users/, 'Gestión de usuarios (/admin/users)'],
    [/^\/admin\/simulations/, 'Editor de simulaciones (/admin/simulations)'],
    [/^\/admin\/evaluaciones/, 'Panel de evaluaciones (/admin/evaluaciones)'],
    [/^\/admin\/progress/, 'Progreso unificado: Mundos y Módulos (/admin/progress)'],
    [/^\/admin\/import/, 'Importar contenido (/admin/import)'],
    [/^\/admin/, 'Panel de gestión (/admin)'],
    [/^\/arena/, 'Arena (/arena)'],
    [/^\/world/, 'Mapa del mundo (/world)'],
    [/^\/mission/, 'Misión (/mission)'],
  ]
  for (const [re, label] of map) if (re.test(pathname)) return label
  return pathname
}
