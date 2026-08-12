/* ────────────────────────────────────────────────────────────────────────────
   "Crear sección con IA" — el modal que se abre desde la galería de secciones.

   Dos maneras de pedirla, y el modal lo dice sin letra chica:

   · Solo escribiendo → la IA se apoya en el módulo que ya está escrito.
   · Adjuntando un documento → la sección sale SOLO de ese documento, y ahí sí
     tiene sentido pedir varias de una (un manual no cabe en una sola sección).

   El número de secciones se propone leyendo el documento (`suggestModuleSectionCount`),
   pero lo decide el capacitador: es su documento y sabe cómo quiere partirlo.
   ──────────────────────────────────────────────────────────────────────────── */

import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  FileSpreadsheet,
  FileText,
  Loader2,
  Presentation,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { NumberField } from '@/components/ui/NumberField'
import { AiCreditsNotice } from '@/components/ui/AiCreditsNotice'
import { AiQuotaNotice } from '@/components/ui/AiQuotaNotice'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import {
  ACCEPTED_DOC_EXTENSIONS,
  extractDocumentText,
  suggestModuleSectionCount,
  type ExtractedDocument,
  type ExtractProgress,
} from '@/lib/documentExtract'
import { runSectionAiGeneration, MAX_AI_SECTIONS } from '@/services/sectionAi.service'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'

export interface AiSectionModalProps {
  open: boolean
  onClose: () => void
  moduleId: string
  campaignId: string
  moduleTitle: string
  moduleSubtitle?: string | null
  objectives?: string[] | null
  /** Encabezados actuales del módulo, en orden. */
  existingHeadings: string[]
  /** `sort_order` que le toca a la primera sección nueva. */
  startOrder: number
}

