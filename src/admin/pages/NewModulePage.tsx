import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, Clock, FileText, Loader2, Minus,
  Plus, RotateCcw, Sparkles, Upload, X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { createModule, saveGeneratedModule } from '@/services/modules.service'
import {
  addModuleToCourse,
  getCoursesForCampaign,
  getCourseById,
  type CourseWithModules,
} from '@/services/courses.service'
import { generateModule, type CacheUsage, type GeneratedModule } from '@/services/ai.service'
import { syncCourseWorldById } from '@/services/worlds.service'
import {
  extractDocumentText, ACCEPTED_DOC_EXTENSIONS,
  type ExtractStage, type ExtractedImage,
} from '@/lib/documentExtract'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import i18n from '@/i18n'
import { useTranslation } from 'react-i18next'
import { GenerationProgress, MODULE_GENERATION_STEPS } from '@/admin/components/GenerationProgress'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import type { Campaign } from '@/types/database'

// ─── Constants ────────────────────────────────────────────────

type Lang = 'es' | 'en' | 'pt'
type Mode = 'manual' | 'ai'

const ICONS = [
  '📚', '📖', '🎯', '💡', '🔧', '📊', '📱', '🤝',
  '💰', '🏆', '⭐', '🎓', '🧠', '🗣️', '📋', '✅',
  '🔑', '💼', '🌐', '🎤', '🚀', '🔍', '📝', '🎨',
  '⚡', '🛡️', '📡', '🧩', '🗂️', '🌟',
]

const LANG_LABELS: Record<Lang, string> = { es: 'ES', en: 'EN', pt: 'PT' }
const LANG_NAMES: Record<Lang, string> = { es: 'Español', en: 'English', pt: 'Português' }

const CACHE_KEY = 'ai_module_cache_expires'
const CACHE_DURATION_MS = 5 * 60 * 1000

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function formatMs(ms: number) {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ─── Cache timer hook ─────────────────────────────────────────

function useCacheTimer() {
  const [remaining, setRemaining] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const notifyCache = useCallback((usage: CacheUsage) => {
    if (usage.cache_creation_input_tokens > 0) {
      localStorage.setItem(CACHE_KEY, String(Date.now() + CACHE_DURATION_MS))
    }
  }, [])

  useEffect(() => {
    const tick = () => {
      const stored = localStorage.getItem(CACHE_KEY)
      if (!stored) { setRemaining(0); return }
      const rem = Number(stored) - Date.now()
      if (rem <= 0) {
        setRemaining(0)
        localStorage.removeItem(CACHE_KEY)
        if (intervalRef.current) clearInterval(intervalRef.current)
      } else {
        setRemaining(rem)
      }
    }
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  return { remaining, notifyCache }
}

// ─── Sub-components ───────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-widest text-text-subtle font-medium mb-3">
      {children}
    </p>
  )
}

function GlassInput({
  value, onChange, placeholder, required, maxLength,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  maxLength?: number
}) {
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        className={cn(
          'w-full rounded-xl px-4 py-3 text-[14px] text-text',
          'bg-glass/5 border border-glass-border/10',
          'focus:border-neon-green/30 focus:bg-glass/8 focus:outline-none',
          'placeholder:text-text-subtle transition-colors',
        )}
      />
      {maxLength && value.length > maxLength * 0.8 && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-text-subtle">
          {value.length}/{maxLength}
        </span>
      )}
    </div>
  )
}

function LangTabs({ active, onChange }: { active: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex gap-1 mb-3">
      {(['es', 'en', 'pt'] as Lang[]).map((lang) => (
        <button
          key={lang}
          type="button"
          onClick={() => onChange(lang)}
          className={cn(
            'px-3 py-1 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-all',
            active === lang
              ? 'bg-neon-green/15 text-neon-green border border-neon-green/25'
              : 'text-text-subtle hover:text-text border border-transparent',
          )}
        >
          {LANG_LABELS[lang]}
        </button>
      ))}
    </div>
  )
}

