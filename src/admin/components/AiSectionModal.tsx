/* ────────────────────────────────────────────────────────────────────────────
   "Crear sección con IA" — el modal que se abre desde la galería de secciones.

   Dos maneras de pedirla, y el modal lo dice sin letra chica:

   · Solo escribiendo → la IA se apoya en el módulo que ya está escrito.
   · Adjuntando un documento → la sección sale SOLO de ese documento, y ahí sí
     tiene sentido pedir varias de una (un manual no cabe en una sola sección).

   El número de secciones se propone leyendo el documento (`suggestModuleSectionCount`),
   pero lo decide el capacitador: es su documento y sabe cómo quiere partirlo.
   ──────────────────────────────────────────────────────────────────────────── */

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  FileSpreadsheet,
  FileText,
  Loader2,
  Presentation,
  Sparkles,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { NumberField } from '@/components/ui/NumberField'
import { AiCreditsNotice } from '@/components/ui/AiCreditsNotice'
import { AiQuotaNotice } from '@/components/ui/AiQuotaNotice'
import { AiReviewNotice } from '@/components/ui/AiReviewNotice'
import { FileDropZone } from '@/components/ui/FileDropZone'
import { Modal } from '@/components/ui/Modal'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  ACCEPTED_DOC_EXTENSIONS,
  extractDocumentText,
  suggestModuleSectionCount,
  type ExtractedDocument,
  type ExtractProgress,
} from '@/lib/documentExtract'
import { runSectionAiGeneration, MAX_AI_SECTIONS } from '@/services/sectionAi.service'
import { toast } from '@/stores/toastStore'

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

  const handleFile = async (file: File) => {
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

  if (!open) return null

  return (
    <Modal
      onClose={close}
      title={t('admin.section_ai.title')}
      subtitle={t('admin.section_ai.subtitle')}
      icon={<Sparkles className="h-4 w-4" />}
      accent="green"
      size="lg"
      dismissible={!extracting}
      footerLeft={<AiReviewNotice variant="inline" />}
      footer={
        <>
          <Button variant="glass" size="sm" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={handleGenerate} disabled={!canGenerate}>
            <Sparkles className="h-3.5 w-3.5" />
            {count > 1
              ? t('admin.section_ai.generate_n', { count })
              : t('admin.section_ai.generate')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <AiCreditsNotice />
        <AiQuotaNotice />

        {/* Qué debe cubrir la sección */}
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-text-subtle">
            {t('admin.section_ai.instructions_label')}
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder={t('admin.section_ai.instructions_ph')}
            className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] text-text outline-none transition-colors focus:border-primary"
          />
        </div>

        {/* Documento (opcional) */}
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-text-subtle">
            {t('admin.section_ai.document_label')}
          </label>
          {doc ? (
            <div className="flex items-center gap-3 rounded-xl border border-brand-violet/15 bg-brand-violet/6 px-4 py-3">
              {doc.kind === 'excel'
                ? <FileSpreadsheet className="h-5 w-5 shrink-0 text-brand-green" />
                : doc.kind === 'powerpoint'
                ? <Presentation className="h-5 w-5 shrink-0 text-[#D24726]" />
                : <FileText className="h-5 w-5 shrink-0 text-brand-violet" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text">{doc.fileName}</div>
                <div className="text-[11px] text-text-muted">
                  {doc.text.trim()
                    ? t('admin.import.chars_extracted', { n: (doc.text.length / 1000).toFixed(1) })
                    : t('admin.import.no_text_scanned')}
                  {doc.images.length > 0 && doc.text.trim()
                    && ` ${t('admin.import.figures_from_doc', { n: doc.images.length })}`}
                </div>
              </div>
              <Tooltip label={t('admin.import.remove_file')}>
                <button
                  onClick={() => { setDoc(null); setCount(1); setError(null) }}
                  aria-label={t('admin.import.remove_file')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <X className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
          ) : extracting ? (
            <div className="rounded-xl border border-brand-violet/15 bg-brand-violet/6 px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-violet" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-text">
                    {readingName || t('admin.import.reading')}
                  </div>
                  <div className="text-[11px] text-text-muted">
                    {t(`admin.import.stage_${progress.stage}`)}
                  </div>
                </div>
                <span className="shrink-0 text-[12px] font-semibold tabular-nums text-brand-violet">
                  {Math.round(progress.ratio * 100)}%
                </span>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-glass/10">
                <motion.div
                  className="h-full rounded-full bg-brand-violet"
                  initial={false}
                  animate={{ width: `${Math.max(4, progress.ratio * 100)}%` }}
                  transition={{ ease: 'easeOut', duration: 0.3 }}
                />
              </div>
            </div>
          ) : (
            <FileDropZone
              size="sm"
              accept={ACCEPTED_DOC_EXTENSIONS}
              onFile={handleFile}
              hint={t('admin.import.formats_short')}
              hintFull={t('admin.import.formats')}
            />
          )}
          <p className="mt-1.5 text-[11px] leading-snug text-text-subtle">
            {doc ? t('admin.section_ai.source_doc_hint') : t('admin.section_ai.source_module_hint')}
          </p>
        </div>

        {/* Cuántas secciones */}
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="ai-section-count"
              className="block text-[11px] font-medium uppercase tracking-widest text-text-subtle"
            >
              {t('admin.section_ai.count_label')}
            </label>
            <p className="mt-1 text-[11px] leading-snug text-text-subtle">
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
            className="w-20 shrink-0 rounded-xl border border-line bg-surface px-3 py-2 text-center text-[14px] tabular-nums text-text outline-none transition-colors focus:border-primary"
            aria-label={t('admin.section_ai.count_label')}
          />
        </div>

        {error && <p className="text-[12px] text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
