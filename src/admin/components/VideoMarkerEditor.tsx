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
  Youtube,
  Languages,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { detectLang } from '@/lib/detectLang'
import { uploadSectionMedia } from '@/services/modules.service'
import { findDuplicateMedia, type DuplicateMatch } from '@/services/mediaDuplicates.service'
import { shortFileHash } from '@/lib/fileHash'
import { DuplicateMediaNotice } from './DuplicateMediaNotice'
import type { VideoMarkerRaw, VideoQuestionRaw } from '@/services/modules.service'
import { MIN_VIDEO_QUIZ_SECONDS, clampQuizTime } from '@/types/blocks'
import { moduleAiAssist } from '@/services/ai.service'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useTranslation } from 'react-i18next'
import { YouTubePlayer } from '@/components/modules/YouTubePlayer'
import { VimeoPlayer } from '@/components/modules/VimeoPlayer'
import { extractYouTubeId, type PlayerLike } from '@/lib/youtube'
import { extractVimeoId } from '@/lib/vimeo'

type Lang = 'es' | 'en' | 'pt'
type VideoSource = 'video' | 'youtube' | 'vimeo'

interface VideoMarkerEditorProps {
  sectionId: string
  campaignId: string
  moduleId: string
  videoUrl: string | null
  videoType?: VideoSource | null
  markers: VideoMarkerRaw[]
  lang: Lang
  onVideoChange: (url: string | null, type: VideoSource | null) => void
  onMarkersChange: (markers: VideoMarkerRaw[]) => void
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

// Devuelve null si el texto no es un tiempo válido: así el que llama conserva
// el valor anterior en vez de mandar el marcador a 0:00.
function parseTimeInput(val: string): number | null {
  const raw = val.trim()
  if (!raw) return null
  const parts = raw.split(':').map((p) => Number(p.trim()))
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2]
  if (parts.length === 2) return (parts[0] * 60) + parts[1]
  if (parts.length === 1) return parts[0]
  return null
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
  const { t } = useTranslation()
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
            {(q[qField] as string) || t('admin.modules.vme.question_n', { n: index + 1 })}
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
              {t('admin.modules.vme.question_label', { lang: lang.toUpperCase() })}
            </label>
            <textarea
              value={q[qField] as string}
              onChange={(e) => onChange({ ...q, [qField]: e.target.value })}
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-[13px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none resize-none placeholder:text-text-subtle"
              placeholder={t('admin.modules.vme.ph_correct_answer')}
            />
          </div>

          <div>
            <label className="block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
              {t('admin.modules.vme.options_mark_correct')}
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
                      placeholder={t('admin.modules.vme.ph_option_letter', { letter })}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">
              {t('admin.modules.vme.explanation_label', { lang: lang.toUpperCase() })}
            </label>
            <textarea
              value={q[expField] as string}
              onChange={(e) => onChange({ ...q, [expField]: e.target.value })}
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-[13px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none resize-none placeholder:text-text-subtle"
              placeholder={t('admin.modules.vme.ph_why_correct')}
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
  getCurrentTime,
  onSave,
  onCancel,
}: {
  marker: VideoMarkerRaw
  lang: Lang
  videoDuration: number
  getCurrentTime: () => number
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
      // El marcador pudo escribirse en cualquier idioma (el contenido se genera en
      // el idioma de la interfaz), así que el origen se detecta y se traduce a los
      // otros dos, no siempre "del español a en/pt".
      const from = detectLang(Object.values(fields).join('\n'))
      const targets = (['es', 'en', 'pt'] as const).filter(l => l !== from)
      const res = await moduleAiAssist({ action: 'translate', contentType: 'meta', sourceLang: from, targetLangs: [...targets], fields })
      const data = res.data as Record<string, Record<string, string>>
      setDraft(p => {
        const updated = { ...p } as unknown as Record<string, unknown>
        for (const l of targets) {
          if (data[l]?.title) updated[`title_${l}`] = data[l].title
        }
        if (p.questions) {
          updated.questions = p.questions.map((q, i) => {
            const next = { ...q } as unknown as Record<string, unknown>
            for (const l of targets) {
              const d = data[l]
              if (!d) continue
              if (d[`q${i}`]) next[`question_${l}`] = d[`q${i}`]
              const opts = (q as unknown as Record<string, string[] | undefined>)[`options_${l}`] ?? ['', '', '', '']
              next[`options_${l}`] = opts.map((o, j) => d[`q${i}o${j}`] || o || '')
              if (d[`q${i}exp`]) next[`explanation_${l}`] = d[`q${i}exp`]
            }
            return next as unknown as typeof q
          })
        }
        return updated as unknown as VideoMarkerRaw
      })
    } catch {
      setTranslateError(t('common.translate_error'))
    } finally {
      setTranslating(false)
    }
  }
  const titleField = `title_${lang}` as 'title_es' | 'title_en' | 'title_pt'
  const [timeInput, setTimeInput] = useState(formatTime(draft.timeSeconds))

