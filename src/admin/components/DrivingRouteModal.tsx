import { useEffect, useRef, useState } from 'react'
import { X, Sparkles } from 'lucide-react'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { Select } from '@/components/ui/Select'
import { LEVELS, LEVEL_LABEL, DEFAULT_PASS_PCT, createCourseRoute, listCourses, type CourseOption, type DrivingLevel } from '@/services/drivingLevels.service'

interface Props {
  /** Curso ya elegido (al rehacer una ruta existente). */
  courseId?: string
  campaignId: string | null
  onClose: () => void
  onCreated: () => void
}

/**
 * Crea con IA la ruta por niveles de un curso: un juego de autos por nivel,
 * con preguntas sacadas del contenido real del curso. Todo queda en borrador.
 */
export function DrivingRouteModal({ courseId = '', campaignId, onClose, onCreated }: Props) {
  const [courses, setCourses] = useState<CourseOption[]>([])
  const [course, setCourse] = useState(courseId)
  const [levels, setLevels] = useState<DrivingLevel[]>(LEVELS)
  const [count, setCount] = useState(8)
  const [instruction, setInstruction] = useState('')
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  useEffect(() => {
    listCourses().then(setCourses).catch(() => setError('No se pudieron cargar los cursos.'))
    return () => abort.current?.abort()
  }, [])
  async function generate() {
    const picked = courses.find(c => c.id === course)
    if (!picked || levels.length === 0 || running) return
    setError('')
    abort.current = new AbortController()
    const ordered = LEVELS.filter(l => levels.includes(l))
    try {
      await createCourseRoute({
        course: picked, levels: ordered, count, instruction, campaignId, signal: abort.current.signal,
        onProgress: (level, i) => setRunning('Generando nivel ' + LEVEL_LABEL[level] + ' (' + (i + 1) + ' de ' + ordered.length + ')…'),
      })
      onCreated(); onClose()
    } catch (failure) {
      if (abort.current?.signal.aborted) return
      setError(failure instanceof Error ? failure.message : 'No se pudo generar la ruta.')
      // Los niveles que alcanzaron a guardarse ya están en la lista.
      onCreated()
    } finally { setRunning(null) }
  }
  const field = 'w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text placeholder-text-subtle focus:outline-none focus:border-[#10D451]/50 min-h-[44px]'
  return <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)' }} {...backdropDismiss(() => { if (!running) onClose() })}>
    <div className="w-full max-w-lg rounded-2xl border border-line bg-surface" role="dialog" aria-modal="true" aria-labelledby="route-title">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 id="route-title" className="text-[16px] font-semibold text-text">Ruta por niveles con IA</h2>
        <button onClick={() => { abort.current?.abort(); onClose() }} aria-label="Cerrar" className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-glass/6 hover:text-text"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-4 px-5 py-5">
        <p className="text-sm leading-relaxed text-text-muted">La IA lee el contenido del curso y escribe un juego por nivel. El aprendiz empieza en Básico y desbloquea el siguiente al llegar al {DEFAULT_PASS_PCT} % de aciertos. Todo queda en borrador para que lo revises antes de publicar.</p>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-muted">Curso</label>
          <Select value={course} onChange={setCourse} disabled={!!running} placeholder="Elige un curso" searchable options={courses.map(c => ({ value: c.id, label: c.title_es }))} />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[12px] font-medium text-text-muted">Niveles</legend>
          <div className="flex flex-wrap gap-2">{LEVELS.map(level => <label key={level} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm text-text">
            <input type="checkbox" disabled={!!running} checked={levels.includes(level)} onChange={e => setLevels(v => e.target.checked ? [...v, level] : v.filter(l => l !== level))} /> {LEVEL_LABEL[level]}
          </label>)}</div>
          <p className="mt-1.5 text-[11px] text-text-subtle">Si el curso ya tiene ese nivel, se reemplazan sus preguntas y vuelve a borrador.</p>
        </fieldset>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-muted" htmlFor="route-count">Semáforos por nivel</label>
          <input id="route-count" type="number" min={3} max={15} value={count} disabled={!!running} onChange={e => setCount(Math.max(3, Math.min(15, Number(e.target.value) || 8)))} className={field} />
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-muted" htmlFor="route-note">Indicación (opcional)</label>
          <input id="route-note" value={instruction} disabled={!!running} onChange={e => setInstruction(e.target.value)} placeholder="Ej.: enfócate en el manejo de objeciones" className={field} />
        </div>
        {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm text-danger">{error}</p>}
        {running && <p role="status" className="text-sm text-neon-green">{running} Puede tardar un minuto por nivel.</p>}
      </div>
      <div className="flex justify-end gap-3 border-t border-line px-5 py-4">
        <button onClick={() => { abort.current?.abort(); onClose() }} className="rounded-xl px-4 py-2.5 text-sm text-text-muted hover:text-text">{running ? 'Cancelar' : 'Cerrar'}</button>
        <button onClick={() => void generate()} disabled={!course || levels.length === 0 || !!running} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-on-primary transition hover:brightness-110 disabled:opacity-50"><Sparkles size={16} /> {running ? 'Generando…' : 'Generar niveles'}</button>
      </div>
    </div>
  </div>
}
