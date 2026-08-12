import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  Award, ChevronDown, ExternalLink, Loader2, Sparkles, Target, ListChecks,
  Check, AlertTriangle, HelpCircle, Pencil,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { EntityIcon } from '@/components/ui/EntityIcon'
import {
  loadCoursePensum, generatePensumWithAi, savePensum, type PensumDraft,
} from '@/services/pensum.service'
import { writeCertSharePreview } from '@/lib/certSharePreview'
import { useUserStore } from '@/stores/userStore'
import { useUndoHistory, type RegisterUndo } from '@/hooks/useUndoHistory'

/** Una línea = un ítem. Es la forma más rápida de escribir listas a mano. */
function parseLines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter(Boolean)
}

/** Fila editable: el texto manda mientras se escribe; las listas se derivan. */
interface Row extends PensumDraft {
  objText: string
  keyText: string
}

const toRow = (d: PensumDraft): Row => ({
  ...d,
  objText: d.objectives_es.join('\n'),
  keyText: d.takeaways_es.join('\n'),
})

/** Huella de lo editable, para saber si hay cambios sin guardar. */
const fingerprint = (rows: Row[]) =>
  rows.map((r) => `${r.id}|${parseLines(r.objText).join('§')}|${parseLines(r.keyText).join('§')}`).join('¶')

/** Barra de cobertura: cuántos módulos ya tienen escrito su trozo. */
function Coverage({ icon, label, done, total }: {
  icon: React.ReactNode; label: string; done: number; total: number
}) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const full = total > 0 && done === total
  return (
    <div className="rounded-xl border border-line px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('shrink-0', full ? 'text-brand-green' : 'text-text-muted')}>{icon}</span>
        <span className="text-[12.5px] font-medium text-text">{label}</span>
        <span className="ml-auto text-[12px] tabular-nums text-text-muted">{done}/{total}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
        <motion.div
          className={cn('h-full rounded-full', full ? 'bg-brand-green' : 'bg-brand-magenta')}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  )
}

/**
 * Panel "Lo que dirá el certificado al compartirlo", en la pestaña
 * Certificación del editor de curso.
 *
 * Existe porque había un hueco invisible: la página pública del certificado
 * (la que abre el QR) publica los objetivos y las conclusiones clave de cada
 * módulo, pero esos campos se editan lejos de aquí —en el editor de cada
 * módulo— y nada le decía al capacitador que de ahí salía su certificado. Un
 * curso con esos campos vacíos producía una página que solo sabía decir "hizo
 * 3 módulos".
 *
 * Está escrito para alguien que llega por primera vez: una sola frase arriba
 * (el detalle se despliega solo si lo pide), UN paso siguiente recomendado que
 * cambia según cómo esté el curso, y el resto como apoyo. Nunca se ofrecen dos
 * acciones principales a la vez.
 */
