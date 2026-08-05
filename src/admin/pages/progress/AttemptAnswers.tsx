import React from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, XCircle, MinusCircle, ArrowRight, Info, MessageSquare, ListOrdered, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ScoreDistribution } from './ModulesChrome'
import { getSectionContent, type SectionContent } from '@/services/attemptContent.service'

/* ────────────────────────────────────────────────────────────────────────
   Visor de "qué respondió el aprendiz". Cada tipo de actividad guarda su
   detalle en `submitted_answers.detalle` (ver los bloques del aprendiz):

   · KNOWLEDGE_CHECK → pregunta suelta con opción elegida / correcta
   · VIDEO_QUIZ      → detalle[] de preguntas del marcador del video
   · CLASSIFY_CASES  → detalle[] de casos: dónde lo puso vs. dónde iba
   · SORT_PROCESS    → detalle[] de procesos: orden correcto vs. primer intento

   Los intentos ANTERIORES a este cambio no traen `detalle`: para esos se cae
   al resumen de siempre (aciertos/errores + variables), nunca a una pantalla
   vacía. Todo el texto viene ya en el idioma en que jugó el aprendiz.
   ──────────────────────────────────────────────────────────────────────── */

const ease = [0.16, 1, 0.3, 1] as const

export interface QuizDetail {
  pregunta: string
  opcion_elegida: string | null
  opcion_correcta: string
  correcta: boolean
}

export interface ClassifyDetail {
  caso: string
  categoria_elegida: string | null
  categoria_correcta: string | null
  correcta: boolean
}

export interface SortDetail {
  proceso: string
  orden_correcto: string[]
  primer_intento: string[] | null
  correcta: boolean
}

type AnyRecord = Record<string, any>

/** Fila de encabezado: "N de M correctas" + barra verde/roja. */
function ResultHeader({ ok, total, label }: { ok: number; total: number; label?: string }) {
  const { t } = useTranslation()
  if (total === 0) return null
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-[13px] font-semibold text-text">
        {label ?? t('admin.trainer_panel.n_of_m_correct', '{{ok}} de {{total}} correctas', { ok, total })}
      </span>
      <ScoreDistribution perfect={ok} passed={0} failed={total - ok} className="max-w-[200px]" height={6} />
    </div>
  )
}

/** Etiqueta de estado (acertó / falló / sin responder). */
function Verdict({ state }: { state: 'ok' | 'bad' | 'none' }) {
  const { t } = useTranslation()
  const map = {
    ok: { Icon: CheckCircle2, label: t('admin.trainer_panel.verdict_ok', 'Correcta'), cls: 'text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/25' },
    bad: { Icon: XCircle, label: t('admin.trainer_panel.verdict_bad', 'Incorrecta'), cls: 'text-red-500 dark:text-red-400 bg-red-500/10 border-red-500/25' },
    none: { Icon: MinusCircle, label: t('admin.trainer_panel.verdict_none', 'Sin responder'), cls: 'text-text-muted bg-subtle/60 border-line' },
  }[state]
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', map.cls)}>
      <map.Icon className="h-3 w-3" />
      {map.label}
    </span>
  )
}

