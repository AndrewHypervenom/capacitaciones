import { useEffect, useMemo, useRef, useState } from 'react'
import i18n from '@/i18n'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Upload, FileText, FileSpreadsheet, Sparkles, Loader2, X,
  AlertTriangle, ListChecks,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  extractDocumentText, ACCEPTED_DOC_EXTENSIONS,
  type ExtractedDocument, type ExtractStage,
} from '@/lib/documentExtract'
import { runModuleAiGeneration } from '@/services/moduleAi.service'
import { getCourseById, type CourseWithModules } from '@/services/courses.service'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { Button } from '@/components/ui/Button'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { cn } from '@/lib/cn'
import { toast } from '@/stores/toastStore'
import type { Campaign } from '@/types/database'

// El documento completo se convierte en UN solo módulo (no se divide en varios).
// La generación con IA corre en SEGUNDO PLANO (indicador global, cancelable): esta
// pantalla solo prepara el documento y dispara el proceso.

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
  const [error, setError] = useState<string | null>(null)

  // Modo manual paso a paso: fidelidad máxima a un manual/procedimiento.
  const [manualMode, setManualMode] = useState(false)
  const lastFileRef = useRef<File | null>(null)

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

  const extractFile = async (file: File, manual: boolean) => {
    setError(null)
    setReadingName(file.name)
    setProgress({ stage: 'reading', ratio: 0 })
    setExtracting(true)
    try {
      const extracted = await extractDocumentText(file, (p) => setProgress(p), { manualMode: manual })
      setDoc(extracted)
    } catch (err) {
      setDoc(null)
      setError(err instanceof Error ? err.message : 'No se pudo leer el archivo')
    } finally {
      setExtracting(false)
    }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return
    lastFileRef.current = file
    await extractFile(file, manualMode)
  }

  // Al cambiar el modo manual re-extraemos el mismo archivo.
  const handleToggleManual = async (next: boolean) => {
    setManualMode(next)
    if (lastFileRef.current) {
      await extractFile(lastFileRef.current, next)
    }
  }

  // Dispara la generación EN SEGUNDO PLANO y devuelve el control de inmediato:
  // el avance (y el botón Cancelar) viven en el indicador global de tareas.
  const handleGenerate = () => {
    if (!doc || !campaignId) return
    const nextOrder = course ? Math.max(0, ...course.modules.map((m) => m.course_sort_order)) + 1 : 1
    runModuleAiGeneration({
      campaignId,
      instructions,
      doc,
      manualMode,
      course: course ? { id: course.id, nextOrder } : null,
    })
    toast.success(i18n.t('admin.import.bg_started'))
    // Volvemos al curso/lista; el módulo aparecerá cuando termine (aviso + acción).
    navigate(course ? `/admin/courses/${courseId}` : '/admin/modules')
  }

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
                  {doc.text.trim()
                    ? `${(doc.text.length / 1000).toFixed(1)}k caracteres extraídos`
                    : 'Sin texto (documento escaneado) — se leerá con visión'}
                  {doc.images.length > 0 && doc.text.trim() && ` · ${doc.images.length} figura(s) del documento`}
                  {doc.contextImages.length > 0 && ` · ${doc.contextImages.length} página(s)${manualMode && !doc.text.trim() ? ' — se recortarán las capturas' : ' para análisis visual'}`}
                </div>
              </div>
              <button
                onClick={() => { setDoc(null); lastFileRef.current = null; setError(null) }}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                title={i18n.t('admin.import.remove_file')}
              >
                <X className="h-4 w-4" />
              </button>
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

        {/* Modo manual paso a paso */}
        <button
          type="button"
          onClick={() => handleToggleManual(!manualMode)}
          disabled={extracting}
          className={cn(
            'mt-5 w-full flex items-start gap-3 rounded-xl px-4 py-3 text-left transition-all border',
            manualMode
              ? 'bg-brand-violet/8 border-brand-violet/30'
              : 'bg-glass/4 border-glass-border/10 hover:border-brand-violet/20',
            extracting && 'opacity-60 cursor-wait',
          )}
        >
          <div className={cn(
            'mt-0.5 h-8 w-8 shrink-0 flex items-center justify-center rounded-lg transition-colors',
            manualMode ? 'bg-brand-violet/20 text-brand-violet' : 'bg-glass/8 text-text-muted',
          )}>
            <ListChecks className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-text">Manual / paso a paso</span>
              <span className={cn(
                'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                manualMode ? 'bg-brand-violet' : 'bg-glass/20',
              )}>
                <span className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
                  manualMode ? 'left-[18px]' : 'left-0.5',
                )} />
              </span>
            </div>
            <p className="text-[11px] text-text-muted mt-0.5 leading-snug">
              Fidelidad máxima a un procedimiento: conserva cada paso en orden e inserta la captura de cada paso. Úsalo para manuales con pantallazos exactos (analiza más a fondo; tarda un poco más).
            </p>
          </div>
        </button>

        {/* Instrucciones opcionales */}
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
      </GlassCard>

      {/* Error de extracción */}
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

      {/* ── Acción: generar (en segundo plano) ── */}
      <p className="flex items-center gap-1.5 text-[11px] text-text-subtle mb-3">
        <Sparkles className="h-3 w-3 shrink-0" />
        {i18n.t('admin.import.bg_started')}
      </p>
      <div className="flex justify-end">
        <Button
          variant="neon"
          size="md"
          disabled={!doc || !campaignId || extracting}
          onClick={handleGenerate}
          className="min-w-[200px] flex items-center justify-center gap-2"
        >
          <Sparkles className="h-4 w-4" /> Generar módulo
        </Button>
      </div>
    </div>
  )
}
