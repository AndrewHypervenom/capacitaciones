import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, PlayCircle, ChevronRight, Trophy } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { VideoQuizMarker, VideoQuizQuestion } from '@/data/modules'
import type { Language } from '@/stores/userStore'

interface VideoQuizOverlayProps {
  marker: VideoQuizMarker
  language: Language
  onComplete: (score: number, total: number) => void
}

const LETTERS = ['A', 'B', 'C', 'D', 'E']

const CONFETTI = [
  { color: 'bg-neon-green', isBar: true },
  { color: 'bg-amber-400', isBar: false },
  { color: 'bg-green-400', isBar: true },
  { color: 'bg-orange-400', isBar: false },
  { color: 'bg-yellow-300', isBar: true },
  { color: 'bg-neon-green', isBar: false },
  { color: 'bg-amber-300', isBar: true },
  { color: 'bg-green-500', isBar: false },
  { color: 'bg-neon-green', isBar: true },
  { color: 'bg-amber-400', isBar: false },
]

function ConfettiPiece({ color, angle, delay, isBar }: { color: string; angle: number; delay: number; isBar: boolean }) {
  const rad = (angle * Math.PI) / 180
  const dist = 90 + Math.random() * 50
  const x = Math.cos(rad) * dist
  const y = Math.sin(rad) * dist
  return (
    <motion.span
      className={cn('absolute pointer-events-none', color, isBar ? 'h-0.5 w-5 rounded-sm' : 'h-3 w-3 rounded-full')}
      style={{ top: '50%', left: '50%' }}
      initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
      animate={{ x, y: y - 70, opacity: 0, scale: 0.2, rotate: angle * 2.5 }}
      transition={{ duration: 1.2, delay, ease: [0.16, 1, 0.3, 1] }}
    />
  )
}

type Phase = 'question' | 'summary'

