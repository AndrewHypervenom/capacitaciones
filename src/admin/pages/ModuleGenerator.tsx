import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, AlertTriangle, BookOpen, CheckCircle2, Clock,
  FileText, Loader2, RotateCcw, Sparkles, Upload, X,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { generateModule, type CacheUsage, type GeneratedModule } from '@/services/ai.service'
import { createModule, upsertSection } from '@/services/modules.service'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import type { Campaign } from '@/types/database'

const CACHE_KEY = 'ai_module_cache_expires'
const CACHE_DURATION_MS = 5 * 60 * 1000

function formatMs(ms: number) {
  const s = Math.ceil(ms / 2000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function useCacheTimer() {
  const [remaining, setRemaining] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const notifyCache = useCallback((usage: CacheUsage) => {
    // Only reset the 5-min window when the cache was just written (not on a hit)
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

const slugify = (s: string) =>
  s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60)

export default function ModuleGenerator() {
  const nav = useNavigate()
<<<<<<< HEAD
  const { campaignId: authCampaignId, isSuperAdmin } = useAuth()
=======
  const { campaignId: authCampaignId, isAdmin } = useAuth()
>>>>>>> origin/main
  const { remaining, notifyCache } = useCacheTimer()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState(authCampaignId ?? '')
  const [description, setDescription] = useState('')
  const [documentText, setDocumentText] = useState('')
  const [docMode, setDocMode] = useState<'none' | 'paste' | 'file'>('none')
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<GeneratedModule | null>(null)
  const [savedModuleId, setSavedModuleId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
<<<<<<< HEAD
    if (!isSuperAdmin) return
=======
    if (!isAdmin) return
>>>>>>> origin/main
    supabase.from('campaigns').select('*').order('name').then(({ data }) => {
      setCampaigns(data ?? [])
      if (!selectedCampaignId && data?.[0]) setSelectedCampaignId(data[0].id)
    })
<<<<<<< HEAD
  }, [isSuperAdmin, selectedCampaignId])
=======
  }, [isAdmin, selectedCampaignId])
>>>>>>> origin/main

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setDocMode('file')
    const reader = new FileReader()
    reader.onload = (ev) => setDocumentText(String(ev.target?.result ?? ''))
    reader.readAsText(file)
  }

  const clearDocument = () => {
    setDocumentText(''); setFileName(''); setDocMode('none')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleGenerate = async () => {
    if (!description.trim()) return
    setLoading(true); setError(null); setGenerated(null); setSavedModuleId(null)
    try {
      const result = await generateModule({
        description,
        documentText: documentText.trim() || undefined,
      })
      setGenerated(result.data)
      notifyCache(result.usage)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!generated || !selectedCampaignId) return
    setSaving(true)
    try {
      const { metadata, sections } = generated
      const { id: moduleId } = await createModule(selectedCampaignId, {
        slug: metadata.slug || slugify(metadata.title_es),
        icon: metadata.icon,
        duration_min: metadata.duration_min,
        title_es: metadata.title_es,
        title_en: metadata.title_en,
        title_pt: metadata.title_pt,
        subtitle_es: metadata.subtitle_es,
        subtitle_en: metadata.subtitle_en,
        subtitle_pt: metadata.subtitle_pt,
      })
      await supabase.from('modules').update({
        objectives_es: metadata.objectives_es,
        objectives_en: metadata.objectives_en,
        objectives_pt: metadata.objectives_pt,
        key_takeaways_es: metadata.key_takeaways_es,
        key_takeaways_en: metadata.key_takeaways_en,
        key_takeaways_pt: metadata.key_takeaways_pt,
      }).eq('id', moduleId)
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i]
        await upsertSection({
          module_id: moduleId,
          sort_order: i + 1,
          heading_es: s.heading_es,
          heading_en: s.heading_en,
          heading_pt: s.heading_pt,
          body_es: s.body_es,
          body_en: s.body_en,
          body_pt: s.body_pt,
          section_style: (s.section_style as 'default') ?? 'default',
          callout_kind: s.callout_kind as 'tip' | 'important' | 'warning' | 'success' | 'note' | null,
          callout_es: s.callout_es,
          callout_en: s.callout_en,
          callout_pt: s.callout_pt,
        })
      }
      setSavedModuleId(moduleId)
      toast.success('Módulo creado exitosamente')
    } catch (e) {
      toast.error(`Error guardando: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button
          onClick={() => nav('/admin/modules')}
          className="p-2 rounded-xl hover:bg-glass/8 text-text-muted hover:text-text transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <GradientHeading as="h1" className="text-2xl mb-0.5">Generar módulo con IA</GradientHeading>
          <p className="text-sm text-text-muted">
            Claude crea el módulo completo en 3 idiomas a partir de tu descripción o documento
          </p>
        </div>
        {remaining > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-green/8 border border-brand-green/20 text-brand-green text-xs font-medium shrink-0">
            <Clock className="h-3.5 w-3.5" />
            Caché activo · {formatMs(remaining)}
          </div>
        )}
      </div>

      {/* Campaign selector (superadmin only) */}
<<<<<<< HEAD
      {isSuperAdmin && campaigns.length > 0 && (
=======
      {isAdmin && campaigns.length > 0 && (
>>>>>>> origin/main
        <GlassCard className="p-4 mb-4">
          <label className="text-xs font-medium text-text-muted mb-1.5 block">Campaña destino</label>
          <select
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="glass border border-glass-border/20 rounded-xl px-3 py-2 text-sm text-text bg-transparent w-full"
          >
            <option value="">— Seleccionar campaña —</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </GlassCard>
      )}

      {/* Input form */}
      <GlassCard className="p-5 mb-4">
        <label className="text-xs font-medium text-text-muted mb-1.5 block">
          ¿Sobre qué trata el módulo? <span className="text-danger">*</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ej: Módulo sobre manejo de objeciones en ventas telefónicas. Cubre técnicas de escucha activa, cómo rebatir objeciones de precio y tiempo, y cómo cerrar la llamada de forma positiva aunque no haya venta inmediata..."
          rows={4}
          className="w-full glass border border-glass-border/20 rounded-xl px-3 py-2.5 text-sm text-text bg-transparent resize-none focus:outline-none focus:border-brand-violet/40 placeholder:text-text-subtle mb-4"
        />

        {/* Document attachment */}
        <div className="border-t border-glass-border/10 pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-text-muted">
              Documento fuente <span className="text-text-subtle font-normal">(opcional)</span>
            </span>
            {(documentText || fileName) && (
              <button
                onClick={clearDocument}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-danger transition-colors"
              >
                <X className="h-3 w-3" /> Quitar
              </button>
            )}
          </div>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setDocMode(docMode === 'paste' ? 'none' : 'paste')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all',
                docMode === 'paste'
                  ? 'border-brand-violet/30 bg-brand-violet/8 text-brand-violet'
                  : 'border-glass-border/20 text-text-muted hover:text-text hover:border-glass-border/40',
              )}
            >
              <FileText className="h-3.5 w-3.5" /> Pegar texto
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all',
                docMode === 'file' && fileName
                  ? 'border-brand-violet/30 bg-brand-violet/8 text-brand-violet'
                  : 'border-glass-border/20 text-text-muted hover:text-text hover:border-glass-border/40',
              )}
            >
              <Upload className="h-3.5 w-3.5" /> Subir archivo .txt / .md
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
          {docMode === 'paste' && (
            <textarea
              value={documentText}
              onChange={(e) => setDocumentText(e.target.value)}
              placeholder="Pega aquí el contenido del documento (manual, guión, política, etc.). Para PDFs, copia el texto desde el visor de PDF."
              rows={6}
              className="w-full glass border border-glass-border/20 rounded-xl px-3 py-2.5 text-sm text-text bg-transparent resize-none focus:outline-none focus:border-brand-violet/40 placeholder:text-text-subtle"
            />
          )}
          {docMode === 'file' && fileName && (
            <div className="flex items-center gap-2 text-xs text-brand-violet px-3 py-2 rounded-lg bg-brand-violet/6 border border-brand-violet/15">
              <FileText className="h-3.5 w-3.5 shrink-0" />
              {fileName} — {(documentText.length / 1000).toFixed(1)}k caracteres cargados
            </div>
          )}
        </div>
      </GlassCard>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 text-sm text-danger p-3 rounded-xl bg-danger/8 border border-danger/20 mb-4">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 py-4 px-5 rounded-2xl bg-brand-violet/6 border border-brand-violet/15 mb-4">
          <Loader2 className="h-4 w-4 animate-spin text-brand-violet shrink-0" />
          <div>
            <p className="text-sm text-text font-medium">Generando módulo...</p>
            <p className="text-xs text-text-muted">
              Claude está estructurando el contenido en 3 idiomas. Puede tardar 30-50 segundos.
            </p>
          </div>
        </div>
      )}

      {/* Generate button */}
      {!generated && !loading && (
        <div className="flex justify-end">
          <Button
            onClick={handleGenerate}
            disabled={!description.trim() || !selectedCampaignId}
          >
            <Sparkles className="h-4 w-4" /> Generar módulo
          </Button>
        </div>
      )}

      {/* Preview */}
      {generated && !loading && (
        <ModulePreview
          generated={generated}
          savedModuleId={savedModuleId}
          saving={saving}
          canSave={!!selectedCampaignId}
          onSave={handleSave}
          onRegenerate={handleGenerate}
          onEdit={() => nav(`/admin/modules/${savedModuleId}`)}
        />
      )}
    </div>
  )
}

function ModulePreview({
  generated, savedModuleId, saving, canSave, onSave, onRegenerate, onEdit,
}: {
  generated: GeneratedModule
  savedModuleId: string | null
  saving: boolean
  canSave: boolean
  onSave: () => void
  onRegenerate: () => void
  onEdit: () => void
}) {
  const { metadata, sections } = generated

  const calloutColors: Record<string, string> = {
    tip: 'text-brand-cyan border-brand-cyan/20 bg-brand-cyan/8',
    important: 'text-brand-amber border-brand-amber/20 bg-brand-amber/8',
    warning: 'text-danger border-danger/20 bg-danger/8',
    success: 'text-brand-green border-brand-green/20 bg-brand-green/8',
    note: 'text-text-muted border-glass-border/20 bg-glass/8',
  }

  return (
    <GlassCard className="p-5 space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-brand-green" />
          <span className="text-sm font-medium text-text">Módulo generado</span>
        </div>
        <div className="flex items-center gap-2">
          {!savedModuleId && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors px-2 py-1.5 rounded-lg hover:bg-glass/8"
            >
              <RotateCcw className="h-3 w-3" /> Regenerar
            </button>
          )}
          {savedModuleId ? (
            <Button size="sm" onClick={onEdit}>
              <BookOpen className="h-4 w-4" /> Editar módulo →
            </Button>
          ) : (
            <Button size="sm" onClick={onSave} disabled={saving || !canSave}>
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <BookOpen className="h-4 w-4" />}
              {saving ? 'Guardando...' : 'Guardar módulo'}
            </Button>
          )}
        </div>
      </div>

      {/* Module identity */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-glass/4 border border-glass-border/10">
        <span className="text-3xl leading-none">{metadata.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-text text-sm leading-snug">{metadata.title_es}</div>
          <div className="text-xs text-text-muted mt-0.5">{metadata.subtitle_es}</div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <NeonBadge color="cyan" className="text-[9px]">{metadata.duration_min} min</NeonBadge>
            <span className="text-[11px] text-text-subtle font-mono">{metadata.slug}</span>
          </div>
        </div>
      </div>

      {/* Objectives */}
      {metadata.objectives_es?.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-text-subtle uppercase tracking-widest mb-2">
            Objetivos de aprendizaje
          </div>
          <ul className="space-y-1">
            {metadata.objectives_es.map((obj, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-text-muted">
                <span className="text-brand-green shrink-0 mt-px">✓</span>
                {obj}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sections */}
      <div>
        <div className="text-[10px] font-semibold text-text-subtle uppercase tracking-widest mb-2">
          {sections.length} secciones
        </div>
        <div className="space-y-2">
          {sections.map((s, i) => (
            <div key={i} className="p-3 rounded-xl bg-glass/4 border border-glass-border/8">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] font-mono text-text-subtle w-4 shrink-0">{i + 1}</span>
                <span className="text-xs font-medium text-text flex-1">{s.heading_es}</span>
                {s.callout_kind && (
                  <span className={cn(
                    'text-[9px] px-1.5 py-0.5 rounded border font-medium',
                    calloutColors[s.callout_kind] ?? calloutColors.note,
                  )}>
                    {s.callout_kind}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-muted leading-snug line-clamp-2 ml-6">
                {s.body_es[0]}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Key takeaways */}
      {metadata.key_takeaways_es?.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-text-subtle uppercase tracking-widest mb-2">
            Puntos clave
          </div>
          <div className="flex flex-wrap gap-1.5">
            {metadata.key_takeaways_es.map((t, i) => (
              <span
                key={i}
                className="text-[10px] px-2.5 py-1 rounded-full bg-glass/8 border border-glass-border/15 text-text-muted"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Saved state */}
      {savedModuleId && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-brand-green/6 border border-brand-green/20 text-brand-green text-xs">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Módulo guardado como borrador. Puedes editarlo, agregar media, quizzes y publicarlo.
        </div>
      )}
    </GlassCard>
  )
}