export function AiSectionModal({
  open,
  onClose,
  moduleId,
  campaignId,
  moduleTitle,
  moduleSubtitle,
  objectives,
  existingHeadings,
  startOrder,
}: AiSectionModalProps) {
  const { t } = useTranslation()
  const fileRef = useRef<HTMLInputElement>(null)

  const [instructions, setInstructions] = useState('')
  const [doc, setDoc] = useState<ExtractedDocument | null>(null)
  const [count, setCount] = useState(1)
  const [extracting, setExtracting] = useState(false)
  const [readingName, setReadingName] = useState('')
  const [progress, setProgress] = useState<ExtractProgress>({ stage: 'reading', ratio: 0 })
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setInstructions('')
    setDoc(null)
    setCount(1)
    setError(null)
    setExtracting(false)
  }

  const close = () => { reset(); onClose() }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setError(null)
    setReadingName(file.name)
    setProgress({ stage: 'reading', ratio: 0 })
    setExtracting(true)
    try {
      const extracted = await extractDocumentText(file, (p) => setProgress(p))
      setDoc(extracted)
      // Propuesta, no imposición: el documento sugiere en cuántas partirse.
      setCount(Math.min(MAX_AI_SECTIONS, suggestModuleSectionCount(extracted)))
    } catch (err) {
      setDoc(null)
      setError(err instanceof Error ? err.message : t('admin.section_ai.read_error'))
    } finally {
      setExtracting(false)
    }
  }

  const canGenerate = !extracting && (!!doc || instructions.trim().length > 0)

  const handleGenerate = () => {
    if (!canGenerate) return
    runSectionAiGeneration({
      moduleId,
      campaignId,
      moduleTitle,
      moduleSubtitle,
      objectives,
      existingHeadings,
      startOrder,
      instructions: instructions.trim(),
      doc,
      count,
    })
    toast.success(t('admin.section_ai.started'))
    close()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm"
            {...backdropDismiss(close)}
          />

          <motion.div
            className="relative z-10 w-full max-w-lg"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="bg-surface border border-line rounded-3xl shadow-xl overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-green/40 to-transparent" />

              <div className="p-6 max-h-[85vh] overflow-y-auto">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <NeonBadge color="green" dot className="mb-2">
                      {t('admin.section_ai.badge')}
                    </NeonBadge>
                    <GradientHeading as="h2" variant="white" size="headline">
                      {t('admin.section_ai.title')}
                    </GradientHeading>
                    <p className="text-[13px] text-text-muted mt-1">
                      {t('admin.section_ai.subtitle')}
                    </p>
                  </div>
                  <button
                    onClick={close}
                    className="p-2 rounded-xl bg-subtle border border-line text-text-muted hover:text-text transition-colors shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <AiCreditsNotice className="mb-3" />
                <AiQuotaNotice className="mb-3" />
                <AiReviewNotice className="mb-5" />

                {/* Qué debe cubrir la sección */}
                <label className="text-[11px] uppercase tracking-widest text-text-subtle font-medium mb-2 block">
                  {t('admin.section_ai.instructions_label')}
                </label>
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={4}
                  placeholder={t('admin.section_ai.instructions_ph')}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] text-text outline-none transition-colors focus:border-primary resize-y"
                />

                {/* Documento (opcional) */}
                <label className="text-[11px] uppercase tracking-widest text-text-subtle font-medium mt-5 mb-2 block">
                  {t('admin.section_ai.document_label')}
                </label>
                {doc ? (
                  <div className="rounded-xl bg-brand-violet/6 border border-brand-violet/15 flex items-center gap-3 px-4 py-3">
                    {doc.kind === 'excel'
                      ? <FileSpreadsheet className="h-5 w-5 text-brand-green shrink-0" />
                      : doc.kind === 'powerpoint'
                      ? <Presentation className="h-5 w-5 text-[#D24726] shrink-0" />
                      : <FileText className="h-5 w-5 text-brand-violet shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] text-text font-medium truncate">{doc.fileName}</div>
                      <div className="text-[11px] text-text-muted">
                        {doc.text.trim()
                          ? t('admin.import.chars_extracted', { n: (doc.text.length / 1000).toFixed(1) })
                          : t('admin.import.no_text_scanned')}
                        {doc.images.length > 0 && doc.text.trim()
                          && ` ${t('admin.import.figures_from_doc', { n: doc.images.length })}`}
                      </div>
                    </div>
                    <button
                      onClick={() => { setDoc(null); setCount(1); setError(null) }}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors shrink-0"
                      title={t('admin.import.remove_file')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : extracting ? (
                  <div className="rounded-xl bg-brand-violet/6 border border-brand-violet/15 px-4 py-4">
                    <div className="flex items-center gap-3">
                      <Loader2 className="h-5 w-5 animate-spin text-brand-violet shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-text font-medium truncate">
                          {readingName || t('admin.import.reading')}
                        </div>
                        <div className="text-[11px] text-text-muted">
                          {t(`admin.import.stage_${progress.stage}`)}
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
                    onClick={() => fileRef.current?.click()}
                    className={cn(
                      'w-full flex flex-col items-center justify-center gap-1.5 px-4 py-6 rounded-xl border border-dashed transition-all',
                      'border-glass-border/25 hover:border-brand-violet/40 hover:bg-glass/4',
                    )}
                  >
                    <Upload className="h-5 w-5 text-text-muted" />
                    <span className="text-[13px] text-text font-medium">{t('admin.section_ai.upload')}</span>
                    <span className="text-[11px] text-text-subtle">{t('admin.import.formats')}</span>
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED_DOC_EXTENSIONS}
                  className="hidden"
                  onChange={handleFile}
                />
                <p className="text-[11px] text-text-subtle mt-2 leading-snug">
                  {doc ? t('admin.section_ai.source_doc_hint') : t('admin.section_ai.source_module_hint')}
                </p>

                {/* Cuántas secciones */}
                <div className="mt-5 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <label
                      htmlFor="ai-section-count"
                      className="text-[11px] uppercase tracking-widest text-text-subtle font-medium block"
                    >
                      {t('admin.section_ai.count_label')}
                    </label>
                    <p className="text-[11px] text-text-subtle mt-1 leading-snug">
                      {doc
                        ? t('admin.section_ai.count_hint_doc', { n: suggestModuleSectionCount(doc) })
                        : t('admin.section_ai.count_hint_text')}
                    </p>
                  </div>
                  <NumberField
                    id="ai-section-count"
                    value={count}
                    onChange={setCount}
                    min={1}
                    max={MAX_AI_SECTIONS}
                    className="w-20 shrink-0 rounded-xl border border-line bg-surface px-3 py-2 text-[14px] tabular-nums text-text text-center outline-none transition-colors focus:border-primary"
                    aria-label={t('admin.section_ai.count_label')}
                  />
                </div>

                {error && (
                  <p className="mt-4 text-[12px] text-danger">{error}</p>
                )}

                <div className="mt-6 flex items-center justify-end gap-2">
                  <Button variant="glass" size="sm" onClick={close}>
                    {t('common.cancel')}
                  </Button>
                  <Button size="sm" onClick={handleGenerate} disabled={!canGenerate}>
                    <Sparkles className="h-3.5 w-3.5" />
                    {count > 1
                      ? t('admin.section_ai.generate_n', { count })
                      : t('admin.section_ai.generate')}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
