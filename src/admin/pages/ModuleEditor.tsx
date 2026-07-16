import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  BookOpen,
  Columns2,
  Eye,
  EyeOff,
  HelpCircle,
  Image,
  Layers,
  Lightbulb,
  Loader2,
  Menu,
  Plus,
  Save,
  Sparkle,
  Square,
  Star,
  Trash2,
  Volume2,
  X,
  ZoomIn,
  ArrowDownUp,
} from 'lucide-react'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import {
  getModuleWithSectionsRaw,
  updateModuleMetadata,
  upsertSection,
  deleteSection,
  toggleModulePublished,
  upsertSectionQuiz,
  deleteSectionQuiz,
  type DbModuleRow,
  type DbModuleWithSections,
  type DbSectionRow,
  type DbQuizRow,
} from '@/services/modules.service'
import { invalidateModulesCache } from '@/hooks/useModules'
import { MediaUploader } from '@/admin/components/MediaUploader'
import { VideoMarkerEditor } from '@/admin/components/VideoMarkerEditor'
import { SortableItem } from '@/admin/components/SortableSectionList'
import { SectionTemplateGallery } from '@/admin/components/SectionTemplateGallery'
import type { SectionTemplate } from '@/admin/components/AddSectionMenu'
import type { VideoMarkerRaw } from '@/services/modules.service'
import { GlassCard } from '@/components/ui/GlassCard'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { QUIZ_SOUND_THEMES, playQuizSound } from '@/lib/sound'
import { BlockEditor } from '@/admin/components/BlockEditor'
import { SortGameEditor } from '@/components/modules/blocks/SortGameEditor'
import { ModuleAIPanel } from '@/admin/components/ModuleAIPanel'
import { ClassifyGameEditor } from '@/components/modules/blocks/ClassifyGameEditor'
import { useEditingPresence } from '@/hooks/usePresence'
import { usePresenceStore } from '@/stores/presenceStore'
import { PresenceStack } from '@/components/presence/PresenceStack'
import { EditingBanner } from '@/components/presence/EditingBanner'
import type { GameClassifyBlock } from '@/types/blocks' // Importamos el tipo del bloque nuevo
import type { BlockWithId, ContentBlock, GameSortBlock } from '@/types/blocks'
import { toast } from '@/stores/toastStore'

// ─── Tipos ────────────────────────────────────────────────────

type Lang = 'es' | 'en' | 'pt'
type SectionStyleOption = 'default' | 'immersive' | 'side-by-side' | 'hero' | 'spotlight' | 'feature' | 'video-interactive' | 'game-sort' | 'game-classify'
type MediaType = 'image' | 'youtube' | 'video'
type MediaSize = 'sm' | 'md' | 'lg' | 'full' | 'bleed'
type MediaAlign = 'left' | 'center' | 'right'
type CalloutKind = 'tip' | 'important' | 'warning' | 'success' | 'quote' | 'note'

const MEDIA_SIZES: { value: MediaSize; label: string }[] = [
  { value: 'sm', label: 'SM' },
  { value: 'md', label: 'MD' },
  { value: 'lg', label: 'LG' },
  { value: 'full', label: 'Full' },
  { value: 'bleed', label: 'Bleed' },
]

// ─── Componentes UI pequeños reutilizables ─────────────────────

function LangTabs({
  active,
  onChange,
  hasContent,
}: {
  active: Lang
  onChange: (l: Lang) => void
  hasContent?: Partial<Record<Lang, boolean>>
}) {
  return (
    <div className="flex gap-1 p-1 rounded-lg glass w-fit">
      {(['es', 'en', 'pt'] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={cn(
            'relative px-3 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wider transition-all duration-200',
            active === l
              ? 'bg-neon-green/10 border border-neon-green/20 text-neon-green'
              : 'text-text-muted hover:text-text border border-transparent',
          )}
        >
          {l}
          {hasContent?.[l] && (
            <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-neon-green" />
          )}
        </button>
      ))}
    </div>
  )
}

function GroupDivider({
  label,
  enabled,
  onToggle,
}: {
  label: string
  enabled?: boolean
  onToggle?: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-text-subtle shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-glass-border/8" />
      {onToggle !== undefined && enabled !== undefined && (
        <div
          onClick={() => onToggle(!enabled)}
          className={cn(
            'relative h-5 w-9 rounded-full transition-all duration-300 shrink-0 cursor-pointer',
            enabled ? 'bg-neon-green' : 'bg-glass-border/15 border border-glass-border/10',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-300',
              enabled ? 'left-4' : 'left-0.5',
            )}
          />
        </div>
      )}
    </div>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="block text-[11px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
      {children}
    </label>
  )
}

function GlassInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        'w-full rounded-xl px-4 py-2.5 text-[14px] text-text',
        'bg-glass/5 border border-glass-border/10',
        'focus:border-neon-green/30 focus:bg-glass/8 outline-none',
        'placeholder:text-text-subtle transition-all duration-200',
        className,
      )}
    />
  )
}

function GlassTextarea({
  value,
  onChange,
  rows = 5,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      placeholder={placeholder}
      className={cn(
        'w-full rounded-xl px-4 py-2.5 text-[14px] text-text resize-y',
        'bg-glass/5 border border-glass-border/10',
        'focus:border-neon-green/30 focus:bg-glass/8 outline-none',
        'placeholder:text-text-subtle transition-all duration-200 font-mono leading-relaxed',
      )}
    />
  )
}

function GlassToggle({
  checked,
  onChange,
  label,
  subtitle,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  subtitle?: string
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 rounded-full transition-all duration-300 flex-shrink-0',
          checked ? 'bg-neon-green shadow-neon-green' : 'glass border-glass-border/15',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-300',
            checked ? 'left-4' : 'left-0.5',
          )}
        />
      </div>
      <div>
        <div className="text-[13px] font-medium text-text">{label}</div>
        {subtitle && <div className="text-[11px] text-text-subtle">{subtitle}</div>}
      </div>
    </label>
  )
}

// ─── Panel editor de sección ─────────────────────────────────

interface SectionEditorPanelProps {
  section: DbSectionRow
  campaignId: string
  moduleTitle?: string
  onSaved: (updated: DbSectionRow) => void
  onDirty: (dirty: boolean) => void
  onRegisterSave: (fn: (() => void) | null) => void
}

function GameSortEditorWrapper({
  section,
  heading,
  language, // 🌟 Sincronizado con el estándar del ingeniero
  onBlockChange,
}: {
  section: DbSectionRow
  heading: Record<string, string>
  language: string
  onBlockChange: (updated: GameSortBlock) => void
}) {
  const { t } = useTranslation()
  const getInitialBlock = (): GameSortBlock => {
    if (section.blocks_data && Array.isArray(section.blocks_data)) {
      const first = section.blocks_data[0] as any
      if (first?.type === 'game-sort') return first
    }
      return {
      type: 'game-sort' as const,
      title: { es: heading.es, en: heading.en, pt: heading.pt },
      instructions: { es: '', en: '', pt: '' },
      processes: [{
        id: 'process-1',
        title: { es: heading.es, en: heading.en, pt: heading.pt },
        steps: [],
        feedback_correct: { es: '', en: '', pt: '' },
        feedback_wrong: { es: '', en: '', pt: '' },
      }],
    }
  }

  const [localBlock, setLocalBlock] = useState<GameSortBlock>(getInitialBlock)

  const handleChange = (updated: GameSortBlock) => {
    setLocalBlock(updated)
    onBlockChange(updated)
  }

  return (
    <div className="space-y-4">
      <GroupDivider label={t('admin.modules.ed_group_game_sort')} />
      <SortGameEditor
        block={localBlock}
        lang={language as any} // Pasa el parámetro de idioma correcto
        onChange={handleChange}
      />
    </div>
  )
}

