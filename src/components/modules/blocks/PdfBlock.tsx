import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  FileText, Download, Maximize2, ExternalLink,
  CheckCircle2, Loader2, ShieldCheck, RotateCcw,
} from 'lucide-react';
import { saveActivityAttempt } from '@/services/activity.service';
import type { PdfBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

interface Props {
  block: PdfBlock;
  language: Language;
  userId?: string;
  campaignId?: string;
  moduleId?: string;
  sectionId?: string;
  blockIndex?: number;
  /** Último intento DOCUMENT_REVIEW guardado (para restaurar "ya revisado"). */
  savedAttempt?: any;
}

/** Nombre legible del documento: título del capacitador → nombre de archivo → genérico. */
function docName(block: PdfBlock, language: Language, fallback: string): string {
  const title = block.title?.[language] || block.title?.es;
  if (title) return title;
  if (block.filename) return block.filename;
  return fallback;
}

export function PdfBlockRenderer({
  block, language, userId, campaignId, moduleId, sectionId, blockIndex, savedAttempt,
}: Props) {
  const { t } = useTranslation();

  const required = block.required !== false;
  const [reviewed, setReviewed] = useState<boolean>(!!savedAttempt);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sin documento cargado (p. ej. vista previa mientras el capacitador aún no sube nada).
  if (!block.url) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-8 text-center">
        <FileText className="mx-auto mb-2 h-6 w-6 text-text-subtle" />
        <p className="text-[13px] text-text-subtle">{t('module.blocks.pdf.empty')}</p>
      </div>
    );
  }

  const name = docName(block, language, t('module.blocks.pdf.default_name'));
  const caption = block.caption?.[language] || block.caption?.es;
  // #view=FitH ajusta el ancho; toolbar visible para navegar/descargar desde el visor nativo.
  const viewerUrl = `${block.url}#view=FitH`;

  const handleReview = async () => {
    // Marca como revisado. Si hay contexto de guardado, registra el intento
    // DOCUMENT_REVIEW (score 100) que alimenta la compuerta del módulo.
    if (userId && campaignId && sectionId) {
      setSaving(true);
      try {
        await saveActivityAttempt({
          user_id: userId,
          campaign_id: campaignId,
          module_id: moduleId || '',
          section_id: sectionId,
          game_type: 'DOCUMENT_REVIEW',
          score: 100,
          status: 'completed',
          submitted_answers: {
            doc_key: `${sectionId}:b${blockIndex ?? 0}`,
            documento: name,
            filename: block.filename ?? null,
            mensaje: 'Documento revisado por el aprendiz',
          },
        });
      } catch (err) {
        console.error('[PdfBlock] no se pudo guardar la revisión', err);
      } finally {
        setSaving(false);
      }
    }
    setReviewed(true);
  };

  return (
    <div className="rounded-2xl border border-line overflow-hidden bg-surface shadow-sm">
      {/* ── Barra de título con acciones ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-subtle/60">
        <span className="h-9 w-9 shrink-0 rounded-xl bg-neon-magenta/10 text-neon-magenta flex items-center justify-center">
          <FileText className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold text-text truncate">{name}</p>
          <p className="text-[11px] text-text-subtle">
            PDF{required ? ` · ${t('module.blocks.pdf.required_tag')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={block.url}
            target="_blank"
            rel="noopener noreferrer"
            title={t('module.blocks.pdf.open_tab')}
            className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-glass-border/10 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <a
            href={block.url}
            download={block.filename || undefined}
            title={t('module.blocks.pdf.download')}
            className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-glass-border/10 transition-colors"
          >
            <Download className="h-4 w-4" />
          </a>
        </div>
      </div>

      {caption && (
        <p className="px-4 pt-3 text-[12.5px] text-text-muted">{caption}</p>
      )}

      {/* ── Visor embebido ── */}
      <div className="p-3">
        <div className="relative rounded-xl overflow-hidden border border-line bg-neutral-100 dark:bg-black/40">
          <iframe
            src={viewerUrl}
            title={name}
            className="w-full h-[70vh] min-h-[440px] border-0 block"
          />
          <a
            href={block.url}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/70 text-white text-[12px] font-medium hover:bg-black/85 transition-colors backdrop-blur-sm"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            {t('module.blocks.pdf.fullscreen')}
          </a>
        </div>
      </div>

      {/* ── Confirmación obligatoria de revisión ── */}
      {required && (
        <div className="px-4 pb-4">
          <AnimatePresence mode="wait">
            {reviewed ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 rounded-xl border border-neon-green/25 bg-neon-green/[0.06] px-4 py-3"
              >
                <CheckCircle2 className="h-5 w-5 text-neon-green shrink-0" />
                <div className="flex-1">
                  <p className="text-[13px] font-semibold text-text">{t('module.blocks.pdf.reviewed_title')}</p>
                  <p className="text-[11.5px] text-text-subtle">{t('module.blocks.pdf.reviewed_hint')}</p>
                </div>
                <button
                  onClick={() => { setReviewed(false); setConfirmed(false); }}
                  className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('module.blocks.pdf.review_again')}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="pending"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-4 space-y-3"
              >
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="h-4.5 w-4.5 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[12.5px] text-text-muted leading-relaxed">
                    {t('module.blocks.pdf.gate_hint')}
                  </p>
                </div>
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-neon-green cursor-pointer"
                  />
                  <span className="text-[13px] text-text leading-snug">
                    {t('module.blocks.pdf.confirm_label')}
                  </span>
                </label>
                <button
                  onClick={handleReview}
                  disabled={!confirmed || saving}
                  className={cn(
                    'w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all',
                    confirmed && !saving
                      ? 'bg-neon-green text-black hover:bg-neon-green/90'
                      : 'bg-subtle text-text-subtle cursor-not-allowed',
                  )}
                >
                  {saving
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {t('common.saving')}</>
                    : <><CheckCircle2 className="h-4 w-4" /> {t('module.blocks.pdf.mark_reviewed')}</>}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