/** Tarjeta de una pregunta: enunciado + respuesta del aprendiz + la correcta. */
function QuestionCard({ q, index, delay }: { q: QuizDetail; index: number; delay: number }) {
  const { t } = useTranslation()
  const state: 'ok' | 'bad' | 'none' = q.opcion_elegida == null ? 'none' : q.correcta ? 'ok' : 'bad'
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease }}
      className={cn(
        'overflow-hidden rounded-2xl border',
        state === 'ok' ? 'border-green-500/25' : state === 'bad' ? 'border-red-500/25' : 'border-line',
      )}
    >
      <div className="flex items-start gap-2.5 border-b border-line bg-subtle/50 px-4 py-3">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-zinc-200/70 dark:bg-zinc-800 text-[10px] font-bold text-text-muted">
          {index + 1}
        </span>
        <p className="flex-1 text-[13.5px] font-medium leading-snug text-text">{q.pregunta}</p>
        <Verdict state={state} />
      </div>

      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 sm:divide-x">
        <div className={cn('px-4 py-3', state === 'ok' ? 'bg-green-50/40 dark:bg-green-950/10' : state === 'bad' ? 'bg-red-50/40 dark:bg-red-950/10' : '')}>
          <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">
            {t('admin.trainer_panel.q_your_answer')}
          </p>
          <div className={cn(
            'flex items-start gap-2 text-[13px] font-semibold',
            state === 'ok' ? 'text-green-600 dark:text-green-400' : state === 'bad' ? 'text-red-500 dark:text-red-400' : 'text-text-muted italic',
          )}>
            {state === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : state === 'bad' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : null}
            <span>{q.opcion_elegida ?? t('admin.trainer_panel.no_answer', 'No respondió')}</span>
          </div>
        </div>
        {/* La correcta solo aporta cuando falló: si acertó sería repetir la misma línea. */}
        {state !== 'ok' && (
          <div className="px-4 py-3">
            <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">
              {t('admin.trainer_panel.q_correct_answer')}
            </p>
            <div className="flex items-start gap-2 text-[13px] font-semibold text-green-600 dark:text-green-400">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{q.opcion_correcta || '—'}</span>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

/** Caso del juego de clasificar: dónde lo puso vs. dónde iba. */
function CaseRow({ c, index, delay }: { c: ClassifyDetail; index: number; delay: number }) {
  const { t } = useTranslation()
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay, ease }}
      className={cn(
        'rounded-2xl border p-3.5',
        c.correcta ? 'border-green-500/25 bg-green-50/30 dark:bg-green-950/10' : 'border-red-500/25 bg-red-50/30 dark:bg-red-950/10',
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-zinc-200/70 dark:bg-zinc-800 text-[10px] font-bold text-text-muted">
          {index + 1}
        </span>
        <p className="flex-1 text-[13px] leading-snug text-text">{c.caso}</p>
        <Verdict state={c.correcta ? 'ok' : 'bad'} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-8 text-[12px]">
        <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted">
          {t('admin.trainer_panel.classified_as', 'Lo clasificó en')}
        </span>
        <span className={cn('rounded-lg border px-2 py-0.5 font-semibold',
          c.correcta
            ? 'border-green-500/25 text-green-600 dark:text-green-400'
            : 'border-red-500/25 text-red-500 dark:text-red-400')}>
          {c.categoria_elegida ?? '—'}
        </span>
        {!c.correcta && (
          <>
            <ArrowRight className="h-3.5 w-3.5 text-text-muted/50" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted">
              {t('admin.trainer_panel.should_be', 'Iba en')}
            </span>
            <span className="rounded-lg border border-green-500/25 px-2 py-0.5 font-semibold text-green-600 dark:text-green-400">
              {c.categoria_correcta ?? '—'}
            </span>
          </>
        )}
      </div>
    </motion.div>
  )
}

/** Proceso del juego de ordenar: orden correcto y, si falló, lo que envió. */
function ProcessCard({ p, index, delay }: { p: SortDetail; index: number; delay: number }) {
  const { t } = useTranslation()
  // Posición que la persona le dio a cada paso en su primer intento (para marcar
  // exactamente qué pasos movió de lugar, no solo "se equivocó").
  const wrongPos = new Map<string, number>()
  p.primer_intento?.forEach((text, i) => wrongPos.set(text, i))

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease }}
      className={cn('rounded-2xl border p-4', p.correcta ? 'border-green-500/25' : 'border-amber-500/30')}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-subtle text-text-muted">
          <ListOrdered className="h-3.5 w-3.5" />
        </span>
        {/* Si el paso se guardó sin nombre, se dice así en vez de mostrar el
            marcador interno como si fuera lo que respondió el aprendiz. */}
        {isPlaceholderName(p.proceso) ? (
          <p className="flex-1 truncate text-[13.5px] font-semibold italic text-text-muted" title={p.proceso}>
            {t('admin.trainer_panel.unknown_item', 'Contenido sin nombre')}
          </p>
        ) : (
          <p className="flex-1 truncate text-[13.5px] font-semibold text-text">{p.proceso}</p>
        )}
        <Verdict state={p.correcta ? 'ok' : 'bad'} />
      </div>

      {p.correcta ? (
        // Acertó a la primera: basta con el orden que armó (= el correcto).
        <ol className="space-y-1.5">
          {p.orden_correcto.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px] text-text">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-green-500/15 text-[9.5px] font-bold text-green-600 dark:text-green-400">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-[9px] font-bold uppercase tracking-wider text-text-muted">
              {t('admin.trainer_panel.sent_order', 'Su primer intento')}
            </p>
            {p.primer_intento?.length ? (
              <ol className="space-y-1.5">
                {p.primer_intento.map((step, i) => {
                  const okHere = p.orden_correcto[i] === step
                  return (
                    <li key={i} className={cn('flex items-start gap-2 text-[12.5px]', okHere ? 'text-text' : 'text-red-500 dark:text-red-400')}>
                      <span className={cn(
                        'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-[9.5px] font-bold',
                        okHere ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-red-500/15 text-red-500 dark:text-red-400',
                      )}>
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="text-[12px] italic text-text-muted">{t('admin.trainer_panel.no_first_try', 'Sin registro del intento fallido')}</p>
            )}
          </div>
          <div>
            <p className="mb-2 text-[9px] font-bold uppercase tracking-wider text-text-muted">
              {t('admin.trainer_panel.correct_order', 'Orden correcto')}
            </p>
            <ol className="space-y-1.5">
              {p.orden_correcto.map((step, i) => {
                const moved = wrongPos.has(step) && wrongPos.get(step) !== i
                return (
                  <li key={i} className="flex items-start gap-2 text-[12.5px] text-text">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-green-500/15 text-[9.5px] font-bold text-green-600 dark:text-green-400">
                      {i + 1}
                    </span>
                    <span className={cn(moved && 'font-semibold')}>{step}</span>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      )}
    </motion.div>
  )
}

/** Claves internas que nunca deben salir en pantalla como "dato". */
const INTERNAL_KEYS = [
  'total', 'aciertos', 'errores', 'total_preguntas', 'correctas', 'incorrectas', 'total_cases',
  'detalle', 'quiz_key', 'marker_id', 'doc_key', 'opcion_index', 'correcta',
  'pregunta', 'opcion_elegida', 'opcion_correcta',
  // Texto fijo del propio juego ("Juego de ordenar completado"): no aporta nada.
  'mensaje', 'mensaje_detalle', 'proceso_finalizado', 'tema',
]

/**
 * Nombres que en realidad son un "no se pudo resolver": el bloque no tenía título
 * cuando se guardó el intento, o el contenido se editó/eliminó después. Mostrarlos
 * tal cual ("Proceso sin título") hace pensar que el aprendiz respondió eso.
 */
const PLACEHOLDER_NAMES = new Set(
  [
    'proceso sin titulo', 'proceso sin título', 'sin titulo', 'sin título',
    'processo sem titulo', 'processo sem título', 'untitled', 'no title',
    'undefined', 'null', '-', '—', 'secuencia',
  ],
)

const isPlaceholderName = (s: string) => {
  const norm = s.trim().toLowerCase().replace(/\.$/, '')
  return norm === '' || PLACEHOLDER_NAMES.has(norm) || /^proceso \d+$/.test(norm)
}

/** Tarjeta para un elemento cuyo nombre se perdió: explica por qué, sin culpar al aprendiz. */
function UnknownItemCard({ raw, tone = 'red' }: { raw: string; tone?: 'red' | 'amber' }) {
  const { t } = useTranslation()
  return (
    <div className={cn(
      'flex items-start gap-2.5 rounded-2xl border p-3.5',
      tone === 'red' ? 'border-red-500/25 bg-red-50/30 dark:bg-red-950/10' : 'border-amber-500/30 bg-amber-500/5',
    )}>
      <HelpCircle className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'red' ? 'text-red-500 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-text">
          {t('admin.trainer_panel.unknown_item', 'Contenido sin nombre')}
        </p>
        <p className="mt-1 text-[12px] leading-snug text-text-muted">
          {t(
            'admin.trainer_panel.unknown_item_why',
            'Cuando se respondió, este paso no tenía título; o el contenido se editó o se eliminó del módulo después. El intento sí quedó registrado.',
          )}
        </p>
        {raw && (
          <p className="mt-1.5 text-[11px] italic text-text-muted/70">
            {t('admin.trainer_panel.recorded_as', 'Registrado como')}: “{raw}”
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Saca los nombres de lo que falló desde la nota que arma el propio juego, con
 * forma fija: "1 de 8 casos mal ubicados: Caso A, Caso B y 2 más." Los juegos la
 * escriben siempre en español (es texto generado en el bloque, no traducido), así
 * que se corta por el primer ": " y se separa por comas — si el formato no
 * coincide se devuelve vacío y la nota se muestra tal cual.
 */
function extractFailedItems(nota: string): { names: string[]; more: number } {
  const idx = nota.indexOf(': ')
  if (idx < 0) return { names: [], more: 0 }
  let tail = nota.slice(idx + 2).trim().replace(/\.\s*$/, '')
  let more = 0
  const moreMatch = tail.match(/\s+y\s+(\d+)\s+más$/i)
  if (moreMatch) {
    more = Number(moreMatch[1])
    tail = tail.slice(0, moreMatch.index).trim()
  }
  const names = tail.split(/,\s*/).map((s) => s.trim()).filter(Boolean)
  return { names, more }
}

/**
 * Resumen para entregas viejas (sin `detalle`) o tipos desconocidos. La versión
 * anterior volcaba las claves crudas del JSON —"mensaje", "proceso finalizado"—
 * y leía como un log, no como una entrega. Aquí se traduce a una sola frase que
 * dice qué pasó, con la nota del propio juego debajo.
 */
function LegacySummary({ gameType, answers, score }: { gameType: string; answers: AnyRecord; score: number }) {
  const { t } = useTranslation()
  const aciertos = Number(answers.aciertos ?? answers.correctas ?? 0)
  const errores = Number(answers.errores ?? answers.incorrectas ?? 0)
  const total = Number(answers.total ?? answers.total_cases ?? answers.total_preguntas ?? aciertos + errores)
  // Nombre legible de la actividad tal como lo vio el aprendiz.
  const titulo = answers.proceso_finalizado || answers.tema || null
  const nota = answers.mensaje_detalle || null

  // Cada juego mide algo distinto: "0 de 1 correctas" en un juego de ordenar es
  // falso —lo terminó— y solo confunde. Por eso la frase es por tipo.
  let headline: string
  let good = aciertos
  let bad = errores
  if (gameType === 'SORT_PROCESS') {
    // En ordenar, "errores" = procesos que necesitaron repaso; completarlo es 100%.
    headline = t('admin.trainer_panel.legacy_sort', 'Completó la secuencia. {{first}} de {{total}} a la primera.', {
      first: aciertos, total: total || aciertos + errores,
    })
  } else if (gameType === 'CLASSIFY_CASES') {
    headline = t('admin.trainer_panel.legacy_classify', 'Ubicó bien {{ok}} de {{total}} casos.', { ok: aciertos, total })
  } else if (total > 0) {
    headline = t('admin.trainer_panel.n_of_m_correct', '{{ok}} de {{total}} correctas', { ok: aciertos, total })
  } else {
    headline = `${score}%`
    good = score >= 70 ? 1 : 0
    bad = score >= 70 ? 0 : 1
  }

  // La nota del juego SÍ nombra lo que falló ("…: Caso A, Caso B y 2 más."), así
  // que se extraen esos nombres y se pintan como tarjetas en vez de dejar una
  // frase larga que hay que leer con lupa.
  const parsed = extractFailedItems(String(nota ?? ''))
  // Si un caso trae comas en su texto, el corte por comas lo habría partido en
  // pedazos: en ese caso (más nombres que errores) no inventamos nada y se
  // muestra la nota original tal cual.
  const failed = errores > 0 && parsed.names.length > errores ? { names: [], more: 0 } : parsed
  const okCount = Math.max(0, (total || aciertos + errores) - (errores || failed.names.length))

  // Cualquier dato suelto que no sepamos interpretar va aparte, sin protagonismo.
  const rest = Object.entries(answers).filter(([k, v]) => !INTERNAL_KEYS.includes(k) && v != null && v !== '')

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-subtle/40 p-4">
        {titulo && !isPlaceholderName(String(titulo)) && (
          <p className="mb-2 text-[13.5px] font-semibold leading-snug text-text">{String(titulo)}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-semibold text-text">{headline}</span>
          <ScoreDistribution perfect={good} passed={0} failed={bad} className="max-w-[180px]" height={6} />
        </div>
      </div>

      {/* Lo que falló, nombre por nombre */}
      {failed.names.length > 0 ? (
        <div className="space-y-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            {gameType === 'SORT_PROCESS'
              ? t('admin.trainer_panel.needed_review', 'Necesitó repaso')
              : t('admin.trainer_panel.got_wrong', 'Lo que no ubicó bien')}
          </p>
          {failed.names.map((name, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: i * 0.05, ease }}
            >
              {isPlaceholderName(name) ? (
                <UnknownItemCard raw={name} />
              ) : (
                <div className="flex items-start gap-2.5 rounded-2xl border border-red-500/25 bg-red-50/30 p-3.5 dark:bg-red-950/10">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                  <p className="flex-1 text-[13px] leading-snug text-text">{name}</p>
                </div>
              )}
            </motion.div>
          ))}
          {failed.more > 0 && (
            <p className="text-[11.5px] text-text-muted">
              {t('admin.trainer_panel.and_n_more', 'y {{count}} más (no quedaron registrados por nombre)', { count: failed.more })}
            </p>
          )}
          {okCount > 0 && (
            <div className="flex items-center gap-2 rounded-2xl border border-green-500/25 bg-green-50/30 px-3.5 py-2.5 dark:bg-green-950/10">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
              <p className="text-[12.5px] text-text">
                {gameType === 'SORT_PROCESS'
                  ? t('admin.trainer_panel.rest_first_try', 'Los otros {{count}} los ordenó bien a la primera', { count: okCount })
                  : t('admin.trainer_panel.rest_ok', 'Los otros {{count}} casos los ubicó bien', { count: okCount })}
              </p>
            </div>
          )}
        </div>
      ) : nota ? (
        <div className="flex items-start gap-2 rounded-2xl border border-line bg-subtle/40 px-3.5 py-2.5">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
          <p className="text-[12.5px] leading-snug text-text">{String(nota)}</p>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-2xl border border-green-500/25 bg-green-50/30 px-3.5 py-2.5 dark:bg-green-950/10">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
          <p className="text-[12.5px] text-text">{t('admin.trainer_panel.all_ok', 'Sin errores registrados')}</p>
        </div>
      )}

      {rest.length > 0 && (
        <details className="rounded-xl border border-line bg-subtle/30 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-text-muted">
            {t('admin.trainer_panel.tech_data', 'Datos técnicos')}
          </summary>
          <div className="mt-2 space-y-1.5">
            {rest.map(([key, value]) => (
              <div key={key} className="flex gap-2 text-[11.5px]">
                <span className="shrink-0 text-text-muted">{key.replace(/_/g, ' ')}:</span>
                <span className="text-text">{String(value)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

/* ── Reconstrucción desde el contenido del módulo ─────────────────────────
   Las entregas antiguas solo guardaron contadores, pero el enunciado, los casos
   y el orden correcto SIGUEN en el módulo. Cargamos la sección y volvemos a
   armar la actividad completa: se ve todo lo que se preguntó y qué era lo
   correcto, marcando lo que falló con el nombre que sí quedó en la nota.
   Lo único irrecuperable es la opción concreta que eligió (nunca se guardó):
   eso se dice explícitamente en vez de inventarlo.
   ──────────────────────────────────────────────────────────────────────── */

/** Texto multi-idioma → cadena, con respaldo a español. */
const ml = (v: any, lang: string): string =>
  (v && typeof v === 'object' ? v[lang] || v.es || v.en || v.pt : v) || ''

/** Mismos procesos que ve el aprendiz (el editor rápido guarda en `steps`). */
function normalizeProcesses(block: any): any[] {
  const withSteps = (block?.processes ?? []).filter((p: any) => (p?.steps?.length ?? 0) > 0)
  if (withSteps.length > 0) return withSteps
  if (block?.steps?.length) return [{ id: 'legacy', steps: block.steps }]
  return []
}

/** Compara nombres ignorando mayúsculas, tildes y puntuación final. */
const sameName = (a: string, b: string) =>
  a.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[.\s]+$/, '') ===
  b.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[.\s]+$/, '')

function useSectionContent(sectionId: string | null | undefined, enabled: boolean) {
  const [content, setContent] = React.useState<SectionContent | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!enabled || !sectionId) { setContent(null); return }
    let cancelled = false
    setLoading(true)
    getSectionContent(sectionId)
      .then((c) => { if (!cancelled) setContent(c) })
      .catch(() => { if (!cancelled) setContent(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sectionId, enabled])

  return { content, loading }
}

/** Aviso de que un dato concreto no se guardó en su momento. */
function NotRecorded({ text }: { text: string }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] italic text-text-muted/80">
      <Info className="mt-0.5 h-3 w-3 shrink-0" />
      {text}
    </p>
  )
}

/** Clasificar casos, reconstruido: TODOS los casos con su categoría correcta. */
function RebuiltClassify({ block, failedNames, lang }: { block: any; failedNames: string[]; lang: string }) {
  const { t } = useTranslation()
  const catName = (id: string) => {
    const c = (block.categories ?? []).find((x: any) => x.id === id)
    return c ? ml(c.name, lang) : '—'
  }
  const cases = (block.cases ?? []).map((c: any) => {
    const text = ml(c.text, lang)
    return { text, categoria: catName(c.correctCategoryId), correcta: !failedNames.some((n) => sameName(n, text)) }
  })
  const ok = cases.filter((c: any) => c.correcta).length

  return (
    <div className="space-y-4">
      <ResultHeader
        ok={ok}
        total={cases.length}
        label={t('admin.trainer_panel.legacy_classify', 'Ubicó bien {{ok}} de {{total}} casos.', { ok, total: cases.length })}
      />
      <div className="space-y-2.5">
        {cases.map((c: any, i: number) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i, 12) * 0.04, ease }}
            className={cn(
              'rounded-2xl border p-3.5',
              c.correcta ? 'border-green-500/25 bg-green-50/30 dark:bg-green-950/10' : 'border-red-500/25 bg-red-50/30 dark:bg-red-950/10',
            )}
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-zinc-200/70 text-[10px] font-bold text-text-muted dark:bg-zinc-800">
                {i + 1}
              </span>
              <p className="flex-1 text-[13px] leading-snug text-text">{c.text}</p>
              <Verdict state={c.correcta ? 'ok' : 'bad'} />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-8 text-[12px]">
              <span className="text-[9px] font-bold uppercase tracking-wider text-text-muted">
                {t('admin.trainer_panel.belongs_to', 'Categoría correcta')}
              </span>
              <span className="rounded-lg border border-green-500/25 px-2 py-0.5 font-semibold text-green-600 dark:text-green-400">
                {c.categoria}
              </span>
            </div>
            {!c.correcta && (
              <div className="pl-8">
                <NotRecorded text={t('admin.trainer_panel.choice_not_recorded', 'De esta entrega no quedó registrado en qué categoría lo puso.')} />
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/** Ordenar procesos, reconstruido: cada proceso con su orden correcto. */
function RebuiltSort({ block, failedNames, lang }: { block: any; failedNames: string[]; lang: string }) {
  const { t } = useTranslation()
  const processes = normalizeProcesses(block)
  const blockTitle = ml(block.title, lang)
  const rows = processes.map((p: any, i: number) => {
    const title = ml(p.title, lang) || blockTitle || `${i + 1}`
    // Los nombres de la nota pueden venir del título del proceso o del bloque.
    const failed = failedNames.some((n) => sameName(n, title) || (isPlaceholderName(n) && processes.length === 1))
    return { title, steps: (p.steps ?? []).map((s: any) => ml(s.text, lang)), correcta: !failed }
  })
  const ok = rows.filter((r: any) => r.correcta).length

  return (
    <div className="space-y-4">
      <ResultHeader
        ok={ok}
        total={rows.length}
        label={t('admin.trainer_panel.n_of_m_first_try', '{{ok}} de {{total}} a la primera', { ok, total: rows.length })}
      />
      <div className="space-y-3">
        {rows.map((p: any, i: number) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.05, ease }}
            className={cn('rounded-2xl border p-4', p.correcta ? 'border-green-500/25' : 'border-amber-500/30')}
          >
            <div className="mb-3 flex items-center gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-subtle text-text-muted">
                <ListOrdered className="h-3.5 w-3.5" />
              </span>
              <p className="flex-1 truncate text-[13.5px] font-semibold text-text">{p.title}</p>
              <Verdict state={p.correcta ? 'ok' : 'bad'} />
            </div>
            <p className="mb-2 text-[9px] font-bold uppercase tracking-wider text-text-muted">
              {t('admin.trainer_panel.correct_order', 'Orden correcto')}
            </p>
            <ol className="space-y-1.5">
              {p.steps.map((step: string, j: number) => (
                <li key={j} className="flex items-start gap-2 text-[12.5px] text-text">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-green-500/15 text-[9.5px] font-bold text-green-600 dark:text-green-400">
                    {j + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            {!p.correcta && (
              <NotRecorded text={t('admin.trainer_panel.order_not_recorded', 'De esta entrega no quedó registrado el orden que envió; solo que necesitó repaso.')} />
            )}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/** Quiz de video, reconstruido: las preguntas del marcador y su respuesta correcta. */
function RebuiltVideoQuiz({ marker, ok, total, lang }: { marker: any; ok: number; total: number; lang: string }) {
  const { t } = useTranslation()
  const questions = marker?.questions ?? []
  return (
    <div className="space-y-4">
      <ResultHeader ok={ok} total={total || questions.length} />
      {marker?.title && (
        <p className="text-[11.5px] text-text-muted">
          {t('admin.trainer_panel.video_topic', 'Tema del video')}: <span className="font-semibold text-text">{ml(marker.title, lang)}</span>
        </p>
      )}
      <div className="space-y-3">
        {questions.map((q: any, i: number) => {
          const opts: string[] = q.options?.[lang]?.length ? q.options[lang] : q.options?.es ?? []
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05, ease }}
              className="overflow-hidden rounded-2xl border border-line"
            >
              <div className="flex items-start gap-2.5 border-b border-line bg-subtle/50 px-4 py-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-zinc-200/70 text-[10px] font-bold text-text-muted dark:bg-zinc-800">
                  {i + 1}
                </span>
                <p className="flex-1 text-[13.5px] font-medium leading-snug text-text">{ml(q.question, lang)}</p>
              </div>
              <div className="space-y-1.5 px-4 py-3">
                {opts.map((opt, j) => (
                  <div
                    key={j}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px]',
                      j === q.correct
                        ? 'border-green-500/25 bg-green-50/40 font-semibold text-green-600 dark:bg-green-950/10 dark:text-green-400'
                        : 'border-line text-text-muted',
                    )}
                  >
                    {j === q.correct && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                    {opt}
                  </div>
                ))}
                <NotRecorded text={t('admin.trainer_panel.choice_not_recorded_quiz', 'De esta entrega no quedó registrada la opción que eligió; solo el total de aciertos.')} />
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Componente principal ─────────────────────────────────────────────── */

export function AttemptAnswers({
  gameType, answers, score, sectionId,
}: {
  gameType: string
  answers: AnyRecord
  score: number
  /** Sección de la entrega: permite recuperar el contenido original del módulo. */
  sectionId?: string | null
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.slice(0, 2) || 'es'
  const detalle = Array.isArray(answers.detalle) ? answers.detalle : null

  // Sin `detalle` (entregas antiguas) intentamos reconstruir la actividad desde
  // el módulo. Solo se pide la sección en ese caso: las entregas nuevas ya traen
  // todo y no hace falta ninguna consulta extra.
  const needsRebuild = !detalle && ['CLASSIFY_CASES', 'SORT_PROCESS', 'VIDEO_QUIZ'].includes(gameType)
  const { content, loading } = useSectionContent(sectionId, needsRebuild)

  // Un quiz de sección guarda UNA pregunta suelta: se normaliza a la misma
  // forma que el resto para reutilizar la tarjeta de pregunta.
  const singleQuiz: QuizDetail | null =
    !detalle && (answers.pregunta || answers.opcion_elegida || answers.opcion_correcta)
      ? {
          pregunta: String(answers.pregunta ?? t('admin.trainer_panel.q_question')),
          opcion_elegida: answers.opcion_elegida != null ? String(answers.opcion_elegida) : null,
          opcion_correcta: answers.opcion_correcta != null ? String(answers.opcion_correcta) : '',
          correcta:
            typeof answers.correcta === 'boolean'
              ? answers.correcta
              : answers.opcion_elegida != null && answers.opcion_correcta != null
                ? String(answers.opcion_elegida) === String(answers.opcion_correcta)
                : score >= 70,
        }
      : null

  if (singleQuiz) {
    return (
      <div className="space-y-4">
        <ResultHeader ok={singleQuiz.correcta ? 1 : 0} total={1} />
        <QuestionCard q={singleQuiz} index={0} delay={0} />
      </div>
    )
  }

  if (detalle && detalle.length > 0) {
    if (gameType === 'SORT_PROCESS') {
      const rows = detalle as SortDetail[]
      const ok = rows.filter((r) => r.correcta).length
      return (
        <div className="space-y-4">
          <ResultHeader
            ok={ok}
            total={rows.length}
            // En este juego no hay "correctas": hay procesos resueltos a la primera.
            label={t('admin.trainer_panel.n_of_m_first_try', '{{ok}} de {{total}} a la primera', { ok, total: rows.length })}
          />
          <p className="text-[11.5px] text-text-muted">
            {t('admin.trainer_panel.sort_note', 'El juego obliga a corregir el orden para avanzar, así que se muestra el primer intento de cada proceso.')}
          </p>
          <div className="space-y-3">
            {rows.map((p, i) => <ProcessCard key={i} p={p} index={i} delay={i * 0.05} />)}
          </div>
        </div>
      )
    }

    if (gameType === 'CLASSIFY_CASES') {
      const rows = detalle as ClassifyDetail[]
      const ok = rows.filter((r) => r.correcta).length
      return (
        <div className="space-y-4">
          <ResultHeader ok={ok} total={rows.length} />
          <div className="space-y-2.5">
            {rows.map((c, i) => <CaseRow key={i} c={c} index={i} delay={i * 0.04} />)}
          </div>
        </div>
      )
    }

    // VIDEO_QUIZ y cualquier otra actividad de preguntas.
    const rows = detalle as QuizDetail[]
    const ok = rows.filter((r) => r.correcta).length
    return (
      <div className="space-y-4">
        <ResultHeader ok={ok} total={rows.length} />
        {answers.tema && (
          <p className="text-[11.5px] text-text-muted">
            {t('admin.trainer_panel.video_topic', 'Tema del video')}: <span className="font-semibold text-text">{String(answers.tema)}</span>
          </p>
        )}
        <div className="space-y-3">
          {rows.map((q, i) => <QuestionCard key={i} q={q} index={i} delay={i * 0.05} />)}
        </div>
      </div>
    )
  }

  // ── Entregas antiguas: reconstruir desde el contenido del módulo ──
  if (needsRebuild) {
    if (loading) {
      return (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl border border-line bg-subtle/40" />
          ))}
        </div>
      )
    }

    const nota = String(answers.mensaje_detalle ?? '')
    const errores = Number(answers.errores ?? 0)
    const parsed = extractFailedItems(nota)
    // Si el corte por comas produjo más nombres que errores, se partió un texto
    // con comas: mejor no marcar nada que marcar mal.
    const failedNames = errores > 0 && parsed.names.length > errores ? [] : parsed.names

    const blocks = content?.blocks ?? []
    if (gameType === 'CLASSIFY_CASES') {
      const block = blocks.find((b: any) => b?.type === 'game-classify') as any
      if (block?.cases?.length) return <RebuiltClassify block={block} failedNames={failedNames} lang={lang} />
    }
    if (gameType === 'SORT_PROCESS') {
      const block = blocks.find((b: any) => b?.type === 'game-sort') as any
      if (block && normalizeProcesses(block).length > 0) {
        return <RebuiltSort block={block} failedNames={failedNames} lang={lang} />
      }
    }
    if (gameType === 'VIDEO_QUIZ') {
      const markers = Array.isArray(content?.markers) ? (content!.markers as any[]) : []
      const marker = markers.find((m) => m?.id === answers.marker_id && m?.type === 'quiz')
      if (marker?.questions?.length) {
        return (
          <RebuiltVideoQuiz
            marker={marker}
            ok={Number(answers.aciertos ?? 0)}
            total={Number(answers.total ?? marker.questions.length)}
            lang={lang}
          />
        )
      }
    }
    // El módulo cambió o el bloque ya no existe: queda el resumen de la entrega.
  }

  return <LegacySummary gameType={gameType} answers={answers} score={score} />
}

export default AttemptAnswers
