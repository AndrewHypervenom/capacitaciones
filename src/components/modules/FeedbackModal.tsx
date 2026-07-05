// src/components/modules/FeedbackModal.tsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  X, Target, Clock, CheckCircle2, XCircle,
  MessageSquare, AlertCircle, HelpCircle, Info, BookOpen
} from 'lucide-react';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  attempts: any[];
  computedMetrics: {
    timeSpent: string;
    efficiency: number;
    pendingSectionsCount: number;
    goodAt: string;
    badAt: string;
    reinforce: string;
    trainerNotes: string | null;
  };
}

export function FeedbackModal({ isOpen, onClose, attempts, computedMetrics }: FeedbackModalProps) {
  const { t } = useTranslation();

  // ─── CONFIG POR TIPO DE PLANTILLA ───────────────────────────────────────────
  const getTemplateConfig = (attempt: any) => {
    const type = attempt.game_type ? attempt.game_type.trim().toUpperCase() : '';
    const isCompleted = attempt.status === 'completed';

    const answers = attempt.submitted_answers || {};
    const aciertos = answers.aciertos ?? answers.correctas ?? answers.score ?? attempt.score ?? 0;
    const total = answers.total_cases ?? answers.total ?? answers.total_questions ?? 0;

    const esAprobado = isCompleted || (total > 0 && aciertos === total) || attempt.score >= 70;

    // Defaults
    let title = t('feedback.modal.section_default');
    let icon = <Info className="h-4 w-4" />;
    let statusText = t('feedback.modal.status_reviewed');
    let cardStyle = '';
    let iconStyle = '';
    let textColor = '';

    switch (type) {
      // ── KNOWLEDGE_CHECK ────────────────────────────────────────────────────
      case 'KNOWLEDGE_CHECK': {
        // Título: pregunta elegida o pregunta correcta como referencia legible
        const pregunta = answers.opcion_correcta
          ? t('feedback.modal.kc_correct_answer', { opt: answers.opcion_correcta })
          : answers.opcion_elegida
          ? t('feedback.modal.kc_answered', { opt: answers.opcion_elegida })
          : t('feedback.modal.kc_review');

        title = pregunta;
        icon = esAprobado
          ? <CheckCircle2 className="h-4 w-4" />
          : <XCircle className="h-4 w-4" />;
        statusText = esAprobado ? t('feedback.modal.status_correct') : t('feedback.modal.status_incorrect');
        cardStyle = esAprobado
          ? 'border-emerald-500/25 bg-emerald-500/6'
          : 'border-rose-500/25 bg-rose-500/6';
        iconStyle = esAprobado
          ? 'bg-emerald-500/12 text-emerald-500'
          : 'bg-rose-500/12 text-rose-400';
        textColor = esAprobado ? 'text-emerald-500' : 'text-rose-400';
        break;
      }

      // ── SORT ───────────────────────────────────────────────────────────────
      case 'SORT_PROCESS':
      case 'SORT_GAME':
      case 'GAME-SORT':
      case 'GAME_SORT':
        title = t('feedback.modal.sort_title');
        icon = esAprobado ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />;
        statusText = esAprobado ? t('feedback.modal.status_passed') : t('feedback.modal.sort_failed');
        cardStyle = esAprobado
          ? 'border-emerald-500/25 bg-emerald-500/6'
          : 'border-rose-500/25 bg-rose-500/6';
        iconStyle = esAprobado
          ? 'bg-emerald-500/12 text-emerald-500'
          : 'bg-rose-500/12 text-rose-400';
        textColor = esAprobado ? 'text-emerald-500' : 'text-rose-400';
        break;

      // ── CLASSIFY ──────────────────────────────────────────────────────────
      case 'CLASSIFY_CASES':
      case 'CLASSIFY_GAME':
      case 'GAME-CLASSIFY':
      case 'GAME_CLASSIFY':
        title = t('feedback.modal.classify_title');
        icon = esAprobado ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />;
        statusText = esAprobado ? t('feedback.modal.status_passed') : t('feedback.modal.classify_failed');
        cardStyle = esAprobado
          ? 'border-emerald-500/25 bg-emerald-500/6'
          : 'border-rose-500/25 bg-rose-500/6';
        iconStyle = esAprobado
          ? 'bg-emerald-500/12 text-emerald-500'
          : 'bg-rose-500/12 text-rose-400';
        textColor = esAprobado ? 'text-emerald-500' : 'text-rose-400';
        break;

      // ── QUIZ ──────────────────────────────────────────────────────────────
      case 'QUIZ':
        title = t('feedback.modal.quiz_title');
        icon = esAprobado ? <CheckCircle2 className="h-4 w-4" /> : <HelpCircle className="h-4 w-4" />;
        statusText = esAprobado ? t('feedback.modal.status_approved') : t('feedback.modal.quiz_pending');
        cardStyle = esAprobado
          ? 'border-emerald-500/25 bg-emerald-500/6'
          : 'border-amber-500/25 bg-amber-500/6';
        iconStyle = esAprobado
          ? 'bg-emerald-500/12 text-emerald-500'
          : 'bg-amber-500/12 text-amber-500';
        textColor = esAprobado ? 'text-emerald-500' : 'text-amber-500';
        break;

      // ── CALLOUT ───────────────────────────────────────────────────────────
      case 'CALLOUT':
        title = t('feedback.modal.callout_title');
        icon = <Info className="h-4 w-4" />;
        statusText = t('feedback.modal.status_read');
        cardStyle = 'border-violet-500/25 bg-violet-500/6';
        iconStyle = 'bg-violet-500/12 text-violet-500';
        textColor = 'text-violet-500';
        break;

      // ── FALLBACK ──────────────────────────────────────────────────────────
      default:
        cardStyle = 'border-zinc-300/30 dark:border-zinc-700/40 bg-zinc-100/50 dark:bg-zinc-800/30';
        iconStyle = 'bg-zinc-200/60 dark:bg-zinc-700/50 text-zinc-500 dark:text-zinc-400';
        textColor = 'text-zinc-500 dark:text-zinc-400';
        break;
    }

    return { title, icon, statusText, cardStyle, iconStyle, textColor, esAprobado };
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">

          {/* ── Fondo translúcido ─────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/40 dark:bg-black/70 backdrop-blur-sm"
          />

          {/* ── Panel principal — ADAPTABLE claro / oscuro ────────────────── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={[
              'relative w-full max-w-md overflow-hidden rounded-2xl p-6 shadow-2xl z-10',
              // ── Claro ──
              'bg-white border border-zinc-200 text-zinc-900',
              // ── Oscuro ──
              'dark:bg-[#1a1a1e] dark:border-[#2d2d34] dark:text-zinc-100',
            ].join(' ')}
          >
            {/* Botón cerrar */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            {/* ── Encabezado ───────────────────────────────────────────────── */}
            <div className="mb-6">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 mb-3">
                <Target className="h-3 w-3" /> {t('feedback.modal.badge_history')}
              </span>
              <h3 className="font-bold text-xl tracking-tight">{t('feedback.modal.title_main')}</h3>
            </div>

            {/* ── Métricas superiores ───────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-zinc-100 dark:bg-[#141416] border border-zinc-200 dark:border-[#26262b] p-4 rounded-xl">
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-widest font-semibold block mb-1">
                  {t('feedback.modal.time_used')}
                </span>
                <span className="font-mono text-zinc-800 dark:text-zinc-200 font-bold text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-zinc-400" />
                  {computedMetrics?.timeSpent || '00:00'}
                </span>
              </div>
              <div className="bg-zinc-100 dark:bg-[#141416] border border-zinc-200 dark:border-[#26262b] p-4 rounded-xl">
                <span className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-widest font-semibold block mb-1">
                  {t('feedback.modal.avg_efficiency')}
                </span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold text-lg">
                  {computedMetrics?.efficiency || 0}%
                </span>
              </div>
            </div>

            {/* ── Lista de intentos ─────────────────────────────────────────── */}
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 uppercase tracking-widest font-semibold mb-2">
              {t('feedback.modal.last_activity')}
            </p>

            <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1 scrollbar-thin">
              {attempts && attempts.length > 0 ? (
                attempts.map((attempt, index) => {
                  const { title, icon, statusText, cardStyle, iconStyle, textColor, esAprobado } =
                    getTemplateConfig(attempt);

                  const itemNumber = String(index + 1).padStart(2, '0');
                  const moduleTitle = attempt.module_title || t('feedback.modal.no_module');

                  const answers = attempt.submitted_answers || {};
                  const cantidadErrores =
                    attempt.errors_count ?? answers.errores ?? answers.fallos ?? answers.incorrectas ?? null;
                  const tiempoPlantilla = attempt.duration_seconds
                    ? `${attempt.duration_seconds}s`
                    : answers.tiempo ?? answers.duration ?? null;
                  const mensajeDetalle: string | null = answers.mensaje_detalle ?? null;

                  // Para KNOWLEDGE_CHECK mostramos la opción elegida vs correcta como subtítulo
                  const isKnowledgeCheck =
                    (attempt.game_type ?? '').trim().toUpperCase() === 'KNOWLEDGE_CHECK';

                  return (
                    <div
                      key={attempt.id || index}
                      className={`flex gap-3 p-4 rounded-xl border transition-all ${cardStyle}`}
                    >
                      {/* Icono */}
                      <div
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${iconStyle}`}
                      >
                        {icon}
                      </div>

                      {/* Contenido */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <h4 className="text-[13px] font-bold text-zinc-800 dark:text-zinc-200 truncate">
                            {itemNumber} — {moduleTitle}
                          </h4>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {attempt.score !== undefined && (
                              <span className="text-[11px] font-mono font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-200/60 dark:bg-zinc-800/40 px-1.5 py-0.5 rounded border border-zinc-300/40 dark:border-zinc-700/20">
                                {t('feedback.modal.pts', { score: attempt.score })}
                              </span>
                            )}
                            {tiempoPlantilla && (
                              <span className="text-[11px] font-mono font-semibold text-blue-500 dark:text-blue-400 bg-blue-500/8 px-1.5 py-0.5 rounded border border-blue-500/20 flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" /> {tiempoPlantilla}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Subtítulo: para KC mostramos las opciones; para otros el tipo */}
                        {isKnowledgeCheck ? (
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-500 mb-1 space-y-0.5">
                            {answers.opcion_elegida && (
                              <p>
                                {t('feedback.modal.chosen')}{' '}
                                <span className="font-medium text-zinc-600 dark:text-zinc-400">
                                  "{answers.opcion_elegida}"
                                </span>
                              </p>
                            )}
                            {answers.opcion_correcta && (
                              <p>
                                {t('feedback.modal.correct')}{' '}
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                  "{answers.opcion_correcta}"
                                </span>
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mb-1">{title}</p>
                        )}

                        {/* Estado */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                          <p className={`text-[12px] font-medium ${textColor}`}>
                            {t('feedback.modal.status_label', { status: statusText })}
                          </p>
                          {cantidadErrores !== null && cantidadErrores > 0 && (
                            <span className="text-[11px] text-rose-500 dark:text-rose-400 font-medium bg-rose-500/8 px-1.5 py-0.5 rounded border border-rose-500/20">
                              {cantidadErrores} {cantidadErrores === 1 ? t('feedback.modal.error_one') : t('feedback.modal.error_other')}
                            </span>
                          )}
                        </div>

                        {/* Detalle del error */}
                        {!esAprobado && mensajeDetalle && (
                          <div className="mt-2 rounded-lg bg-rose-500/8 border border-rose-500/20 px-2.5 py-2">
                            <p className="text-[11px] text-rose-500 dark:text-rose-400 leading-snug">
                              {mensajeDetalle}
                            </p>
                          </div>
                        )}

                        {!esAprobado && !mensajeDetalle && answers.mensaje && (
                          <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400 mt-1 italic leading-tight">
                            {t('feedback.modal.detail', { msg: answers.mensaje })}
                          </p>
                        )}

                        {/* Comentario del capacitador */}
                        {attempt.trainer_comment && (
                          <div className="mt-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-800/60 text-[11.5px] text-violet-600 dark:text-violet-300 italic flex items-start gap-1">
                            <MessageSquare className="h-3 w-3 mt-0.5 text-violet-500 shrink-0" />
                            <span>"{attempt.trainer_comment}"</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 border border-dashed border-zinc-300 dark:border-[#26262b] rounded-xl text-zinc-500 dark:text-zinc-500 text-[12.5px]">
                  <AlertCircle className="h-5 w-5 mx-auto mb-2 text-zinc-400 dark:text-zinc-600 animate-pulse" />
                  {t('feedback.modal.no_interactions')}
                </div>
              )}
            </div>

            {/* ── Botón cerrar ─────────────────────────────────────────────── */}
            <button
              onClick={onClose}
              className="w-full mt-6 py-3 rounded-xl font-bold text-[13px] tracking-wide transition-colors bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border border-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-200 dark:border-zinc-700/50"
            >
              {t('feedback.modal.close_view')}
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
