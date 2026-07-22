import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MessageCircle, X, ArrowUp, Sparkles, Trash2, Bot } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useHelpChatStore } from '@/stores/helpChatStore'
import { sendHelpMessage } from '@/services/help.service'
import { logHelpInteraction } from '@/services/helpLog.service'
import { getSuggestionKeys } from './suggestions'
import { matchFaq } from './faq'
import { aiDailyLimit, todayKey } from './config'
import { ChatMarkdown } from './ChatMarkdown'
import { cn } from '@/lib/cn'

/** Solo se muestra el cupo diario de IA cuando quedan estas consultas o menos. */
const QUOTA_LOW_THRESHOLD = 5

export function HelpWidget() {
  const { t, i18n } = useTranslation()
  const { isAuthenticated, isAdminOrCapacitador, displayName, role, campaignId } = useAuth()
  const location = useLocation()
  const reduce = useReducedMotion()
  const {
    isOpen, messages, loading, aiUsage,
    close, toggle, nextId, addMessage, updateMessage, setLoading, clear,
    aiUsedToday, recordAiUse, markAiExhausted,
  } = useHelpChatStore()

  const [input, setInput] = useState('')
  /** id del mensaje del asistente que se está "escribiendo" con efecto máquina. */
  const [animatingId, setAnimatingId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const lang = (i18n.resolvedLanguage ?? 'es') as 'es' | 'en' | 'pt'

  const dailyLimit = aiDailyLimit(isAdminOrCapacitador)
  const usedToday = aiUsage.day === todayKey() ? aiUsage.count : 0
  const quotaLeft = Math.max(0, dailyLimit - usedToday)

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') =>
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior })

  // Auto-scroll al último mensaje
  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => scrollToBottom())
  }, [messages, isOpen, loading])

  // Foco al abrir
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 320)
  }, [isOpen])

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  // Autosize del textarea
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }, [input])

  if (!isAuthenticated) return null

  const suggestionKeys = getSuggestionKeys({ isStaff: isAdminOrCapacitador, pathname: location.pathname })
  const firstName = displayName?.split(' ')[0] || ''

  // ── Envío: IA-first. Cada pregunta la responde Claude Haiku. La base local
  //    (FAQ) solo actúa de red de seguridad si se agota el cupo o falla la red. ──
  async function ask(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setInput('')
    addMessage({ id: nextId(), role: 'user', content: trimmed })

    const logBase = { role, campaignId, lang, page: location.pathname }

    // Cupo diario agotado → intenta la base local antes de rendirse.
    if (aiUsedToday() >= dailyLimit) {
      const match = matchFaq(trimmed, { isStaff: isAdminOrCapacitador })
      if (match) {
        const answer = match.entry.answer[lang]
        const id = nextId()
        addMessage({ id, role: 'assistant', content: answer, faq: true, question: trimmed })
        revealFrom(id)
        void logHelpInteraction({ ...logBase, source: 'faq', faqId: match.entry.id, question: trimmed, answer })
      } else {
        addMessage({ id: nextId(), role: 'assistant', content: t('help.ai_limit_reached'), notice: true })
      }
      return
    }

    const assistantId = nextId()
    addMessage({ id: assistantId, role: 'assistant', content: '', pending: true })
    setLoading(true)

    // Historial para la IA: solo turnos reales con contenido (sin pendientes/avisos).
    const history = [...useHelpChatStore.getState().messages]
      .filter((m) => m.content && !m.pending && !m.notice)
      .map((m) => ({ role: m.role, content: m.content }))

    try {
      const { reply } = await sendHelpMessage({ messages: history, page: pageLabel(location.pathname), lang })
      recordAiUse()
      updateMessage(assistantId, { content: reply, pending: false })
      revealFrom(assistantId)
      void logHelpInteraction({ ...logBase, source: 'ai', question: trimmed, answer: reply })
    } catch (e) {
      const isLimit = (e as Error).message === 'AI_DAILY_LIMIT'
      const fallback = isLimit ? null : matchFaq(trimmed, { isStaff: isAdminOrCapacitador })
      if (isLimit) {
        markAiExhausted()
        updateMessage(assistantId, { content: t('help.ai_limit_reached'), pending: false, notice: true })
      } else if (fallback) {
        const answer = fallback.entry.answer[lang]
        updateMessage(assistantId, { content: answer, pending: false, faq: true })
        revealFrom(assistantId)
        void logHelpInteraction({ ...logBase, source: 'faq', faqId: fallback.entry.id, question: trimmed, answer })
      } else {
        updateMessage(assistantId, { content: t('help.error'), pending: false, error: true })
      }
    } finally {
      setLoading(false)
    }
  }

  /** Dispara el efecto máquina de escribir para el mensaje dado. */
  function revealFrom(id: string) {
    if (reduce) return
    setAnimatingId(id)
  }

  const greeting = firstName
    ? t('help.greeting_name', { name: firstName, defaultValue: `Hola, ${firstName} 👋` })
    : t('help.greeting')

  return createPortal(
    <>
      {/* ── Botón flotante ─────────────────────────────────────── */}
      <motion.button
        onClick={toggle}
        aria-label={t('help.title')}
        className="fixed bottom-5 right-5 z-[9990] h-14 w-14 rounded-full"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.4, type: 'spring', stiffness: 260, damping: 20 }}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.92 }}
      >
        <span className="relative flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-neon-green to-neon-cyan text-black shadow-xl shadow-neon-green/30">
          {/* halo pulsante cuando está cerrado */}
          {!isOpen && !reduce && (
            <motion.span
              className="absolute inset-0 rounded-full bg-neon-green/40"
              animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
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
        </span>
      </motion.button>

      {/* ── Panel ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              'fixed z-[9990] flex flex-col overflow-hidden',
              'glass-strong border border-glass-border/10 shadow-2xl shadow-black/40',
              'bottom-0 right-0 left-0 h-[88vh] rounded-t-[28px]',
              'sm:bottom-24 sm:right-5 sm:left-auto sm:h-[620px] sm:max-h-[78vh] sm:w-[416px] sm:rounded-[28px]',
            )}
          >
            {/* Header con degradado */}
            <div className="relative overflow-hidden border-b border-line/70">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-neon-green/12 via-transparent to-neon-cyan/10" />
              <div className="relative flex items-center gap-3 px-4 py-3.5">
                <div className="relative">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-neon-green to-neon-cyan text-black shadow-lg shadow-neon-green/25">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-bg bg-emerald-500">
                    {!reduce && (
                      <motion.span
                        className="absolute inset-0 rounded-full bg-emerald-400"
                        animate={{ scale: [1, 1.9], opacity: [0.6, 0] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
                      />
                    )}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[15px] font-semibold text-text leading-tight">
                    {t('help.assistant_name', 'Guía')}
                    <span className="rounded-full bg-neon-green/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-neon-green">
                      {t('help.role_tag', 'IA')}
                    </span>
                  </p>
                  <p className="text-[11.5px] text-text-muted leading-tight">
                    {loading ? t('help.status_typing', 'escribiendo…') : t('help.status_online', 'En línea · responde al instante')}
                  </p>
                </div>
                {messages.length > 0 && (
                  <button
                    onClick={() => { clear(); setAnimatingId(null) }}
                    aria-label={t('help.clear')}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-subtle hover:text-text"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={close}
                  aria-label={t('help.close')}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-subtle hover:text-text sm:hidden"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Mensajes */}
            <div ref={scrollRef} className="help-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <EmptyState
                  greeting={greeting}
                  subtitle={t('help.empty')}
                  suggestions={suggestionKeys.map((k) => ({ key: k, label: t(`help.suggest.${k}`) }))}
                  onPick={ask}
                  reduce={!!reduce}
                />
              ) : (
                messages.filter((m) => !m.pending).map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    animate={m.id === animatingId}
                    onDoneAnimating={() => { setAnimatingId(null); scrollToBottom() }}
                    onTick={() => scrollToBottom('auto')}
                    onNavigate={close}
                    faqBadge={t('help.faq_badge')}
                    reduce={!!reduce}
                  />
                ))
              )}
              <AnimatePresence>
                {loading && <ThinkingBubble key="thinking" reduce={!!reduce} />}
              </AnimatePresence>
            </div>

            {/* Sugerencias rápidas (conversación activa) */}
            {messages.length > 0 && !loading && (
              <div className="help-scroll flex gap-1.5 overflow-x-auto px-4 pb-2 pt-0.5 [scrollbar-width:none]">
                {suggestionKeys.map((key) => {
                  const label = t(`help.suggest.${key}`)
                  return (
                    <button
                      key={key}
                      onClick={() => ask(label)}
                      className="shrink-0 whitespace-nowrap rounded-full border border-line bg-subtle/40 px-3 py-1.5 text-[11.5px] text-text-muted transition-all hover:-translate-y-0.5 hover:border-neon-green/40 hover:text-text"
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Input */}
            <div className="border-t border-line/70 p-3">
              <div className="flex items-end gap-2 rounded-[20px] border border-line bg-subtle/40 px-3 py-2 transition-colors focus-within:border-neon-green/50 focus-within:bg-subtle/60">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) }
                  }}
                  rows={1}
                  placeholder={t('help.placeholder')}
                  className="max-h-32 flex-1 resize-none bg-transparent py-1 text-[13.5px] text-text placeholder:text-text-subtle focus:outline-none"
                  style={{ minHeight: 24 }}
                />
                <motion.button
                  onClick={() => ask(input)}
                  disabled={!input.trim() || loading}
                  aria-label={t('help.send')}
                  whileTap={input.trim() && !loading ? { scale: 0.88 } : undefined}
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
                    input.trim() && !loading
                      ? 'bg-gradient-to-br from-neon-green to-neon-cyan text-black shadow-md shadow-neon-green/25'
                      : 'bg-line text-text-subtle',
                  )}
                >
                  <ArrowUp className="h-4.5 w-4.5" />
                </motion.button>
              </div>
              <p className="mt-1.5 flex items-center justify-center gap-1 text-center text-[10.5px] text-text-subtle">
                {t('help.disclaimer')}
                {/* El cupo diario solo se muestra cuando queda poco (aviso). */}
                {quotaLeft <= QUOTA_LOW_THRESHOLD && (
                  <span className="text-amber-500">· {t('help.quota_low', { count: quotaLeft, defaultValue: 'quedan {{count}} hoy' })}</span>
                )}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  )
}