export function VideoQuizOverlay({ marker, language, onComplete }: VideoQuizOverlayProps) {
  const { t } = useTranslation()
  const [currentIdx, setCurrentIdx] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [answered, setAnswered] = useState<Record<number, number>>({})
  const [phase, setPhase] = useState<Phase>('question')
  const [showConfetti, setShowConfetti] = useState(false)

  const questions = marker.questions
  const q: VideoQuizQuestion = questions[currentIdx]
  const lang = language as 'es' | 'en' | 'pt'
  const questionText = q.question[lang] || q.question.es
  const options = q.options[lang]?.length ? q.options[lang] : q.options.es
  const explanation = q.explanation[lang] || q.explanation.es
  const isAnswered = selected !== null
  const isCorrect = selected === q.correct
  const isLast = currentIdx === questions.length - 1

  const score = Object.entries(answered).filter(
    ([idx, choice]) => choice === questions[Number(idx)].correct,
  ).length

  const handleSelect = (i: number) => {
    if (isAnswered) return
    setSelected(i)
    setAnswered((prev) => ({ ...prev, [currentIdx]: i }))
  }

  const handleNext = () => {
    setSelected(null)
    setCurrentIdx((prev) => prev + 1)
  }

  const handleFinish = () => {
    const finalScore = Object.entries({ ...answered }).filter(
      ([idx, choice]) => choice === questions[Number(idx)].correct,
    ).length
    if (finalScore / questions.length >= 0.75) {
      setShowConfetti(true)
      setTimeout(() => setShowConfetti(false), 1500)
    }
    setPhase('summary')
  }

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex flex-col bg-zinc-950"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
    >
      {/* Franja de acento ámbar */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-amber-400 to-transparent shrink-0" />

      <AnimatePresence mode="wait">
        {phase === 'question' ? (
          <motion.div
            key="question"
            className="flex-1 flex flex-col min-h-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {/* Barra superior */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-zinc-800/60 shrink-0">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  {t('video.quiz_tag')}
                </span>
                <span className="text-zinc-700">·</span>
                <span className="text-[13px] text-zinc-400 truncate max-w-[240px]">
                  {marker.title[lang] || marker.title.es}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {questions.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'rounded-full transition-all duration-300',
                      i < currentIdx
                        ? 'h-2 w-2 bg-neon-green'
                        : i === currentIdx
                          ? 'h-2.5 w-2.5 bg-amber-400'
                          : 'h-2 w-2 bg-zinc-700',
                    )}
                  />
                ))}
                <span className="ml-1 text-[11px] text-zinc-600 font-mono tabular-nums">
                  {currentIdx + 1}/{questions.length}
                </span>
              </div>
            </div>

            {/* Contenido — ocupa el espacio restante, centrado */}
            <div className="flex-1 flex flex-col justify-center px-8 py-6 max-w-2xl mx-auto w-full min-h-0">
              <p className="text-[22px] font-semibold text-white leading-snug mb-7">
                {questionText}
              </p>

              <div className="space-y-2.5">
                {options.map((opt, i) => {
                  const isSelectedOpt = selected === i
                  const isCorrectOpt = i === q.correct

                  const cls = cn(
                    'w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border text-left transition-all duration-200 text-[14px] font-medium',
                    !isAnswered
                      ? 'border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800 cursor-pointer'
                      : isSelectedOpt && isCorrect
                        ? 'border-neon-green bg-neon-green/10 text-white'
                        : isSelectedOpt && !isCorrect
                          ? 'border-red-500 bg-red-500/10 text-white'
                          : !isSelectedOpt && isCorrectOpt
                            ? 'border-neon-green/40 bg-neon-green/5 text-neon-green/80'
                            : 'border-zinc-800/40 bg-zinc-900/40 text-zinc-600',
                  )

                  return (
                    <button key={i} type="button" onClick={() => handleSelect(i)} disabled={isAnswered} className={cls}>
                      <span className={cn(
                        'h-7 w-7 rounded-xl flex items-center justify-center text-[12px] font-bold shrink-0 transition-all duration-200',
                        !isAnswered
                          ? 'bg-zinc-800 text-zinc-400'
                          : isSelectedOpt && isCorrect
                            ? 'bg-neon-green text-black'
                            : isSelectedOpt && !isCorrect
                              ? 'bg-red-500 text-white'
                              : isCorrectOpt
                                ? 'bg-neon-green/20 text-neon-green'
                                : 'bg-zinc-800 text-zinc-600',
                      )}>
                        {LETTERS[i]}
                      </span>
                      <span className="flex-1">{opt}</span>
                      {isAnswered && isSelectedOpt && isCorrect && <CheckCircle2 className="h-5 w-5 text-neon-green shrink-0" />}
                      {isAnswered && isSelectedOpt && !isCorrect && <XCircle className="h-5 w-5 text-red-400 shrink-0" />}
                      {isAnswered && !isSelectedOpt && isCorrectOpt && <CheckCircle2 className="h-5 w-5 text-neon-green/40 shrink-0" />}
                    </button>
                  )
                })}
              </div>

              <AnimatePresence>
                {isAnswered && explanation && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      'mt-4 rounded-xl px-4 py-3 text-[13px] leading-relaxed border-l-2',
                      isCorrect
                        ? 'bg-neon-green/5 border-neon-green text-zinc-400'
                        : 'bg-zinc-900 border-amber-400 text-zinc-400',
                    )}
                  >
                    <span className="font-semibold text-white mr-1.5">
                      {isCorrect ? t('video.correct') : t('video.correct_answer')}
                    </span>
                    {explanation}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Botón de acción inferior */}
            <AnimatePresence>
              {isAnswered && (
                <motion.div
                  className="px-8 pb-8 max-w-2xl mx-auto w-full shrink-0"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {!isLast ? (
                    <button
                      type="button"
                      onClick={handleNext}
                      className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-[14px] font-semibold text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
                    >
                      {t('video.next_question')} <ChevronRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleFinish}
                      className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-[14px] font-semibold text-black bg-amber-400 hover:bg-amber-300 transition-colors"
                    >
                      <Trophy className="h-4 w-4" /> {t('video.see_result')}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="summary"
            className="flex-1 flex flex-col items-center justify-center px-8 relative"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {showConfetti && (
              <div className="absolute top-1/2 left-1/2 pointer-events-none">
                {CONFETTI.map((c, ci) => (
                  <ConfettiPiece
                    key={ci}
                    color={c.color}
                    isBar={c.isBar}
                    angle={(ci / CONFETTI.length) * 360 + 15}
                    delay={ci * 0.07}
                  />
                ))}
              </div>
            )}

            <div className="w-full max-w-md text-center">
              <div className={cn(
                'h-20 w-20 rounded-3xl flex items-center justify-center mb-6 mx-auto ring-1',
                score / questions.length >= 0.75
                  ? 'bg-neon-green/10 ring-neon-green/30 text-neon-green'
                  : 'bg-amber-400/10 ring-amber-400/20 text-amber-400',
              )}>
                <Trophy className="h-9 w-9" />
              </div>

              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                {t('video.quiz_complete')}
              </p>
              <p className="text-[52px] font-bold text-white leading-none mb-1 tabular-nums">
                {score}
                <span className="text-[28px] text-zinc-600 font-medium"> / {questions.length}</span>
              </p>
              <p className="text-[14px] text-zinc-500 mb-6">
                {score === questions.length
                  ? t('video.all_correct')
                  : score / questions.length >= 0.75
                    ? t('video.good_result')
                    : t('video.review_material')}
              </p>

              <div className="h-1 w-full rounded-full bg-zinc-800 mb-8 overflow-hidden">
                <motion.div
                  className={cn('h-full rounded-full', score / questions.length >= 0.75 ? 'bg-neon-green' : 'bg-amber-400')}
                  initial={{ width: 0 }}
                  animate={{ width: `${(score / questions.length) * 100}%` }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
                />
              </div>

              <div className="space-y-2 mb-8 text-left">
                {questions.map((_, i) => {
                  const correct = answered[i] === questions[i].correct
                  const qText = questions[i].question[lang] || questions[i].question.es
                  return (
                    <div
                      key={i}
                      className={cn(
                        'flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[13px]',
                        correct
                          ? 'bg-neon-green/10 text-zinc-300'
                          : 'bg-red-500/10 text-zinc-400',
                      )}
                    >
                      {correct
                        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-neon-green" />
                        : <XCircle className="h-4 w-4 shrink-0 text-red-400" />}
                      <span className="line-clamp-1">{qText}</span>
                    </div>
                  )
                })}
              </div>

              <button
                type="button"
                onClick={() => onComplete(score, questions.length)}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-[14px] font-semibold text-black bg-neon-green hover:bg-neon-green/90 transition-colors"
              >
                <PlayCircle className="h-4 w-4" />
                {t('video.continue_video')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
