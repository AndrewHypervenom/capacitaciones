import { AlertTriangle, Check, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import {
  DIFFICULTIES,
  DIFFICULTY_PILL,
  difficultyLabel,
  isLevelLocked,
  levelFits,
} from '@/lib/examLevel'
import type { ExamDifficulty, ExamTargetLevel } from '@/types/exam'

/* ────────────────────────────────────────────────────────────────────────────
   Las tres piezas del nivel del examen, compartidas por todas las pantallas
   que lo tocan: el selector, la píldora de nivel y el aviso de bloqueo.

   La regla es una sola y se repite igual en los cuatro sitios: si el examen
   evalúa a un nivel concreto, TODO lo que entra al banco es de ese nivel.
   Mejor un aviso que se entiende que un examen "avanzado" respondido con
   preguntas básicas.
   ──────────────────────────────────────────────────────────────────────────── */

/** Selector del nivel del examen (vive en "Reglas del examen"). */
export function ExamLevelPicker({
  value,
  onChange,
  offLevelCount = 0,
  onSeeOffLevel,
}: {
  value: ExamTargetLevel
  onChange: (v: ExamTargetLevel) => void
  /** Preguntas del banco que no son de ese nivel (para avisar al cambiarlo). */
  offLevelCount?: number
  onSeeOffLevel?: () => void
}) {
  const { t } = useTranslation()

  const options: { id: ExamTargetLevel; tip: string }[] = [
    {
      id: 'mixta',
      tip: t(
        'admin.exam.level_tip_mixta',
        'El examen acepta preguntas de cualquier nivel. Es lo más flexible y no bloquea nada, pero el aprendiz no sabe a qué exigencia se enfrenta.',
      ),
    },
    {
      id: 'basico',
      tip: t(
        'admin.exam.level_tip_basico',
        'Reconocer y recordar: definiciones, pasos del proceso, qué dice la política. Para certificar que la persona conoce el contenido.',
      ),
    },
    {
      id: 'medio',
      tip: t(
        'admin.exam.level_tip_medio',
        'Aplicar: casos concretos donde hay que usar la regla correcta. Es el nivel estándar de una certificación operativa.',
      ),
    },
    {
      id: 'avanzado',
      tip: t(
        'admin.exam.level_tip_avanzado',
        'Decidir: dos opciones defendibles y hay que elegir la mejor, con excepciones y varias reglas en juego. Para certificar criterio, no memoria.',
      ),
    },
  ]

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <label className="text-[12px] font-medium text-text-muted">
          {t('admin.exam.f_level', 'Nivel del examen')}
        </label>
        <Tooltip
          label={t(
            'admin.exam.f_level_tip',
            'Es un compromiso, no una etiqueta: con un nivel fijo, la IA solo escribe preguntas de ese nivel, los quizzes de otro nivel no se pueden copiar al banco y el examen no se publica hasta que todo el banco sea de ese nivel.',
          )}
          maxWidth={300}
          anchor="element"
          describedBy
        >
          <ShieldCheck className="h-3.5 w-3.5 cursor-help text-text-subtle" />
        </Tooltip>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(({ id, tip }) => {
          const selected = value === id
          return (
            <Tooltip key={id} label={tip} maxWidth={280} anchor="element" describedBy>
              <button
                type="button"
                onClick={() => onChange(id)}
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all',
                  selected
                    ? 'border-primary/50 bg-primary/[0.06] ring-1 ring-primary/20'
                    : 'border-line hover:border-primary/25',
                )}
              >
                <div
                  className={cn(
                    'grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
                    selected ? 'border-primary bg-primary' : 'border-line',
                  )}
                >
                  {selected && <Check className="h-3 w-3 text-on-primary" strokeWidth={3} />}
                </div>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-medium text-text">
                    {difficultyLabel(t, id)}
                  </div>
                  <div className="text-[11.5px] text-text-muted">
                    {id === 'mixta'
                      ? t('admin.exam.level_desc_mixta', 'Acepta cualquier nivel. No bloquea nada.')
                      : id === 'basico'
                        ? t('admin.exam.level_desc_basico', 'Reconocer lo que se enseñó.')
                        : id === 'medio'
                          ? t('admin.exam.level_desc_medio', 'Aplicar la regla a un caso.')
                          : t('admin.exam.level_desc_avanzado', 'Decidir entre opciones defendibles.')}
                  </div>
                </div>
              </button>
            </Tooltip>
          )
        })}
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-text-subtle">
        {isLevelLocked(value)
          ? t('admin.exam.f_level_hint_locked', {
              level: difficultyLabel(t, value),
              defaultValue:
                'Con nivel {{level}}: la IA escribe solo a ese nivel, los quizzes de otro nivel no se copian y no se puede publicar con preguntas fuera de nivel.',
            })
          : t(
              'admin.exam.f_level_hint_mixed',
              'Con mezcla de niveles no se valida nada: cualquier pregunta entra al banco y el examen se publica igual.',
            )}
      </p>

      {isLevelLocked(value) && offLevelCount > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3.5 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1 text-[12px] text-text-muted">
            {t('admin.exam.level_change_warn', {
              n: offLevelCount,
              level: difficultyLabel(t, value),
              defaultValue:
                'El banco ya tiene {{n}} preguntas que no son de nivel {{level}}. Ajústalas o quítalas: hasta entonces no podrás publicar.',
            })}
          </span>
          {onSeeOffLevel && (
            <button
              type="button"
              onClick={onSeeOffLevel}
              className="shrink-0 rounded-full border border-amber-500/40 px-3 py-1 text-[11.5px] font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
            >
              {t('admin.exam.level_see_off', 'Ver cuáles')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Píldora de nivel. En ámbar y con aviso si no encaja con el nivel del examen. */
export function LevelPill({
  level,
  target,
  className,
}: {
  level: ExamDifficulty
  target?: ExamTargetLevel
  className?: string
}) {
  const { t } = useTranslation()
  const fits = levelFits(target, level)

  const pill = (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        fits
          ? DIFFICULTY_PILL[level]
          : 'cursor-help border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
        className,
      )}
    >
      {!fits && <AlertTriangle className="h-3 w-3" />}
      {difficultyLabel(t, level)}
    </span>
  )

  if (fits) return pill
  return (
    <Tooltip
      label={t('admin.exam.level_pill_off_tip', {
        level: difficultyLabel(t, level),
        target: difficultyLabel(t, target as ExamDifficulty),
        defaultValue:
          'Es de nivel {{level}} y el examen evalúa a nivel {{target}}. Mientras esté en el banco, el examen no se puede publicar.',
      })}
      maxWidth={270}
      anchor="element"
      describedBy
    >
      {pill}
    </Tooltip>
  )
}

/**
 * Aviso de bloqueo por nivel, con su salida a un clic.
 *
 * Siempre aparece junto al botón que bloquea, nunca como un toast que se va:
 * el capacitador tiene que poder leer por qué no puede seguir mientras arregla.
 */
export function LevelGuard({
  title,
  body,
  actionLabel,
  onAction,
  className,
}: {
  title: string
  body: string
  actionLabel?: string
  onAction?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/[0.07] px-4 py-3',
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div className="min-w-[180px] flex-1">
        <p className="text-[13px] font-semibold text-text">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-text-muted">{body}</p>
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 rounded-full border border-amber-500/40 px-3.5 py-1.5 text-[12px] font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}

/** Selector de nivel para la IA: fijo al del examen cuando el examen lo exige. */
export function AiLevelField({
  value,
  onChange,
  target,
  disabled,
}: {
  value: ExamTargetLevel
  onChange: (v: ExamTargetLevel) => void
  target: ExamTargetLevel
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const locked = isLevelLocked(target)
  const choices: ExamTargetLevel[] = ['mixta', ...DIFFICULTIES]

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label className="text-[12px] font-medium text-text-muted">
          {t('admin.exam.ai_difficulty', 'Nivel')}
        </label>
        {locked && (
          <Tooltip
            label={t('admin.exam.ai_level_locked_tip', {
              level: difficultyLabel(t, target),
              defaultValue:
                'El examen evalúa a nivel {{level}}, así que la IA escribe a ese nivel. Para pedir otro, cambia el nivel del examen en "Reglas del examen".',
            })}
            maxWidth={280}
            anchor="element"
            describedBy
          >
            <ShieldCheck className="h-3.5 w-3.5 cursor-help text-primary" />
          </Tooltip>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => {
          const selected = value === c
          const blocked = locked && c !== target
          return (
            <Tooltip
              key={c}
              label={
                blocked
                  ? t('admin.exam.ai_level_blocked_tip', {
                      level: difficultyLabel(t, target),
                      defaultValue:
                        'No disponible: este examen solo admite preguntas de nivel {{level}}.',
                    })
                  : difficultyLabel(t, c)
              }
              maxWidth={260}
            >
              {/* Los niveles bloqueados van con `aria-disabled` y no con
                  `disabled`: un botón deshabilitado no recibe eventos y el
                  tooltip que explica POR QUÉ no está disponible nunca saldría. */}
              <button
                type="button"
                disabled={disabled}
                aria-disabled={blocked}
                onClick={() => !blocked && onChange(c)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors',
                  selected
                    ? 'border-primary/50 bg-primary/[0.08] text-primary'
                    : 'border-line text-text-muted hover:text-text',
                  blocked && 'cursor-not-allowed opacity-40 hover:text-text-muted',
                  disabled && 'opacity-40',
                )}
              >
                {c === 'mixta' ? t('admin.exam.ai_diff_mixed', 'Mezcla equilibrada') : difficultyLabel(t, c)}
              </button>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
