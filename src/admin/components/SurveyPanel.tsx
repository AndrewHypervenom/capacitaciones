import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  Clock,
  Loader2,
  MessageSquareHeart,
  RefreshCw,
  Repeat,
  History,
  Users,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Toggle } from '@/components/ui/Toggle'
import { NumberField } from '@/components/ui/NumberField'
import { Select } from '@/components/ui/Select'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import {
  DEFAULT_SURVEY_CONFIG,
  getSurveyConfig,
  getSurveyContext,
  getSurveyResults,
  listCourseInstructors,
  saveSurveyConfig,
  type CourseInstructorOption,
  surveyQuestionKeys,
  surveyScoreLabelKeys,
  type Q1Mode,
  type Q2Mode,
  type SurveyConfig,
  type SurveyResults,
} from '@/services/survey.service'

/* ────────────────────────────────────────────────────────────────────────────
   Pestaña "Encuesta" del curso

   Dos mitades: cómo se comporta (arriba) y qué contestó la gente (abajo).

   Las tres preguntas NO se editan desde aquí, y es a propósito: vienen de
   Talento Humano y su valor está en que sean idénticas en todos los cursos.
   Si cada capacitador redacta las suyas, en seis meses hay cuarenta encuestas
   que no se pueden comparar entre sí y el indicador deja de existir. Se
   muestran en solo lectura para que quede claro qué se está preguntando.
   ──────────────────────────────────────────────────────────────────────────── */

/** Barra de una nota en la distribución 0-10. */
function HistBar({ n, max, label }: { n: number; max: number; label: string }) {
  const pct = max > 0 ? (n / max) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-text-subtle">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-subtle">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 shrink-0 text-[11px] tabular-nums text-text-subtle">{n || ''}</span>
    </div>
  )
}

