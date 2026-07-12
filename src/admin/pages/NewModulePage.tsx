import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, Loader2, Minus, Plus, Sparkles,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { createModule } from '@/services/modules.service'
import ImportContent from '@/admin/pages/ImportContent'
import {
  addModuleToCourse,
  getCoursesForCampaign,
  getCourseById,
  type CourseWithModules,
} from '@/services/courses.service'
import { useTranslation } from 'react-i18next'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
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

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
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
      // El mundo (gamificación) se crea y configura aparte, en la sección Mundos.
      // Adjuntar un módulo no genera ni sincroniza nada de mundos.
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
      setError(err instanceof Error ? err.message : t('admin.modules.new.toast_create_error'))
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
                      ? t('admin.modules.new.ph_title_example')
                      : t('admin.modules.new.title_in_lang', { lang: LANG_NAMES[titleLang] })
                  }
                  required={titleLang === 'es'}
                  maxLength={120}
                />
                {titleLang !== 'es' && (
                  <p className="text-[11px] text-text-subtle mt-1.5">
                    {t('admin.modules.new.title_empty_hint')}
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
                      ? t('admin.modules.new.ph_subtitle_example')
                      : t('admin.modules.new.subtitle_in_lang', { lang: LANG_NAMES[subtitleLang] })
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
            {/* Flujo completo de "Generar contenido" (subir documento → esquema →
                secciones → guardar), integrado aquí como pestaña. Lee el ?courseId=
                de la URL para adjuntar el módulo al mismo curso. */}
            <ImportContent embedded />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
