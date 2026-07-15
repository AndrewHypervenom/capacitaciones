import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, MessageSquare, Clock, ChevronRight, GraduationCap, Inbox, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserStore } from '@/stores/userStore';
import { getMyTrainerFeedback, type StudentFeedbackItem } from '@/services/activity.service';

function scoreHex(score: number): string {
  if (score >= 90) return '#22c55e';
  if (score >= 70) return '#f59e0b';
  return '#ef4444';
}

export default function MyFeedback() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const language = useUserStore((s) => s.language);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<StudentFeedbackItem[]>([]);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    setLoading(true);
    getMyTrainerFeedback(user.id)
      .then(({ data }) => alive && setItems(data))
      .finally(() => alive && setLoading(false));
    // Si el capacitador califica mientras el aprendiz mira, refrescamos.
    const onSaved = () => user?.id && getMyTrainerFeedback(user.id).then(({ data }) => setItems(data));
    window.addEventListener('activity_attempt_saved', onSaved);
    return () => {
      alive = false;
      window.removeEventListener('activity_attempt_saved', onSaved);
    };
  }, [user?.id]);

  /** Etiqueta legible del tipo de actividad. */
  const typeLabel = (type: string) => {
    switch (type.trim().toUpperCase()) {
      case 'KNOWLEDGE_CHECK': return t('my_feedback.type_quiz', 'Evaluación');
      case 'VIDEO_QUIZ': return t('my_feedback.type_video', 'Quiz de video');
      case 'CLASSIFY_CASES': return t('my_feedback.type_classify', 'Clasificación');
      case 'SORT_PROCESS': return t('my_feedback.type_sort', 'Secuenciación');
      default: return t('my_feedback.type_activity', 'Actividad');
    }
  };

  const pick = (obj: { es: string; en: string | null; pt: string | null } | null, fallback: string) => {
    if (!obj) return fallback;
    return (obj as any)[language] || obj.es || fallback;
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : null;

  const count = items.length;
  const avg = useMemo(
    () => (count ? Math.round(items.reduce((s, it) => s + (it.score || 0), 0) / count) : 0),
    [items, count],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/dashboard'))}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('common.back', 'Volver')}
        </button>
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-neon-green/10 border border-neon-green/20 flex items-center justify-center shrink-0">
            <MessageSquare className="h-5 w-5 text-neon-green" />
          </div>
          <div>
            <h1 className="text-[20px] sm:text-[24px] font-bold text-text">{t('my_feedback.title', 'Mis retroalimentaciones')}</h1>
            <p className="text-[13px] text-text-muted">{t('my_feedback.subtitle', 'Los comentarios que tu capacitador dejó sobre tus actividades.')}</p>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
        </div>
      ) : count === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center">
          <Inbox className="h-8 w-8 mx-auto mb-3 text-text-subtle" />
          <div className="text-[15px] font-medium text-text mb-1">{t('my_feedback.empty_title', 'Aún no tienes retroalimentaciones')}</div>
          <div className="text-[13px] text-text-muted">{t('my_feedback.empty_desc', 'Cuando tu capacitador revise tus actividades, sus comentarios aparecerán aquí.')}</div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">{t('my_feedback.kpi_total', 'Comentarios')}</div>
              <div className="text-2xl font-bold text-text tabular-nums">{count}</div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="text-[10px] uppercase tracking-wider text-text-muted">{t('my_feedback.kpi_avg', 'Desempeño prom.')}</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: scoreHex(avg) }}>{avg}%</div>
            </div>
          </div>

          <div className="space-y-3">
            {items.map((it) => {
              const moduleTitle = pick(it.module_title, t('my_feedback.module_fallback', 'Módulo'));
              const sectionTitle = pick(it.section_heading, '');
              const date = fmtDate(it.feedback_date);
              const card = (
                <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5 transition-colors hover:border-neon-green/30">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text min-w-0">
                        <GraduationCap className="h-4 w-4 shrink-0 text-text-muted" />
                        <span className="truncate">{moduleTitle}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
                        <span className="inline-flex items-center rounded-md bg-subtle px-1.5 py-0.5 font-medium uppercase tracking-wide">
                          {typeLabel(it.game_type)}
                        </span>
                        {sectionTitle && <span className="truncate">· {sectionTitle}</span>}
                        {date && (
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {date}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className="shrink-0 text-[12px] font-mono font-bold px-2 py-1 rounded-lg"
                      style={{ background: `${scoreHex(it.score)}1a`, color: scoreHex(it.score) }}
                    >
                      {it.score}%
                    </span>
                  </div>

                  {/* Comentario del capacitador */}
                  <div className="mt-3 rounded-xl border border-violet-500/20 bg-violet-500/6 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0 text-violet-500" />
                      <p className="text-[13px] leading-relaxed text-text">{it.trainer_comment}</p>
                    </div>
                  </div>

                  {it.module_slug && (
                    <div className="mt-2 flex items-center justify-end">
                      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-neon-green">
                        {t('my_feedback.open_module', 'Ir al módulo')}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  )}
                </div>
              );
              return it.module_slug ? (
                <Link key={it.id} to={`/modules/${it.module_slug}`} className="block">
                  {card}
                </Link>
              ) : (
                <div key={it.id}>{card}</div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
