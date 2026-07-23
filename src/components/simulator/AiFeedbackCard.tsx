import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Lightbulb, Loader2, RotateCw, Sparkles, ThumbsUp } from 'lucide-react';
import type { AiFeedback } from '@/services/certification.service';
import type { SimAiErrorKind } from '@/services/simGroq.service';

interface Props {
  feedback: AiFeedback | null;
  loading: boolean;
  /** Motivo del fallo, si la IA no pudo responder. */
  error?: SimAiErrorKind | null;
  /** Si se pasa, se ofrece un botón para reintentar tras un fallo. */
  onRetry?: () => void;
}

/**
 * Estado "analizando" con cronómetro: el aprendiz necesita ver que algo avanza
 * para decidir si espera. Vive en su propio componente para que el contador
 * nazca en 0 en cada montaje (y en cada reintento) sin resetear estado a mano.
 */
function AnalyzingState() {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="py-3">
      <div className="flex items-center gap-2 text-[14px] text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('simulator.ai_feedback.loading')}
        <span className="tabular-nums text-text-subtle">{seconds}s</span>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-text-subtle">
        {seconds < 10
          ? t('simulator.ai_feedback.loading_hint')
          : t('simulator.ai_feedback.loading_hint_long')}
      </p>
    </div>
  );
}

/**
 * Tarjeta de retroalimentación personalizada generada por IA (Groq).
 * Compartida por el resultado de llamada y el de opción múltiple.
 * Estados: analizando (con cronómetro, para saber si vale la pena esperar),
 * error explicado + reintentar, o el feedback ya listo.
 */
export function AiFeedbackCard({ feedback, loading, error = null, onRetry }: Props) {
  const { t } = useTranslation();

  if (!feedback && !loading && !error) return null;

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

      {loading ? (
        <AnalyzingState />
      ) : error || !feedback ? (
        <div className="py-2">
          <div className="flex items-start gap-2 text-[14px] text-text-muted">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand-magenta" />
            <div>
              <p className="text-text">{t(`simulator.ai_feedback.error.${error ?? 'unknown'}`)}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text-subtle">
                {t('simulator.ai_feedback.error.saved_anyway')}
              </p>
            </div>
          </div>
          {onRetry && error !== 'not_configured' && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-text hover:bg-surface"
            >
              <RotateCw className="h-3.5 w-3.5" />
              {t('simulator.ai_feedback.error.retry')}
            </button>
          )}
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