// ─── AI Mode ─────────────────────────────────────────────────

function AIModeForm({
  campaignId,
  campaigns,
  isSuperAdmin,
  courses,
  courseId,
  onSelectCampaign,
  onSelectCourse,
  onCreated,
}: {
  campaignId: string
  campaigns: Campaign[]
  isSuperAdmin: boolean
  courses: CourseWithModules[]
  courseId: string
  onSelectCampaign: (id: string) => void
  onSelectCourse: (id: string) => void
  onCreated: (moduleId: string) => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { remaining, notifyCache } = useCacheTimer()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [description, setDescription] = useState('')
  const [documentText, setDocumentText] = useState('')
  const [docMode, setDocMode] = useState<'none' | 'paste' | 'file'>('none')
  const [fileName, setFileName] = useState('')
  const [docImages, setDocImages] = useState<ExtractedImage[]>([])
  const [docContextImages, setDocContextImages] = useState<ExtractedImage[]>([])
  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState<{ stage: ExtractStage; ratio: number }>({ stage: 'reading', ratio: 0 })
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedModule | null>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setFileName(file.name)
    setDocMode('file')
    setDocImages([]); setDocContextImages([])
    setProgress({ stage: 'reading', ratio: 0 })
    setExtracting(true)
    try {
      const extracted = await extractDocumentText(file, (p) => setProgress(p))
      setDocumentText(extracted.text)
      setDocImages(extracted.images)
      setDocContextImages(extracted.contextImages)
    } catch (err) {
      setDocumentText(''); setFileName(''); setDocMode('none')
      setError(err instanceof Error ? err.message : 'No se pudo leer el archivo')
    } finally {
      setExtracting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const clearDocument = async () => {
    if (!(await confirmDialog({
      title: i18n.t('confirm.delete_media_title'),
      description: i18n.t('confirm.delete_media_desc'),
      confirmLabel: i18n.t('confirm.remove'),
    }))) return
    setDocumentText(''); setFileName(''); setDocMode('none')
    setDocImages([]); setDocContextImages([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleGenerate = async () => {
    if (!description.trim()) return
    setGenerating(true); setError(null); setGenerated(null)
    try {
      const result = await generateModule({
        description,
        documentText: documentText.trim() || undefined,
        images: docImages.length ? docImages : undefined,
        contextImages: docContextImages.length ? docContextImages : undefined,
      })
      setGenerated(result.data)
      notifyCache(result.usage)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  const handleCreate = async () => {
    if (!generated || !campaignId) return
    setSaving(true)
    try {
      const moduleId = await saveGeneratedModule(campaignId, generated)
      toast.success('Módulo creado. Abriendo editor...')
      await onCreated(moduleId)
    } catch (e) {
      toast.error(`Error: ${(e as Error).message}`)
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Campaña + curso destino */}
      <GlassCard intensity="subtle" padding="none" rounded="2xl" className="p-4 sm:p-8 space-y-5">
        {isSuperAdmin && campaigns.length > 0 && (
          <div>
            <SectionLabel>{t('admin.modules.new.campaign_target')}</SectionLabel>
            <FilterDropdown
              value={campaignId}
              onChange={onSelectCampaign}
              options={[
                { value: '', label: '— Seleccionar campaña —' },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
        )}
        <div>
          <SectionLabel>{t('admin.modules.new.course_target')}</SectionLabel>
          <FilterDropdown
            value={courseId}
            onChange={onSelectCourse}
            options={[
              { value: '', label: '— Sin curso (Plan general) —' },
              ...courses.map((c) => ({ value: c.id, label: c.title_es })),
            ]}
          />
        </div>
      </GlassCard>

      {/* Description input */}
      <GlassCard intensity="subtle" padding="none" rounded="2xl" className="p-4 sm:p-8">
        <div className="flex items-center justify-between mb-3">
          <SectionLabel>{t('admin.modules.new.what_learn')}</SectionLabel>
          {remaining > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-green/8 border border-brand-green/20 text-brand-green text-[10px] font-medium">
              <Clock className="h-3 w-3" />
              Caché · {formatMs(remaining)}
            </div>
          )}
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('admin.modules.new.ph_prompt')}
          rows={5}
          className={cn(
            'w-full rounded-xl px-4 py-3 text-[14px] text-text resize-none',
            'bg-glass/5 border border-glass-border/10',
            'focus:border-brand-violet/30 focus:bg-glass/8 focus:outline-none',
            'placeholder:text-text-subtle transition-colors leading-relaxed',
          )}
        />

        {/* Document attachment */}
        <div className="mt-4 pt-4 border-t border-glass-border/8">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] text-text-muted font-medium">
              {t('admin.modules.new.source_document')} <span className="text-text-subtle font-normal">{t('admin.modules.new.optional_file')}</span>
            </span>
            {(documentText || fileName) && (
              <button
                onClick={clearDocument}
                className="flex items-center gap-1 text-[11px] text-text-muted hover:text-danger transition-colors"
              >
                <X className="h-3 w-3" /> Quitar
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDocMode(docMode === 'paste' ? 'none' : 'paste')}
              disabled={extracting}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 min-h-[36px] rounded-xl text-[12px] border transition-all disabled:opacity-50',
                docMode === 'paste'
                  ? 'border-brand-violet/30 bg-brand-violet/8 text-brand-violet'
                  : 'border-glass-border/10 text-text-muted hover:text-text hover:border-glass-border/25',
              )}
            >
              <FileText className="h-3.5 w-3.5" /> Pegar texto
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={extracting}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 min-h-[36px] rounded-xl text-[12px] border transition-all disabled:opacity-50',
                docMode === 'file' && fileName
                  ? 'border-brand-violet/30 bg-brand-violet/8 text-brand-violet'
                  : 'border-glass-border/10 text-text-muted hover:text-text hover:border-glass-border/25',
              )}
            >
              <Upload className="h-3.5 w-3.5" /> Subir archivo
            </button>
            <input ref={fileInputRef} type="file" accept={ACCEPTED_DOC_EXTENSIONS} className="hidden" onChange={handleFileUpload} />
          </div>
          <AnimatePresence>
            {extracting && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2.5 rounded-xl bg-brand-violet/6 border border-brand-violet/15 px-3 py-3">
                  <div className="flex items-center gap-3">
                    <div className="relative h-8 w-8 shrink-0 flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-brand-violet/70" />
                      <FileText className="absolute h-3.5 w-3.5 text-brand-violet" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-text font-medium truncate">{fileName}</div>
                      <div className="text-[11px] text-text-muted">{t(`admin.import.stage_${progress.stage}`)}</div>
                    </div>
                    <span className="text-[12px] font-semibold text-brand-violet tabular-nums shrink-0">
                      {Math.round(progress.ratio * 100)}%
                    </span>
                  </div>
                  <div className="mt-2.5 h-1.5 w-full rounded-full bg-glass/10 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-brand-violet"
                      initial={false}
                      animate={{ width: `${Math.max(4, progress.ratio * 100)}%` }}
                      transition={{ ease: 'easeOut', duration: 0.3 }}
                    />
                  </div>
                </div>
              </motion.div>
            )}
            {docMode === 'paste' && !extracting && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <textarea
                  value={documentText}
                  onChange={(e) => setDocumentText(e.target.value)}
                  placeholder={t('admin.modules.new.ph_paste_doc')}
                  rows={5}
                  className={cn(
                    'w-full mt-2.5 rounded-xl px-4 py-3 text-[13px] text-text resize-none',
                    'bg-glass/5 border border-glass-border/10',
                    'focus:border-brand-violet/30 focus:outline-none',
                    'placeholder:text-text-subtle transition-colors',
                  )}
                />
              </motion.div>
            )}
            {docMode === 'file' && fileName && !extracting && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-2.5 flex items-center gap-2 text-[12px] text-brand-violet px-3 py-2 rounded-xl bg-brand-violet/6 border border-brand-violet/15"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {fileName} — {(documentText.length / 1000).toFixed(1)}k caracteres
                  {docImages.length > 0 && ` · ${docImages.length} figura(s)`}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </GlassCard>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-xl px-4 py-3 text-[13px] text-danger bg-danger/8 border border-danger/20"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generation progress */}
      <GenerationProgress
        steps={MODULE_GENERATION_STEPS}
        active={generating}
        title={t('admin.modules.new.title_generating')}
      />

      {/* Preview */}
      <AnimatePresence>
        {generated && !generating && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <GlassCard intensity="subtle" padding="none" rounded="2xl" className="p-4 sm:p-8 border border-brand-violet/15">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-brand-green animate-pulse" />
                  <span className="text-[12px] font-semibold text-text">{t('admin.modules.new.ready_to_create')}</span>
                </div>
                <button
                  onClick={handleGenerate}
                  className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text transition-colors px-2 py-1 rounded-lg hover:bg-glass/8"
                >
                  <RotateCcw className="h-3 w-3" /> Regenerar
                </button>
              </div>

              {/* Module header */}
              <div className="flex items-start gap-3 mb-4 p-3 rounded-xl bg-glass/4 border border-glass-border/8">
                <span className="text-3xl leading-none">{generated.metadata.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-text leading-snug">
                    {generated.metadata.title_es}
                  </p>
                  <p className="text-[12px] text-text-muted mt-0.5 leading-snug">
                    {generated.metadata.subtitle_es}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <NeonBadge color="cyan" className="text-[9px]">
                      {generated.metadata.duration_min} min
                    </NeonBadge>
                    <span className="text-[10px] font-mono text-text-subtle">
                      {generated.metadata.slug}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sections list */}
              <div className="space-y-1.5 mb-4">
                <p className="text-[10px] uppercase tracking-widest text-text-subtle font-semibold mb-2">
                  {generated.sections.length} secciones generadas
                </p>
                {generated.sections.map((s, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-2 px-3 rounded-xl bg-glass/3 border border-glass-border/6">
                    <span className="text-[10px] font-mono text-text-subtle w-4 shrink-0 text-right">{i + 1}</span>
                    <span className="text-[12px] text-text flex-1 truncate">{s.heading_es}</span>
                    <span className="text-[9px] text-text-subtle shrink-0">
                      {s.blocks?.length ?? 0} bloques
                    </span>
                  </div>
                ))}
              </div>

              {/* Objectives preview */}
              {generated.metadata.objectives_es?.length > 0 && (
                <div className="mb-5">
                  <p className="text-[10px] uppercase tracking-widest text-text-subtle font-semibold mb-2">
                    Objetivos
                  </p>
                  <ul className="space-y-1">
                    {generated.metadata.objectives_es.slice(0, 3).map((obj, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px] text-text-muted">
                        <span className="text-brand-green shrink-0">✓</span> {obj}
                      </li>
                    ))}
                    {generated.metadata.objectives_es.length > 3 && (
                      <li className="text-[10px] text-text-subtle ml-4">
                        +{generated.metadata.objectives_es.length - 3} más...
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action buttons */}
      <motion.div
        layout
        className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-1"
      >
        <Link to="/admin/modules">
          <Button type="button" variant="ghost" size="md" className="w-full sm:w-auto">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Cancelar
          </Button>
        </Link>

        {!generated ? (
          <Button
            type="button"
            variant="neon"
            size="md"
            disabled={!description.trim() || !campaignId || generating}
            onClick={handleGenerate}
            className="w-full sm:w-auto sm:min-w-[180px] flex items-center justify-center gap-2"
          >
            {generating ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> {t('admin.modules.new.generating')}</>
            ) : (
              <><Sparkles className="h-4 w-4" /> {t('admin.modules.new.generate_module')}</>
            )}
          </Button>
        ) : (
          <Button
            type="button"
            variant="neon"
            size="md"
            disabled={saving || !campaignId}
            onClick={handleCreate}
            className="w-full sm:w-auto sm:min-w-[200px] flex items-center justify-center gap-2"
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> {t('admin.modules.new.creating_module')}</>
            ) : (
              <>{t('admin.modules.new.create_open_editor')} <ChevronRight className="h-4 w-4" /></>
            )}
          </Button>
        )}
      </motion.div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────

export default function NewModulePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { campaignId: authCampaignId, isSuperAdmin } = useAuth()

  // Modo inicial: ?mode=ai abre directo en "Generar con IA" (p. ej. desde el curso).
  const [mode, setMode] = useState<Mode>(searchParams.get('mode') === 'ai' ? 'ai' : 'manual')
  const [icon, setIcon] = useState('📚')
  const [titleLang, setTitleLang] = useState<Lang>('es')
  const [title, setTitle] = useState<Record<Lang, string>>({ es: '', en: '', pt: '' })
  const [subtitleLang, setSubtitleLang] = useState<Lang>('es')
  const [subtitle, setSubtitle] = useState<Record<Lang, string>>({ es: '', en: '', pt: '' })
  const [duration, setDuration] = useState(30)
  const [campaignId, setCampaignId] = useState(authCampaignId ?? '')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [courseId, setCourseId] = useState('')
  const [courses, setCourses] = useState<CourseWithModules[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuperAdmin) return
    supabase.from('campaigns').select('*').order('name').then(({ data }) => {
      setCampaigns(data ?? [])
      if (!campaignId && data?.[0]) setCampaignId(data[0].id)
    })
  }, [isSuperAdmin, campaignId])

  // Si llegamos desde el editor de un curso (?courseId=), fijar ese curso y su campaña.
  useEffect(() => {
    const qsCourse = searchParams.get('courseId')
    if (!qsCourse) return
    getCourseById(qsCourse)
      .then((c) => {
        if (c) {
          setCampaignId(c.campaign_id)
          setCourseId(c.id)
        }
      })
      .catch(() => {})
  }, [searchParams])

  // Cursos de la campaña seleccionada (para elegir el curso destino del módulo).
  useEffect(() => {
    if (!campaignId) {
      setCourses([])
      return
    }
    getCoursesForCampaign(campaignId)
      .then((cs) => {
        setCourses(cs)
        setCourseId((prev) => (prev && cs.some((c) => c.id === prev) ? prev : ''))
      })
      .catch(() => setCourses([]))
  }, [campaignId])

  const attachToCourse = async (moduleId: string) => {
    if (!courseId) return
    try {
      const target = courses.find((c) => c.id === courseId)
      const maxOrder = target ? Math.max(0, ...target.modules.map((m) => m.course_sort_order)) : 0
      await addModuleToCourse(courseId, moduleId, maxOrder + 1)
      // Solo sincroniza la estructura del mundo si el curso YA tiene uno (opt-in).
      // La región nueva queda sin niveles; se generan al activar/sincronizar el
      // mundo desde el editor del curso, cuando haya contenido.
      await syncCourseWorldById(courseId, { createIfMissing: false }).catch(() => {})
    } catch {
      /* si falla el adjuntar, el módulo igual queda creado (suelto) */
    }
  }

  // Crea/adjunta y abre el editor. Compartido por modo manual e IA.
  const handleCreated = async (moduleId: string) => {
    await attachToCourse(moduleId)
    navigate(`/admin/modules/${moduleId}`)
  }

  const canCreate = title.es.trim().length > 0 && campaignId
  const adjustDuration = (delta: number) =>
    setDuration((prev) => Math.min(240, Math.max(5, prev + delta)))

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canCreate) return
    setSaving(true)
    setError(null)
    try {
      const slug = slugify(title.es) || `modulo-${Date.now()}`
      const { id } = await createModule(campaignId, {
        slug,
        icon,
        duration_min: duration,
        title_es: title.es.trim(),
        title_en: title.en.trim() || null,
        title_pt: title.pt.trim() || null,
        subtitle_es: subtitle.es.trim() || null,
        subtitle_en: subtitle.en.trim() || null,
        subtitle_pt: subtitle.pt.trim() || null,
      })
      await handleCreated(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el módulo')
      setSaving(false)
    }
  }

  const fadeUp = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } }

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto">
      {/* Header */}
      <motion.div {...fadeUp} transition={{ duration: 0.3 }} className="mb-6 sm:mb-8">
        <Link
          to="/admin/modules"
          className="inline-flex items-center gap-1.5 text-[12px] text-text-subtle hover:text-text transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Volver a módulos
        </Link>
        <p className="text-[11px] text-text-subtle uppercase tracking-wider mb-2">
          Admin / Módulos / Nuevo
        </p>
        <GradientHeading as="h1" variant="white" size="headline">
          Crear módulo
        </GradientHeading>
        <p className="text-text-muted text-[13px] mt-1">
          Completa la información manualmente o deja que la IA genere el módulo completo.
        </p>
      </motion.div>

      {/* Mode switcher */}
      <motion.div {...fadeUp} transition={{ duration: 0.3, delay: 0.04 }} className="mb-6">
        <div className="flex gap-2 p-1.5 rounded-2xl glass border border-glass-border/10 w-fit">
          <button
            onClick={() => setMode('manual')}
            className={cn(
              'px-5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200',
              mode === 'manual'
                ? 'bg-glass-border/12 text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            )}
          >
            Manual
          </button>
          <button
            onClick={() => setMode('ai')}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200',
              mode === 'ai'
                ? 'bg-brand-violet/12 text-brand-violet border border-brand-violet/20'
                : 'text-text-muted hover:text-text',
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generar con IA
          </button>
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {mode === 'manual' ? (
          <motion.form
            key="manual"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2 }}
            onSubmit={handleCreate}
            className="space-y-5"
          >
            {/* ── Identidad visual ── */}
            <GlassCard intensity="subtle" padding="none" rounded="2xl" className="p-4 sm:p-8">
              <SectionLabel>{t('admin.modules.new.visual_identity')}</SectionLabel>
              <div className="flex flex-col items-center mb-5">
                <div className={cn(
                  'w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mb-4',
                  'bg-glass/6 border border-glass-border/10 shadow-inner',
                )}>
                  {icon}
                </div>
                <div className="grid grid-cols-6 sm:grid-cols-10 gap-1.5">
                  {ICONS.map((emoji, i) => (
                    <button
                      key={`${i}-${emoji}`}
                      type="button"
                      onClick={() => setIcon(emoji)}
                      className={cn(
                        'w-8 h-8 rounded-lg text-lg flex items-center justify-center transition-all hover:bg-glass/10',
                        icon === emoji ? 'bg-neon-green/15 ring-1 ring-neon-green/40 scale-110' : 'bg-glass/4',
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[12px] font-medium text-text-muted">
                    Título <span className="text-danger">*</span>
                  </label>
                  <LangTabs active={titleLang} onChange={setTitleLang} />
                </div>
                <GlassInput
                  key={`title-${titleLang}`}
                  value={title[titleLang]}
                  onChange={(v) => setTitle((prev) => ({ ...prev, [titleLang]: v }))}
                  placeholder={
                    titleLang === 'es'
                      ? 'Ej: Introducción a Ventas Consultivas'
                      : `Título en ${LANG_NAMES[titleLang]} (opcional)`
                  }
                  required={titleLang === 'es'}
                  maxLength={120}
                />
                {titleLang !== 'es' && (
                  <p className="text-[11px] text-text-subtle mt-1.5">
                    Si lo dejas vacío, se mostrará el título en español.
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[12px] font-medium text-text-muted">
                    {t('admin.modules.new.subtitle')} <span className="text-text-subtle text-[11px]">{t('admin.modules.new.optional')}</span>
                  </label>
                  <LangTabs active={subtitleLang} onChange={setSubtitleLang} />
                </div>
                <GlassInput
                  key={`subtitle-${subtitleLang}`}
                  value={subtitle[subtitleLang]}
                  onChange={(v) => setSubtitle((prev) => ({ ...prev, [subtitleLang]: v }))}
                  placeholder={
                    subtitleLang === 'es'
                      ? 'Ej: Aprende a conectar con el cliente desde la empatía'
                      : `Subtítulo en ${LANG_NAMES[subtitleLang]}`
                  }
                  maxLength={200}
                />
              </div>
            </GlassCard>

            {/* ── Configuración ── */}
            <GlassCard intensity="subtle" padding="none" rounded="2xl" className="p-4 sm:p-8">
              <SectionLabel>{t('admin.modules.new.config')}</SectionLabel>

              <div className="mb-5">
                <label className="text-[12px] font-medium text-text-muted block mb-3">
                  Duración estimada
                </label>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => adjustDuration(-5)}
                    disabled={duration <= 5}
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center transition-all',
                      'bg-glass/5 border border-glass-border/10 hover:bg-glass/10',
                      'disabled:opacity-30 disabled:cursor-not-allowed',
                    )}
                  >
                    <Minus className="h-4 w-4 text-text" />
                  </button>
                  <div className="flex-1 text-center">
                    <span className="text-[32px] font-bold text-text tabular-nums">{duration}</span>
                    <span className="text-[13px] text-text-muted ml-2">{t('admin.modules.new.min')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => adjustDuration(5)}
                    disabled={duration >= 240}
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center transition-all',
                      'bg-glass/5 border border-glass-border/10 hover:bg-glass/10',
                      'disabled:opacity-30 disabled:cursor-not-allowed',
                    )}
                  >
                    <Plus className="h-4 w-4 text-text" />
                  </button>
                </div>
                <input
                  type="range" min={5} max={240} step={5} value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full mt-3 accent-neon-green h-1 rounded-full cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-text-subtle mt-1">
                  <span>{t('admin.modules.new.five_min')}</span><span>{t('admin.modules.new.four_h')}</span>
                </div>
              </div>

              {isSuperAdmin && campaigns.length > 0 && (
                <div>
                  <label className="text-[12px] font-medium text-text-muted block mb-2">{t('admin.modules.new.campaign')}</label>
                  <FilterDropdown
                    value={campaignId}
                    onChange={setCampaignId}
                    options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
                  />
                </div>
              )}

              <div className={cn(isSuperAdmin && campaigns.length > 0 && 'mt-5')}>
                <label className="text-[12px] font-medium text-text-muted block mb-2">
                  Curso destino
                </label>
                <FilterDropdown
                  value={courseId}
                  onChange={setCourseId}
                  options={[
                    { value: '', label: '— Sin curso (Plan general) —' },
                    ...courses.map((c) => ({ value: c.id, label: c.title_es })),
                  ]}
                />
                <p className="text-[11px] text-text-subtle mt-1.5">
                  El módulo se agregará a este curso. Puedes cambiarlo luego desde el curso.
                </p>
              </div>
            </GlassCard>

            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="rounded-xl px-4 py-3 text-[13px] text-danger bg-danger/8 border border-danger/20"
              >
                {error}
              </motion.div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Link to="/admin/modules">
                <Button type="button" variant="ghost" size="md">
                  <ArrowLeft className="h-4 w-4 mr-1.5" /> Cancelar
                </Button>
              </Link>
              <Button
                type="submit"
                variant="neon"
                size="md"
                disabled={!canCreate || saving}
                className="min-w-[160px] flex items-center justify-center gap-2"
              >
                {saving
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('admin.modules.new.creating')}</>
                  : <>{t('admin.modules.new.create_module')} <ChevronRight className="h-4 w-4" /></>
                }
              </Button>
            </div>
          </motion.form>
        ) : (
          <motion.div
            key="ai"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.2 }}
          >
            <AIModeForm
              campaignId={campaignId}
              campaigns={campaigns}
              isSuperAdmin={isSuperAdmin}
              courses={courses}
              courseId={courseId}
              onSelectCampaign={setCampaignId}
              onSelectCourse={setCourseId}
              onCreated={handleCreated}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
