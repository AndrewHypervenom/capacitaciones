import { useEffect, useMemo, useRef, useState } from 'react'
import i18n from '@/i18n'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Upload, FileText, FileSpreadsheet, Sparkles, Loader2, X,
  CheckCircle2, AlertTriangle, RotateCcw, BookOpen, ChevronRight,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  extractDocumentText, ACCEPTED_DOC_EXTENSIONS,
  type ExtractedDocument, type ExtractStage,
} from '@/lib/documentExtract'
import {
  generateModuleOutline, generateModuleSection,
  type GeneratedModule,
} from '@/services/ai.service'
import { saveGeneratedModule } from '@/services/modules.service'
import {
  addModuleToCourse, getCourseById, type CourseWithModules,
} from '@/services/courses.service'
import { syncCourseWorldAndGenerate } from '@/services/worlds.service'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import type { Campaign } from '@/types/database'

// El documento completo se convierte en UN solo módulo (no se divide en varios).
type Phase = 'setup' | 'generating' | 'preview' | 'done'

// `embedded`: cuando se renderiza dentro de otra pantalla (p. ej. la pestaña
// "Generar con IA" de NewModulePage) se oculta la cabecera y el contenedor
// propio para que se integre sin duplicar títulos ni márgenes.
export default function ImportContent({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { campaignId: authCampaignId, isSuperAdmin } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState(searchParams.get('campaign') ?? authCampaignId ?? '')

  // Si llegamos desde un curso (?courseId=), el módulo se adjunta a ese curso.
  const courseId = searchParams.get('courseId') ?? ''
  const [course, setCourse] = useState<CourseWithModules | null>(null)

  const [doc, setDoc] = useState<ExtractedDocument | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [readingName, setReadingName] = useState('')
  const [progress, setProgress] = useState<{ stage: ExtractStage; ratio: number }>({ stage: 'reading', ratio: 0 })
  const [instructions, setInstructions] = useState('')

  const [phase, setPhase] = useState<Phase>('setup')
  const [error, setError] = useState<string | null>(null)

  // Generación + resultado (un único módulo)
  const [genProgress, setGenProgress] = useState('')
  const [generated, setGenerated] = useState<GeneratedModule | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  useEffect(() => {
    if (!isSuperAdmin) return
    supabase.from('campaigns').select('*').order('name').then(({ data }) => {
      setCampaigns(data ?? [])
      if (!campaignId && data?.[0]) setCampaignId(data[0].id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin])

  // Si venimos de un curso, fijamos su campaña y lo recordamos para adjuntar/volver.
  useEffect(() => {
    if (!courseId) return
    getCourseById(courseId)
      .then((c) => {
        if (c) {
          setCourse(c)
          setCampaignId(c.campaign_id)
        }
      })
      .catch(() => {})
  }, [courseId])

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

  const resetToSetup = () => {
    setGenerated(null)
    setSavedId(null)
    setPhase('setup')
    setError(null)
  }

  const handleGenerate = async () => {
    if (!doc || !campaignId) return
    setPhase('generating')
    setError(null)
    setGenerated(null)
    setGenProgress('Diseñando el esquema…')

    // Se usa únicamente el conocimiento del documento (sin inventar).
    const description = instructions.trim()
      || `Crea un módulo de formación a partir del documento "${doc.fileName}". `
        + 'Usa únicamente el conocimiento presente en el documento, sin inventar contenido.'
    const docContext = {
      documentText: doc.text,
      images: doc.images,
      contextImages: doc.contextImages,
    }

    try {
      // Paso 1: esquema (1 llamada chica).
      const { data: outline } = await generateModuleOutline({ description, ...docContext })
      const headings = outline.sections.map((h) => h.heading_es)

      // Paso 2: cada sección por separado (llamadas chicas, a prueba de límites).
      const sections: GeneratedModule['sections'] = []
      for (let s = 0; s < outline.sections.length; s++) {
        setGenProgress(`Generando sección ${s + 1}/${outline.sections.length}…`)
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
      setGenerated({ metadata: outline.metadata, sections })
      setPhase('preview')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando el módulo')
      setPhase('setup')
    }
  }

  const handleSave = async () => {
    if (!generated) return
    setPhase('done')
    try {
      const id = await saveGeneratedModule(campaignId, generated, doc?.images ?? [])
      // Si venimos de un curso, adjuntamos el módulo y sincronizamos su mundo
      // (solo si ya existe; no lo fuerza). Si falla, el módulo igual queda creado.
      if (courseId && course) {
        try {
          const maxOrder = Math.max(0, ...course.modules.map((m) => m.course_sort_order))
          await addModuleToCourse(courseId, id, maxOrder + 1)
          // Refleja el módulo como región del mundo del curso (si tiene mundo) y
          // genera sus niveles/quiz con IA en 2º plano; el progreso y el
          // resultado se ven en el indicador global de procesos.
          void syncCourseWorldAndGenerate(courseId)
            .catch(() => toast.error('No se pudo actualizar el mundo del curso'))
        } catch { /* módulo queda creado aunque no se adjunte */ }
      }
      setSavedId(id)
      toast.success(course
        ? `Módulo creado y agregado a ${course.title_es}`
        : `Módulo creado en ${campaignName ?? 'la campaña'}`)
    } catch (err) {
      toast.error(`Error guardando: ${err instanceof Error ? err.message : 'desconocido'}`)
      setPhase('preview')
    }
  }

  const busy = phase === 'generating'

  // Figuras del documento efectivamente usadas por el módulo generado.
  const usedFigures = useMemo(() => {
    if (!generated) return []
    const usedIdx = new Set<number>()
    generated.sections.forEach((s) =>
      (s.blocks ?? []).forEach((b) => {
        if (b.type === 'image' && typeof b.image_index === 'number') usedIdx.add(b.image_index)
      }),
    )
    return [...usedIdx]
      .map((idx) => doc?.images[idx])
      .filter((img): img is NonNullable<typeof img> => !!img)
  }, [generated, doc])

  return (
    <div className={embedded ? '' : 'p-4 sm:p-8 max-w-3xl mx-auto'}>
      {/* Encabezado (se omite cuando va embebido en otra pantalla) */}
      {!embedded && (
        <div className="mb-6 sm:mb-8">
          <Link
            to={course ? `/admin/courses/${courseId}` : '/admin/campaigns'}
            className="inline-flex items-center gap-1.5 text-[12px] text-text-subtle hover:text-text transition-colors mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {course ? 'Volver al curso' : 'Volver a campañas'}
          </Link>
          <p className="text-[11px] text-text-subtle uppercase tracking-wider mb-2">
            {course ? `Admin / Cursos / ${course.title_es}` : 'Admin / Campañas'} / Generar contenido
          </p>
          <GradientHeading as="h1" variant="white" size="headline">
            Generar contenido
          </GradientHeading>
          <p className="text-text-muted text-[13px] mt-1">
            Sube un archivo Word, Excel o PDF. La IA lo analiza y crea un módulo en 3 idiomas.
          </p>
        </div>
      )}

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

      {/* ── Acción: Generar el módulo ── */}
      {(phase === 'setup' || phase === 'generating') && (
        <div className="flex justify-end">
          <Button
            variant="neon"
            size="md"
            disabled={!doc || !campaignId || phase === 'generating'}
            onClick={handleGenerate}
            className="min-w-[200px] flex items-center justify-center gap-2"
          >
            {phase === 'generating'
              ? <><Loader2 className="h-4 w-4 animate-spin" /> {genProgress || 'Generando…'}</>
              : <><Sparkles className="h-4 w-4" /> Generar módulo</>}
          </Button>
        </div>
      )}

      {/* ── Vista previa del módulo generado ── */}
      {(phase === 'preview' || phase === 'done') && generated && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard intensity="subtle" padding="none" rounded="2xl" className="p-4 sm:p-6 border border-brand-violet/15">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-brand-green animate-pulse" />
                <span className="text-[13px] font-semibold text-text">Módulo generado</span>
              </div>
              {phase === 'preview' && (
                <button
                  onClick={handleGenerate}
                  className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text transition-colors px-2 py-1 rounded-lg hover:bg-glass/8"
                >
                  <RotateCcw className="h-3 w-3" /> Regenerar
                </button>
              )}
            </div>

            {/* Cabecera del módulo */}
            <div className="flex items-start gap-3 mb-4 p-3 rounded-xl bg-glass/4 border border-glass-border/8">
              <span className="text-3xl leading-none">{generated.metadata.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-text leading-snug">{generated.metadata.title_es}</p>
                <p className="text-[12px] text-text-muted mt-0.5 leading-snug">{generated.metadata.subtitle_es}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <NeonBadge color="cyan" className="text-[9px]">{generated.metadata.duration_min} min</NeonBadge>
                  <span className="text-[11px] text-text-muted">{generated.sections.length} secciones</span>
                  {usedFigures.length > 0 && (
                    <span className="text-[11px] text-text-muted">· {usedFigures.length} imagen(es)</span>
                  )}
                </div>
              </div>
            </div>

            {/* Secciones */}
            <div className="space-y-1.5">
              {generated.sections.map((s, i) => (
                <div key={i} className="flex items-center gap-2.5 py-2 px-3 rounded-xl bg-glass/3 border border-glass-border/6">
                  <span className="text-[10px] font-mono text-text-subtle w-4 shrink-0 text-right">{i + 1}</span>
                  <span className="text-[12px] text-text flex-1 truncate">{s.heading_es}</span>
                  <span className="text-[9px] text-text-subtle shrink-0">{s.blocks?.length ?? 0} bloques</span>
                </div>
              ))}
            </div>

            {usedFigures.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {usedFigures.map((img, k) => (
                  <img
                    key={k}
                    src={`data:${img.mediaType};base64,${img.dataBase64}`}
                    alt={`Figura ${k + 1}`}
                    className="h-16 w-24 object-cover rounded-lg border border-glass-border/15 bg-white"
                  />
                ))}
              </div>
            )}

            {/* Acciones tras la generación */}
            {phase === 'preview' && (
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 mt-5">
                <Button type="button" variant="ghost" size="md" onClick={resetToSetup} className="w-full sm:w-auto">
                  <ArrowLeft className="h-4 w-4 mr-1.5" /> Cambiar archivo
                </Button>
                <Button
                  variant="neon"
                  size="md"
                  onClick={handleSave}
                  className="w-full sm:w-auto sm:min-w-[200px] flex items-center justify-center gap-2"
                >
                  <BookOpen className="h-4 w-4" /> Guardar módulo
                </Button>
              </div>
            )}

            {/* Estado final */}
            {phase === 'done' && (
              savedId ? (
                <div className="mt-5">
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-brand-green/6 border border-brand-green/20 text-brand-green text-[12px] mb-3">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    Módulo guardado como borrador. Edítalo y publícalo cuando esté listo.
                  </div>
                  <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      onClick={() => navigate(course ? `/admin/courses/${courseId}` : '/admin/modules')}
                      className="w-full sm:w-auto"
                    >
                      {course ? 'Volver al curso' : 'Ver todos los módulos'}
                    </Button>
                    <Button
                      variant="neon"
                      size="md"
                      onClick={() => navigate(`/admin/modules/${savedId}`)}
                      className="w-full sm:w-auto flex items-center justify-center gap-2"
                    >
                      Editar módulo <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 mt-5 py-2 text-[13px] text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-violet" /> Guardando módulo…
                </div>
              )
            )}
          </GlassCard>
        </motion.div>
      )}
    </div>
  )
}
