import { useRef, useState } from 'react'
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  BookOpen,
  ClipboardList,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Upload,
  Video,
  Languages,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { uploadSectionMedia } from '@/services/modules.service'
import type { VideoMarkerRaw, VideoQuestionRaw } from '@/services/modules.service'
import { moduleAiAssist } from '@/services/ai.service'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTranslation } from 'react-i18next'

type Lang = 'es' | 'en' | 'pt'

interface VideoMarkerEditorProps {
  sectionId: string
  campaignId: string
  moduleId: string
  videoUrl: string | null
  markers: VideoMarkerRaw[]
  lang: Lang
  onVideoChange: (url: string | null) => void
  onMarkersChange: (markers: VideoMarkerRaw[]) => void
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function parseTimeInput(val: string): number {
  const parts = val.split(':').map(Number)
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2]
  if (parts.length === 2) return (parts[0] * 60) + parts[1]
  return Number(val) || 0
}

function newMarkerId() {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function newQuestionId() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function markerTitle(m: VideoMarkerRaw, l: Lang): string {
  return (m as unknown as Record<string, string>)[`title_${l}`] || m.title_es || ''
}

function emptyQuestion(): VideoQuestionRaw {
  return {
    id: newQuestionId(),
    question_es: '', question_en: '', question_pt: '',
    options_es: ['', '', '', ''], options_en: ['', '', '', ''], options_pt: ['', '', '', ''],
    correct: 0,
    explanation_es: '', explanation_en: '', explanation_pt: '',
  }
}

// ─── Subcomponente: editor de preguntas ───────────────────────

function QuestionEditor({
  q,
  lang,
  index,
  total,
  onChange,
  onDelete,
}: {
  q: VideoQuestionRaw
  lang: Lang
  index: number
  total: number
  onChange: (q: VideoQuestionRaw) => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(index === 0)
  const qField = `question_${lang}` as keyof VideoQuestionRaw
  const optsField = `options_${lang}` as keyof VideoQuestionRaw
  const expField = `explanation_${lang}` as keyof VideoQuestionRaw

  return (
    <div className="rounded-xl border border-glass-border/10 bg-glass/3 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-glass/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="h-5 w-5 rounded-md bg-amber-400/15 text-amber-400 text-[10px] font-bold flex items-center justify-center shrink-0">
            {index + 1}
          </span>
          <span className="text-[12px] font-medium text-text truncate max-w-[200px]">
            {(q[qField] as string) || `Pregunta ${index + 1}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {total > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="p-1 rounded-md text-text-subtle hover:text-danger hover:bg-danger/8 transition-all"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          {open ? <ChevronUp className="h-3.5 w-3.5 text-text-subtle" /> : <ChevronDown className="h-3.5 w-3.5 text-text-subtle" />}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-glass-border/8">
          <div className="pt-3">
            <label className="block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">
              Pregunta ({lang.toUpperCase()})
            </label>
            <textarea
              value={q[qField] as string}
              onChange={(e) => onChange({ ...q, [qField]: e.target.value })}
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-[13px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none resize-none placeholder:text-text-subtle"
              placeholder="¿Cuál es la respuesta correcta?"
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
              Opciones — marca la correcta
            </label>
            <div className="space-y-1.5">
              {(['A','B','C','D'] as const).map((letter, i) => {
                const opts = (q[optsField] as string[]) ?? ['', '', '', '']
                return (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onChange({ ...q, correct: i })}
                      className={cn(
                        'h-4 w-4 rounded-full border-2 shrink-0 transition-all duration-150',
                        q.correct === i
                          ? 'border-neon-green bg-neon-green/20'
                          : 'border-glass-border/20 hover:border-neon-green/40',
                      )}
                    />
                    <span className="text-[10px] font-bold text-text-subtle w-4 shrink-0">{letter}</span>
                    <input
                      value={opts[i] ?? ''}
                      onChange={(e) => {
                        const next = [...opts]
                        next[i] = e.target.value
                        onChange({ ...q, [optsField]: next })
                      }}
                      className="flex-1 rounded-lg px-2.5 py-1.5 text-[12px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none placeholder:text-text-subtle"
                      placeholder={`Opción ${letter}`}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">
              Explicación ({lang.toUpperCase()})
            </label>
            <textarea
              value={q[expField] as string}
              onChange={(e) => onChange({ ...q, [expField]: e.target.value })}
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-[13px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none resize-none placeholder:text-text-subtle"
              placeholder="Por qué esta respuesta es correcta..."
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Subcomponente: formulario de edición de marcador ──────────

function MarkerEditForm({
  marker,
  lang,
  videoDuration,
  onSave,
  onCancel,
}: {
  marker: VideoMarkerRaw
  lang: Lang
  videoDuration: number
  onSave: (m: VideoMarkerRaw) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<VideoMarkerRaw>(() => JSON.parse(JSON.stringify(marker)))
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState<string | null>(null)

  const handleAutoTranslate = async () => {
    if (!draft.title_es) return
    setTranslating(true)
    setTranslateError(null)
    try {
      const fields: Record<string, string> = { title: draft.title_es }
      if (draft.type === 'quiz' && draft.questions) {
        draft.questions.forEach((q, i) => {
          fields[`q${i}`] = q.question_es
          ;(q.options_es ?? []).forEach((opt, j) => { fields[`q${i}o${j}`] = opt })
          if (q.explanation_es) fields[`q${i}exp`] = q.explanation_es
        })
      }
      const res = await moduleAiAssist({ action: 'translate', contentType: 'meta', sourceLang: 'es', targetLangs: ['en', 'pt'], fields })
      const data = res.data as Record<string, Record<string, string>>
      setDraft(p => {
        const updated: VideoMarkerRaw = { ...p }
        if (data.en?.title) updated.title_en = data.en.title
        if (data.pt?.title) updated.title_pt = data.pt.title
        if (p.questions) {
          updated.questions = p.questions.map((q, i) => ({
            ...q,
            question_en: data.en?.[`q${i}`] || q.question_en,
            question_pt: data.pt?.[`q${i}`] || q.question_pt,
            options_en: (q.options_en ?? ['','','','']).map((_, j) => data.en?.[`q${i}o${j}`] || q.options_en?.[j] || ''),
            options_pt: (q.options_pt ?? ['','','','']).map((_, j) => data.pt?.[`q${i}o${j}`] || q.options_pt?.[j] || ''),
            explanation_en: data.en?.[`q${i}exp`] || q.explanation_en,
            explanation_pt: data.pt?.[`q${i}exp`] || q.explanation_pt,
          }))
        }
        return updated
      })
    } catch {
      setTranslateError('Error al traducir. Intenta de nuevo.')
    } finally {
      setTranslating(false)
    }
  }
  const titleField = `title_${lang}` as 'title_es' | 'title_en' | 'title_pt'
  const [timeInput, setTimeInput] = useState(formatTime(draft.timeSeconds))

  const handleTimeBlur = () => {
    const secs = Math.max(0, Math.min(parseTimeInput(timeInput), videoDuration || 9999))
    setDraft((p) => ({ ...p, timeSeconds: secs }))
    setTimeInput(formatTime(secs))
  }

  const addQuestion = () => {
    setDraft((p) => ({ ...p, questions: [...(p.questions ?? []), emptyQuestion()] }))
  }

  const updateQuestion = (i: number, q: VideoQuestionRaw) => {
    setDraft((p) => {
      const qs = [...(p.questions ?? [])]
      qs[i] = q
      return { ...p, questions: qs }
    })
  }

  const deleteQuestion = async (i: number) => {
    const ok = await confirm({
      title: t('confirm.delete_question_title'),
      description: t('confirm.delete_question_desc'),
    })
    if (!ok) return
    setDraft((p) => ({ ...p, questions: (p.questions ?? []).filter((_, idx) => idx !== i) }))
  }

  return (
    <div className="mt-2 p-4 rounded-2xl border border-blue-400/20 bg-blue-400/4 space-y-4">
      <div className="flex items-center gap-3">
        <div>
          <label className="block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">Tiempo</label>
          <input
            value={timeInput}
            onChange={(e) => setTimeInput(e.target.value)}
            onBlur={handleTimeBlur}
            className="w-24 rounded-lg px-2.5 py-1.5 text-[13px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none font-mono"
            placeholder="0:00"
          />
        </div>
        <div className="flex-1">
          <label className="block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">
            Título ({lang.toUpperCase()})
          </label>
          <input
            value={draft[titleField]}
            onChange={(e) => setDraft((p) => ({ ...p, [titleField]: e.target.value }))}
            className="w-full rounded-lg px-2.5 py-1.5 text-[13px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none placeholder:text-text-subtle"
            placeholder={draft.type === 'chapter' ? 'Nombre del capítulo' : 'Nombre del quiz'}
          />
        </div>
      </div>

      {/* Títulos en los otros dos idiomas */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">Otros idiomas</span>
          <button
            type="button"
            onClick={handleAutoTranslate}
            disabled={translating || !draft.title_es}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-blue-400 hover:bg-blue-400/8 border border-blue-400/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {translating
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Traduciendo…</>
              : <><Languages className="h-3 w-3" /> Traducir con IA</>}
          </button>
        </div>
        {translateError && (
          <p className="text-[11px] text-danger">{translateError}</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {(['es', 'en', 'pt'] as const).filter((l) => l !== lang).map((l) => {
            const f = `title_${l}` as 'title_es' | 'title_en' | 'title_pt'
            return (
              <div key={l}>
                <label className="block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">
                  Título ({l.toUpperCase()})
                </label>
                <input
                  value={draft[f]}
                  onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                  className="w-full rounded-lg px-2.5 py-1.5 text-[12px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none placeholder:text-text-subtle"
                  placeholder={`Título en ${l.toUpperCase()}`}
                />
              </div>
            )
          })}
        </div>
      </div>

      {/* Preguntas del quiz */}
      {draft.type === 'quiz' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Preguntas ({(draft.questions ?? []).length})
            </label>
            <button
              type="button"
              onClick={addQuestion}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-blue-400 hover:bg-blue-400/8 transition-colors border border-blue-400/20"
            >
              <Plus className="h-3 w-3" /> Agregar pregunta
            </button>
          </div>
          {(draft.questions ?? []).map((q, i) => (
            <QuestionEditor
              key={q.id}
              q={q}
              lang={lang}
              index={i}
              total={(draft.questions ?? []).length}
              onChange={(updated) => updateQuestion(i, updated)}
              onDelete={() => deleteQuestion(i)}
            />
          ))}
          {(draft.questions ?? []).length === 0 && (
            <button
              type="button"
              onClick={addQuestion}
              className="w-full py-3 rounded-xl border border-dashed border-glass-border/20 text-[12px] text-text-subtle hover:border-blue-400/30 hover:text-blue-400 transition-colors"
            >
              + Agregar primera pregunta
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-muted hover:text-text glass border border-glass-border/10 transition-colors"
        >
          <X className="h-3.5 w-3.5" /> Cancelar
        </button>
        <button
          type="button"
          onClick={() => onSave(draft)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-neon-green bg-neon-green/8 border border-neon-green/20 hover:bg-neon-green/12 transition-colors"
        >
          <Check className="h-3.5 w-3.5" /> Guardar
        </button>
      </div>
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────

export function VideoMarkerEditor({
  sectionId,
  campaignId,
  moduleId,
  videoUrl,
  markers,
  lang,
  onVideoChange,
  onMarkersChange,
}: VideoMarkerEditorProps) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingType, setAddingType] = useState<'chapter' | 'quiz' | null>(null)
  const [translatingAll, setTranslatingAll] = useState(false)
  const [translateAllError, setTranslateAllError] = useState<string | null>(null)

  const handleTranslateAllMarkers = async () => {
    const withEs = markers.filter(m => m.title_es?.trim())
    if (!withEs.length) return
    setTranslatingAll(true)
    setTranslateAllError(null)
    try {
      const fields: Record<string, string> = {}
      withEs.forEach((m, i) => {
        fields[`m${i}_title`] = m.title_es
        if (m.type === 'quiz' && m.questions) {
          m.questions.forEach((q, qi) => {
            if (q.question_es) fields[`m${i}q${qi}`] = q.question_es
            ;(q.options_es ?? []).forEach((opt, oi) => { if (opt) fields[`m${i}q${qi}o${oi}`] = opt })
            if (q.explanation_es) fields[`m${i}q${qi}exp`] = q.explanation_es
          })
        }
      })
      const res = await moduleAiAssist({ action: 'translate', contentType: 'meta', sourceLang: 'es', targetLangs: ['en', 'pt'], fields })
      const data = res.data as Record<string, Record<string, string>>
      const updated = markers.map(m => {
        const idx = withEs.findIndex(x => x.id === m.id)
        if (idx === -1) return m
        const next: VideoMarkerRaw = { ...m }
        if (data.en?.[`m${idx}_title`]) next.title_en = data.en[`m${idx}_title`]
        if (data.pt?.[`m${idx}_title`]) next.title_pt = data.pt[`m${idx}_title`]
        if (m.questions) {
          next.questions = m.questions.map((q, qi) => ({
            ...q,
            question_en: data.en?.[`m${idx}q${qi}`] || q.question_en,
            question_pt: data.pt?.[`m${idx}q${qi}`] || q.question_pt,
            options_en: (q.options_en ?? ['','','','']).map((_, oi) => data.en?.[`m${idx}q${qi}o${oi}`] || q.options_en?.[oi] || ''),
            options_pt: (q.options_pt ?? ['','','','']).map((_, oi) => data.pt?.[`m${idx}q${qi}o${oi}`] || q.options_pt?.[oi] || ''),
            explanation_en: data.en?.[`m${idx}q${qi}exp`] || q.explanation_en,
            explanation_pt: data.pt?.[`m${idx}q${qi}exp`] || q.explanation_pt,
          }))
        }
        return next
      })
      onMarkersChange(updated)
    } catch {
      setTranslateAllError('Error al traducir. Intenta de nuevo.')
    } finally {
      setTranslatingAll(false)
    }
  }

  const sortedMarkers = [...markers].sort((a, b) => a.timeSeconds - b.timeSeconds)

  const handleFileSelect = async (file: File) => {
    if (!sectionId) {
      setUploadError('Guarda la sección primero para poder subir archivos')
      return
    }
    if (!['video/mp4', 'video/webm', 'video/ogg'].includes(file.type)) {
      setUploadError('Solo se aceptan videos MP4, WebM u OGG')
      return
    }
    if (file.size > 500 * 1024 * 1024) {
      setUploadError('El video excede 500 MB')
      return
    }
    setUploading(true)
    setUploadError(null)
    try {
      const url = await uploadSectionMedia(file, campaignId, moduleId, sectionId)
      onVideoChange(url)
    } catch {
      setUploadError('Error al subir el video')
    } finally {
      setUploading(false)
    }
  }

  const getCurrentTime = () => videoRef.current?.currentTime ?? 0

  const handleAddMarker = (type: 'chapter' | 'quiz') => {
    const newMarker: VideoMarkerRaw = {
      id: newMarkerId(),
      timeSeconds: Math.round(getCurrentTime()),
      type,
      title_es: '',
      title_en: '',
      title_pt: '',
      ...(type === 'quiz' ? { questions: [emptyQuestion()] } : {}),
    }
    onMarkersChange([...markers, newMarker])
    setEditingId(newMarker.id)
    setAddingType(null)
  }

  const handleSaveMarker = (updated: VideoMarkerRaw) => {
    onMarkersChange(markers.map((m) => (m.id === updated.id ? updated : m)))
    setEditingId(null)
  }

  const handleDeleteMarker = async (id: string) => {
    const ok = await confirm({
      title: t('confirm.delete_marker_title'),
      description: t('confirm.delete_marker_desc'),
    })
    if (!ok) return
    onMarkersChange(markers.filter((m) => m.id !== id))
    if (editingId === id) setEditingId(null)
  }

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current || !videoDuration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    const secs = Math.max(0, Math.min(pct * videoDuration, videoDuration))
    videoRef.current.currentTime = secs
  }

  return (
    <div className="space-y-5">
      {/* Subida / vista previa del video */}
      <div>
        <label className="block text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2">
          Video del módulo
        </label>

        {videoUrl ? (
          <div className="rounded-2xl overflow-hidden border border-glass-border/10 bg-black">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              preload="metadata"
              className="w-full max-h-72 block"
              onLoadedMetadata={() => setVideoDuration(videoRef.current?.duration ?? 0)}
            />
          </div>
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const file = e.dataTransfer.files[0]
              if (file) handleFileSelect(file)
            }}
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-3 h-32 rounded-2xl border-2 border-dashed border-glass-border/15 bg-glass/3 hover:border-blue-400/30 hover:bg-blue-400/4 cursor-pointer transition-colors"
          >
            {uploading ? (
              <div className="flex items-center gap-2 text-text-muted text-[13px]">
                <div className="h-4 w-4 border-2 border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
                Subiendo video…
              </div>
            ) : (
              <>
                <Video className="h-8 w-8 text-text-subtle" />
                <p className="text-[13px] text-text-muted text-center">
                  Arrastra un video MP4/WebM aquí o{' '}
                  <span className="text-blue-400 font-medium">selecciona archivo</span>
                </p>
                <p className="text-[11px] text-text-subtle">MP4, WebM, OGG · Máx 500 MB</p>
              </>
            )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/webm,video/ogg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFileSelect(file)
            e.target.value = ''
          }}
        />

        {videoUrl && (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-text-muted glass border border-glass-border/10 hover:text-text transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? 'Subiendo…' : 'Cambiar video'}
            </button>
            <button
              type="button"
              onClick={() => onVideoChange(null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-danger/70 hover:text-danger glass border border-glass-border/10 hover:bg-danger/6 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar video
            </button>
          </div>
        )}

        {uploadError && (
          <p className="mt-2 text-[12px] text-danger">{uploadError}</p>
        )}
      </div>

      {/* Línea de tiempo */}
      {videoUrl && videoDuration > 0 && (
        <div>
          <label className="block text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2">
            Línea de tiempo · Click para posicionar
          </label>
          <div
            className="relative h-8 rounded-full bg-glass/8 border border-glass-border/10 cursor-pointer"
            onClick={handleTimelineClick}
          >
            {/* Línea de progreso */}
            <div className="absolute inset-0 flex items-center px-3">
              <div className="h-1 w-full rounded-full bg-glass-border/15" />
            </div>
            {/* Puntos de marcadores */}
            {sortedMarkers.map((m) => {
              const pct = (m.timeSeconds / videoDuration) * 100
              return (
                <div
                  key={m.id}
                  title={`${m.type === 'chapter' ? '●' : '📝'} ${markerTitle(m, lang) || '—'} (${formatTime(m.timeSeconds)})`}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
                  style={{ left: `${pct}%` }}
                  onClick={(e) => { e.stopPropagation(); setEditingId(m.id) }}
                >
                  <div className={cn(
                    'h-4 w-4 rounded-full border-2 border-bg shadow-sm transition-transform hover:scale-125 cursor-pointer',
                    m.type === 'chapter' ? 'bg-blue-400 border-blue-300' : 'bg-amber-400 border-amber-300',
                  )} />
                </div>
              )
            })}
            {/* Etiquetas de tiempo */}
            <div className="absolute inset-0 flex items-end pb-0.5 px-2 pointer-events-none">
              <span className="text-[9px] text-text-subtle font-mono">0:00</span>
              <span className="ml-auto text-[9px] text-text-subtle font-mono">{formatTime(videoDuration)}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="flex items-center gap-1.5 text-[11px] text-text-subtle">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-400 inline-block" />
              Capítulo
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-text-subtle">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400 inline-block" />
              Quiz
            </span>
          </div>
        </div>
      )}

      {/* Botones para agregar marcador */}
      {videoUrl && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { setAddingType(null); handleAddMarker('chapter') }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium text-blue-400 bg-blue-400/8 border border-blue-400/20 hover:bg-blue-400/12 transition-colors"
          >
            <BookOpen className="h-3.5 w-3.5" />
            + Agregar capítulo
          </button>
          <button
            type="button"
            onClick={() => { setAddingType(null); handleAddMarker('quiz') }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium text-amber-400 bg-amber-400/8 border border-amber-400/20 hover:bg-amber-400/12 transition-colors"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            + Agregar quiz
          </button>
          {videoDuration > 0 && videoRef.current && (
            <span className="flex items-center text-[11px] text-text-subtle ml-auto">
              Tiempo actual: {formatTime(videoRef.current?.currentTime ?? 0)}
            </span>
          )}
        </div>
      )}

      {/* Lista de marcadores */}
      {sortedMarkers.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
              Marcadores ({sortedMarkers.length})
            </label>
            <button
              type="button"
              onClick={handleTranslateAllMarkers}
              disabled={translatingAll || !markers.some(m => m.title_es?.trim())}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-blue-400 hover:bg-blue-400/8 border border-blue-400/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {translatingAll
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Traduciendo…</>
                : <><Languages className="h-3 w-3" /> Traducir todos con IA</>}
            </button>
          </div>
          {translateAllError && (
            <p className="text-[11px] text-danger mb-2">{translateAllError}</p>
          )}
          <div className="space-y-2">
            {sortedMarkers.map((m) => (
              <div key={m.id} className="rounded-xl border border-glass-border/8 bg-glass/3 overflow-visible">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <GripVertical className="h-3.5 w-3.5 text-text-subtle shrink-0" />
                  <div className={cn(
                    'h-5 w-5 rounded-md flex items-center justify-center shrink-0',
                    m.type === 'chapter' ? 'bg-blue-400/15 text-blue-400' : 'bg-amber-400/15 text-amber-400',
                  )}>
                    {m.type === 'chapter' ? <BookOpen className="h-3 w-3" /> : <ClipboardList className="h-3 w-3" />}
                  </div>
                  <span className="text-[11px] font-mono text-text-subtle shrink-0 w-10">
                    {formatTime(m.timeSeconds)}
                  </span>
                  <span className="flex-1 text-[13px] text-text truncate">
                    {markerTitle(m, lang) || <span className="text-text-subtle italic">—</span>}
                  </span>
                  {m.type === 'quiz' && (
                    <span className="text-[11px] text-amber-400/70 shrink-0">
                      {(m.questions ?? []).length}P
                    </span>
                  )}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingId(editingId === m.id ? null : m.id)}
                      className={cn(
                        'p-1.5 rounded-lg transition-all',
                        editingId === m.id
                          ? 'bg-neon-green/10 text-neon-green'
                          : 'text-text-subtle hover:text-text hover:bg-glass/8',
                      )}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteMarker(m.id)}
                      className="p-1.5 rounded-lg text-text-subtle hover:text-danger hover:bg-danger/8 transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {editingId === m.id && (
                  <div className="px-3 pb-3 border-t border-glass-border/8">
                    <MarkerEditForm
                      marker={m}
                      lang={lang}
                      videoDuration={videoDuration}
                      onSave={handleSaveMarker}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {markers.length === 0 && videoUrl && (
        <div className="py-6 text-center text-[12px] text-text-subtle border border-dashed border-glass-border/10 rounded-xl">
          Sin marcadores. Usa los botones para agregar capítulos o quizzes.
        </div>
      )}
    </div>
  )
}
