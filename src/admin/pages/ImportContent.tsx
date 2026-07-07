import { useEffect, useMemo, useRef, useState } from 'react'
import i18n from '@/i18n'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Upload, FileText, FileSpreadsheet, Sparkles, Loader2, X,
  CheckCircle2, AlertTriangle, RotateCcw, BookOpen, ChevronRight, Wand2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  extractDocumentText, ACCEPTED_DOC_EXTENSIONS,
  type ExtractedDocument, type ExtractStage,
} from '@/lib/documentExtract'
import {
  analyzeDocument, generateModuleOutline, generateModuleSection,
  type ProposedModule, type GeneratedModule,
} from '@/services/ai.service'
import { saveGeneratedModule } from '@/services/modules.service'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import type { Campaign } from '@/types/database'

type Phase = 'setup' | 'analyzing' | 'review' | 'generating' | 'preview' | 'done'

interface GenItem {
  proposed: ProposedModule
  status: 'pending' | 'generating' | 'done' | 'error'
  generated?: GeneratedModule
  progress?: string
  error?: string
}

function buildDescription(p: ProposedModule): string {
  const parts = [p.focus_es?.trim() || p.title_es]
  if (p.topics?.length) parts.push(`Subtemas a cubrir: ${p.topics.join(', ')}.`)
  return parts.join('\n')
}