// ─────────────────────────────────────────────────────────────
// Estado vacío con tarjetas de sugerencia
// ─────────────────────────────────────────────────────────────
function EmptyState({
  greeting, subtitle, suggestions, onPick, reduce,
}: {
  greeting: string
  subtitle: string
  suggestions: Array<{ key: string; label: string }>
  onPick: (t: string) => void
  reduce: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center pt-4 text-center">
      <motion.div
        initial={reduce ? false : { scale: 0.6, opacity: 0, filter: 'blur(8px)' }}
        animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
        className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-neon-green to-neon-cyan text-black shadow-xl shadow-neon-green/30"
      >
        <Sparkles className="h-8 w-8" />
      </motion.div>
      <motion.p
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.22 }}
        className="mt-4 text-[17px] font-semibold text-text"
      >
        {greeting}
      </motion.p>
      <motion.p
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
        className="mt-1 max-w-[290px] text-[13px] text-text-muted"
      >
        {subtitle}
      </motion.p>

      <div className="mt-6 w-full space-y-2">
        <p className="mb-2 text-left text-[11px] font-medium uppercase tracking-wide text-text-subtle">
          {t('help.suggestions_title', 'Prueba a preguntar')}
        </p>
        {suggestions.map((s, i) => (
          <motion.button
            key={s.key}
            onClick={() => onPick(s.label)}
            initial={reduce ? false : { opacity: 0, y: 12, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay: 0.38 + i * 0.08, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ x: 3, transition: { duration: 0.2, ease: 'easeOut' } }}
            className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-subtle/30 px-3.5 py-3 text-left transition-colors hover:border-neon-green/40 hover:bg-subtle/60"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neon-green/12 text-neon-green transition-colors group-hover:bg-neon-green/20">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="flex-1 text-[13px] font-medium text-text">{s.label}</span>
            <ArrowUp className="h-4 w-4 rotate-45 text-text-subtle transition-transform group-hover:translate-x-0.5" />
          </motion.button>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Burbuja de mensaje (con avatar del asistente + efecto máquina)
// ─────────────────────────────────────────────────────────────
function MessageBubble({
  message: m, animate, onDoneAnimating, onTick, onNavigate, faqBadge, reduce,
}: {
  message: import('@/stores/helpChatStore').HelpMessage
  animate: boolean
  onDoneAnimating: () => void
  onTick: () => void
  onNavigate: () => void
  faqBadge: string
  reduce: boolean
}) {
  const isUser = m.role === 'user'
  const shown = useTypewriter(m.content, animate, onDoneAnimating, onTick)

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={cn('flex items-end gap-2', isUser ? 'justify-end' : 'justify-start')}
    >
      {!isUser && (
        <div className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neon-green to-neon-cyan text-black shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13.5px]',
          isUser
            ? 'rounded-br-md bg-gradient-to-br from-neon-green/20 to-neon-cyan/15 text-text'
            : cn('rounded-bl-md bg-subtle text-text', m.error && 'text-red-400'),
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
        ) : (
          <>
            {m.faq && !m.notice && (
              <span className="mb-1.5 inline-flex items-center gap-1 text-[10.5px] font-medium text-neon-green">
                <Bot className="h-3 w-3" />
                {faqBadge}
              </span>
            )}
            <ChatMarkdown text={shown.text} onNavigate={onNavigate} />
            {shown.typing && (
              <motion.span
                className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 rounded-full bg-neon-green align-middle"
                animate={{ opacity: [1, 0.15, 1] }}
                transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </>
        )}
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// Indicador de "pensando" con estatus cíclico
// ─────────────────────────────────────────────────────────────
function ThinkingBubble({ reduce }: { reduce: boolean }) {
  const { t } = useTranslation()
  const statuses = useMemo(
    () => [
      t('help.thinking_0', 'Consultando el manual…'),
      t('help.thinking_1', 'Revisando tus cursos…'),
      t('help.thinking_2', 'Redactando respuesta…'),
    ],
    [t],
  )
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setIdx((i) => (i + 1) % statuses.length), 1700)
    return () => clearInterval(id)
  }, [reduce, statuses.length])

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-end gap-2"
    >
      <motion.div
        className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neon-green to-neon-cyan text-black shadow-sm"
        animate={reduce ? undefined : { scale: [1, 1.1, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Sparkles className="h-3.5 w-3.5" />
      </motion.div>
      <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-subtle px-3.5 py-2.5">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-neon-green"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -2.5, 0] }}
              transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut', delay: i * 0.2 }}
            />
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.span
            key={idx}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="text-[12px] text-text-muted"
          >
            {statuses[idx]}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// Hook: efecto máquina de escribir. Revela `full` progresivamente cuando
// `enabled`; si no, muestra todo de una.
// ─────────────────────────────────────────────────────────────
function useTypewriter(
  full: string,
  enabled: boolean,
  onDone: () => void,
  onTick: () => void,
): { text: string; typing: boolean } {
  const [count, setCount] = useState(enabled ? 0 : full.length)
  const doneRef = useRef(onDone)
  const tickRef = useRef(onTick)
  useEffect(() => { doneRef.current = onDone; tickRef.current = onTick })

  useEffect(() => {
    if (!enabled) { setCount(full.length); return }
    setCount(0)
    let raf = 0
    const start = performance.now()
    // Reveal por tiempo (cadencia constante, sin saltos por frame). Caracteres
    // por segundo, adaptativo: respuestas largas se revelan un poco más rápido.
    const cps = full.length > 520 ? 380 : full.length > 240 ? 260 : 190
    const frame = (now: number) => {
      const elapsed = (now - start) / 1000
      // eased: arranca suave y acelera un pelín (sensación orgánica)
      const target = Math.min(full.length, Math.round(elapsed * cps))
      setCount(target)
      tickRef.current()
      if (target < full.length) {
        raf = requestAnimationFrame(frame)
      } else {
        doneRef.current()
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [full, enabled])

  // Redondea al límite de palabra para que no aparezcan fragmentos cortados.
  const safeText = (() => {
    if (count >= full.length) return full
    const slice = full.slice(0, count)
    const lastSpace = slice.lastIndexOf(' ')
    return lastSpace > 0 ? slice.slice(0, lastSpace) : slice
  })()

  return { text: safeText, typing: enabled && count < full.length }
}

// ─────────────────────────────────────────────────────────────
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
