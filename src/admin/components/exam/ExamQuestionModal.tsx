import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { AlertTriangle, Check, GripVertical, Loader2, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Select } from '@/components/ui/Select'
import { Tooltip } from '@/components/ui/Tooltip'
import { useBackdropDismiss } from '@/hooks/useBackdropDismiss'
import { useUndoHistory } from '@/hooks/useUndoHistory'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { newOptionId, trueFalseOptions } from '@/services/exams.admin.service'
import type {
  ExamDifficulty,
  ExamDomain,
  ExamOption,
  ExamQuestion,
  ExamQuestionKind,
  ExamTargetLevel,
} from '@/types/exam'
import { DIFFICULTIES, difficultyLabel, isLevelLocked, levelFits } from '@/lib/examLevel'
import { cn } from '@/lib/cn'
import { rowText } from '@/lib/contentLang'

const ease = [0.16, 1, 0.3, 1] as const

/* ────────────────────────────────────────────────────────────────────────────
   Editor de UNA pregunta del examen.

   La regla de oro es que sea imposible guardar una pregunta rota: sin
   enunciado, sin dos opciones o sin respuesta marcada el botón no se activa y
   el motivo se dice en voz alta. Un banco con preguntas a medias es peor que
   un banco vacío — se descubre cuando alguien está presentando el examen.
   ──────────────────────────────────────────────────────────────────────────── */

export interface QuestionDraft {
  domain_id: string | null
  kind: ExamQuestionKind
  text_es: string
  options: ExamOption[]
  correct: string[]
  explanation_es: string
  difficulty: ExamDifficulty
}