export default function ImportContent() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { campaignId: authCampaignId, isSuperAdmin } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState(searchParams.get('campaign') ?? authCampaignId ?? '')

  const [doc, setDoc] = useState<ExtractedDocument | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [readingName, setReadingName] = useState('')
  const [progress, setProgress] = useState<{ stage: ExtractStage; ratio: number }>({ stage: 'reading', ratio: 0 })
  const [instructions, setInstructions] = useState('')

  const [phase, setPhase] = useState<Phase>('setup')
  const [error, setError] = useState<string | null>(null)

  // Propuesta de módulos (revisión)
  const [proposals, setProposals] = useState<(ProposedModule & { selected: boolean })[]>([])

  // Generación + resultado
  const [items, setItems] = useState<GenItem[]>([])
  const [savedIds, setSavedIds] = useState<string[]>([])

  useEffect(() => {
    if (!isSuperAdmin) return
    supabase.from('campaigns').select('*').order('name').then(({ data }) => {
      setCampaigns(data ?? [])
      if (!campaignId && data?.[0]) setCampaignId(data[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin])

  const campaignName = useMemo(
    () => campaigns.find((c) => c.id === campaignId)?.name,
    [campaigns, campaignId],
  )

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setReadingName(file.name)
    setProgress({ stage: 'reading', ratio: 0 })
    setExtracting(true)
    try {
      const extracted = await extractDocumentText(file, (p) => setProgress(p))
      setDoc(extracted)
    } catch (err) {
      setDoc(null)
      setError(err instanceof Error ? err.message : 'No se pudo leer el archivo')
    } finally {
      setExtracting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleAnalyze = async () => {
    if (!doc || !campaignId) return
    setPhase('analyzing')
    setError(null)
    try {
      const { data } = await analyzeDocument({
        documentText: doc.text,
        instructions: instructions.trim() || undefined,
        campaignName,
        images: doc.images,
        contextImages: doc.contextImages,
      })
      if (!data.modules.length) throw new Error('La IA no propuso módulos. Prueba con instrucciones más específicas.')
      setProposals(data.modules.map((m) => ({ ...m, selected: true })))
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error analizando el documento')
      setPhase('setup')
    }
  }

  const toggleProposal = (idx: number) =>
    setProposals((prev) => prev.map((p, i) => (i === idx ? { ...p, selected: !p.selected } : p)))

  const updateProposalTitle = (idx: number, title: string) =>
    setProposals((prev) => prev.map((p, i) => (i === idx ? { ...p, title_es: title } : p)))

  const selectedCount = proposals.filter((p) => p.selected).length

  const handleGenerate = async () => {
    if (!doc) return
    const selected = proposals.filter((p) => p.selected)
    if (!selected.length) return

    const initial: GenItem[] = selected.map((p) => ({ proposed: p, status: 'pending' }))
    setItems(initial)
    setPhase('generating')
    setError(null)

    const docContext = {
      documentText: doc.text,
      images: doc.images,
      contextImages: doc.contextImages,
    }
    const setItem = (i: number, patch: Partial<GenItem>) =>
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))

    for (let i = 0; i < selected.length; i++) {
      setItem(i, { status: 'generating', progress: 'Diseñando el esquema…' })
      try {
        const description = buildDescription(selected[i])
        // Paso 1: esquema (1 llamada chica).
        const { data: outline } = await generateModuleOutline({ description, ...docContext })
        const headings = outline.sections.map((h) => h.heading_es)

        // Paso 2: cada sección por separado (llamadas chicas, a prueba de límites).
        const sections: GeneratedModule['sections'] = []
        for (let s = 0; s < outline.sections.length; s++) {
          setItem(i, { progress: `Generando sección ${s + 1}/${outline.sections.length}…` })
          const h = outline.sections[s]
          try {
            const { data } = await generateModuleSection({
              description,
              moduleTitle: outline.metadata.title_es,
              moduleSubtitle: outline.metadata.subtitle_es,
              objectives: outline.metadata.objectives_es,
              sectionHeading: h.heading_es,
              sectionIndex: s,
              totalSections: outline.sections.length,
              allHeadings: headings,
              ...docContext,
            })
            sections.push({ ...h, blocks: data.blocks })
          } catch {
            // Si una sección falla, se omite y se continúa con el resto.
          }
        }

        if (!sections.length) throw new Error('No se pudo generar el contenido de las secciones')
        const generated: GeneratedModule = { metadata: outline.metadata, sections }
        setItem(i, { status: 'done', generated, progress: undefined })
      } catch (err) {
        setItem(i, { status: 'error', progress: undefined, error: err instanceof Error ? err.message : 'Error' })
      }
    }
    setPhase('preview')
  }

  const generatedItems = items.filter((it) => it.status === 'done' && it.generated)

  const handleSaveAll = async () => {
    if (!generatedItems.length) return
    setPhase('done')
    const ids: string[] = []
    try {
      for (const it of generatedItems) {
        const id = await saveGeneratedModule(campaignId, it.generated!, doc?.images ?? [])
        ids.push(id)
      }
      setSavedIds(ids)
      toast.success(`${ids.length} módulo(s) creado(s) en ${campaignName ?? 'la campaña'}`)
    } catch (err) {
      toast.error(`Error guardando: ${err instanceof Error ? err.message : 'desconocido'}`)
      // Guarda los que sí se hayan creado y vuelve a la vista previa para reintentar el resto
      setSavedIds(ids)
      setPhase('preview')
    }
  }

  const resetToSetup = () => {
    setProposals([])
    setItems([])
    setPhase('setup')
    setError(null)
  }

  const busy = phase === 'analyzing' || phase === 'generating'

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      {/* Encabezado */}
      <div className="mb-6 sm:mb-8">
        <Link
          to="/admin/campaigns"
          className="inline-flex items-center gap-1.5 text-[12px] text-text-subtle hover:text-text transition-colors mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a campañas
        </Link>
        <p className="text-[11px] text-text-subtle uppercase tracking-wider mb-2">
          Admin / Campañas / Importar contenido
        </p>
        <GradientHeading as="h1" variant="white" size="headline">
          Importar contenido
        </GradientHeading>
        <p className="text-text-muted text-[13px] mt-1">
          Sube un archivo Word, Excel o PDF. La IA lo analiza y crea uno o varios módulos en 3 idiomas.
        </p>
      </div>

      {/* ── Configuración (campaña + archivo + instrucciones) ── */}
      <GlassCard intensity="subtle" padding="none" rounded="2xl" className="p-4 sm:p-6 mb-4">
        {/* Campaña destino */}
        {isSuperAdmin && campaigns.length > 0 && (
          <div className="mb-5">
            <label className="text-[11px] uppercase tracking-widest text-text-subtle font-medium mb-2 block">
              Campaña destino
            </label>
            <FilterDropdown
              value={campaignId}
              onChange={setCampaignId}
              options={[
                { value: '', label: '— Seleccionar campaña —' },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>
        )}

        {/* Archivo */}
        <label className="text-[11px] uppercase tracking-widest text-text-subtle font-medium mb-2 block">
          Documento fuente
        </label>
        {doc ? (
          <div className="rounded-xl bg-brand-violet/6 border border-brand-violet/15">
            <div className="flex items-center gap-3 px-4 py-3">
              {doc.kind === 'excel'
                ? <FileSpreadsheet className="h-5 w-5 text-brand-green shrink-0" />
                : <FileText className="h-5 w-5 text-brand-violet shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text font-medium truncate">{doc.fileName}</div>
                <div className="text-[11px] text-text-muted">
                  {(doc.text.length / 1000).toFixed(1)}k caracteres extraídos
                  {doc.images.length > 0 && ` · ${doc.images.length} figura(s) del documento`}
                  {doc.contextImages.length > 0 && ` · ${doc.contextImages.length} página(s) para análisis visual`}
                </div>
              </div>
              {!busy && phase === 'setup' && (
                <button
                  onClick={() => { setDoc(null); resetToSetup() }}
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                  title={i18n.t('admin.import.remove_file')}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {(doc.images.length > 0 || doc.contextImages.length > 0) && (
              <div className="px-4 pb-3 pt-1 border-t border-brand-violet/10">
                {doc.images.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {doc.images.map((img, k) => (
                      <img
                        key={k}
                        src={`data:${img.mediaType};base64,${img.dataBase64}`}
                        alt={`Figura ${k + 1} del documento`}
                        className="h-16 w-24 object-cover rounded-lg border border-glass-border/15 bg-white"
                      />
                    ))}
                  </div>
                )}
                {doc.images.length === 0 && doc.contextImages.length > 0 && (
                  <p className="text-[11px] text-text-subtle">
                    No se detectaron figuras insertables; las páginas se usarán solo para el análisis de la IA.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : extracting ? (
          <div className="rounded-xl bg-brand-violet/6 border border-brand-violet/15 px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="relative h-9 w-9 shrink-0 flex items-center justify-center">
                <Loader2 className="h-9 w-9 animate-spin text-brand-violet/70" />
                <FileText className="absolute h-4 w-4 text-brand-violet" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text font-medium truncate">{readingName || i18n.t('admin.import.reading')}</div>
                <div className="text-[11px] text-text-muted">
                  {i18n.t(`admin.import.stage_${progress.stage}`)}
                </div>
              </div>
              <span className="text-[12px] font-semibold text-brand-violet tabular-nums shrink-0">
                {Math.round(progress.ratio * 100)}%
              </span>
            </div>
            {/* Barra de progreso */}
            <div className="mt-3 h-1.5 w-full rounded-full bg-glass/10 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-brand-violet"
                initial={false}
                animate={{ width: `${Math.max(4, progress.ratio * 100)}%` }}
                transition={{ ease: 'easeOut', duration: 0.3 }}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'w-full flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-xl border border-dashed transition-all',
              'border-glass-border/25 hover:border-brand-violet/40 hover:bg-glass/4',
            )}
          >
            <Upload className="h-6 w-6 text-text-muted" />
            <span className="text-[13px] text-text font-medium">{i18n.t('admin.import.upload')}</span>
            <span className="text-[11px] text-text-subtle">{i18n.t('admin.import.formats')}</span>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_DOC_EXTENSIONS}
          className="hidden"
          onChange={handleFile}
        />

        {/* Instrucciones opcionales */}
        {phase === 'setup' && (
          <div className="mt-5">
            <label className="text-[11px] uppercase tracking-widest text-text-subtle font-medium mb-2 block">
              Instrucciones para la IA <span className="text-text-subtle normal-case font-normal">{i18n.t('admin.import.optional')}</span>
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={i18n.t('admin.import.ph_prompt')}
              rows={2}
              className={cn(
                'w-full rounded-xl px-4 py-3 text-[13px] text-text resize-none',
                'bg-glass/5 border border-glass-border/10',
                'focus:border-brand-violet/30 focus:bg-glass/8 focus:outline-none',
                'placeholder:text-text-subtle transition-colors',
              )}
            />
          </div>
        )}
      </GlassCard>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-xl px-4 py-3 text-[13px] text-danger bg-danger/8 border border-danger/20 mb-4"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Acción: Analizar ── */}
      {(phase === 'setup' || phase === 'analyzing') && (
        <div className="flex justify-end">
          <Button
            variant="neon"
            size="md"
            disabled={!doc || !campaignId || phase === 'analyzing'}
            onClick={handleAnalyze}
            className="min-w-[200px] flex items-center justify-center gap-2"
          >
            {phase === 'analyzing'
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {i18n.t('admin.import.analyzing')}</>
              : <><Wand2 className="h-4 w-4" /> {i18n.t('admin.import.analyze')}</>}
          </Button>
        </div>
      )}

      {/* ── Revisión de la propuesta ── */}
      {phase === 'review' && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard intensity="subtle" padding="none" rounded="2xl" className="p-4 sm:p-6 border border-brand-violet/15">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-semibold text-text">
                Propuesta: {proposals.length} módulo(s)
              </span>
              <button
                onClick={handleAnalyze}
                className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text transition-colors px-2 py-1 rounded-lg hover:bg-glass/8"
              >
                <RotateCcw className="h-3 w-3" /> Re-analizar
              </button>
            </div>
            <p className="text-[12px] text-text-muted mb-4">
              Revisa y desmarca los que no quieras crear. Puedes ajustar el título.
            </p>

            <div className="space-y-2.5">
              {proposals.map((p, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-xl border p-3 transition-colors',
                    p.selected ? 'border-brand-violet/25 bg-glass/4' : 'border-glass-border/10 bg-transparent opacity-60',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleProposal(i)}
                      className={cn(
                        'mt-0.5 h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors',
                        p.selected
                          ? 'bg-brand-violet/20 border-brand-violet/40 text-brand-violet'
                          : 'border-glass-border/30 text-transparent',
                      )}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <input
                        value={p.title_es}
                        onChange={(e) => updateProposalTitle(i, e.target.value)}
                        className="w-full bg-transparent text-[14px] font-medium text-text focus:outline-none border-b border-transparent focus:border-brand-violet/30 pb-0.5"
                      />
                      <p className="text-[12px] text-text-muted mt-1 leading-snug">{p.focus_es}</p>
                      {p.topics?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {p.topics.map((t, j) => (
                            <span key={j} className="text-[10px] px-2 py-0.5 rounded-full bg-glass/8 border border-glass-border/15 text-text-muted">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-5">
              <Button type="button" variant="ghost" size="md" onClick={resetToSetup} className="w-full sm:w-auto">
                <ArrowLeft className="h-4 w-4 mr-1.5" /> Cambiar archivo
              </Button>
              <Button
                variant="neon"
                size="md"
                disabled={selectedCount === 0}
                onClick={handleGenerate}
                className="w-full sm:w-auto sm:min-w-[200px] flex items-center justify-center gap-2"
              >
                <Sparkles className="h-4 w-4" /> Generar {selectedCount} módulo(s)
              </Button>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* ── Generación en progreso / Vista previa ── */}
      {(phase === 'generating' || phase === 'preview' || phase === 'done') && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard intensity="subtle" padding="none" rounded="2xl" className="p-4 sm:p-6 border border-brand-violet/15">
            <div className="flex items-center gap-2 mb-4">
              <div className={cn(
                'h-2 w-2 rounded-full',
                phase === 'generating' ? 'bg-brand-violet animate-pulse' : 'bg-brand-green',
              )} />
              <span className="text-[13px] font-semibold text-text">
                {phase === 'generating' ? 'Generando módulos con Claude…' : 'Módulos generados'}
              </span>
            </div>

            <div className="space-y-2">
              {items.map((it, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-glass/4 border border-glass-border/8"
                >
                  <div className="w-5 h-5 shrink-0 flex items-center justify-center mt-0.5">
                    {it.status === 'done' && <CheckCircle2 className="h-4 w-4 text-brand-green" />}
                    {it.status === 'generating' && <Loader2 className="h-4 w-4 animate-spin text-brand-violet" />}
                    {it.status === 'pending' && <div className="h-2.5 w-2.5 rounded-full border border-glass-border/30" />}
                    {it.status === 'error' && <AlertTriangle className="h-4 w-4 text-danger" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {it.generated && <span className="text-lg leading-none">{it.generated.metadata.icon}</span>}
                      <span className="text-[13px] text-text font-medium truncate">
                        {it.generated?.metadata.title_es ?? it.proposed.title_es}
                      </span>
                    </div>
                    {it.status === 'generating' && it.progress && (
                      <p className="text-[11px] text-brand-violet mt-1">{it.progress}</p>
                    )}
                    {it.status === 'done' && it.generated && (() => {
                      const usedIdx = new Set<number>()
                      it.generated.sections.forEach((s) =>
                        (s.blocks ?? []).forEach((b) => {
                          if (b.type === 'image' && typeof b.image_index === 'number') usedIdx.add(b.image_index)
                        }),
                      )
                      const figures = [...usedIdx]
                        .map((idx) => doc?.images[idx])
                        .filter((img): img is NonNullable<typeof img> => !!img)
                      const blockCount = it.generated.sections.reduce((n, s) => n + (s.blocks?.length ?? 0), 0)
                      return (
                        <>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <NeonBadge color="cyan" className="text-[9px]">{it.generated.metadata.duration_min} min</NeonBadge>
                            <span className="text-[11px] text-text-muted">{it.generated.sections.length} secciones</span>
                            <span className="text-[11px] text-text-muted">· {blockCount} bloques</span>
                            {figures.length > 0 && (
                              <span className="text-[11px] text-text-muted">· {figures.length} imagen(es)</span>
                            )}
                          </div>
                          {figures.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2.5">
                              {figures.map((img, k) => (
                                <img
                                  key={k}
                                  src={`data:${img.mediaType};base64,${img.dataBase64}`}
                                  alt={`Figura ${k + 1}`}
                                  className="h-16 w-24 object-cover rounded-lg border border-glass-border/15 bg-white"
                                />
                              ))}
                            </div>
                          )}
                        </>
                      )
                    })()}
                    {it.status === 'error' && (
                      <p className="text-[11px] text-danger mt-1">{it.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Acciones tras la generación */}
            {phase === 'preview' && (
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-5">
                <Button type="button" variant="ghost" size="md" onClick={() => setPhase('review')} className="w-full sm:w-auto">
                  <ArrowLeft className="h-4 w-4 mr-1.5" /> Volver a la propuesta
                </Button>
                <Button
                  variant="neon"
                  size="md"
                  disabled={generatedItems.length === 0}
                  onClick={handleSaveAll}
                  className="w-full sm:w-auto sm:min-w-[200px] flex items-center justify-center gap-2"
                >
                  <BookOpen className="h-4 w-4" /> Guardar {generatedItems.length} módulo(s)
                </Button>
              </div>
            )}

            {/* Estado final */}
            {phase === 'done' && (
              savedIds.length > 0 ? (
                <div className="mt-5">
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-brand-green/6 border border-brand-green/20 text-brand-green text-[12px] mb-3">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {savedIds.length} módulo(s) guardado(s) como borrador. Edítalos y publícalos cuando estén listos.
                  </div>
                  <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
                    <Button type="button" variant="ghost" size="md" onClick={() => navigate('/admin/modules')} className="w-full sm:w-auto">
                      Ver todos los módulos
                    </Button>
                    <Button
                      variant="neon"
                      size="md"
                      onClick={() => navigate(`/admin/modules/${savedIds[0]}`)}
                      className="w-full sm:w-auto flex items-center justify-center gap-2"
                    >
                      Editar el primero <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 mt-5 py-2 text-[13px] text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-violet" /> Guardando módulos…
                </div>
              )
            )}
          </GlassCard>
        </motion.div>
      )}
    </div>
  )
}