  // Tope: la duración real si ya se conoce (los videos embebidos la reportan
  // tarde), si no un techo alto para no recortar videos largos.
  const clampTime = (secs: number) =>
    Math.max(0, Math.min(Math.round(secs), videoDuration > 0 ? Math.floor(videoDuration) : 99999))

  // Un quiz demasiado al principio no se dispara (la detección es por cruce y el
  // video arranca en 0). No lo corregimos a la fuerza: se avisa aquí para que no
  // pase inadvertido, y el reproductor lo corre al mínimo como red de seguridad.
  const isQuiz = draft.type === 'quiz'
  const timeTooEarly = isQuiz && draft.timeSeconds < MIN_VIDEO_QUIZ_SECONDS

  // Lee el tiempo del cuadro de texto. Es la única fuente de verdad al guardar:
  // no se puede depender del onBlur, porque en varios navegadores el clic en
  // "Guardar" no quita el foco del input y el marcador se guardaba en 0:00.
  const timeFromInput = () => {
    const parsed = parseTimeInput(timeInput)
    return parsed === null ? draft.timeSeconds : clampTime(parsed)
  }

  const handleTimeChange = (val: string) => {
    setTimeInput(val)
    const parsed = parseTimeInput(val)
    if (parsed !== null) setDraft((p) => ({ ...p, timeSeconds: clampTime(parsed) }))
  }

