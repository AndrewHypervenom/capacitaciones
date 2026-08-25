import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowRight, Clock, Loader2, MessageSquareHeart, RotateCcw } from 'lucide-react';
import { FadeIn } from '@/components/ui/motion';
import { Button } from '@/components/ui/Button';
import { InstructorBadge } from '@/components/course/InstructorBadge';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/stores/toastStore';
import { cn } from '@/lib/cn';
import {
  formatCountdown,
  getSurveyGate,
  startSurveyAttempt,
  submitSurvey,
  surveyDraftKey,
  surveyQuestionKeys,
  type SurveyGate,
} from '@/services/survey.service';

/* ────────────────────────────────────────────────────────────────────────────
   Encuesta de satisfacción — paso de cierre del curso

   Va entre aprobar y ver el certificado. Tres preguntas —dos escalas que miden
   cosas distintas y una abierta— más una cuarta condicional y opcional para
   quien quedó insatisfecho.

   Dos decisiones que explican casi todo el archivo:

   · El cronómetro NO castiga. Se pidió que estuviera y está, corriendo a la
     vista, pero al vencerse solo se descarta el intento y se ofrece empezar de
     nuevo, sin límite. Que a alguien que ya aprobó el curso se le caiga el
     diploma por un formulario de 30 segundos sería indefendible.

   · El borrador se guarda solo. Cerrar la pestaña, quedarse sin batería o
     perder la conexión no puede costarle a nadie volver a escribir su
     comentario. Lo que sí es del servidor es el reloj: `started_at` vive en la
     base, así que recargar no regala tiempo.
   ──────────────────────────────────────────────────────────────────────────── */

const SCALE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

interface Draft {
  q1: number | null;
  q2: number | null;
  q3: string;
  followup: string;
}

const EMPTY_DRAFT: Draft = { q1: null, q2: null, q3: '', followup: '' };

/**
 * Escala 0-10.
 *
 * En Sinergy son once radios diminutos en una sola fila: en celular quedan de
 * ~20px y la gente toca el número de al lado. Aquí son botones de 44px que se
 * envuelven en varias filas, con las anclas debajo — sin ellas cada persona
 * calibra el 0 y el 10 a su manera y el promedio no significa nada.
 */
