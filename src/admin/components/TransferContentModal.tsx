import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Loader2, TriangleAlert } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { toast } from '@/stores/toastStore'
import {
  getUserContent, transferContent, totalAuthored,
  type AuthoredCounts, type BlockingRef,
} from '@/services/ownership.service'

/**
 * Pasar el contenido de una persona a otra, antes de darla de baja.
 *
 * Por qué existe: si se borra una cuenta que alcanzó a crear cursos, ese
 * contenido queda sin dueño —de `courses.created_by` depende quién puede
 * administrarlo— o el borrado falla por las claves foráneas que apuntan a ella.
 *
 * El modal enseña PRIMERO qué hay que mover y qué bloquearía el borrado. Un
 * "¿seguro?" sin datos delante no es una decisión informada, y esta se toma una
 * sola vez y no se deshace.
 */
export function TransferContentModal({
  user,
  candidates,
  onClose,
  onDone,
}: {
  user: { id: string; display_name: string | null }
  /** A quién se le puede pasar: capacitadores y superadmins, menos el propio. */
  candidates: { id: string; display_name: string | null }[]
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [authored, setAuthored] = useState<AuthoredCounts | null>(null)
  const [blocking, setBlocking] = useState<BlockingRef[]>([])
  const [target, setTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getUserContent(user.id)
      .then((c) => { if (alive) { setAuthored(c.authored); setBlocking(c.blocking) } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [user.id])

  const options = useMemo(
    () => candidates
      .filter((c) => c.id !== user.id)
      .map((c) => ({ value: c.id, label: c.display_name || c.id })),
    [candidates, user.id],
  )

  // Solo las filas con algo: una lista de doce ceros no dice nada.
  const rows = useMemo(() => {
    if (!authored) return []
    return (Object.entries(authored) as [keyof AuthoredCounts, number][])
      .filter(([, n]) => Number(n) > 0)
      .map(([k, n]) => ({ key: k, n: Number(n), label: t(`admin.transfer.kind.${k}`, LABEL_ES[k]) }))
  }, [authored, t])

  const total = authored ? totalAuthored(authored) : 0

  const submit = async () => {
    if (!target) return
    setSaving(true)
    try {
      const moved = await transferContent(user.id, target)
      const n = Object.values(moved).reduce((s, v) => s + (Number(v) || 0), 0)
      toast.success(
        t('admin.transfer.done_title', 'Contenido transferido'),
        t('admin.transfer.done_body', { count: n, defaultValue: '{{count}} elementos cambiaron de dueño.' }),
      )
      onDone()
      onClose()
    } catch (e) {
      toast.error(
        t('admin.transfer.error', 'No se pudo transferir'),
        e instanceof Error ? e.message : String(e),
      )
    } finally {
      setSaving(false)
    }
  }

  const who = user.display_name || t('admin.transfer.unnamed', 'esta persona')

  return (
    <Modal
      onClose={onClose}
      title={t('admin.transfer.title', 'Cambiar de dueño el contenido')}
      subtitle={t('admin.transfer.subtitle', { name: who, defaultValue: 'Lo que creó {{name}} pasa a otra persona' })}
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-text-muted transition-colors hover:bg-glass/10 hover:text-text"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!target || saving || loading || total === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary/12 px-3.5 py-2 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/18 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('admin.transfer.confirm', 'Transferir')}
          </button>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-[13px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('admin.transfer.loading', 'Revisando qué creó…')}
        </div>
      ) : error ? (
        <p className="py-6 text-[13px] text-danger">{error}</p>
      ) : (
        <div className="space-y-5">
          {/* Qué se va a mover */}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              {t('admin.transfer.what', 'Qué se va a mover')}
            </p>
            {rows.length === 0 ? (
              <p className="text-[13px] text-text-muted">
                {t('admin.transfer.nothing', 'No figura como autor de nada. Se puede borrar sin transferir.')}
              </p>
            ) : (
              <ul className="space-y-1">
                {rows.map((r) => (
                  <li key={r.key} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-text-muted">{r.label}</span>
                    <span className="font-semibold tabular-nums text-text">{r.n}</span>
                  </li>
                ))}
              </ul>
            )}
            {/* Los módulos no tienen dueño propio: es la duda que siempre surge. */}
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-text-subtle">
              {t('admin.transfer.modules_note', 'Los módulos van con su curso: no tienen dueño propio, los administra quien administra el curso y la campaña.')}
            </p>
          </div>

          {/* A quién */}
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              {t('admin.transfer.to', 'Nuevo dueño')}
            </label>
            <Select
              value={target}
              onChange={setTarget}
              options={options}
              placeholder={t('admin.transfer.pick', 'Elige un capacitador o superadmin')}
            />
          </div>

          {/* Qué seguirá bloqueando el borrado */}
          {blocking.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3.5 py-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-amber-600">
                <TriangleAlert className="h-3.5 w-3.5" />
                {t('admin.transfer.blocking_title', 'Esto impediría borrar la cuenta')}
              </p>
              <p className="mb-2 text-[11.5px] leading-relaxed text-text-muted">
                {t('admin.transfer.blocking_body', 'Quedan referencias a esta persona que la base no borra sola. Transferir el contenido puede resolver algunas; las que sigan hay que revisarlas antes de dar la baja.')}
              </p>
              <ul className="space-y-0.5">
                {blocking.map((b) => (
                  <li key={`${b.table}.${b.column}`} className="flex items-baseline gap-2 text-[11.5px] text-text-muted">
                    <ArrowRight className="h-3 w-3 shrink-0 translate-y-0.5 opacity-50" />
                    <code className="font-mono">{b.table}.{b.column}</code>
                    <span className="ml-auto font-semibold tabular-nums">{b.rows}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

/** Respaldo en español por si falta la clave de i18n. */
const LABEL_ES: Record<keyof AuthoredCounts, string> = {
  courses: 'Cursos',
  courses_deleted: 'Cursos en la papelera',
  courses_approved: 'Cursos que aprobó',
  exams: 'Exámenes',
  exam_questions: 'Preguntas de examen',
  scenarios: 'Simulaciones',
  choice_scenarios: 'Simulaciones de opción múltiple',
  worlds: 'Mundos',
  arena_quizzes: 'Arenas',
  guided_missions: 'Misiones guiadas',
  live_quizzes: 'Quizzes en vivo',
  ai_scenario_drafts: 'Borradores de IA',
}