function ScoreCard({
  title,
  avg,
  hist,
  emptyLabel,
}: {
  title: string
  avg: number | null
  hist: Record<string, number>
  emptyLabel: string
}) {
  const max = Math.max(1, ...Object.values(hist))
  const has = Object.keys(hist).length > 0
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium text-text">{title}</span>
        <span className="text-[22px] font-bold tabular-nums leading-none text-text">
          {avg === null ? '—' : avg.toFixed(1)}
          <span className="ml-0.5 text-[12px] font-normal text-text-subtle">/10</span>
        </span>
      </div>
      {has ? (
        <div className="space-y-1">
          {Array.from({ length: 11 }, (_, i) => (
            <HistBar key={i} label={String(i)} n={hist[String(i)] ?? 0} max={max} />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-text-subtle">{emptyLabel}</p>
      )}
    </div>
  )
}

export function SurveyPanel({
  courseId,
  onDirtyChange,
  registerSave,
}: {
  courseId: string
  onDirtyChange: (dirty: boolean) => void
  registerSave: (fn: (() => Promise<boolean>) | null) => void
}) {
  const { t } = useTranslation()
  const [cfg, setCfg] = useState<SurveyConfig>(DEFAULT_SURVEY_CONFIG)
  const [saved, setSaved] = useState<SurveyConfig>(DEFAULT_SURVEY_CONFIG)
  const [results, setResults] = useState<SurveyResults | null>(null)
  const [ctx, setCtx] = useState<{
    campaignName: string | null
    defaultInstructorId: string | null
  }>({ campaignName: null, defaultInstructorId: null })
  const [instructors, setInstructors] = useState<CourseInstructorOption[]>([])
  // Por qué no se pudo cargar la lista. Vacío ≠ falló, y hay que poder
  // distinguirlos en pantalla o el capacitador se queda mirando un desplegable
  // sin opciones sin saber qué hacer.
  const [instructorsError, setInstructorsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)

  /**
   * Todo menos la configuración: resultados, campaña y lista de instructores.
   *
   * Va aparte a propósito. Es lo que recarga el botón "Actualizar", y volver a
   * leer la configuración desde la base ahí borraría los cambios que todavía
   * no se han guardado.
   */
  const loadData = useCallback(async () => {
    const [r, x, people] = await Promise.all([
      getSurveyResults(courseId),
      getSurveyContext(courseId).catch(() => ({
        campaignName: null,
        defaultInstructorId: null,
      })),
      listCourseInstructors(courseId).then(
        (list) => ({ list, err: null as string | null }),
        (e: unknown) => ({
          list: [] as CourseInstructorOption[],
          err: (e as { message?: string })?.message || String(e),
        }),
      ),
    ])
    setResults(r)
    setCtx(x)
    setInstructors(people.list)
    setInstructorsError(people.err)
  }, [courseId])

  useEffect(() => {
    let alive = true
    Promise.all([
      getSurveyConfig(courseId).catch(() => DEFAULT_SURVEY_CONFIG),
      loadData(),
    ])
      .then(([c]) => {
        if (!alive) return
        setCfg(c)
        setSaved(c)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [courseId, loadData])

  // Sucio = distinto de lo guardado, comparando contenido. Un `isFirstRender`
  // aquí mentiría con StrictMode (dos montajes) y la barra saldría encendida
  // sin que nadie hubiera tocado nada.
  const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved])
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  // El guardado real vive en la barra única del pie, igual que las demás
  // pestañas: un solo sitio donde se guarda en todo el editor.
  // El guardado se registra una sola vez; la referencia le da siempre el
  // borrador vigente sin volver a registrarlo en cada tecla.
  const cfgRef = useRef(cfg)
  useEffect(() => {
    cfgRef.current = cfg
  }, [cfg])
  useEffect(() => {
    registerSave(async () => {
      try {
        await saveSurveyConfig(courseId, cfgRef.current)
        setSaved(cfgRef.current)
        return true
      } catch (e) {
        toast.error(t('admin.courses.survey.save_error'), (e as Error)?.message)
        return false
      }
    })
    return () => registerSave(null)
  }, [courseId, registerSave, t])

  // Recarga todo, no solo los resultados: también sirve de "reintentar" cuando
  // la lista de instructores no cargó.
  const refresh = async () => {
    setReloading(true)
    try {
      await loadData()
    } finally {
      setReloading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
      </div>
    )
  }

  // Lo que va a leer el aprendiz, con los nombres reales ya puestos. Es la
  // misma función que usa la pantalla del aprendiz, así que la vista previa no
  // puede desincronizarse de lo que se pregunta de verdad.
  const campaign = ctx.campaignName ?? t('admin.courses.survey.campaign_fallback')
  const qKeys = surveyQuestionKeys(cfg.q1_mode, cfg.q2_mode)
  const QUESTIONS = [t(qKeys.q1, { campaign }), t(qKeys.q2, { campaign }), t('survey.q3')]
  const labelKeys = surveyScoreLabelKeys(cfg.q1_mode, cfg.q2_mode)

  // Quién va a salir en la pregunta 1. Misma regla que aplica el servidor: lo
  // escrito a mano manda; si está vacío, el perfil enlazado o el creador.
  const linkedProfile =
    instructors.find((p) => p.id === (cfg.instructor_id ?? ctx.defaultInstructorId)) ?? null
  const typedName = (cfg.instructor_name ?? '').trim()
  const effectiveName = typedName || linkedProfile?.name || ''
  // La foto solo si el nombre que se va a mostrar es el de ese perfil. Prestar
  // la cara de otra persona es peor que no tener cara.
  const effectiveAvatar =
    linkedProfile && (!typedName || typedName === linkedProfile.name)
      ? linkedProfile.avatar_url
      : null

  // Sugerencias de gente del sitio mientras escribe. Es un atajo, no una
  // obligación: el campo acepta cualquier nombre porque muchas capacitaciones
  // las dicta gente externa que no tiene cuenta aquí.
  const suggestions =
    typedName.length >= 2 && typedName !== linkedProfile?.name
      ? instructors
          .filter((p) => p.name.toLowerCase().includes(typedName.toLowerCase()))
          .slice(0, 5)
      : []

  // La P1 pregunta por un instructor que no hay. El servidor se cae solo a la
  // variante de campaña, pero hay que decirlo aquí y ofrecer la salida — o el
  // capacitador creería que está preguntando algo que nadie va a ver.
  const instructorMissing = cfg.q1_mode === 'instructor' && !effectiveName

  return (
    <div className="space-y-10">
      {/* ── Cómo se comporta ───────────────────────────────────────────────── */}
      <div>
        <h2 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-text">
          <MessageSquareHeart className="h-4 w-4 text-text-muted" />
          {t('admin.courses.survey.title')}
        </h2>
        <p className="mb-4 text-[12px] text-text-muted">{t('admin.courses.survey.lead')}</p>

        <div className="space-y-3">
          {/* Encendido */}
          <div className="rounded-xl border border-line px-3.5 py-3">
            <div className="flex items-center gap-3">
              <MessageSquareHeart className="h-4 w-4 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text">
                  {t('admin.courses.survey.enabled')}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('admin.courses.survey.enabled_hint')}
                </div>
              </div>
              <Toggle on={cfg.enabled} onClick={() => setCfg({ ...cfg, enabled: !cfg.enabled })} />
            </div>
          </div>

          {/* Cronómetro */}
          <div className="rounded-xl border border-line px-3.5 py-3">
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text">
                  {t('admin.courses.survey.time_limit')}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('admin.courses.survey.time_limit_hint')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <NumberField
                  value={cfg.time_limit_min}
                  onChange={(n) => setCfg({ ...cfg, time_limit_min: n })}
                  min={1}
                  max={480}
                  aria-label={t('admin.courses.survey.time_limit')}
                  className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-[13px] tabular-nums text-text outline-none focus:border-primary"
                />
                <span className="text-[12px] text-text-muted">min</span>
              </div>
            </div>
          </div>

          {/* Repregunta a insatisfechos */}
          <div className="rounded-xl border border-line px-3.5 py-3">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-4 w-4 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text">
                  {t('admin.courses.survey.followup')}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('admin.courses.survey.followup_hint')}
                </div>
              </div>
              <Toggle
                on={cfg.followup_enabled}
                onClick={() => setCfg({ ...cfg, followup_enabled: !cfg.followup_enabled })}
              />
            </div>
            {cfg.followup_enabled && (
              <div className="mt-3 flex items-center gap-2 pl-7">
                <span className="text-[12px] text-text-muted">
                  {t('admin.courses.survey.threshold')}
                </span>
                <NumberField
                  value={cfg.followup_threshold}
                  onChange={(n) => setCfg({ ...cfg, followup_threshold: n })}
                  min={0}
                  max={10}
                  aria-label={t('admin.courses.survey.threshold')}
                  className="w-16 rounded-lg border border-line bg-surface px-2 py-1 text-[13px] tabular-nums text-text outline-none focus:border-primary"
                />
                <span className="text-[12px] text-text-muted">/ 10</span>
              </div>
            )}
          </div>

          {/* Repetir al recertificar */}
          <div className="rounded-xl border border-line px-3.5 py-3">
            <div className="flex items-center gap-3">
              <Repeat className="h-4 w-4 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text">
                  {t('admin.courses.survey.repeat')}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('admin.courses.survey.repeat_hint')}
                </div>
              </div>
              <Toggle
                on={cfg.repeat_on_recert}
                onClick={() => setCfg({ ...cfg, repeat_on_recert: !cfg.repeat_on_recert })}
              />
            </div>
          </div>

          {/* Retroactiva */}
          <div className="rounded-xl border border-line px-3.5 py-3">
            <div className="flex items-center gap-3">
              <History className="h-4 w-4 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-text">
                  {t('admin.courses.survey.retroactive')}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t('admin.courses.survey.retroactive_hint')}
                </div>
              </div>
              <Toggle
                on={cfg.retroactive}
                onClick={() => setCfg({ ...cfg, retroactive: !cfg.retroactive })}
              />
            </div>
          </div>
        </div>

        {/* ── Qué se pregunta ──
            El TEXTO no se edita —su valor está en poder comparar entre
            cursos—, pero sí a qué apunta. Un curso dictado por una persona y
            uno autoservicio no pueden hacer la misma primera pregunta. */}
        <div className="mt-6">
          <h3 className="mb-1 text-[13px] font-semibold text-text">
            {t('admin.courses.survey.questions_title')}
          </h3>
          <p className="mb-4 text-[12px] text-text-muted">
            {t('admin.courses.survey.questions_lead')}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Variante de la P1 */}
            <div className="rounded-xl border border-line p-3.5">
              <label className="mb-1.5 block text-[12px] font-medium text-text">
                {t('admin.courses.survey.q1_mode')}
              </label>
              <Select
                value={cfg.q1_mode}
                onChange={(v) => setCfg({ ...cfg, q1_mode: v as Q1Mode })}
                aria-label={t('admin.courses.survey.q1_mode')}
                options={[
                  {
                    value: 'instructor',
                    label: t('admin.courses.survey.q1_mode_instructor'),
                  },
                  { value: 'campaign', label: t('admin.courses.survey.q1_mode_campaign') },
                ]}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-text-subtle">
                {cfg.q1_mode === 'instructor'
                  ? t('admin.courses.survey.q1_mode_instructor_hint')
                  : t('admin.courses.survey.q1_mode_campaign_hint')}
              </p>

              {/* Quién dictó el curso. Se elige aquí mismo: mandar al
                  capacitador a otra pantalla a arreglar el aviso es hacerle
                  perder el hilo de lo que estaba configurando.

                  Ojo: esto NO toca `courses.created_by`. De ese campo depende
                  quién puede administrar el curso, así que escribir ahí el
                  instructor le quitaría el curso a su dueño sin avisar. */}
              {cfg.q1_mode === 'instructor' && (
                <div className="mt-3">
                  <label
                    htmlFor="survey-instructor"
                    className="mb-1.5 block text-[11px] font-medium text-text-muted"
                  >
                    {t('admin.courses.survey.instructor_pick')}
                  </label>
                  <input
                    id="survey-instructor"
                    type="text"
                    value={cfg.instructor_name ?? ''}
                    maxLength={120}
                    placeholder={t('admin.courses.survey.instructor_placeholder')}
                    onChange={(e) => {
                      const name = e.target.value
                      // Al reescribir el nombre se suelta el enlace al perfil:
                      // si no, quedaría la foto de una persona junto al nombre
                      // de otra.
                      setCfg({
                        ...cfg,
                        instructor_name: name,
                        instructor_id:
                          name.trim() === linkedProfile?.name ? cfg.instructor_id : null,
                      })
                    }}
                    className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-text outline-none transition-colors focus:border-primary"
                  />
                  <p className="mt-1.5 text-[11px] leading-relaxed text-text-subtle">
                    {t('admin.courses.survey.instructor_free_hint')}
                  </p>

                  {/* Sugerencias de gente del sitio. Elegir una enlaza el
                      perfil y con él la foto; escribir cualquier otra cosa es
                      igual de válido. */}
                  {suggestions.length > 0 && (
                    <div className="mt-2">
                      <div className="mb-1.5 text-[11px] text-text-subtle">
                        {t('admin.courses.survey.instructor_suggestions')}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestions.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() =>
                              setCfg({ ...cfg, instructor_name: p.name, instructor_id: p.id })
                            }
                            className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[11px] text-text-muted transition-colors hover:border-primary hover:text-text"
                          >
                            <Avatar src={p.avatar_url} name={p.name} size={16} />
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* La lista de sugerencias no cargó. No bloquea nada —el
                      campo es de texto libre— pero hay que decir que faltan
                      los atajos, no dejar que parezca que no hay nadie. */}
                  {instructorsError && (
                    <div className="mt-2 rounded-lg border border-danger/25 bg-danger/5 px-2.5 py-2">
                      <p className="flex gap-1.5 text-[11px] leading-relaxed text-danger">
                        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                        <span>{t('admin.courses.survey.instructor_load_error')}</span>
                      </p>
                      <p className="mt-1 break-words pl-5 font-mono text-[10px] text-text-subtle">
                        {instructorsError}
                      </p>
                      <button
                        type="button"
                        onClick={refresh}
                        className="mt-1.5 ml-5 text-[11px] font-medium text-primary hover:underline"
                      >
                        {t('admin.courses.survey.refresh')}
                      </button>
                    </div>
                  )}

                  {effectiveName && (
                    <p className="mt-2 flex items-center gap-2 text-[11px] text-text-subtle">
                      {effectiveAvatar !== null || linkedProfile ? (
                        <Avatar src={effectiveAvatar} name={effectiveName} size={20} />
                      ) : null}
                      <span>
                        {t('admin.courses.survey.instructor_shown', { name: effectiveName })}
                      </span>
                    </p>
                  )}
                </div>
              )}

              {instructorMissing && (
                <p className="mt-2 flex gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                  <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{t('admin.courses.survey.q1_no_instructor')}</span>
                </p>
              )}
            </div>

            {/* Variante de la P2 */}
            <div className="rounded-xl border border-line p-3.5">
              <label className="mb-1.5 block text-[12px] font-medium text-text">
                {t('admin.courses.survey.q2_mode')}
              </label>
              <Select
                value={cfg.q2_mode}
                onChange={(v) => setCfg({ ...cfg, q2_mode: v as Q2Mode })}
                aria-label={t('admin.courses.survey.q2_mode')}
                options={[
                  { value: 'training', label: t('admin.courses.survey.q2_mode_training') },
                  { value: 'content', label: t('admin.courses.survey.q2_mode_content') },
                ]}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-text-subtle">
                {cfg.q2_mode === 'training'
                  ? t('admin.courses.survey.q2_mode_training_hint')
                  : t('admin.courses.survey.q2_mode_content_hint')}
              </p>
            </div>
          </div>

          {/* Vista previa: exactamente lo que va a leer el aprendiz, con los
              nombres reales ya puestos. Cambia al vuelo con los selectores. */}
          <div className="mt-3 rounded-xl border border-dashed border-line bg-subtle/40 p-4">
            <div className="mb-2 text-[12px] font-medium text-text">
              {t('admin.courses.survey.preview_title')}
            </div>
            <ol className="space-y-2">
              {QUESTIONS.map((q, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-text-muted">
                  <span className="shrink-0 tabular-nums text-text-subtle">{i + 1}.</span>
                  <span>{q}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[11px] leading-relaxed text-text-subtle">
              {t('admin.courses.survey.questions_locked')}
            </p>
          </div>
        </div>
      </div>

      {/* ── Resultados ─────────────────────────────────────────────────────── */}
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-text">
              <Users className="h-4 w-4 text-text-muted" />
              {t('admin.courses.survey.results_title')}
            </h2>
            <p className="text-[12px] text-text-muted">{t('admin.courses.survey.results_lead')}</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] text-text-muted hover:text-text"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', reloading && 'animate-spin')} />
            {t('admin.courses.survey.refresh')}
          </button>
        </div>

        {!results || results.total === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-8 text-center">
            <p className="text-[13px] text-text-muted">{t('admin.courses.survey.no_answers')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <ScoreCard
                title={t(labelKeys.q1)}
                avg={results.q1_avg ?? results.q1_avg_all}
                hist={results.q1_hist}
                emptyLabel={t('admin.courses.survey.no_answers')}
              />
              <ScoreCard
                title={t(labelKeys.q2)}
                avg={results.q2_avg ?? results.q2_avg_all}
                hist={results.q2_hist}
                emptyLabel={t('admin.courses.survey.no_answers')}
              />
            </div>

            {/* Cambiar la variante no reescribe el pasado: las respuestas
                guardan qué se les preguntó. Si el histórico mezcla variantes,
                el promedio sigue siendo válido pero ya no compara lo mismo, y
                eso hay que decirlo en vez de dejar que el número mienta. */}
            {results.mixed_modes && (
              <p className="flex gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>{t('admin.courses.survey.mixed_modes')}</span>
              </p>
            )}

            {/* Las retroactivas se cuentan aparte: quien opina meses después ya
                no se acuerda igual, y mezclarlas mueve el promedio sin que
                nadie sepa por qué. */}
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full border border-line px-2.5 py-1 text-text-muted">
                {t('admin.courses.survey.count_total', { n: results.total })}
              </span>
              {results.total_retro > 0 && (
                <span className="rounded-full border border-amber-500/25 bg-amber-500/5 px-2.5 py-1 text-amber-600 dark:text-amber-400">
                  {t('admin.courses.survey.count_retro', { n: results.total_retro })}
                </span>
              )}
            </div>

            <div>
              <div className="mb-2 text-[12px] font-medium text-text">
                {t('admin.courses.survey.comments_title')}
              </div>
              <div className="space-y-2">
                {results.comments.map((c, i) => (
                  <div key={i} className="rounded-xl border border-line p-3.5">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text-subtle">
                      <span className="tabular-nums">
                        {new Date(c.at).toLocaleDateString()}
                      </span>
                      <span className="rounded-full bg-subtle px-2 py-0.5 tabular-nums">
                        {c.q1}/10 · {c.q2}/10
                      </span>
                      <span className="uppercase">{c.lang}</span>
                      {c.retro && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400">
                          {t('admin.courses.survey.tag_retro')}
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text">
                      {c.text}
                    </p>
                    {c.followup && (
                      <p className="mt-2 whitespace-pre-wrap rounded-lg border-l-2 border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-text-muted">
                        {c.followup}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