export function ExamQuestionModal({
  question,
  domains,
  targetLevel = 'mixta',
  onSave,
  onClose,
}: {
  /** `null` = pregunta nueva. */
  question: ExamQuestion | null
  domains: ExamDomain[]
  /** Nivel al que evalúa el examen: si es fijo, la pregunta tiene que serlo. */
  targetLevel?: ExamTargetLevel
  onSave: (draft: QuestionDraft) => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [saving, setSaving] = useState(false)
  const backdrop = useBackdropDismiss(onClose, !saving)

  const [draft, setDraft] = useState<QuestionDraft>(() => ({
    domain_id: question?.domain_id ?? null,
    kind: question?.kind ?? 'single',
    text_es: question?.text_es ?? '',
    options: question?.options?.length
      ? question.options
      : [
          { id: 'a', text_es: '', text_en: null, text_pt: null },
          { id: 'b', text_es: '', text_en: null, text_pt: null },
          { id: 'c', text_es: '', text_en: null, text_pt: null },
          { id: 'd', text_es: '', text_en: null, text_pt: null },
        ],
    correct: question?.correct ?? [],
    explanation_es: question?.explanation_es ?? '',
    // Una pregunta nueva nace ya al nivel del examen: es el caso normal y
    // ahorra el aviso de "esta no es del nivel" antes de escribir nada.
    difficulty: question?.difficulty ?? (isLevelLocked(targetLevel) ? targetLevel : 'medio'),
  }))

  // Deshacer dentro de la pregunta (Ctrl+Z): reordenar opciones, vaciar una o
  // cambiar la respuesta correcta sin querer ya se puede desandar sin cerrar el
  // modal y perderlo todo. Abre con el borrador completo, así que nada cambia
  // aquí salvo por mano de una persona.
  useUndoHistory({ state: draft, apply: setDraft, trustChanges: true })

  // Cambiar a Verdadero/Falso reemplaza las opciones; volver a opción múltiple
  // devuelve cuatro casillas en blanco. Mezclarlas dejaba estados imposibles.
  useEffect(() => {
    setDraft((d) => {
      if (d.kind === 'true_false' && d.options.length !== 2) {
        return { ...d, options: trueFalseOptions(), correct: [] }
      }
      if (d.kind !== 'true_false' && d.options.length === 2 && d.options[0].text_es === 'Verdadero') {
        return {
          ...d,
          options: ['a', 'b', 'c', 'd'].map((id) => ({ id, text_es: '', text_en: null, text_pt: null })),
          correct: [],
        }
      }
      return d
    })
  }, [draft.kind])

  const multi = draft.kind === 'multi'

  const problems = useMemo(() => {
    const list: string[] = []
    if (!draft.text_es.trim()) list.push(t('admin.exam.q_err_text', 'Falta el enunciado'))
    const filled = draft.options.filter((o) => o.text_es.trim())
    if (filled.length < 2) list.push(t('admin.exam.q_err_options', 'Necesita al menos 2 opciones'))
    if (draft.correct.length === 0) {
      list.push(t('admin.exam.q_err_correct', 'Marca cuál es la respuesta correcta'))
    }
    if (!multi && draft.correct.length > 1) {
      list.push(t('admin.exam.q_err_single', 'Una sola respuesta permitida en este tipo'))
    }
    /* Una de "varias respuestas" con una sola correcta es una trampa: al
       aprendiz se le dice "elige 2" y no hay 2 que elegir. O tiene dos o es de
       una sola respuesta. */
    if (multi && draft.correct.length === 1) {
      list.push(
        t('admin.exam.q_err_multi_one', 'Marca al menos 2 correctas, o cámbiala a una sola respuesta'),
      )
    }
    if (draft.correct.some((id) => !filled.find((o) => o.id === id))) {
      list.push(t('admin.exam.q_err_correct_empty', 'La respuesta marcada está en blanco'))
    }
    // El nivel del examen es un contrato: no se guarda una pregunta que lo
    // rompa. Es mejor detenerlo aquí que descubrirlo al no poder publicar.
    if (!levelFits(targetLevel, draft.difficulty)) {
      list.push(
        t('admin.exam.q_err_level', {
          level: difficultyLabel(t, targetLevel),
          defaultValue: 'Este examen solo admite preguntas de nivel {{level}}',
        }),
      )
    }
    return list
  }, [draft, multi, targetLevel, t])

  const toggleCorrect = (id: string) => {
    setDraft((d) => ({
      ...d,
      correct: multi
        ? d.correct.includes(id)
          ? d.correct.filter((c) => c !== id)
          : [...d.correct, id]
        : d.correct[0] === id
          ? []
          : [id],
    }))
  }

  const setOptionText = (id: string, text: string) => {
    setDraft((d) => ({
      ...d,
      options: d.options.map((o) => (o.id === id ? { ...o, text_es: text } : o)),
    }))
  }

  const addOption = () => {
    setDraft((d) => ({
      ...d,
      options: [...d.options, { id: newOptionId(d.options), text_es: '', text_en: null, text_pt: null }],
    }))
  }

  const removeOption = (id: string) => {
    setDraft((d) => ({
      ...d,
      options: d.options.filter((o) => o.id !== id),
      correct: d.correct.filter((c) => c !== id),
    }))
  }

  const handleSave = async () => {
    if (problems.length > 0) return
    /* Un segundo disparo mientras el primero viaja crea la MISMA pregunta dos
       veces en el banco. El botón se deshabilita al guardar, pero eso solo
       frena al ratón: un evento que llegue por otra vía (teclado repetido, un
       clic sintético) entra igual. La guardia va aquí, que es donde escribe. */
    if (saving) return
    setSaving(true)
    try {
      await onSave({
        ...draft,
        // Las opciones en blanco no llegan a la base: son ruido que después
        // aparece como una alternativa vacía en el examen.
        options: draft.options.filter((o) => o.text_es.trim()),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-text outline-none transition-colors focus:border-primary'

  // Portal a <body>: dentro del árbol del panel, cualquier ancestro con
  // `transform`/`filter` (las tarjetas animadas del editor) crea un contexto de
  // apilamiento y encierra al `fixed`, con lo que el modal quedaba POR DEBAJO de
  // la barra lateral (z-[60]). El z-[120] es el estándar del sitio.
  return createPortal(
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      {...backdrop}
    >
      <motion.div
        initial={reduce ? undefined : { opacity: 0, scale: 0.97, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <h2 className="flex-1 text-[16px] font-semibold text-text">
            {question
              ? t('admin.exam.q_edit_title', 'Editar pregunta')
              : t('admin.exam.q_new_title', 'Nueva pregunta')}
          </h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-text-subtle transition-colors hover:bg-subtle hover:text-text"
            aria-label={t('common.close', 'Cerrar')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Tipo, tema y dificultad */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
                {t('admin.exam.q_kind', 'Tipo')}
              </label>
              <Select
                value={draft.kind}
                onChange={(v) => setDraft((d) => ({ ...d, kind: v as ExamQuestionKind }))}
                options={[
                  { value: 'single', label: t('admin.exam.kind_single', 'Una respuesta') },
                  { value: 'multi', label: t('admin.exam.kind_multi', 'Varias respuestas') },
                  { value: 'true_false', label: t('admin.exam.kind_tf', 'Verdadero / Falso') },
                ]}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
                {t('admin.exam.q_domain_v2', 'Tema')}
              </label>
              <Select
                value={draft.domain_id ?? ''}
                onChange={(v) => setDraft((d) => ({ ...d, domain_id: v || null }))}
                placeholder={t('admin.exam.q_no_domain_v2', 'Sin tema')}
                options={[
                  { value: '', label: t('admin.exam.q_no_domain_v2', 'Sin tema') },
                  ...domains.map((d) => ({ value: d.id, label: rowText(d, 'name'), color: d.color })),
                ]}
              />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-text-muted">
                {t('admin.exam.q_difficulty', 'Dificultad')}
                {isLevelLocked(targetLevel) && (
                  <Tooltip
                    label={t('admin.exam.q_difficulty_locked_tip', {
                      level: difficultyLabel(t, targetLevel),
                      defaultValue:
                        'Este examen evalúa a nivel {{level}}: solo se pueden guardar preguntas de ese nivel. Para mezclar niveles, cámbialo en "Reglas del examen".',
                    })}
                    maxWidth={280}
                    anchor="element"
                    describedBy
                  >
                    <ShieldCheck className="h-3.5 w-3.5 cursor-help text-primary" />
                  </Tooltip>
                )}
              </label>
              <Select
                value={draft.difficulty}
                onChange={(v) => setDraft((d) => ({ ...d, difficulty: v as ExamDifficulty }))}
                options={DIFFICULTIES.map((d) => ({ value: d, label: difficultyLabel(t, d) }))}
              />
              {!levelFits(targetLevel, draft.difficulty) && (
                <button
                  type="button"
                  onClick={() =>
                    setDraft((d) => ({ ...d, difficulty: targetLevel as ExamDifficulty }))
                  }
                  className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-amber-700 underline decoration-dotted underline-offset-2 dark:text-amber-300"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {t('admin.exam.q_use_exam_level', {
                    level: difficultyLabel(t, targetLevel),
                    defaultValue: 'Usar el nivel del examen ({{level}})',
                  })}
                </button>
              )}
            </div>
          </div>

          {/* Enunciado */}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
              {t('admin.exam.q_text', 'Enunciado')}
            </label>
            <textarea
              value={draft.text_es}
              onChange={(e) => setDraft((d) => ({ ...d, text_es: e.target.value }))}
              rows={3}
              autoFocus
              placeholder={t(
                'admin.exam.q_text_ph',
                'Un cliente llama molesto porque le cobraron dos veces. ¿Qué haces primero?',
              )}
              className={cn(inputCls, 'resize-y leading-relaxed')}
            />
            <p className="mt-1.5 text-[11.5px] text-text-subtle">
              {t(
                'admin.exam.q_text_hint',
                'Las preguntas de situación miden mejor que las de definición.',
              )}
            </p>
          </div>

          {/* Opciones */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[12px] font-medium text-text-muted">
                {t('admin.exam.q_options', 'Opciones')}
              </label>
              <span className="text-[11.5px] text-text-subtle">
                {multi
                  ? t('admin.exam.q_mark_multi_n', {
                      n: draft.correct.length,
                      defaultValue: 'Marca todas las correctas (van {{n}}; mínimo 2)',
                    })
                  : t('admin.exam.q_mark_single', 'Marca la correcta')}
              </span>
            </div>

            <div className="space-y-2">
              {draft.options.map((opt, i) => {
                const isCorrect = draft.correct.includes(opt.id)
                return (
                  <div key={opt.id} className="flex items-center gap-2">
                    <Tooltip
                      label={
                        isCorrect
                          ? t('admin.exam.q_is_correct', 'Es la correcta')
                          : t('admin.exam.q_set_correct', 'Marcar como correcta')
                      }
                    >
                      <button
                        type="button"
                        onClick={() => toggleCorrect(opt.id)}
                        className={cn(
                          'grid h-8 w-8 shrink-0 place-items-center border text-[12px] font-semibold transition-colors',
                          multi ? 'rounded-lg' : 'rounded-full',
                          isCorrect
                            ? 'border-primary bg-primary text-on-primary'
                            : 'border-line text-text-subtle hover:border-primary/50',
                        )}
                      >
                        {isCorrect ? (
                          <Check className="h-4 w-4" strokeWidth={3} />
                        ) : (
                          String.fromCharCode(65 + i)
                        )}
                      </button>
                    </Tooltip>

                    <input
                      value={opt.text_es}
                      onChange={(e) => setOptionText(opt.id, e.target.value)}
                      placeholder={t('admin.exam.q_option_ph', {
                        n: i + 1,
                        defaultValue: 'Opción {{n}}',
                      })}
                      disabled={draft.kind === 'true_false'}
                      className={cn(inputCls, 'py-2 disabled:opacity-60')}
                    />

                    {draft.kind !== 'true_false' && draft.options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOption(opt.id)}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                        aria-label={t('common.delete', 'Eliminar')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            {draft.kind !== 'true_false' && draft.options.length < 8 && (
              <button
                type="button"
                onClick={addOption}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] font-medium text-text-muted transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('admin.exam.q_add_option', 'Añadir opción')}
              </button>
            )}
          </div>

          {/* Explicación */}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-text-muted">
              {t('admin.exam.q_explanation', 'Por qué (se muestra en el informe)')}
            </label>
            <textarea
              value={draft.explanation_es}
              onChange={(e) => setDraft((d) => ({ ...d, explanation_es: e.target.value }))}
              rows={2}
              placeholder={t(
                'admin.exam.q_explanation_ph',
                'Explica en una o dos frases por qué esa es la respuesta.',
              )}
              className={cn(inputCls, 'resize-y leading-relaxed')}
            />
          </div>

          {/* Qué falta */}
          {problems.length > 0 && (
            <ul className="space-y-1 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
              {problems.map((p) => (
                <li key={p} className="flex items-center gap-2 text-[12.5px] text-text-muted">
                  <GripVertical className="h-3 w-3 text-amber-500" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-2.5 text-[13.5px] text-text-muted transition-colors hover:text-text"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            onClick={handleSave}
            disabled={problems.length > 0 || saving}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('common.save', 'Guardar')}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