export function CertificatePensumPanel({
  courseId,
  courseTitle,
  courseDescription,
  onDirtyChange,
  registerSave,
  registerUndo,
}: {
  courseId: string
  courseTitle: string
  courseDescription: string | null
  onDirtyChange: (dirty: boolean) => void
  registerSave: (fn: (() => Promise<boolean>) | null) => void
  /** Publica el deshacer del pénsum en la barra de guardado del editor. */
  registerUndo?: RegisterUndo
}) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const trainerName = useUserStore((s) => s.name)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [aiBusy, setAiBusy] = useState<'all' | 'missing' | string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const baseline = useRef('')

  useEffect(() => {
    let active = true
    setLoading(true)
    loadCoursePensum(courseId)
      .then((ds) => {
        if (!active) return
        const next = ds.map(toRow)
        baseline.current = fingerprint(next)
        setRows(next)
      })
      .catch(() => { if (active) setRows([]) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [courseId])

  // La huella se compara dentro del efecto y no en el render: `baseline` es una
  // ref y leerla al pintar sería impuro (y el linter lo marca con razón).
  useEffect(() => {
    onDirtyChange(rows.length > 0 && fingerprint(rows) !== baseline.current)
  }, [rows, onDirtyChange])

  const handleSave = useCallback(async (): Promise<boolean> => {
    try {
      await savePensum(rows.map((r) => ({
        id: r.id,
        objectives_es: parseLines(r.objText),
        takeaways_es: parseLines(r.keyText),
      })))
      baseline.current = fingerprint(rows)
      // Sin esto la barra de guardado seguiría anunciando cambios pendientes.
      onDirtyChange(false)
      return true
    } catch {
      toast.error(t('admin.courses.pensum.save_error'))
      return false
    }
  }, [rows, onDirtyChange, t])

  // El guardado vive en la barra única del pie, como el resto del editor.
  useEffect(() => {
    registerSave(handleSave)
    return () => registerSave(null)
  }, [registerSave, handleSave])

  // Deshacer del pénsum. Lo generado con IA reescribe objetivos y aprendizajes
  // de golpe: sin vuelta atrás, recuperar lo que había escrito a mano era
  // teclearlo otra vez.
  const undoHistory = useUndoHistory({ state: rows, apply: setRows, enabled: !loading })
  const { undo, canUndo } = undoHistory
  useEffect(() => {
    registerUndo?.(undo, canUndo)
    return () => registerUndo?.(null, false)
  }, [registerUndo, undo, canUndo])

  const stats = useMemo(() => {
    const withObj = rows.filter((r) => parseLines(r.objText).length > 0).length
    const withKey = rows.filter((r) => parseLines(r.keyText).length > 0).length
    return { withObj, withKey, total: rows.length }
  }, [rows])

  /** Módulos a los que les falta algo: el objetivo del botón "completar". */
  const missing = useMemo(
    () => rows.filter((r) => parseLines(r.objText).length === 0 || parseLines(r.keyText).length === 0),
    [rows],
  )

  /**
   * En qué punto está el curso. De aquí sale el ÚNICO paso recomendado que se
   * muestra arriba: sin esto el panel enseñaba tres botones a la vez —uno de
   * ellos "Completar 0 módulos con IA", desactivado— y quien llegaba por
   * primera vez no sabía cuál pulsar.
   */
  const phase: 'empty' | 'partial' | 'done' =
    rows.length === 0 || missing.length === rows.length ? 'empty'
      : missing.length > 0 ? 'partial'
        : 'done'

  /**
   * Pide a la IA que redacte el pénsum. `scope` decide sobre qué módulos:
   *  · 'missing' → solo los huecos; nunca toca lo ya escrito.
   *  · 'all'     → rehace el curso entero, pisando lo que haya (con confirmación).
   *  · un id     → ese módulo, también pisando (con confirmación si tenía texto).
   *
   * Lo generado NO se guarda solo: queda como borrador editable y se guarda con
   * la barra del pie, igual que si se hubiera escrito a mano.
   */
  const runAi = async (scope: 'all' | 'missing' | string) => {
    const overwrite = scope !== 'missing'
    const targets = scope === 'all'
      ? rows
      : scope === 'missing'
        ? missing
        : rows.filter((r) => r.id === scope)
    if (targets.length === 0) return

    // Pisar texto escrito a mano nunca debe pasar en silencio.
    const willReplace = overwrite && targets.some(
      (r) => parseLines(r.objText).length > 0 || parseLines(r.keyText).length > 0,
    )
    if (willReplace) {
      const ok = await confirm({
        title: t('admin.courses.pensum.redo_confirm_title'),
        description: t('admin.courses.pensum.redo_confirm_msg', { count: targets.length }),
        confirmLabel: t('admin.courses.pensum.redo_confirm_cta'),
      })
      if (!ok) return
    }

    setAiBusy(scope)
    try {
      const out = await generatePensumWithAi({ courseTitle, modules: targets })
      const byId = new Map(targets.map((r, i) => [r.id, out[i]]))
      setRows((prev) => prev.map((r) => {
        const res = byId.get(r.id)
        if (!res) return r
        // Una respuesta vacía nunca borra lo que ya había.
        const keepObj = !overwrite && parseLines(r.objText).length > 0
        const keepKey = !overwrite && parseLines(r.keyText).length > 0
        return {
          ...r,
          objText: keepObj || res.objectives_es.length === 0
            ? r.objText
            : res.objectives_es.join('\n'),
          keyText: keepKey || res.key_takeaways_es.length === 0
            ? r.keyText
            : res.key_takeaways_es.join('\n'),
        }
      }))
      // Abrir el primero deja el resultado a la vista: si la IA escribe y no se
      // ve nada, parece que no pasó nada y hay que ir a buscarlo.
      if (targets.length > 0) setOpenId(targets[0].id)
      toast.success(t('admin.courses.pensum.ai_done', { count: targets.length }))
    } catch (err) {
      toast.error((err as Error)?.message || t('admin.courses.pensum.ai_error'))
    } finally {
      setAiBusy(null)
    }
  }

  const patch = (id: string, field: 'objText' | 'keyText', value: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)))

  /**
   * Abre la página pública REAL en una pestaña nueva, con lo que hay en
   * pantalla. Es tal cual la vería alguien que abre el enlace del certificado
   * —la misma página, no una maqueta—, solo que con el borrador sin guardar.
   */
  const openSharePreview = () => {
    const url = writeCertSharePreview({
      courseId,
      courseTitle,
      courseDescription,
      learnerName: trainerName?.trim() || t('certificate.sample_name'),
      modules: rows.map((r) => ({
        id: r.id,
        icon: r.icon,
        duration_min: r.duration_min,
        title_es: r.title_es,
        title_en: null,
        title_pt: null,
        subtitle_es: r.subtitle_es,
        subtitle_en: null,
        subtitle_pt: null,
        objectives_es: parseLines(r.objText),
        objectives_en: null,
        objectives_pt: null,
        takeaways_es: parseLines(r.keyText),
        takeaways_en: null,
        takeaways_pt: null,
        topics_es: r.topics_es,
        topics_en: null,
        topics_pt: null,
      })),
    })
    window.open(url, '_blank', 'noopener')
  }

  const aiWorking = aiBusy === 'missing' || aiBusy === 'all'

  return (
    <div>
      <h2 className="mb-1 flex items-center gap-2 text-[14px] font-semibold text-text">
        <Award className="h-4 w-4 text-text-muted" />
        {t('admin.courses.pensum.title')}
      </h2>
      {/* Una sola frase. El "por qué" completo se despliega solo si lo piden:
          dos párrafos de entrada hacían que nadie leyera ninguno. */}
      <p className="text-[12px] text-text-muted">{t('admin.courses.pensum.lead')}</p>
      <button
        type="button"
        onClick={() => setShowHelp((v) => !v)}
        aria-expanded={showHelp}
        className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-medium text-text-muted transition-colors hover:text-text"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        {t('admin.courses.pensum.help_toggle')}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200 ease-apple', showHelp && 'rotate-180')} />
      </button>
      {showHelp && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mt-2.5 rounded-xl border border-line bg-subtle/40 px-3.5 py-3"
        >
          <p className="text-[12px] leading-relaxed text-text-muted">
            {t('admin.courses.pensum.explainer')}
          </p>
        </motion.div>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 rounded-xl bg-subtle skeleton-shine" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-text-muted">
            {t('admin.courses.pensum.no_modules')}
          </div>
        ) : (
          <>
            {/* ── El paso siguiente. Uno solo, y cambia con el estado real ── */}
            <div className={cn(
              'rounded-2xl border px-4 py-4',
              phase === 'done'
                ? 'border-brand-green/30 bg-brand-green/[0.07]'
                : phase === 'empty'
                  ? 'border-brand-magenta/30 bg-brand-magenta/[0.06]'
                  : 'border-amber-500/30 bg-amber-500/[0.08]',
            )}>
              <div className="flex items-start gap-3">
                <div className={cn(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
                  phase === 'done'
                    ? 'bg-brand-green/15 text-brand-green'
                    : phase === 'empty'
                      ? 'bg-brand-magenta/15 text-brand-magenta'
                      : 'bg-amber-500/15 text-amber-500',
                )}>
                  {phase === 'done'
                    ? <Check className="h-4 w-4" strokeWidth={3} />
                    : phase === 'empty'
                      ? <Sparkles className="h-4 w-4" />
                      : <AlertTriangle className="h-4 w-4" />}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-text">
                    {phase === 'done'
                      ? t('admin.courses.pensum.step_done_title')
                      : phase === 'empty'
                        ? t('admin.courses.pensum.step_empty_title')
                        : t('admin.courses.pensum.step_partial_title', { count: missing.length })}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
                    {phase === 'done'
                      ? t('admin.courses.pensum.step_done_hint')
                      : phase === 'empty'
                        ? t('admin.courses.pensum.step_empty_hint')
                        : t('admin.courses.pensum.step_partial_hint')}
                  </p>

                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    {phase === 'done' ? (
                      <Button size="sm" onClick={openSharePreview}>
                        <ExternalLink className="h-4 w-4" />
                        {t('admin.courses.pensum.preview_cta')}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => runAi('missing')} disabled={!!aiBusy}>
                        {aiBusy === 'missing'
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Sparkles className="h-4 w-4" />}
                        {aiBusy === 'missing'
                          ? t('admin.courses.pensum.ai_working')
                          : t('admin.courses.pensum.ai_write')}
                      </Button>
                    )}
                    <span className="text-[12px] text-text-subtle">
                      {phase === 'done'
                        ? t('admin.courses.pensum.preview_opens_tab')
                        : t('admin.courses.pensum.step_or_manual')}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Cobertura — con las MISMAS palabras que salen en el certificado,
                para no obligar a nadie a aprender dos vocabularios. */}
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              <Coverage
                icon={<Target className="h-4 w-4" />}
                label={t('admin.courses.pensum.field_objectives')}
                done={stats.withObj}
                total={stats.total}
              />
              <Coverage
                icon={<ListChecks className="h-4 w-4" />}
                label={t('admin.courses.pensum.field_takeaways')}
                done={stats.withKey}
                total={stats.total}
              />
            </div>

            {/* Acciones de apoyo. Nunca compiten con el paso de arriba. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {phase !== 'done' && (
                <Button size="sm" variant="secondary" onClick={openSharePreview}>
                  <ExternalLink className="h-4 w-4" />
                  {t('admin.courses.pensum.preview_cta')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => runAi('all')} disabled={!!aiBusy}>
                {aiBusy === 'all'
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Sparkles className="h-4 w-4" />}
                {t('admin.courses.pensum.ai_redo_all')}
              </Button>
            </div>

            {aiWorking && (
              <p className="mt-2 text-[12px] text-text-muted">
                {t('admin.courses.pensum.ai_working_hint')}
              </p>
            )}

            <AiReviewNotice className="mt-4" />

            {/* ── Los módulos ── */}
            <div className="mb-2 mt-6 flex items-center gap-2">
              <h3 className="text-[13px] font-semibold text-text">
                {t('admin.courses.pensum.list_title')}
              </h3>
              <span className="text-[12px] text-text-subtle">
                {t('admin.courses.pensum.list_hint')}
              </span>
            </div>

            <div className="space-y-2">
              {rows.map((r, i) => {
                const objs = parseLines(r.objText)
                const keys = parseLines(r.keyText)
                const open = openId === r.id
                const complete = objs.length > 0 && keys.length > 0
                return (
                  <div
                    key={r.id}
                    className={cn(
                      'overflow-hidden rounded-xl border transition-colors',
                      complete ? 'border-line' : 'border-amber-500/35',
                    )}
                  >
                    <button
                      onClick={() => setOpenId(open ? null : r.id)}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-glass/5"
                      aria-expanded={open}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-text-muted">
                        <EntityIcon value={r.icon} size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-text">
                          {i + 1}. {r.title_es}
                        </span>
                        {/* Plegado, la fila enseña lo primero que dirá el
                            certificado. Un contador solo no dice si está bien. */}
                        <span className="mt-0.5 block truncate text-[12px] text-text-muted">
                          {complete
                            ? objs[0]
                            : t('admin.courses.pensum.row_missing')}
                        </span>
                      </span>
                      <span className="hidden shrink-0 items-center gap-2.5 text-[11px] text-text-subtle sm:flex">
                        <span className={objs.length ? undefined : 'text-amber-500'}>
                          {t('admin.courses.pensum.chip_objectives', { count: objs.length })}
                        </span>
                        <span className={keys.length ? undefined : 'text-amber-500'}>
                          {t('admin.courses.pensum.chip_takeaways', { count: keys.length })}
                        </span>
                      </span>
                      {complete
                        ? <Check className="h-4 w-4 shrink-0 text-brand-green" />
                        : <Pencil className="h-4 w-4 shrink-0 text-amber-500" />}
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-text-subtle transition-transform duration-200 ease-apple',
                          open && 'rotate-180',
                        )}
                      />
                    </button>

                    {open && (
                      <div className="border-t border-line px-3.5 py-3.5">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
                              <Target className="h-3.5 w-3.5 text-text-muted" />
                              {t('admin.courses.pensum.field_objectives')}
                            </label>
                            <p className="mb-1.5 mt-0.5 text-[11.5px] leading-relaxed text-text-subtle">
                              {t('admin.courses.pensum.help_objectives')}
                            </p>
                            <textarea
                              value={r.objText}
                              onChange={(e) => patch(r.id, 'objText', e.target.value)}
                              rows={5}
                              placeholder={t('admin.courses.pensum.ph_objectives')}
                              className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-text placeholder:text-text-subtle"
                            />
                          </div>
                          <div>
                            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-text">
                              <ListChecks className="h-3.5 w-3.5 text-text-muted" />
                              {t('admin.courses.pensum.field_takeaways')}
                            </label>
                            <p className="mb-1.5 mt-0.5 text-[11.5px] leading-relaxed text-text-subtle">
                              {t('admin.courses.pensum.help_takeaways')}
                            </p>
                            <textarea
                              value={r.keyText}
                              onChange={(e) => patch(r.id, 'keyText', e.target.value)}
                              rows={5}
                              placeholder={t('admin.courses.pensum.ph_takeaways')}
                              className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-text placeholder:text-text-subtle"
                            />
                          </div>
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-[11.5px] text-text-subtle">
                            {t('admin.courses.pensum.line_hint')}
                          </p>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => runAi(r.id)}
                            disabled={!!aiBusy}
                          >
                            {aiBusy === r.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Sparkles className="h-3.5 w-3.5" />}
                            {t('admin.courses.pensum.ai_module')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

    </div>
  )
}
