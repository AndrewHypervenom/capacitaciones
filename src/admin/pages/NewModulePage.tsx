import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Loader2, Minus, Plus } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { createModule } from '@/services/modules.service'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { Campaign } from '@/types/database'

// ─── Constants ────────────────────────────────────────────────

type Lang = 'es' | 'en' | 'pt'

const ICONS = [
  '📚', '📖', '🎯', '💡', '🔧', '📊', '📱', '🤝',
  '💰', '🏆', '⭐', '🎓', '🧠', '🗣️', '📋', '✅',
  '🔑', '💼', '🌐', '🎤', '🚀', '🔍', '📝', '🎨',
  '⚡', '🛡️', '📡', '🧩', '🗂️', '🎯',
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
  value,
  onChange,
  placeholder,
  required,
  maxLength,
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

function LangTabs({
  active,
  onChange,
}: {
  active: Lang
  onChange: (l: Lang) => void
}) {
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
  const navigate = useNavigate()
  const { campaignId: authCampaignId, isSuperAdmin } = useAuth()

  const [icon, setIcon] = useState('📚')
  const [titleLang, setTitleLang] = useState<Lang>('es')
  const [title, setTitle] = useState<Record<Lang, string>>({ es: '', en: '', pt: '' })
  const [subtitleLang, setSubtitleLang] = useState<Lang>('es')
  const [subtitle, setSubtitle] = useState<Record<Lang, string>>({ es: '', en: '', pt: '' })
  const [duration, setDuration] = useState(30)
  const [campaignId, setCampaignId] = useState(authCampaignId ?? '')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuperAdmin) return
    supabase
      .from('campaigns')
      .select('*')
      .order('name')
      .then(({ data }) => {
        setCampaigns(data ?? [])
        if (!campaignId && data?.[0]) setCampaignId(data[0].id)
      })
  }, [isSuperAdmin, campaignId])

  const canCreate = title.es.trim().length > 0 && campaignId

  const adjustDuration = (delta: number) => {
    setDuration((prev) => Math.min(240, Math.max(5, prev + delta)))
  }

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
      navigate(`/admin/modules/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el módulo')
      setSaving(false)
    }
  }

  const fadeUp = {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Header */}
      <motion.div {...fadeUp} transition={{ duration: 0.3 }} className="mb-8">
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
          Completa la información básica. Luego podrás agregar secciones, objetivos y contenido.
        </p>
      </motion.div>

      <form onSubmit={handleCreate} className="space-y-5">

        {/* ── Identidad visual ── */}
        <motion.div {...fadeUp} transition={{ duration: 0.3, delay: 0.05 }}>
          <GlassCard intensity="subtle" padding="lg" rounded="2xl">
            <SectionLabel>Identidad visual</SectionLabel>

            {/* Icon preview + picker */}
            <div className="flex flex-col items-center mb-5">
              <div
                className={cn(
                  'w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mb-4',
                  'bg-glass/6 border border-glass-border/10 shadow-inner',
                )}
              >
                {icon}
              </div>
              <div className="grid grid-cols-10 gap-1.5">
                {ICONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setIcon(emoji)}
                    className={cn(
                      'w-8 h-8 rounded-lg text-lg flex items-center justify-center transition-all',
                      'hover:bg-glass/10',
                      icon === emoji
                        ? 'bg-neon-green/15 ring-1 ring-neon-green/40 scale-110'
                        : 'bg-glass/4',
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Título */}
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

            {/* Subtítulo */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[12px] font-medium text-text-muted">
                  Subtítulo <span className="text-text-subtle text-[11px]">(opcional)</span>
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
        </motion.div>

        {/* ── Configuración ── */}
        <motion.div {...fadeUp} transition={{ duration: 0.3, delay: 0.1 }}>
          <GlassCard intensity="subtle" padding="lg" rounded="2xl">
            <SectionLabel>Configuración</SectionLabel>

            {/* Duración */}
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
                  <span className="text-[13px] text-text-muted ml-2">min</span>
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
                type="range"
                min={5}
                max={240}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full mt-3 accent-neon-green h-1 rounded-full cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-text-subtle mt-1">
                <span>5 min</span>
                <span>4 h</span>
              </div>
            </div>

            {/* Campaña (solo superadmin) */}
            {isSuperAdmin && campaigns.length > 0 && (
              <div>
                <label className="text-[12px] font-medium text-text-muted block mb-2">
                  Campaña
                </label>
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  required
                  className={cn(
                    'w-full rounded-xl px-4 py-3 text-[14px] text-text',
                    'bg-glass/5 border border-glass-border/10',
                    'focus:border-neon-green/30 focus:outline-none',
                    'transition-colors appearance-none cursor-pointer',
                  )}
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id} className="bg-surface text-text">
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* ── Error ── */}
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-xl px-4 py-3 text-[13px] text-danger bg-danger/8 border border-danger/20"
          >
            {error}
          </motion.div>
        )}

        {/* ── Acciones ── */}
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.3, delay: 0.15 }}
          className="flex items-center justify-between pt-1"
        >
          <Link to="/admin/modules">
            <Button type="button" variant="ghost" size="md">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Cancelar
            </Button>
          </Link>

          <Button
            type="submit"
            variant="neon"
            size="md"
            disabled={!canCreate || saving}
            className="min-w-[160px] flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creando…
              </>
            ) : (
              <>
                Crear módulo
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </motion.div>
      </form>
    </div>
  )
}