function SectionEditorPanel({
  section,
  campaignId,
  moduleTitle,
  onSaved,
  onDirty,
  onRegisterSave,
}: SectionEditorPanelProps) {
  const { t } = useTranslation()
  const sectionStyles = useMemo(() => [
    { value: 'default' as SectionStyleOption,      label: t('admin.modules.style_default'),      Icon: Square },
    { value: 'immersive' as SectionStyleOption,    label: t('admin.modules.style_immersive'),    Icon: Sparkle },
    { value: 'side-by-side' as SectionStyleOption, label: t('admin.modules.style_side_by_side'), Icon: Columns2 },
    { value: 'hero' as SectionStyleOption,          label: t('admin.modules.style_hero'),         Icon: ZoomIn },
    { value: 'spotlight' as SectionStyleOption,    label: t('admin.modules.style_spotlight'),    Icon: Star },
    { value: 'feature' as SectionStyleOption,      label: t('admin.modules.style_feature'),      Icon: Layers },
    { value: 'game-sort' as SectionStyleOption,    label: t('admin.modules.style_game_sort'),    Icon: ArrowDownUp }, 
    { value: 'game-classify' as SectionStyleOption, label: 'Clasificar Casos', Icon: Layers },  
  ], [t])
  const [lang, setLang] = useState<Lang>('es')
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'ok'>('idle')
  const [error, setError] = useState<string | null>(null)
  
  const [blocks, setBlocks] = useState<BlockWithId[]>(() => {
    if (!section.blocks_data || !Array.isArray(section.blocks_data)) return []
    return section.blocks_data.map((data, i) => ({ id: (data as any).id || `loaded-${i}-${Date.now()}`, data: data as ContentBlock }))
  })
  
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSaveRef2 = useRef<(() => Promise<void>) | null>(null)

  // Contenido
  const [heading, setHeading] = useState<Record<Lang, string>>({
    es: section.heading_es,
    en: section.heading_en ?? '',
    pt: section.heading_pt ?? '',
  })
  const [body, setBody] = useState<Record<Lang, string>>({
    es: (section.body_es ?? []).join('\n\n'),
    en: (section.body_en ?? section.body_es ?? []).join('\n\n'),
    pt: (section.body_pt ?? section.body_es ?? []).join('\n\n'),
  })
  const [sectionStyle, setSectionStyle] = useState<SectionStyleOption>(
    (section.section_style as SectionStyleOption) ?? 'default',
  )

  // Callout
  const [hasCallout, setHasCallout] = useState(!!section.callout_kind)
  const [calloutKind, setCalloutKind] = useState<CalloutKind>(section.callout_kind ?? 'tip')
  const [callout, setCallout] = useState<Record<Lang, string>>({
    es: section.callout_es ?? '',
    en: section.callout_en ?? '',
    pt: section.callout_pt ?? '',
  })

  // Media
  const [hasMedia, setHasMedia] = useState(!!(section.media_type && section.media_url))
  const [mediaType, setMediaType] = useState<MediaType | null>(section.media_type ?? null)
  const [mediaUrl, setMediaUrl] = useState<string | null>(section.media_url ?? null)
  const [mediaCaption, setMediaCaption] = useState<Record<Lang, string>>({
    es: section.media_caption_es ?? '',
    en: section.media_caption_en ?? '',
    pt: section.media_caption_pt ?? '',
  })
  const [mediaSize, setMediaSize] = useState<MediaSize>(section.media_size ?? 'full')
  const [mediaAlign, setMediaAlign] = useState<MediaAlign>(section.media_align ?? 'center')
  const [mediaShadow, setMediaShadow] = useState(section.media_shadow ?? false)

  // Marcadores de video
  const [videoMarkers, setVideoMarkers] = useState<VideoMarkerRaw[]>(
    () => Array.isArray(section.video_markers) ? (section.video_markers as VideoMarkerRaw[]) : [],
  )

  // Quiz
  const quiz = section.section_quizzes?.[0] ?? null
  const [hasQuiz, setHasQuiz] = useState(!!quiz)
  const [question, setQuestion] = useState<Record<Lang, string>>({
    es: quiz?.question_es ?? '',
    en: quiz?.question_en ?? '',
    pt: quiz?.question_pt ?? '',
  })
  const [options, setOptions] = useState<Record<Lang, string[]>>({
    es: quiz?.options_es ?? ['', '', '', ''],
    en: quiz?.options_en ?? quiz?.options_es ?? ['', '', '', ''],
    pt: quiz?.options_pt ?? quiz?.options_es ?? ['', '', '', ''],
  })
  const [correctIndex, setCorrectIndex] = useState(quiz?.correct_index ?? 0)
  const [explanation, setExplanation] = useState<Record<Lang, string>>({
    es: quiz?.explanation_es ?? '',
    en: quiz?.explanation_en ?? '',
    pt: quiz?.explanation_pt ?? '',
  })

  const parseParagraphs = (text: string): string[] =>
    text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  const isFirstRender = useRef(true)
  useEffect(() => {
    if (!isFirstRender.current) {
      onDirty(true)
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
      setAutoSaveStatus('idle')
      autoSaveTimerRef.current = setTimeout(() => {
        if (handleSaveRef2.current) {
          setAutoSaveStatus('saving')
          void handleSaveRef2.current().then(() => {
            setAutoSaveStatus('ok')
            setTimeout(() => setAutoSaveStatus('idle'), 2000)
          })
        }
      }, 1500)
    }
    isFirstRender.current = false
  }, [heading, body, sectionStyle, hasCallout, calloutKind, callout, hasMedia, mediaType, mediaUrl, mediaCaption, mediaSize, mediaAlign, mediaShadow, blocks])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaveOk(false)
    try {
      const isVideoInteractive = sectionStyle === 'video-interactive'
      const saved = await upsertSection({
        id: section.id,
        module_id: section.module_id,
        sort_order: section.sort_order,
        heading_es: heading.es,
        heading_en: heading.en || null,
        heading_pt: heading.pt || null,
        body_es: isVideoInteractive ? [] : parseParagraphs(body.es),
        body_en: isVideoInteractive ? null : parseParagraphs(body.en) || null,
        body_pt: isVideoInteractive ? null : parseParagraphs(body.pt) || null,
        callout_kind: isVideoInteractive ? null : (hasCallout ? calloutKind : null),
        callout_es: isVideoInteractive ? null : (hasCallout ? callout.es || null : null),
        callout_en: isVideoInteractive ? null : (hasCallout ? callout.en || null : null),
        callout_pt: isVideoInteractive ? null : (hasCallout ? callout.pt || null : null),
        media_type: (isVideoInteractive ? (mediaUrl ? mediaType : null) : (hasMedia ? mediaType : null)),
        media_url: isVideoInteractive ? mediaUrl : (hasMedia ? mediaUrl : null),
        media_caption_es: isVideoInteractive ? null : (hasMedia ? mediaCaption.es || null : null),
        media_caption_en: isVideoInteractive ? null : (hasMedia ? mediaCaption.en || null : null),
        media_caption_pt: isVideoInteractive ? null : (hasMedia ? mediaCaption.pt || null : null),
        media_size: isVideoInteractive ? null : (hasMedia ? mediaSize : null),
        media_align: isVideoInteractive ? null : (hasMedia ? mediaAlign : null),
        media_shadow: isVideoInteractive ? false : (hasMedia ? mediaShadow : false),
        section_style: sectionStyle,
        video_markers: isVideoInteractive ? videoMarkers : null,
        blocks_data: blocks.length > 0 ? blocks.map(b => b.data) : null,
      })

      let savedQuizId: string | null = quiz?.id ?? null
      if (hasQuiz) {
        const savedQuiz = await upsertSectionQuiz({
          id: quiz?.id || undefined,
          section_id: saved.id,
          question_es: question.es,
          question_en: question.en || null,
          question_pt: question.pt || null,
          options_es: options.es,
          options_en: options.en,
          options_pt: options.pt,
          correct_index: correctIndex,
          explanation_es: explanation.es || null,
          explanation_en: explanation.en || null,
          explanation_pt: explanation.pt || null,
        })
        savedQuizId = savedQuiz.id
      } else if (quiz) {
        await deleteSectionQuiz(saved.id)
        savedQuizId = null
      }

      const updatedSection: DbSectionRow = {
        ...section,
        id: saved.id,
        heading_es: heading.es,
        heading_en: heading.en || null,
        heading_pt: heading.pt || null,
        body_es: isVideoInteractive ? [] : parseParagraphs(body.es),
        body_en: isVideoInteractive ? null : parseParagraphs(body.en),
        body_pt: isVideoInteractive ? null : parseParagraphs(body.pt),
        callout_kind: isVideoInteractive ? null : (hasCallout ? calloutKind : null),
        callout_es: isVideoInteractive ? null : (hasCallout ? callout.es || null : null),
        callout_en: isVideoInteractive ? null : (hasCallout ? callout.en || null : null),
        callout_pt: isVideoInteractive ? null : (hasCallout ? callout.pt || null : null),
        media_type: isVideoInteractive ? (mediaUrl ? mediaType : null) : (hasMedia ? mediaType : null),
        media_url: isVideoInteractive ? mediaUrl : (hasMedia ? mediaUrl : null),
        media_caption_es: isVideoInteractive ? null : (hasMedia ? mediaCaption.es || null : null),
        media_caption_en: isVideoInteractive ? null : (hasMedia ? mediaCaption.en || null : null),
        media_caption_pt: isVideoInteractive ? null : (hasMedia ? mediaCaption.pt || null : null),
        media_size: isVideoInteractive ? null : (hasMedia ? mediaSize : null),
        media_align: isVideoInteractive ? null : (hasMedia ? mediaAlign : null),
        media_shadow: isVideoInteractive ? false : (hasMedia ? mediaShadow : false),
        section_style: sectionStyle,
        video_markers: isVideoInteractive ? videoMarkers : null,
        blocks_data: blocks.length > 0 ? blocks.map(b => b.data) : null,
        section_quizzes: isVideoInteractive ? [] : (hasQuiz && savedQuizId
          ? [{
              id: savedQuizId,
              section_id: saved.id,
              question_es: question.es,
              question_en: question.en || null,
              question_pt: question.pt || null,
              options_es: options.es,
              options_en: options.en,
              options_pt: options.pt,
              correct_index: correctIndex,
              explanation_es: explanation.es || null,
              explanation_en: explanation.en || null,
              explanation_pt: explanation.pt || null,
            } satisfies DbQuizRow]
          : []),
      }
      onSaved(updatedSection)
      onDirty(false)
      setSaveOk(true)
      toast.success(t('admin.modules.toast_section_saved'))
      setTimeout(() => setSaveOk(false), 2000)
    } catch {
      setError(t('admin.modules.error_save_section'))
      toast.error(t('admin.modules.toast_section_save_error'))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave
  handleSaveRef2.current = handleSave
  useEffect(() => {
    onRegisterSave(() => handleSaveRef.current())
    return () => onRegisterSave(null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void handleSaveRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const langHasContent: Partial<Record<Lang, boolean>> = {
    es: !!(heading.es || body.es),
    en: !!(heading.en || body.en),
    pt: !!(heading.pt || body.pt),
  }

  if (sectionStyle === 'video-interactive') {
    return (
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NeonBadge color="cyan">{t('admin.modules.template_video_interactive')}</NeonBadge>
          </div>
          <LangTabs active={lang} onChange={setLang} />
        </div>

        <ModuleAIPanel
          type="section"
          content={{ heading }}
          activeLang={lang}
          moduleTitle={moduleTitle}
          markers={videoMarkers}
          onApplyTranslation={(l, fields) => {
            if (fields.heading !== undefined) setHeading(p => ({ ...p, [l]: fields.heading }))
            onDirty(true)
          }}
          onApplyImprovement={(l, fields) => {
            if (fields.heading !== undefined) setHeading(p => ({ ...p, [l]: fields.heading }))
            onDirty(true)
          }}
          onApplyMarkerTranslation={(l, updated) => {
            setVideoMarkers(updated)
            onDirty(true)
          }}
        />

        <div>
          <FieldLabel>{t('admin.modules.ed_section_title', { lang: lang.toUpperCase() })}</FieldLabel>
          <GlassInput
            value={heading[lang]}
            onChange={(v) => setHeading((prev) => ({ ...prev, [lang]: v }))}
            placeholder={t('admin.modules.ed_ph_video_title')}
          />
        </div>

        {section.id ? (
          <VideoMarkerEditor
            sectionId={section.id}
            campaignId={campaignId}
            moduleId={section.module_id}
            videoUrl={mediaUrl}
            videoType={mediaType === 'youtube' ? 'youtube' : mediaType === 'video' ? 'video' : null}
            markers={videoMarkers}
            lang={lang}
            onVideoChange={(url, type) => {
              setMediaUrl(url)
              setMediaType(url ? type : null)
              setHasMedia(!!url)
              onDirty(true)
            }}
            onMarkersChange={(m) => {
              setVideoMarkers(m)
              onDirty(true)
            }}
          />
        ) : (
          <div className="py-4 text-center text-[12px] text-text-subtle border border-dashed border-glass-border/10 rounded-xl">
            Guarda la sección primero para poder subir el video
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          {error && <p className="text-danger text-[12px] flex-1">{error}</p>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-black bg-neon-green hover:bg-neon-green/90 disabled:opacity-50 transition-colors ml-auto"
          >
            {saving
              ? <><span className="h-3.5 w-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />{t('admin.modules.ed_saving')}</>
              : saveOk
                ? <><span className="text-[13px]">✓</span> {t('admin.modules.saved_ok')}</>
                : <>{t('admin.modules.save_section')}</>
            }
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">

      {/* ── Encabezado ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <NeonBadge color="cyan">{t('admin.modules.ed_section_badge')}</NeonBadge>
          <span className="text-[15px] font-semibold text-text truncate max-w-[200px]">
            {heading.es || t('admin.modules.section_untitled')}
          </span>
          {autoSaveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-[11px] text-text-subtle">
              <Loader2 className="h-3 w-3 animate-spin" /> Guardando...
            </span>
          )}
          {(autoSaveStatus === 'ok' || saveOk) && autoSaveStatus !== 'saving' && (
            <span className="text-[11px] text-neon-green">{t('admin.modules.saved_ok')}</span>
          )}
        </div>
        <LangTabs active={lang} onChange={setLang} hasContent={langHasContent} />
      </div>

      <ModuleAIPanel
        type="section"
        content={{
          heading,
          body,
          ...(hasCallout ? { callout } : {}),
        }}
        activeLang={lang}
        moduleTitle={moduleTitle}
        onApplyTranslation={(l, fields) => {
          if (fields.heading !== undefined) setHeading(p => ({ ...p, [l]: fields.heading }))
          if (fields.body !== undefined) setBody(p => ({ ...p, [l]: fields.body }))
          if (fields.callout !== undefined) setCallout(p => ({ ...p, [l]: fields.callout }))
          onDirty(true)
        }}
        onApplyImprovement={(l, fields) => {
          if (fields.heading !== undefined) setHeading(p => ({ ...p, [l]: fields.heading }))
          if (fields.body !== undefined) setBody(p => ({ ...p, [l]: fields.body }))
          if (fields.callout !== undefined) setCallout(p => ({ ...p, [l]: fields.callout }))
          onDirty(true)
        }}
      />

      {/* ── CONTENIDO ── */}
      <div className="space-y-5">
        <div>
          <FieldLabel>{t('admin.modules.field_heading')}</FieldLabel>
          <GlassInput
            value={heading[lang]}
            onChange={(v) => setHeading((prev) => ({ ...prev, [lang]: v }))}
          />
        </div>
        <div>
          <FieldLabel>{t('admin.modules.field_body')}</FieldLabel>
          <GlassTextarea
            rows={7}
            value={body[lang]}
            onChange={(v) => setBody((prev) => ({ ...prev, [lang]: v }))}
            placeholder={t('admin.modules.field_body_hint')}
          />
          <p className="text-[11px] text-text-subtle mt-1">{t('admin.modules.field_body_tip')}</p>
        </div>
        <div>
          <FieldLabel>{t('admin.modules.section_style')}</FieldLabel>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {sectionStyles.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSectionStyle(value)}
                className={cn(
                  'flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl transition-all duration-200',
                  'glass border',
                  sectionStyle === value
                    ? 'border-neon-green/30 bg-neon-green/8 text-neon-green'
                    : 'border-glass-border/8 text-text-muted hover:border-glass-border/20 hover:text-text',
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="text-[10px] font-semibold uppercase tracking-wide">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── MEDIA ── */}
      <div className="space-y-5">
        <GroupDivider
          label={t('admin.modules.ed_group_media')}
          enabled={hasMedia}
          onToggle={(v) => { setHasMedia(v); if (!v) { setMediaType(null); setMediaUrl(null) } }}
        />
        {hasMedia && (
          <>
            <MediaUploader
              moduleId={section.module_id}
              sectionId={section.id}
              campaignId={campaignId}
              currentType={mediaType}
              currentUrl={mediaUrl}
              onSaved={(type, url) => { setMediaType(type); setMediaUrl(url) }}
              onCleared={() => { setMediaType(null); setMediaUrl(null) }}
            />
            <GlassCard intensity="subtle" rounded="xl" className="p-4 space-y-4">
              <p className="text-[10px] uppercase tracking-wider text-text-subtle font-semibold">
                Visualización
              </p>
              <div>
                <FieldLabel>{t('admin.modules.ed_size')}</FieldLabel>
                <div className="flex gap-1.5 flex-wrap">
                  {MEDIA_SIZES.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMediaSize(value)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all duration-200',
                        mediaSize === value
                          ? 'bg-neon-green/10 border-neon-green/25 text-neon-green'
                          : 'glass border-glass-border/8 text-text-muted hover:border-glass-border/20 hover:text-text',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {mediaSize !== 'full' && mediaSize !== 'bleed' && (
                <div>
                  <FieldLabel>{t('admin.modules.ed_alignment')}</FieldLabel>
                  <div className="flex gap-1.5">
                    {([
                      { value: 'left' as MediaAlign, Icon: AlignLeft },
                      { value: 'center' as MediaAlign, Icon: AlignCenter },
                      { value: 'right' as MediaAlign, Icon: AlignRight },
                    ]).map(({ value, Icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMediaAlign(value)}
                        className={cn(
                          'p-2.5 rounded-lg border transition-all duration-200',
                          mediaAlign === value
                            ? 'bg-neon-green/10 border-neon-green/25 text-neon-green'
                            : 'glass border-glass-border/8 text-text-muted hover:border-glass-border/20 hover:text-text',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <GlassToggle checked={mediaShadow} onChange={setMediaShadow} label={t('admin.modules.ed_media_shadow')} />
            </GlassCard>
            <div>
              <FieldLabel>{t('admin.modules.media_caption')}</FieldLabel>
              <GlassInput
                value={mediaCaption[lang]}
                onChange={(v) => setMediaCaption((prev) => ({ ...prev, [lang]: v }))}
                placeholder={t('admin.modules.media_caption_placeholder')}
              />
            </div>
          </>
        )}
      </div>

      {/* ── CALLOUT ── */}
      <div className="space-y-5">
        <GroupDivider label={t('admin.modules.ed_group_callout')} enabled={hasCallout} onToggle={setHasCallout} />
        {hasCallout && (
          <>
            <div>
              <FieldLabel>{t('admin.modules.ed_callout_type')}</FieldLabel>
              <FilterDropdown
                value={calloutKind}
                onChange={(v) => setCalloutKind(v as CalloutKind)}
                options={[
                  { value: 'tip', label: t('module.tip') },
                  { value: 'important', label: t('module.important') },
                  { value: 'warning', label: t('module.warning') },
                  { value: 'success', label: t('module.success') },
                  { value: 'quote', label: t('module.quote') },
                  { value: 'note', label: t('module.note') },
                ]}
              />
            </div>
            <div>
              <FieldLabel>{t('admin.modules.ed_callout_text', { lang: lang.toUpperCase() })}</FieldLabel>
              <GlassTextarea
                rows={3}
                value={callout[lang]}
                onChange={(v) => setCallout((prev) => ({ ...prev, [lang]: v }))}
                placeholder={t('admin.modules.callout_placeholder')}
              />
            </div>
          </>
        )}
      </div>

      {/* ── QUIZ ── */}
      <div className="space-y-5">
        <GroupDivider label={t('admin.modules.ed_group_quiz')} enabled={hasQuiz} onToggle={setHasQuiz} />
        {hasQuiz && (
          <>
            <div>
              <FieldLabel>{t('admin.modules.quiz_question')} ({lang.toUpperCase()})</FieldLabel>
              <GlassTextarea
                rows={3}
                value={question[lang]}
                onChange={(v) => setQuestion((prev) => ({ ...prev, [lang]: v }))}
              />
            </div>
            <div>
              <FieldLabel>{t('admin.modules.quiz_options')}</FieldLabel>
              <div className="space-y-2">
                {(options[lang] ?? ['', '', '', '']).map((opt, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setCorrectIndex(i)}
                      className={cn(
                        'h-4 w-4 rounded-full border-2 shrink-0 transition-all duration-200',
                        correctIndex === i
                          ? 'border-neon-green bg-neon-green/20'
                          : 'border-glass-border/20 hover:border-neon-green/40',
                      )}
                    />
                    <GlassInput
                      value={opt}
                      onChange={(v) => {
                        const next = [...(options[lang] ?? [])]
                        next[i] = v
                        setOptions((prev) => ({ ...prev, [lang]: next }))
                      }}
                      placeholder={`${t('admin.modules.quiz_option')} ${i + 1}`}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-text-subtle mt-1.5">{t('admin.modules.quiz_correct_hint')}</p>
            </div>
            <div>
              <FieldLabel>{t('admin.modules.quiz_explanation')} ({lang.toUpperCase()})</FieldLabel>
              <GlassTextarea
                rows={2}
                value={explanation[lang]}
                onChange={(v) => setExplanation((prev) => ({ ...prev, [lang]: v }))}
              />
            </div>
          </>
        )}
      </div>

      {/* ── BLOQUES (Renders normales) ── */}
      {sectionStyle !== 'game-sort' && sectionStyle !== 'game-classify' && (
        <div className="space-y-4">
          <GroupDivider label={t('admin.modules.ed_group_blocks')} />
          <BlockEditor
            blocks={blocks}
            onChange={(next) => { setBlocks(next); onDirty(true) }}
            activeLang={lang}
            mediaContext={section.id ? { moduleId: section.module_id, sectionId: section.id, campaignId } : undefined}
          />
        </div>
      )}
      {/* ── ORDENAR ── */}
      {sectionStyle === 'game-sort' && (
        <GameSortEditorWrapper
          section={section}
          heading={heading}
          language={lang}
          onBlockChange={(updated: GameSortBlock) => {
            setHeading({
              es: updated.title?.es || heading.es,
              en: updated.title?.en || heading.en,
              pt: updated.title?.pt || heading.pt,
            })
            setBlocks([{ id: 'game-sort-block', data: updated }])
            onDirty(true)
          }}
        />
      )}

      {/* ── CLASIFICAR (Zona de configuración para el juego nuevo de Casos) ── */}
      {sectionStyle === 'game-classify' && (
        <div className="space-y-4">
          <ClassifyGameEditor
            section={section}
            language={lang}
            onBlockChange={(updated: GameClassifyBlock) => {
              // Sincronizamos el encabezado multilenguaje de la sección de forma segura con el título del juego
              setHeading({
                es: updated.title?.es || heading.es,
                en: updated.title?.en || heading.en,
                pt: updated.title?.pt || heading.pt
              })
              // Almacenamos el bloque del juego dentro del arreglo de bloques locales de la sección
              setBlocks([{ id: `game-classify-${Date.now()}`, data: updated }])
              onDirty(true)
            }}
          />
        </div>
      )}

      {/* ── Pie de guardado ── */}
      <div className="pt-5 border-t border-glass-border/8 flex items-center gap-3">
        {error && <p className="text-[12px] text-danger flex-1">{error}</p>}
        <Button
          variant="neon"
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="ml-auto"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {t('admin.modules.save_section')}
        </Button>
      </div>
    </div>
  )
}

// ─── Panel editor de metadatos ────────────────────────────────────────

interface MetaEditorPanelProps {
  mod: DbModuleRow
  onSaved: (updates: Partial<DbModuleWithSections>) => void
  onDirty: (dirty: boolean) => void
  onRegisterSave: (fn: (() => void) | null) => void
}

function MetaEditorPanel({ mod, onSaved, onDirty, onRegisterSave }: MetaEditorPanelProps) {
  const { t } = useTranslation()
  const [lang, setLang] = useState<Lang>('es')
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState<Record<Lang, string>>({
    es: mod.title_es,
    en: mod.title_en ?? '',
    pt: mod.title_pt ?? '',
  })
  const [subtitle, setSubtitle] = useState<Record<Lang, string>>({
    es: mod.subtitle_es ?? '',
    en: mod.subtitle_en ?? '',
    pt: mod.subtitle_pt ?? '',
  })
  const [objectives, setObjectives] = useState<Record<Lang, string>>({
    es: (mod.objectives_es ?? []).join('\n'),
    en: (mod.objectives_en ?? mod.objectives_es ?? []).join('\n'),
    pt: (mod.objectives_pt ?? mod.objectives_es ?? []).join('\n'),
  })
  const [keyTakeaways, setKeyTakeaways] = useState<Record<Lang, string>>({
    es: (mod.key_takeaways_es ?? []).join('\n'),
    en: (mod.key_takeaways_en ?? mod.key_takeaways_es ?? []).join('\n'),
    pt: (mod.key_takeaways_pt ?? mod.key_takeaways_es ?? []).join('\n'),
  })
  const [icon, setIcon] = useState(mod.icon)
  const [duration, setDuration] = useState(String(mod.duration_min))
  const [soundTheme, setSoundTheme] = useState(mod.sound_theme ?? 'chime')

  const parseLines = (text: string) =>
    text.split('\n').map((l) => l.trim()).filter(Boolean)

  const isFirstRender = useRef(true)
  useEffect(() => {
    if (!isFirstRender.current) onDirty(true)
    isFirstRender.current = false
  }, [title, subtitle, icon, duration, soundTheme])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaveOk(false)
    try {
      const updates = {
        title_es: title.es,
        title_en: title.en || null,
        title_pt: title.pt || null,
        subtitle_es: subtitle.es || null,
        subtitle_en: subtitle.en || null,
        subtitle_pt: subtitle.pt || null,
        objectives_es: parseLines(objectives.es),
        objectives_en: parseLines(objectives.en),
        objectives_pt: parseLines(objectives.pt),
        key_takeaways_es: parseLines(keyTakeaways.es),
        key_takeaways_en: parseLines(keyTakeaways.en),
        key_takeaways_pt: parseLines(keyTakeaways.pt),
        icon,
        duration_min: parseInt(duration, 10) || 0,
        sound_theme: soundTheme,
      }
      await updateModuleMetadata(mod.id, updates)
      onSaved(updates)
      onDirty(false)
      setSaveOk(true)
      toast.success('Metadatos guardados')
      setTimeout(() => setSaveOk(false), 2000)
    } catch {
      setError(t('admin.modules.error_save_meta'))
      toast.error('Error al guardar metadatos')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRef = useRef(handleSave)
  handleSaveRef.current = handleSave
  useEffect(() => {
    onRegisterSave(() => handleSaveRef.current())
    return () => onRegisterSave(null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void handleSaveRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <NeonBadge color="violet" className="mb-1">{t('admin.modules.ed_module_badge')}</NeonBadge>
          <p className="text-[13px] text-text-muted mt-1">{t('admin.modules.meta_subtitle')}</p>
        </div>
        <LangTabs active={lang} onChange={setLang} />
      </div>

      <ModuleAIPanel
        type="meta"
        content={{
          title,
          subtitle,
          objectives,
          key_takeaways: keyTakeaways,
        }}
        activeLang={lang}
        moduleTitle={mod.title_es}
        onApplyTranslation={(l, fields) => {
          if (fields.title !== undefined) setTitle(p => ({ ...p, [l]: fields.title }))
          if (fields.subtitle !== undefined) setSubtitle(p => ({ ...p, [l]: fields.subtitle }))
          if (fields.objectives !== undefined) setObjectives(p => ({ ...p, [l]: fields.objectives }))
          if (fields.key_takeaways !== undefined) setKeyTakeaways(p => ({ ...p, [l]: fields.key_takeaways }))
          onDirty(true)
        }}
        onApplyImprovement={(l, fields) => {
          if (fields.title !== undefined) setTitle(p => ({ ...p, [l]: fields.title }))
          if (fields.subtitle !== undefined) setSubtitle(p => ({ ...p, [l]: fields.subtitle }))
          if (fields.objectives !== undefined) setObjectives(p => ({ ...p, [l]: fields.objectives }))
          if (fields.key_takeaways !== undefined) setKeyTakeaways(p => ({ ...p, [l]: fields.key_takeaways }))
          onDirty(true)
        }}
      />

      <div className="space-y-5">
        <div>
          <FieldLabel>{t('admin.modules.field_title')}</FieldLabel>
          <GlassInput
            value={title[lang]}
            onChange={(v) => setTitle((p) => ({ ...p, [lang]: v }))}
          />
        </div>

        <div>
          <FieldLabel>{t('admin.modules.field_subtitle')}</FieldLabel>
          <GlassInput
            value={subtitle[lang]}
            onChange={(v) => setSubtitle((p) => ({ ...p, [lang]: v }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel>{t('admin.modules.field_icon')}</FieldLabel>
            <GlassInput value={icon} onChange={setIcon} placeholder="BookOpen" />
          </div>
          <div>
            <FieldLabel>{t('admin.modules.field_duration')}</FieldLabel>
            <GlassInput value={duration} onChange={setDuration} placeholder="8" />
          </div>
        </div>

        <div>
          <FieldLabel>{t('admin.modules.field_sound')}</FieldLabel>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {QUIZ_SOUND_THEMES.map(({ value, labelKey }) => (
              <button
                key={value}
                type="button"
                onClick={() => { setSoundTheme(value); playQuizSound('correct', value) }}
                className={cn(
                  'flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl transition-all duration-200 glass border',
                  soundTheme === value
                    ? 'border-neon-green/30 bg-neon-green/8 text-neon-green'
                    : 'border-glass-border/8 text-text-muted hover:border-glass-border/20 hover:text-text',
                )}
              >
                <Volume2 className={cn('h-4 w-4', value === 'off' && 'opacity-40')} />
                <span className="text-[10px] font-semibold uppercase tracking-wide">{t(labelKey)}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-text-subtle mt-1.5">{t('admin.modules.field_sound_hint')}</p>
        </div>

        <div>
          <FieldLabel>{t('admin.modules.field_objectives')}</FieldLabel>
          <GlassTextarea
            rows={5}
            value={objectives[lang]}
            onChange={(v) => setObjectives((p) => ({ ...p, [lang]: v }))}
            placeholder={t('admin.modules.field_list_hint')}
          />
        </div>

        <div>
          <FieldLabel>{t('admin.modules.field_key_takeaways')}</FieldLabel>
          <GlassTextarea
            rows={4}
            value={keyTakeaways[lang]}
            onChange={(v) => setKeyTakeaways((p) => ({ ...p, [lang]: v }))}
            placeholder={t('admin.modules.field_list_hint')}
          />
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-glass-border/8 flex items-center gap-3">
        {error && <p className="text-[12px] text-danger flex-1">{error}</p>}
        {saveOk && <p className="text-[12px] text-neon-green flex-1">{t('admin.modules.saved_ok')}</p>}
        <Button
          variant="neon"
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="ml-auto"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {t('admin.modules.save_meta')}
        </Button>
      </div>
    </div>
  )
}

// ─── Exportación principal ──────────────────────────────────────────

export default function ModuleEditor() {
  const { moduleId } = useParams<{ moduleId: string }>()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const confirm = useConfirm()

  const [mod, setMod] = useState<DbModuleWithSections | null>(null)
  const [sections, setSections] = useState<DbSectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [addingSection, setAddingSection] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [publishingMod, setPublishingMod] = useState(false)
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null)
  const [splitView, setSplitView] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const saveFnRef = useRef<(() => void) | null>(null)

  // Presencia colaborativa: anuncio que estoy en este módulo y obtengo la lista
  // de coeditores que lo tienen abierto ahora mismo.
  const coeditors = useEditingPresence(
    moduleId ? { type: 'module', id: moduleId, title: mod?.title_es ?? '' } : null,
  )
  const setPresenceDirty = usePresenceStore((s) => s.setDirty)
  useEffect(() => {
    setPresenceDirty(isDirty)
  }, [isDirty, setPresenceDirty])

  useEffect(() => {
    if (!moduleId) return
    setLoading(true)
    getModuleWithSectionsRaw(moduleId)
      .then((data) => {
        setMod(data)
        setSections(data.module_sections)
      })
      .catch(() => {
        setError(t('admin.modules.error_load'))
        toast.error(t('admin.modules.error_load'))
      })
      .finally(() => setLoading(false))
  }, [moduleId])

  const handleMetaSaved = useCallback((updates: Partial<DbModuleWithSections>) => {
    setMod((prev) => (prev ? { ...prev, ...updates } : prev))
    invalidateModulesCache()
  }, [])

  const handleSectionSaved = useCallback((updated: DbSectionRow) => {
    setSections((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    invalidateModulesCache()
  }, [])

  const handleDeleteSection = async (sectionId: string) => {
    const ok = await confirm({
      title: t('confirm.delete_section_title'),
      description: t('confirm.delete_section_desc'),
    })
    if (!ok) return
    try {
      await deleteSection(sectionId)
      setSections((prev) => prev.filter((s) => s.id !== sectionId))
      if (selectedSectionId === sectionId) setSelectedSectionId(null)
      invalidateModulesCache()
    } catch {
      setError(t('admin.modules.error_delete'))
    }
  }

  const handleReorder = useCallback(async (reordered: DbSectionRow[]) => {
    setSections(reordered)
    for (const s of reordered) {
      const { section_quizzes: _q, ...rest } = s
      await upsertSection(rest)
    }
  }, [])

  const handleAddSection = async (template: SectionTemplate) => {
    if (!mod) return
    setAddingSection(true)
    try {
      const hasCallout = template === 'text-callout' || template === 'full'
      const hasMedia = template === 'text-media' || template === 'full' || template === 'hero'
      const hasQuiz = template === 'text-quiz' || template === 'full'
      const styleMap: Record<SectionTemplate, DbSectionRow['section_style']> = {
        text: 'default',
        'text-callout': 'default',
        'text-media': 'default',
        'text-quiz': 'default',
        full: 'default',
        hero: 'hero',
        spotlight: 'spotlight',
        feature: 'feature',
        'video-interactive': 'video-interactive',
        'game-sort': 'game-sort',
        'game-classify': 'game-classify',
      }
      const sectionStyle = styleMap[template] ?? 'default'

      const newSection = await upsertSection({
        module_id: mod.id,
        sort_order: sections.length,
        heading_es: t('admin.modules.new_section_heading'),
        body_es: [],
        callout_kind: hasCallout ? 'tip' : null,
        section_style: sectionStyle,
      })

      const blank: DbSectionRow = {
        id: newSection.id,
        module_id: mod.id,
        sort_order: sections.length,
        heading_es: t('admin.modules.new_section_heading'),
        heading_en: null,
        heading_pt: null,
        body_es: [],
        body_en: null,
        body_pt: null,
        callout_kind: hasCallout ? 'tip' : null,
        callout_es: null,
        callout_en: null,
        callout_pt: null,
        media_type: hasMedia ? 'image' : null,
        media_url: null,
        media_caption_es: null,
        media_caption_en: null,
        media_caption_pt: null,
        media_size: null,
        media_align: null,
        media_shadow: false,
        section_style: sectionStyle,
        video_markers: template === 'video-interactive' ? [] : null,
        blocks_data: null,
        section_quizzes: hasQuiz ? [{
          id: '',
          section_id: newSection.id,
          question_es: '',
          question_en: null,
          question_pt: null,
          options_es: ['', '', '', ''],
          options_en: null,
          options_pt: null,
          correct_index: 0,
          explanation_es: null,
          explanation_en: null,
          explanation_pt: null,
        }] : [],
      }

      setSections((prev) => [...prev, blank])
      setSelectedSectionId(blank.id)
      setFocusedSectionId(blank.id)
    } catch {
      setError(t('admin.modules.error_add_section'))
    } finally {
      setAddingSection(false)
    }
  }

  const handleTogglePublished = async () => {
    if (!mod) return
    setPublishingMod(true)
    try {
      const next = !mod.is_published
      await toggleModulePublished(mod.id, next)
      setMod((prev) => prev ? { ...prev, is_published: next } : prev)
      toast.success(next ? t('admin.modules.toast_published') : t('admin.modules.toast_unpublished'))
    } catch {
      setError(t('admin.modules.error_toggle'))
      toast.error(t('admin.modules.toast_toggle_error'))
    } finally {
      setPublishingMod(false)
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = sections.findIndex((s) => s.id === active.id)
    const newIdx = sections.findIndex((s) => s.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = arrayMove(sections, oldIdx, newIdx).map((s, i) => ({ ...s, sort_order: i }))
    handleReorder(reordered)
  }

  const handleSelectSection = (id: string | null) => {
    setSelectedSectionId(id)
    setFocusedSectionId(id)
    setIsDirty(false)
    setSidebarOpen(false)
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-text-muted text-[14px]">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('common.loading')}
      </div>
    )
  }

  if (!mod) {
    return (
      <div className="flex h-screen items-center justify-center">
        <GlassCard intensity="subtle" padding="xl" rounded="2xl">
          <p className="text-danger text-[14px]">{error ?? t('admin.modules.error_load')}</p>
        </GlassCard>
      </div>
    )
  }

  const previewContent = (
    <>
      {selectedSectionId ? (
        (() => {
          const s = sections.find((sec) => sec.id === selectedSectionId)
          if (!s) return <p className="text-[12px] text-text-subtle text-center pt-10">{t('admin.modules.ed_select_section')}</p>
          return (
            <div className="space-y-4">
              <p className="text-[10px] text-text-subtle uppercase tracking-widest font-medium">
                {s.heading_es || t('common.untitled')}
              </p>
              {s.body_es?.map((p: string, i: number) => (
                <p key={i} className="text-[14px] leading-relaxed text-text-muted">{p}</p>
              ))}
              {s.callout_kind && s.callout_es && (
                <div className="glass rounded-2xl px-4 py-3 border-l-2 border-neon-green/40">
                  <p className="text-[12px] text-text-muted">{s.callout_es}</p>
                </div>
              )}
              {s.media_url && s.media_type === 'image' && (
                <img src={s.media_url} alt="" className="w-full rounded-2xl border border-line" />
              )}
              {s.media_url && s.media_type === 'youtube' && (
                <div className="relative rounded-2xl overflow-hidden" style={{ paddingTop: '56.25%' }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${s.media_url}?rel=0`}
                    className="absolute inset-0 w-full h-full border-0"
                    allowFullScreen
                  />
                </div>
              )}
              {(s.section_quizzes?.length ?? 0) > 0 && (
                <div className="glass rounded-2xl px-4 py-3">
                  <p className="text-[11px] text-text-subtle mb-2">{t('admin.modules.ed_quiz_badge')}</p>
                  <p className="text-[13px] font-medium text-text">{s.section_quizzes![0].question_es}</p>
                  <div className="space-y-1.5 mt-3">
                    {s.section_quizzes![0].options_es?.map((o: string, i: number) => (
                      <div key={i} className={cn(
                        'px-3 py-2 rounded-xl text-[12px] border',
                        i === s.section_quizzes![0].correct_index
                          ? 'border-neon-green/30 text-neon-green bg-neon-green/5'
                          : 'border-glass-border/10 text-text-muted',
                      )}>
                        {o}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })()
      ) : (
        <p className="text-[12px] text-text-subtle text-center pt-10">
          Selecciona una sección para ver preview
        </p>
      )}
    </>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-bg">

      {/* ── PANEL IZQUIERDO ── */}
      <div className="w-60 flex flex-col glass-strong border-r border-glass-border/8 shrink-0 overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-glass-border/8 md:hidden">
          <button
            onClick={() => setSidebarOpen(false)}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Ítem de metadatos del módulo */}
        <button
          onClick={() => handleSelectSection(null)}
          className={cn(
            'w-full flex items-center gap-2.5 px-4 py-3 text-left transition-all border-b border-glass-border/8',
            selectedSectionId === null
              ? 'bg-glass-border/8 text-text'
              : 'text-text-muted hover:text-text hover:bg-glass/4',
          )}
        >
          <div className={cn(
            'h-5 w-5 rounded-md flex items-center justify-center shrink-0 transition-colors',
            selectedSectionId === null ? 'bg-glass-border/10' : 'bg-glass/8',
          )}>
            <BookOpen className="h-3 w-3 text-text-subtle" />
          </div>
          <span className="text-[12px] font-medium">{t('admin.modules.editor_meta_label')}</span>
        </button>

        <div className="flex items-center justify-between px-4 py-2 border-b border-glass-border/8">
          <span className="text-[10px] uppercase tracking-wider text-text-subtle font-semibold">
            Secciones
          </span>
          <button
            onClick={() => setGalleryOpen(true)}
            disabled={addingSection}
            title={t('admin.modules.add_section')}
            className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-glass/8 disabled:opacity-40 transition-colors"
          >
            {addingSection ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Lista de secciones con arrastrar y soltar */}
      <div className="flex-1 overflow-y-auto">
        {sections.length === 0 ? (
          <div className="px-4 py-6 text-center text-[11px] text-text-subtle">
            {t('admin.modules.ed_no_sections_a')}<br />{t('admin.modules.ed_no_sections_b')} <Plus className="h-3 w-3 inline" /> {t('admin.modules.ed_no_sections_c')}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {sections.map((section, idx) => (
                <SortableItem key={section.id} id={section.id}>
                  {(dragHandle) => (
                    <div
                      onClick={() => handleSelectSection(section.id)}
                      className={cn(
                        'group flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-all border-b border-glass-border/6',
                        selectedSectionId === section.id
                          ? 'bg-glass-border/8 text-text'
                          : 'text-text-muted hover:text-text hover:bg-glass/4',
                      )}
                    >
                      <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
                        {dragHandle}
                      </div>
                      <span className="text-[10px] font-mono text-text-subtle w-4 shrink-0 text-right">
                        {idx + 1}
                      </span>
                      <span className={cn(
                        'flex-1 text-[12px] font-medium truncate',
                        selectedSectionId === section.id ? 'text-text' : '',
                      )}>
                        {section.heading_es || t('common.untitled')}
                      </span>
                      <div className="flex items-center gap-1 shrink-0 opacity-100 md:opacity-50 md:group-hover:opacity-100 transition-opacity">
                        {section.media_type && <Image className="h-2.5 w-2.5 text-text-subtle" />}
                        {section.callout_kind && <Lightbulb className="h-2.5 w-2.5 text-text-subtle" />}
                        {(section.section_quizzes?.length ?? 0) > 0 && <HelpCircle className="h-2.5 w-2.5 text-text-subtle" />}
                        {Array.isArray(section.blocks_data) && section.blocks_data.length > 0 && (
                          <Layers className="h-2.5 w-2.5 text-text-subtle" />
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteSection(section.id) }}
                        className="p-2 md:p-1 rounded-md opacity-60 md:opacity-0 md:group-hover:opacity-60 hover:!opacity-100 hover:text-danger hover:bg-danger/8 transition-all shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5 md:h-3 md:w-3" />
                      </button>
                    </div>
                  )}
                </SortableItem>
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

        <div className="p-3 border-t border-glass-border/8 shrink-0">
          <button
            onClick={() => setGalleryOpen(true)}
            disabled={addingSection}
            className={cn(
              'w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-medium transition-all',
              'border border-dashed border-glass-border/15 text-text-subtle hover:text-text hover:border-glass-border/30 hover:bg-glass/4',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            {addingSection
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Plus className="h-3.5 w-3.5" />
            }
            Nueva sección
          </button>
        </div>
      </div>

      {/* ── PANEL CENTRAL ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 h-14 glass-md border-b border-glass-border/8 shrink-0">
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="text-[13px] md:text-[14px] font-medium text-text truncate">{mod.title_es}</span>
            {isDirty && (
              <span
                className="h-2 w-2 rounded-full bg-amber-400 shrink-0 animate-glow-pulse"
                title={t('admin.modules.editor_unsaved_indicator')}
              />
            )}
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            {coeditors.length > 0 && (
              <div className="mr-1 pr-2 md:pr-3 border-r border-glass-border/10">
                <PresenceStack peers={coeditors} size={30} />
              </div>
            )}
            <button
              onClick={() => setSplitView((v) => !v)}
              title={splitView ? 'Ocultar preview' : 'Ver preview en vivo'}
              className={cn(
                'h-8 w-8 rounded-lg flex items-center justify-center transition-colors',
                splitView ? 'bg-neon-green/12 text-neon-green border border-neon-green/20' : 'glass text-text-muted hover:text-text',
              )}
            >
              <Columns2 className="h-3.5 w-3.5" />
            </button>
            <Button
              variant="glass"
              size="sm"
              onClick={handleTogglePublished}
              disabled={publishingMod}
            >
              {publishingMod ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : mod.is_published ? (
                <><EyeOff className="h-3.5 w-3.5" /><span className="hidden sm:inline">{t('admin.modules.unpublish')}</span></>
              ) : (
                <><Eye className="h-3.5 w-3.5" /><span className="hidden sm:inline">{t('admin.modules.publish')}</span></>
              )}
            </Button>
            <Button
              variant="neon"
              size="sm"
              onClick={() => saveFnRef.current?.()}
            >
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('admin.modules.ed_save')}</span>
            </Button>
          </div>
        </div>

        <EditingBanner coeditors={coeditors} />

        {error && (
          <div className="mx-3 md:mx-5 mt-4 px-4 py-2.5 rounded-xl glass border border-danger/20 text-danger text-[13px] shrink-0">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {selectedSectionId === null ? (
            <MetaEditorPanel
              mod={mod}
              onSaved={handleMetaSaved}
              onDirty={setIsDirty}
              onRegisterSave={(fn) => { saveFnRef.current = fn }}
            />
          ) : (
            sections.find((s) => s.id === selectedSectionId) ? (
              <SectionEditorPanel
                key={selectedSectionId}
                section={sections.find((s) => s.id === selectedSectionId)!}
                campaignId={mod.campaign_id}
                moduleTitle={mod.title_es}
                onSaved={handleSectionSaved}
                onDirty={setIsDirty}
                onRegisterSave={(fn) => { saveFnRef.current = fn }}
              />
            ) : null
          )}
        </div>
      </div>

      {/* ── PANEL DERECHO: Preview — side panel en desktop, fullscreen overlay en mobile ── */}
      {splitView && (
        <>
          {/* Desktop: side panel */}
          <div className="hidden md:flex w-96 xl:w-[480px] flex-col glass-md border-l border-glass-border/8 shrink-0 overflow-hidden">
            <div className="flex items-center gap-2 px-4 h-14 border-b border-glass-border/8 shrink-0">
              <div className="h-2 w-2 rounded-full bg-neon-green animate-[glow-pulse_2s_ease-in-out_infinite]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                Preview en vivo
              </span>
              <span className="ml-auto text-[10px] text-text-subtle">{t('admin.modules.ed_learner_preview')}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-6">
              {previewContent}
            </div>
          </div>

          {/* Mobile: fullscreen overlay */}
          <div className="md:hidden fixed inset-0 z-50 flex flex-col bg-bg">
            <div className="flex items-center gap-2 px-4 h-14 border-b border-glass-border/8 shrink-0 glass-md">
              <div className="h-2 w-2 rounded-full bg-neon-green animate-[glow-pulse_2s_ease-in-out_infinite]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
                Preview en vivo
              </span>
              <button
                onClick={() => setSplitView(false)}
                className="ml-auto h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/6 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-6">
              {previewContent}
            </div>
          </div>
        </>
      )}

      <SectionTemplateGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onSelect={handleAddSection}
      />
    </div>
  )
}
