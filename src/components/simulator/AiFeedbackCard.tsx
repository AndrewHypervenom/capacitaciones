import { useTranslation } from 'react-i18next';
import { Lightbulb, Loader2, Sparkles, ThumbsUp } from 'lucide-react';
import type { AiFeedback } from '@/services/certification.service';

interface Props {
  feedback: AiFeedback | null;
  loading: boolean;
}

/**
 * Tarjeta de retroalimentación personalizada generada por IA (Groq).
 * Compartida por el resultado de llamada y el de opción múltiple.
 * Si `loading`, muestra un estado de "analizando". Si no hay feedback y no
 * está cargando (IA no disponible), no renderiza nada.
 */
export function AiFeedbackCard({ feedback, loading }: Props) {
  const { t } = useTranslation();

  if (!feedback && !loading) return null;

  return (
    <div className="surface-card p-6 text-left">
      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-text-subtle font-medium">
            {t('simulator.ai_feedback.tag')}
          </div>
          <div className="text-[15px] font-semibold tracking-tight text-text">
            {t('simulator.ai_feedback.title')}
          </div>
        </div>
      </div>

      {loading || !feedback ? (
        <div className="flex items-center gap-2 py-4 text-[14px] text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('simulator.ai_feedback.loading')}
        </div>
      ) : (
        <div className="space-y-5">
          {feedback.summary && (
            <p className="text-[14px] leading-relaxed text-text">{feedback.summary}</p>
          )}

          {/* Fortalezas y mejoras lado a lado en pantallas anchas: apiladas se
              leía como una columna interminable. */}
          <div className="grid gap-5 md:grid-cols-2">
          {feedback.strengths?.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-brand-green">
                <ThumbsUp className="h-4 w-4" />
                {t('simulator.ai_feedback.strengths')}
              </div>
              <ul className="space-y-1.5">
                {feedback.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-text-muted">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {feedback.improvements?.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-brand-magenta">
                <Lightbulb className="h-4 w-4" />
                {t('simulator.ai_feedback.improvements')}
              </div>
              <ul className="space-y-1.5">
                {feedback.improvements.map((s, i) => (
                  <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-text-muted">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-magenta" />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
