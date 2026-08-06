import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, GitCompareArrows } from 'lucide-react'
import { ease } from '@/components/ui/motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import type { GeneratedScenario } from '@/services/ai.service'
import { diffScenarios, type DiffPiece, type NodeDiff } from './diffScenario'
import { cn } from '@/lib/cn'
import i18n from '@/i18n'

interface Props {
  before: GeneratedScenario | null
  after: GeneratedScenario | null
  type: 'dialogue' | 'choice'
}

const KIND_STYLE: Record<NodeDiff['kind'], string> = {
  added: 'bg-brand-green/15 text-brand-green',
  removed: 'bg-danger/15 text-danger',
  changed: 'bg-brand-violet/15 text-brand-violet',
}

/** Texto con lo que se va (rojo) o lo que entra (verde) resaltado dentro de la frase. */
function Pieces({ pieces, plain, side }: { pieces?: DiffPiece[]; plain: string; side: 'before' | 'after' }) {
  if (!plain && !pieces?.length) {
    return <span className="italic text-text-subtle">{i18n.t('admin.simulations.ai_edit.diff.empty')}</span>
  }
  if (!pieces) return <>{plain}</>
  return (
    <>
      {pieces.map((p, i) =>
        p.t === 'same' ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span
            key={i}
            className={cn(
              'rounded px-0.5 font-medium',
              side === 'before' ? 'bg-danger/15 text-danger' : 'bg-brand-green/18 text-brand-green',
            )}
          >
            {p.text}
          </span>
        ),
      )}
    </>
  )
}

/**
 * ANTES Y DESPUÉS del ajuste, campo por campo. Va debajo de la lista de cambios que
 * escribe la IA: eso es lo que dice que hizo, esto es lo que de verdad va a pasar si
 * se aplica. Sin esto, "11 rutas reconectadas" es un número que no se puede revisar.
 */
export function ScenarioDiff({ before, after, type }: Props) {
  const reduce = useReducedMotion()
  const diffs = useMemo(() => diffScenarios(before, after, type), [before, after, type])
  // Con uno o dos momentos se abre solo: es justo lo que el capacitador vino a ver.
  const [open, setOpen] = useState(() => diffs.length > 0 && diffs.length <= 2)

  if (diffs.length === 0) return null

  return (
    <div className="rounded-xl border border-glass-border/15 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-glass/4 transition-colors"
      >
        <GitCompareArrows className="h-3.5 w-3.5 text-brand-violet shrink-0" />
        <span className="text-xs font-medium text-text">
          {i18n.t('admin.simulations.ai_edit.diff.title')}
        </span>
        <span className="text-[11px] text-text-subtle">
          {i18n.t('admin.simulations.ai_edit.diff.count', { count: diffs.length })}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25, ease }} className="ml-auto shrink-0">
          <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? undefined : { height: 0, opacity: 0 }}
            animate={reduce ? undefined : { height: 'auto', opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2.5 max-h-[26rem] overflow-y-auto">
              {diffs.map((d) => (
                <div key={d.id} className="rounded-lg border border-glass-border/15 overflow-hidden">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 bg-glass/5 border-b border-glass-border/10">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0', KIND_STYLE[d.kind])}>
                      {i18n.t(`admin.simulations.ai_edit.diff.kind_${d.kind}`)}
                    </span>
                    <span className="text-[11px] text-text-muted truncate">{d.title}</span>
                    <code className="ml-auto shrink-0 text-[10px] text-text-subtle font-mono">{d.id}</code>
                  </div>

                  {/* La confusión número uno: creer que las 3 respuestas son 3
                      propuestas entre las que hay que elegir. Son lo que verá el
                      aprendiz dentro de ESTE momento. */}
                  {d.hasAnswers && (
                    <p className="px-2.5 pt-2 text-[10px] leading-relaxed text-text-subtle">
                      {i18n.t('admin.simulations.ai_edit.diff.answers_caption')}
                    </p>
                  )}

                  <div className="divide-y divide-glass-border/10">
                    {d.rows.map((row, i) => (
                      <div key={i} className="px-2.5 py-2">
                        {/* Encabezado de la respuesta/camino, solo cuando cambia. */}
                        {row.group && row.group !== d.rows[i - 1]?.group && (
                          <p className="text-[11px] font-semibold text-brand-violet mb-1.5">{row.group}</p>
                        )}
                        <p className="text-[10px] font-medium uppercase tracking-wide text-text-subtle mb-1.5">
                          {row.label}
                        </p>
                        {row.note ? (
                          <p className="text-[11px] leading-relaxed text-text-muted rounded-lg border border-glass-border/15 bg-glass/5 px-2 py-1.5">
                            {row.note}
                          </p>
                        ) : (
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          <div className="rounded-lg border border-danger/20 bg-danger/[0.06] px-2 py-1.5 min-w-0">
                            <span className="block text-[9px] font-semibold uppercase tracking-wide text-danger/70 mb-0.5">
                              {i18n.t('admin.simulations.ai_edit.diff.before')}
                            </span>
                            <p className="text-[11px] leading-relaxed text-text-muted break-words">
                              <Pieces pieces={row.beforePieces} plain={row.before} side="before" />
                            </p>
                          </div>
                          <div className="rounded-lg border border-brand-green/25 bg-brand-green/[0.06] px-2 py-1.5 min-w-0">
                            <span className="block text-[9px] font-semibold uppercase tracking-wide text-brand-green/80 mb-0.5">
                              {i18n.t('admin.simulations.ai_edit.diff.after')}
                            </span>
                            <p className="text-[11px] leading-relaxed text-text break-words">
                              <Pieces pieces={row.afterPieces} plain={row.after} side="after" />
                            </p>
                          </div>
                        </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