function ScaleField({
  value,
  onChange,
  lowLabel,
  highLabel,
  name,
}: {
  value: number | null;
  onChange: (n: number) => void;
  lowLabel: string;
  highLabel: string;
  name: string;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5">
        {SCALE.map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(n)}
              className={cn(
                'h-11 min-w-[44px] flex-1 rounded-xl border text-[15px] font-semibold tabular-nums transition-colors',
                active
                  ? 'border-brand-green bg-brand-green text-white dark:text-black'
                  : 'border-line bg-surface text-text-muted hover:border-brand-green/40 hover:text-text',
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-text-subtle">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}

export default function CourseSurvey() {
  const { t, i18n } = useTranslation();
  const { courseId } = useParams<{ courseId: string }>();
  const nav = useNavigate();
  const { profile } = useAuth();

  const [gate, setGate] = useState<SurveyGate | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const certHref = `/certificate/${courseId}`;
  const draftKey = profile?.id && courseId ? surveyDraftKey(profile.id, courseId) : null;

  // ── Borrador local ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!draftKey) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) setDraft({ ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) });
    } catch {
      /* borrador ilegible: se empieza limpio, no es motivo para romper nada */
    }
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      /* sin espacio o en modo privado: se pierde el borrador, no la encuesta */
    }
  }, [draft, draftKey]);

  // ── Arranque: estado + intento ────────────────────────────────────────────
  const begin = useCallback(async () => {
    if (!courseId) return;
    setLoading(true);
    setExpired(false);
    try {
      const g = await getSurveyGate(courseId);
      setGate(g);
      // Sin encuesta pendiente no hay nada que hacer aquí: al certificado.
      if (!g.enabled || !g.needs_survey) {
        nav(certHref, { replace: true });
        return;
      }
      const a = await startSurveyAttempt(courseId);
      setAttemptId(a.attempt_id);
      setSecondsLeft(a.seconds_left);
    } catch {
      // Si no se puede arrancar la encuesta, no dejamos a nadie encerrado:
      // se sigue al certificado. El candado real vive en el servidor.
      toast.error(t('survey.start_error'));
      nav(certHref, { replace: true });
    } finally {
      setLoading(false);
    }
  }, [courseId, certHref, nav, t]);

  useEffect(() => {
    void begin();
  }, [begin]);

  // ── Cronómetro ────────────────────────────────────────────────────────────
  // Cuenta local sobre el valor que dio el servidor. Al llegar a 0 no se envía
  // nada ni se pierde nada: se ofrece empezar de nuevo.
  const expiredRef = useRef(false);
  useEffect(() => {
    if (secondsLeft === null || expired) return;
    if (secondsLeft <= 0) {
      if (!expiredRef.current) {
        expiredRef.current = true;
        setExpired(true);
      }
      return;
    }
    const id = window.setTimeout(() => setSecondsLeft((s) => (s === null ? null : s - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [secondsLeft, expired]);

  const retry = async () => {
    expiredRef.current = false;
    setAttemptId(null);
    setSecondsLeft(null);
    await begin();
  };

  // ── Repregunta condicional ────────────────────────────────────────────────
  // Solo la ve quien calificó por debajo del umbral. Para todos los demás la
  // encuesta son exactamente las tres preguntas del negocio, ni una más.
  const threshold = gate?.followup_threshold ?? 5;
  const showFollowup = useMemo(() => {
    if (!gate?.followup_enabled) return false;
    return (
      (draft.q1 !== null && draft.q1 <= threshold) || (draft.q2 !== null && draft.q2 <= threshold)
    );
  }, [gate?.followup_enabled, draft.q1, draft.q2, threshold]);

  // Las tres son obligatorias por decisión del negocio; la repregunta jamás.
  const canSend = draft.q1 !== null && draft.q2 !== null && draft.q3.trim().length > 0;

  const send = async () => {
    if (!attemptId || !canSend || sending) return;
    setSending(true);
    try {
      const res = await submitSurvey({
        attemptId,
        q1: draft.q1!,
        q2: draft.q2!,
        q3: draft.q3.trim(),
        followup: showFollowup ? draft.followup : null,
        lang: i18n.resolvedLanguage ?? 'es',
      });
      if (res.expired) {
        setExpired(true);
        return;
      }
      // Enviada: el borrador ya no hace falta.
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          /* da igual: la respuesta ya está guardada en la base */
        }
      }
      toast.success(t('survey.thanks'));
      nav(certHref, { replace: true });
    } catch {
      // Lo escrito NO se toca: sigue en el borrador para reintentar.
      toast.error(t('survey.send_error'));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-subtle" />
      </div>
    );
  }

  if (expired) {
    return (
      <div className="mx-auto max-w-lg px-5 pt-20 pb-24">
        <FadeIn>
          <div className="surface-card p-8 text-center">
            <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-subtle text-text-muted">
              <Clock className="h-6 w-6" />
            </div>
            <h1 className="mb-2 text-[20px] font-semibold tracking-tight">{t('survey.expired_title')}</h1>
            <p className="mb-6 text-[14px] text-text-muted">{t('survey.expired_hint')}</p>
            <Button onClick={retry} size="md">
              <RotateCcw className="h-4 w-4" />
              {t('survey.retry')}
            </Button>
          </div>
        </FadeIn>
      </div>
    );
  }

  const lowLabel = t('survey.scale_low');
  const highLabel = t('survey.scale_high');

  // El texto exacto de las dos escalas depende de la variante del curso. El
  // servidor ya resolvió el caso raro (configurado "instructor" pero el curso
  // no tiene ninguno → llega 'campaign'), así que aquí solo se pinta.
  const qKeys = surveyQuestionKeys(gate?.q1_mode ?? 'instructor', gate?.q2_mode ?? 'training');
  const campaign = gate?.campaign_name ?? '';
  const q1Text = t(qKeys.q1, { campaign });
  const q2Text = t(qKeys.q2, { campaign });
  // La foto y el nombre solo tienen sentido si la pregunta habla de esa persona.
  const showInstructor = gate?.q1_mode === 'instructor' && !!gate?.instructor_name;

  return (
    <div className="mx-auto max-w-2xl px-5 pt-12 pb-32">
      <FadeIn>
        {/* Encabezado: por qué está aquí y qué gana al terminar. Ese "y ves tu
            certificado" es la mitad del trabajo — la gente contesta rápido
            porque ve el premio, no porque esté obligada. */}
        <div className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-green/20 bg-brand-green/10 px-3 py-1 text-[12px] font-medium text-brand-green">
            <MessageSquareHeart className="h-3.5 w-3.5" />
            {gate?.is_retroactive ? t('survey.badge_retro') : t('survey.badge')}
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-text">
            {t('survey.title')}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
            {gate?.is_retroactive ? t('survey.lead_retro') : t('survey.lead')}
          </p>
        </div>

        {/* Cronómetro. Lo pidió el negocio; se muestra sin dramatizar porque
            vencerse no cuesta el certificado, solo obliga a volver a empezar. */}
        {secondsLeft !== null && (
          <div
            className={cn(
              'mb-6 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px]',
              secondsLeft <= 60
                ? 'border-danger/30 bg-danger/5 text-danger'
                : 'border-line bg-subtle text-text-muted',
            )}
          >
            <Clock className="h-4 w-4 shrink-0" />
            <span>{t('survey.time_left')}</span>
            <span className="font-semibold tabular-nums">{formatCountdown(secondsLeft)}</span>
          </div>
        )}

        <div className="space-y-4">
          {/* ── P1 ── Se muestra el capacitador con cara y nombre cuando el
              curso tiene uno. No cambia el texto de la pregunta: lo completa.
              Calificar "al instructor" en abstracto, en un curso asincrónico,
              es pedir un número al azar. */}
          <section className="surface-card p-5 sm:p-6">
            <p className="mb-4 text-[14px] font-medium leading-relaxed text-text">{q1Text}</p>
            {showInstructor && (
              <InstructorBadge
                name={gate!.instructor_name!}
                avatarUrl={gate!.instructor_avatar}
                role={t('survey.instructor_role')}
                className="mb-4 mt-4"
              />
            )}
            <ScaleField
              name={q1Text}
              value={draft.q1}
              onChange={(n) => setDraft((d) => ({ ...d, q1: n }))}
              lowLabel={lowLabel}
              highLabel={highLabel}
            />
          </section>

          {/* ── P2 ── */}
          <section className="surface-card p-5 sm:p-6">
            <p className="mb-4 text-[14px] font-medium leading-relaxed text-text">{q2Text}</p>
            <ScaleField
              name={q2Text}
              value={draft.q2}
              onChange={(n) => setDraft((d) => ({ ...d, q2: n }))}
              lowLabel={lowLabel}
              highLabel={highLabel}
            />
          </section>

          {/* ── P3 ── Obligatoria por decisión del negocio. El texto guía del
              campo es lo único que baja la cantidad de "ninguna". */}
          <section className="surface-card p-5 sm:p-6">
            <p className="mb-4 text-[14px] font-medium leading-relaxed text-text">
              {t('survey.q3')}
            </p>
            <textarea
              value={draft.q3}
              onChange={(e) => setDraft((d) => ({ ...d, q3: e.target.value }))}
              rows={4}
              maxLength={2000}
              placeholder={t('survey.q3_placeholder')}
              className="w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-3 text-[14px] leading-relaxed text-text outline-none transition-colors focus:border-primary"
            />
          </section>

          {/* ── Repregunta a los insatisfechos ── */}
          {showFollowup && (
            <FadeIn>
              <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5 sm:p-6">
                <div className="mb-3 flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <p className="text-[14px] font-medium leading-relaxed text-text">
                    {t('survey.followup')}
                  </p>
                </div>
                <textarea
                  value={draft.followup}
                  onChange={(e) => setDraft((d) => ({ ...d, followup: e.target.value }))}
                  rows={3}
                  maxLength={2000}
                  placeholder={t('survey.followup_placeholder')}
                  className="w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-3 text-[14px] leading-relaxed text-text outline-none transition-colors focus:border-primary"
                />
                <p className="mt-2 text-[11px] text-text-subtle">{t('survey.followup_optional')}</p>
              </section>
            </FadeIn>
          )}
        </div>

        <div className="mt-8">
          <Button onClick={send} disabled={!canSend || sending} size="lg" className="w-full sm:w-auto">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {t('survey.submit')}
          </Button>
          {!canSend && <p className="mt-3 text-[12px] text-text-subtle">{t('survey.required_hint')}</p>}
        </div>
      </FadeIn>
    </div>
  );
}