  const handleTimeBlur = () => {
    const secs = timeFromInput()
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
      <div className="flex items-start gap-3">
        <div>
          <label className="block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">{t('admin.modules.vme.time')}</label>
          <input
            value={timeInput}
            onChange={(e) => handleTimeChange(e.target.value)}
            onBlur={handleTimeBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleTimeBlur() } }}
            className={cn(
              'w-24 rounded-lg px-2.5 py-1.5 text-[13px] text-text bg-glass/5 border outline-none font-mono',
              timeTooEarly
                ? 'border-amber-400/50 focus:border-amber-400'
                : 'border-glass-border/10 focus:border-neon-green/30',
            )}
            placeholder="0:00"
          />
          <button
            type="button"
            onClick={() => {
              const secs = clampTime(getCurrentTime())
              setDraft((p) => ({ ...p, timeSeconds: secs }))
              setTimeInput(formatTime(secs))
            }}
            className="mt-1 w-24 rounded-lg px-2 py-1 text-[10px] font-medium text-blue-400 border border-blue-400/20 hover:bg-blue-400/8 transition-colors"
          >
            {t('admin.modules.vme.use_current_time')}
          </button>
        </div>
        <div className="flex-1">
          <label className="block text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1">
            {t('admin.modules.vme.title_label', { lang: lang.toUpperCase() })}
          </label>
          <input
            value={draft[titleField]}
            onChange={(e) => setDraft((p) => ({ ...p, [titleField]: e.target.value }))}
            className="w-full rounded-lg px-2.5 py-1.5 text-[13px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none placeholder:text-text-subtle"
            placeholder={draft.type === 'chapter' ? t('admin.modules.vme.ph_chapter_name') : t('admin.modules.vme.ph_quiz_name')}
          />
        </div>
      </div>

      {/* Aviso: quiz demasiado al principio (no se le mostraría al aprendiz) */}
      {timeTooEarly && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/8 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[12px] text-amber-300 leading-snug">
              {t('admin.modules.vme.quiz_time_zero_warning', { s: MIN_VIDEO_QUIZ_SECONDS })}
            </p>
            <button
              type="button"
              onClick={() => {
                const secs = clampQuizTime(draft.timeSeconds, videoDuration)
                setDraft((p) => ({ ...p, timeSeconds: secs }))
                setTimeInput(formatTime(secs))
              }}
              className="mt-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-amber-300 border border-amber-400/30 hover:bg-amber-400/12 transition-colors"
            >
              {t('admin.modules.vme.quiz_time_zero_fix', { s: MIN_VIDEO_QUIZ_SECONDS })}
            </button>
          </div>
        </div>
      )}

      {/* Títulos en los otros dos idiomas */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{t('admin.modules.vme.other_langs')}</span>
          <button
            type="button"
            onClick={handleAutoTranslate}
            disabled={translating || !draft.title_es}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-blue-400 hover:bg-blue-400/8 border border-blue-400/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {translating
              ? <><Loader2 className="h-3 w-3 animate-spin" /> {t('admin.modules.vme.translating')}</>
              : <><Languages className="h-3 w-3" /> {t('admin.modules.vme.translate_ai')}</>}
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
                  {t('admin.modules.vme.title_label', { lang: l.toUpperCase() })}
                </label>
                <input
                  value={draft[f]}
                  onChange={(e) => setDraft((p) => ({ ...p, [f]: e.target.value }))}
                  className="w-full rounded-lg px-2.5 py-1.5 text-[12px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none placeholder:text-text-subtle"
                  placeholder={t('admin.modules.vme.ph_title_lang', { lang: l.toUpperCase() })}
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
              {t('admin.modules.vme.questions_count', { count: (draft.questions ?? []).length })}
            </label>
            <button
              type="button"
              onClick={addQuestion}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-blue-400 hover:bg-blue-400/8 transition-colors border border-blue-400/20"
            >
              <Plus className="h-3 w-3" /> {t('admin.modules.vme.add_question')}
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
              {t('admin.modules.vme.add_first_question')}
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
          <X className="h-3.5 w-3.5" /> {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => onSave({ ...draft, timeSeconds: timeFromInput() })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-neon-green bg-neon-green/8 border border-neon-green/20 hover:bg-neon-green/12 transition-colors"
        >
          <Check className="h-3.5 w-3.5" /> {t('common.save')}
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
  videoType,
  markers,
  lang,
  onVideoChange,
  onMarkersChange,
}: VideoMarkerEditorProps) {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const videoRef = useRef<PlayerLike | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  // Video elegido que ya está en otro módulo del curso: espera decisión.
  const [dup, setDup] = useState<{ file: File; hash: string | null; match: DuplicateMatch } | null>(null)
  const [videoDuration, setVideoDuration] = useState(0)
  // El modo 'youtube' cubre YouTube y Vimeo (autodetección al pegar la URL).
  const [videoMode, setVideoMode] = useState<VideoSource>(
    videoType === 'youtube' || videoType === 'vimeo' ? 'youtube' : 'video',
  )
  const [ytInput, setYtInput] = useState('')
  const isYouTube = videoType === 'youtube'
  const isVimeo = videoType === 'vimeo'
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
      // Igual que en el marcador suelto: el idioma de origen se detecta del texto,
      // porque la columna base ya no siempre trae español.
      const from = detectLang(Object.values(fields).join('\n'))
      const targets = (['es', 'en', 'pt'] as const).filter(l => l !== from)
      const res = await moduleAiAssist({ action: 'translate', contentType: 'meta', sourceLang: from, targetLangs: [...targets], fields })
      const data = res.data as Record<string, Record<string, string>>
      const updated = markers.map(m => {
        const idx = withEs.findIndex(x => x.id === m.id)
        if (idx === -1) return m
        const next = { ...m } as unknown as Record<string, unknown>
        for (const l of targets) {
          if (data[l]?.[`m${idx}_title`]) next[`title_${l}`] = data[l][`m${idx}_title`]
        }
        if (m.questions) {
          next.questions = m.questions.map((q, qi) => {
            const nq = { ...q } as unknown as Record<string, unknown>
            for (const l of targets) {
              const d = data[l]
              if (!d) continue
              if (d[`m${idx}q${qi}`]) nq[`question_${l}`] = d[`m${idx}q${qi}`]
              const opts = (q as unknown as Record<string, string[] | undefined>)[`options_${l}`] ?? ['', '', '', '']
              nq[`options_${l}`] = opts.map((o, oi) => d[`m${idx}q${qi}o${oi}`] || o || '')
              if (d[`m${idx}q${qi}exp`]) nq[`explanation_${l}`] = d[`m${idx}q${qi}exp`]
            }
            return nq as unknown as typeof q
          })
        }
        return next as unknown as VideoMarkerRaw
      })
      onMarkersChange(updated)
    } catch {
      setTranslateAllError(t('common.translate_error'))
    } finally {
      setTranslatingAll(false)
    }
  }

  const sortedMarkers = [...markers].sort((a, b) => a.timeSeconds - b.timeSeconds)

  // Quiz demasiado al principio: no se dispara y el aprendiz no ve la pregunta.
  const isTooEarly = (m: VideoMarkerRaw) => m.type === 'quiz' && m.timeSeconds < MIN_VIDEO_QUIZ_SECONDS
  const tooEarlyCount = markers.filter(isTooEarly).length

  const fixTooEarlyMarkers = () => {
    onMarkersChange(markers.map((m) => (
      isTooEarly(m) ? { ...m, timeSeconds: clampQuizTime(m.timeSeconds, videoDuration) } : m
    )))
  }

  const doUpload = async (file: File, hash: string | null) => {
    setDup(null)
    setUploading(true)
    setUploadError(null)
    try {
      const url = await uploadSectionMedia(file, campaignId, moduleId, sectionId, undefined, hash)
      onVideoChange(url, 'video')
    } catch {
      setUploadError(t('admin.modules.vme.video_upload_error'))
    } finally {
      setUploading(false)
    }
  }

  const handleFileSelect = async (file: File) => {
    if (!sectionId) {
      setUploadError(t('admin.modules.media_save_section_first'))
      return
    }
    if (!['video/mp4', 'video/webm', 'video/ogg'].includes(file.type)) {
      setUploadError(t('admin.modules.vme.video_only_formats'))
      return
    }
    // Tope de 50 MB: es el límite global de subida del proyecto Supabase (plan Free);
    // superarlo da 400. Para videos más pesados, usar YouTube.
    if (file.size > 50 * 1024 * 1024) {
      setUploadError(t('admin.modules.media_video_size_error'))
      return
    }
    setUploadError(null)
    setDup(null)

    // Un video de 50 MB duplicado en dos módulos del curso es el caso más caro
    // de todos: se pregunta antes de subirlo.
    setChecking(true)
    let hash: string | null = null
    try {
      hash = await shortFileHash(file)
      const match = await findDuplicateMedia(
        moduleId,
        { hash, filename: file.name, kind: 'video' },
        videoUrl ?? undefined,
      )
      if (match) { setDup({ file, hash, match }); return }
    } finally {
      setChecking(false)
    }
    await doUpload(file, hash)
  }

  const handleUseYouTube = () => {
    const ytId = extractYouTubeId(ytInput)
    const vmId = ytId ? null : extractVimeoId(ytInput)
    if (!ytId && !vmId) {
      setUploadError(t('admin.modules.media_youtube_invalid'))
      return
    }
    setUploadError(null)
    setVideoDuration(0)
    onVideoChange(ytId ?? vmId!, ytId ? 'youtube' : 'vimeo')
    setYtInput('')
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
          {t('admin.modules.vme.module_video')}
        </label>

        {videoUrl ? (
          <div className="rounded-2xl overflow-hidden border border-glass-border/10 bg-black">
            {isYouTube ? (
              <YouTubePlayer
                videoId={videoUrl}
                controls
                playerRef={videoRef}
                className="w-full aspect-video block"
                onReady={() => setVideoDuration(videoRef.current?.duration ?? 0)}
              />
            ) : isVimeo ? (
              <VimeoPlayer
                videoId={videoUrl}
                controls
                playerRef={videoRef}
                className="w-full aspect-video block"
                onReady={() => setVideoDuration(videoRef.current?.duration ?? 0)}
              />
            ) : (
              <video
                ref={(el) => { videoRef.current = el }}
                src={videoUrl}
                controls
                preload="metadata"
                className="w-full max-h-72 block"
                onLoadedMetadata={() => setVideoDuration(videoRef.current?.duration ?? 0)}
              />
            )}
          </div>
        ) : (
          <>
            {/* Selector de fuente: subir archivo o YouTube */}
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => { setVideoMode('video'); setUploadError(null) }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors',
                  videoMode === 'video'
                    ? 'text-blue-400 bg-blue-400/8 border-blue-400/25'
                    : 'text-text-muted glass border-glass-border/10 hover:text-text',
                )}
              >
                <Upload className="h-3.5 w-3.5" />
                {t('admin.modules.vme.upload_file')}
              </button>
              <button
                type="button"
                onClick={() => { setVideoMode('youtube'); setUploadError(null) }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors',
                  videoMode === 'youtube'
                    ? 'text-red-400 bg-red-400/8 border-red-400/25'
                    : 'text-text-muted glass border-glass-border/10 hover:text-text',
                )}
              >
                <Youtube className="h-3.5 w-3.5" />
                YouTube / Vimeo
              </button>
            </div>

            {videoMode === 'video' && dup ? (
              <DuplicateMediaNotice
                match={dup.match}
                onReuse={() => { onVideoChange(dup.match.use.url, 'video'); setDup(null) }}
                onUploadAnyway={() => doUpload(dup.file, dup.hash)}
                onCancel={() => setDup(null)}
              />
            ) : videoMode === 'video' ? (
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
                {uploading || checking ? (
                  <div className="flex items-center gap-2 text-text-muted text-[13px]">
                    <div className="h-4 w-4 border-2 border-blue-400/40 border-t-blue-400 rounded-full animate-spin" />
                    {checking ? t('admin.modules.dup.checking') : t('admin.modules.vme.uploading_video')}
                  </div>
                ) : (
                  <>
                    <Video className="h-8 w-8 text-text-subtle" />
                    <p className="text-[13px] text-text-muted text-center">
                      {t('admin.modules.vme.drag_video')}{' '}
                      <span className="text-blue-400 font-medium">{t('admin.modules.media_browse')}</span>
                    </p>
                    <p className="text-[11px] text-text-subtle">{t('admin.modules.vme.video_specs')}</p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    value={ytInput}
                    onChange={(e) => { setYtInput(e.target.value); setUploadError(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleUseYouTube() }}
                    placeholder={t('admin.modules.media_youtube_placeholder')}
                    className="flex-1 rounded-xl px-4 py-2.5 text-[13px] text-text bg-glass/8 border border-glass-border/10 outline-none focus:border-red-400/40 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handleUseYouTube}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium text-red-400 bg-red-400/8 border border-red-400/25 hover:bg-red-400/12 transition-colors shrink-0"
                  >
                    <Youtube className="h-4 w-4" />
                    {t('common.use')}
                  </button>
                </div>
                <p className="text-[11px] text-text-subtle">
                  {t('admin.modules.vme.youtube_hint')}
                </p>
              </div>
            )}
          </>
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
              onClick={() => onVideoChange(null, null)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-danger/70 hover:text-danger glass border border-glass-border/10 hover:bg-danger/6 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isYouTube || isVimeo ? t('admin.modules.vme.change_video') : t('admin.modules.vme.delete_video')}
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
            {t('admin.modules.vme.timeline_label')}
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
              {t('admin.modules.vme.legend_chapter')}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-text-subtle">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400 inline-block" />
              {t('admin.modules.vme.legend_quiz')}
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
            {t('admin.modules.vme.add_chapter')}
          </button>
          <button
            type="button"
            onClick={() => { setAddingType(null); handleAddMarker('quiz') }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-[12px] font-medium text-amber-400 bg-amber-400/8 border border-amber-400/20 hover:bg-amber-400/12 transition-colors"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            {t('admin.modules.vme.add_quiz')}
          </button>
          {videoDuration > 0 && videoRef.current && (
            <span className="flex items-center text-[11px] text-text-subtle ml-auto">
              {t('admin.modules.vme.current_time')} {formatTime(videoRef.current?.currentTime ?? 0)}
            </span>
          )}
        </div>
      )}

      {/* Lista de marcadores */}
      {sortedMarkers.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
              {t('admin.modules.vme.markers_count', { count: sortedMarkers.length })}
            </label>
            <button
              type="button"
              onClick={handleTranslateAllMarkers}
              disabled={translatingAll || !markers.some(m => m.title_es?.trim())}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-blue-400 hover:bg-blue-400/8 border border-blue-400/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {translatingAll
                ? <><Loader2 className="h-3 w-3 animate-spin" /> {t('admin.modules.vme.translating')}</>
                : <><Languages className="h-3 w-3" /> {t('admin.modules.vme.translate_all_ai')}</>}
            </button>
          </div>
          {translateAllError && (
            <p className="text-[11px] text-danger mb-2">{translateAllError}</p>
          )}
          {tooEarlyCount > 0 && (
            <div className="flex items-center gap-2.5 mb-2 rounded-xl border border-amber-400/30 bg-amber-400/8 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <p className="flex-1 text-[12px] text-amber-300 leading-snug">
                {t('admin.modules.vme.quiz_time_zero_banner', { count: tooEarlyCount })}
              </p>
              <button
                type="button"
                onClick={fixTooEarlyMarkers}
                className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium text-amber-300 border border-amber-400/30 hover:bg-amber-400/12 transition-colors"
              >
                {t('admin.modules.vme.quiz_time_zero_fix', { s: MIN_VIDEO_QUIZ_SECONDS })}
              </button>
            </div>
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
                  <span
                    className={cn(
                      'text-[11px] font-mono shrink-0 w-10',
                      isTooEarly(m) ? 'text-amber-400 font-semibold' : 'text-text-subtle',
                    )}
                    title={isTooEarly(m) ? t('admin.modules.vme.quiz_time_zero_warning', { s: MIN_VIDEO_QUIZ_SECONDS }) : undefined}
                  >
                    {formatTime(m.timeSeconds)}
                  </span>
                  {isTooEarly(m) && (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 -ml-1" />
                  )}
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
                      getCurrentTime={getCurrentTime}
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
          {t('admin.modules.vme.no_markers')}
        </div>
      )}
    </div>
  )
}
