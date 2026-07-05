import React, { useState, useEffect, useRef } from 'react';
import i18n from '@/i18n';
import { getPendingAttempts, saveTrainerFeedback, FeedbackPayload } from '@/services/activity.service';
import { useAuth } from '@/hooks/useAuth';
import { Code, LayoutTemplate, CheckCircle2, XCircle, Info, MessageSquare, Search, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

interface SubmittedAnswers {
  total?: number | string;
  aciertos?: number | string;
  errores?: number | string;
  total_preguntas?: number | string;
  correctas?: number | string;
  incorrectas?: number | string;
  total_cases?: number | string;
  [key: string]: any;
}

interface PendingAttempt {
  id: string;
  user_id: string;
  game_type: string;
  score: number;
  submitted_answers: SubmittedAnswers | null;
  started_at: string;
  student?: { id: string; name: string; email: string; } | null;
  campaign?: { title_es: string; } | null;
  module?: { title_es: string; } | null;
  section?: { heading_es: string; } | null;
}

export const TrainerFeedbackPanel: React.FC = () => {
  const { user, isSuperAdmin } = useAuth();
  
  const [attempts, setAttempts] = useState<PendingAttempt[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<PendingAttempt | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'graphic' | 'json'>('graphic');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [scoreFilter, setScoreFilter] = useState<string>('all');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const scoreOptions = [
    { value: 'all', label: 'Todas las calificaciones' },
    { value: 'perfect', label: 'Perfectas (100%)' },
    { value: 'passed', label: 'Aprobadas (70% - 99%)' },
    { value: 'failed', label: 'Reprobadas (Menos de 70%)' }
  ];

  useEffect(() => {
    const loadAttempts = async () => {
      setLoading(true);
      const { data, error: fetchError } = await getPendingAttempts({ excludeSuperadmins: !isSuperAdmin });
      if (fetchError) setError('No se pudieron cargar los intentos.');
      else if (data) setAttempts(data as PendingAttempt[]);
      setLoading(false);
    };
    loadAttempts();
  }, [isSuperAdmin]);

  useEffect(() => {
    setComment('');
    setViewMode('graphic');
  }, [selectedAttempt]);

  // Cerrar el menú desplegable si se hace clic fuera de él
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatGameType = (type: string) => {
    switch (type) {
      case 'CLASSIFY_CASES': return 'Clasificación de Casos';
      case 'SORT_PROCESS': return 'Secuenciación de Procesos';
      case 'KNOWLEDGE_CHECK': return 'Evaluación de Comprensión';
      default: return type.toUpperCase();
    }
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAttempt || !comment.trim() || !user?.id) return;

    setSubmitting(true);
    const payload: FeedbackPayload = {
      attempt_id: selectedAttempt.id,
      user_id: selectedAttempt.user_id, 
      trainer_id: user.id, 
      trainer_comment: comment.trim(),
      feedback_date: new Date().toISOString(),
    };

    const { error: submitError } = await saveTrainerFeedback(payload);
    if (submitError) {
      alert('Error al guardar el feedback');
    } else {
      setAttempts(prev => prev.filter(item => item.id !== selectedAttempt.id));
      setSelectedAttempt(null);
      setComment('');
      alert('¡Evaluación guardada con éxito!');
    }
    setSubmitting(false);
  };

  // Lógica de filtrado dinámico
  const filteredAttempts = attempts.filter((attempt) => {
    const studentName = (attempt.student?.name || 'Usuario Paola').toLowerCase();
    const gameLabel = formatGameType(attempt.game_type).toLowerCase();
    const search = searchTerm.toLowerCase();

    const matchesSearch = studentName.includes(search) || gameLabel.includes(search);

    let matchesScore = true;
    if (scoreFilter === 'perfect') matchesScore = attempt.score === 100;
    else if (scoreFilter === 'passed') matchesScore = attempt.score >= 70 && attempt.score < 100;
    else if (scoreFilter === 'failed') matchesScore = attempt.score < 70;

    return matchesSearch && matchesScore;
  });

  const selectedOptionLabel = scoreOptions.find(opt => opt.value === scoreFilter)?.label || '';

  // Función para renderizar la vista analítica con el gráfico de progreso
  const renderAnalyticsView = (answers: any, generalScore: number) => {
    const porcentajeAciertos = generalScore;

    const total = Number(answers.total || answers.total_preguntas || answers.total_cases || 0);
    const aciertos = Number(answers.aciertos || answers.correctas || 0);
    const errores = Number(answers.errores || answers.incorrectas || 0);

    const infoKeys = Object.entries(answers).filter(
      ([key]) => !['total', 'aciertos', 'errores', 'total_preguntas', 'correctas', 'incorrectas', 'total_cases'].includes(key)
    );

    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Panel de Gráfico de Anillo / Progreso */}
        <div className="bg-zinc-50/50 dark:bg-zinc-950/40 border border-line rounded-xl p-5 flex flex-col items-center justify-center text-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-4">{i18n.t('admin.trainer_panel.answer_ratio')}</span>
          
          <div 
            className="relative w-28 h-28 rounded-full flex items-center justify-center border border-line shadow-inner"
            style={{
              background: `conic-gradient(#22c55e 0% ${porcentajeAciertos}%, #ef4444 ${porcentajeAciertos}% 100%)`
            }}
          >
            <div className="absolute w-24 h-24 bg-white dark:bg-[#0d0e12] rounded-full flex flex-col items-center justify-center shadow-md">
              <span className="text-xl font-mono font-bold text-text">{porcentajeAciertos}%</span>
              <span className="text-[9px] text-text-muted uppercase font-semibold">{i18n.t('admin.trainer_panel.effectiveness')}</span>
            </div>
          </div>

          <div className="flex gap-4 mt-4 w-full justify-center">
            {aciertos > 0 || errores > 0 ? (
              <>
                <div className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                  <span className="text-text-muted font-medium">Aciertos ({aciertos})</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  <span className="text-text-muted font-medium">Errores ({errores})</span>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-text-muted italic">
                Puntaje basado en entrega general
              </div>
            )}
          </div>
        </div>

        {/* Contenedor de Tarjetas Detalladas de Respuesta */}
        <div className="md:col-span-2 space-y-3 flex flex-col justify-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted block">{i18n.t('admin.trainer_panel.submission_details')}</span>
          
          {infoKeys.length === 0 ? (
            <p className="text-xs text-text-muted italic">{i18n.t('admin.trainer_panel.no_extra_vars')}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {infoKeys.map(([key, value]) => {
                const keyStr = String(key).toLowerCase();
                const isCorrectOption = keyStr.includes('correcta');
                const isChosenOption = keyStr.includes('elegida') || keyStr.includes('enviada');

                const displayValue = value !== null && value !== undefined ? String(value) : 'Nulo';

                let VariableIcon = Info;
                if (keyStr.includes('mensaje')) {
                  VariableIcon = MessageSquare;
                } else if (keyStr.includes('proceso') || keyStr.includes('finalizado')) {
                  VariableIcon = CheckCircle2;
                } else if (isCorrectOption) {
                  VariableIcon = CheckCircle2;
                }

                let dynamicClasses = "bg-zinc-50 dark:bg-[#14151b] border-line text-text";
                if (isCorrectOption) {
                  dynamicClasses = "bg-green-50/30 dark:bg-green-950/10 border-green-500/20 text-green-600 dark:text-green-400";
                } else if (isChosenOption) {
                  dynamicClasses = "bg-blue-50/30 dark:bg-blue-950/10 border-blue-500/20 text-blue-600 dark:text-blue-400";
                }

                return (
                  <div 
                    key={key} 
                    className={cn(
                      "p-3 rounded-xl border flex flex-col justify-between transition-all",
                      dynamicClasses
                    )}
                  >
                    <span className="text-[9px] font-bold uppercase tracking-wider opacity-70 block mb-1">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <div className="flex items-center gap-2">
                      <VariableIcon className="w-4 h-4 shrink-0 opacity-80" />
                      <span className="text-xs font-semibold truncate" title={displayValue}>
                        {displayValue}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-bg text-text font-medium text-sm">{i18n.t('admin.trainer_panel.loading')}</div>;
  if (error) return <div className="flex h-screen items-center justify-center bg-bg text-red-500 font-medium text-sm">{error}</div>;

  return (
    <div className="flex h-screen bg-bg text-text overflow-hidden font-sans">
      
      {/* Columna Izquierda: Listado de Entregas */}
      <div className="w-1/3 border-r border-line flex flex-col h-full bg-bg">
        <div className="p-6 border-b border-line shrink-0 space-y-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight">{i18n.t('admin.trainer_panel.pending_evals')}</h2>
            <p className="text-xs text-text-muted mt-1">{i18n.t('admin.trainer_panel.select_prompt')}</p>
          </div>

          {/* Contenedor de Filtros Integrados */}
          <div className="space-y-2">
            {/* Input de Búsqueda */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted/60" />
              <input
                type="text"
                placeholder={i18n.t('admin.trainer_panel.ph_search')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-zinc-50 dark:bg-zinc-900/50 border border-line rounded-xl pl-9 pr-4 py-2 text-xs text-text placeholder:text-text-muted/50 outline-none focus:border-green-500/40 transition-colors"
              />
            </div>
            
            {/* Modo claro/oscuro */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className={cn(
                  "w-full bg-zinc-50 dark:bg-zinc-900/50 border rounded-xl pl-9 pr-4 py-2 text-xs text-text text-left flex items-center justify-between transition-all outline-none",
                  isDropdownOpen ? "border-green-500/50 shadow-md shadow-green-500/5" : "border-line"
                )}
              >
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-text-muted/60 absolute left-3" />
                  <span className="truncate">{selectedOptionLabel}</span>
                </div>
                <ChevronDown className={cn("h-3 w-3 text-text-muted/60 transition-transform duration-200", isDropdownOpen && "rotate-180")} />
              </button>

              {/* Menú Desplegable Flotante */}
              {isDropdownOpen && (
                <div className="absolute z-20 w-full mt-1.5 bg-white dark:bg-[#14151b] border border-line rounded-xl shadow-xl overflow-hidden py-1 max-h-60 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-1 duration-150">
                  {scoreOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setScoreFilter(option.value);
                        setIsDropdownOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-xs transition-colors duration-150",
                        scoreFilter === option.value
                          ? "bg-green-500/10 text-green-500 font-semibold"
                          : "text-text-muted hover:text-text hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Detalle de las Entregas */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {filteredAttempts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted space-y-2">
              <p className="text-sm text-center">{i18n.t('admin.trainer_panel.no_submissions')}</p>
              <p className="text-xs text-text-muted/60">{i18n.t('admin.trainer_panel.try_other_search')}</p>
            </div>
          ) : (
            filteredAttempts.map((attempt) => (
              <div 
                key={attempt.id} 
                onClick={() => setSelectedAttempt(attempt)} 
                className={`p-4 rounded-xl cursor-pointer border transition-all duration-200 select-none ${
                  selectedAttempt?.id === attempt.id 
                    ? 'bg-zinc-100 dark:bg-zinc-900 border-green-500 shadow-lg shadow-green-500/5' 
                    : 'bg-zinc-50/50 dark:bg-zinc-900/40 border-line hover:border-zinc-400 dark:hover:border-zinc-700'
                }`}
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-semibold text-text truncate max-w-[180px]">
                    {attempt.student?.name || 'Usuario Paola'}
                  </span>
                  <span className="text-xs font-mono font-bold text-green-600 dark:text-green-400">{attempt.score}%</span>
                </div>
                <h4 className="font-semibold text-[13px] text-text">{formatGameType(attempt.game_type)}</h4>
                <p className="text-[11px] text-text-muted truncate mt-0.5">{attempt.section?.heading_es || 'Desafío Interactivo'}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Detalle de la Entrega Seleccionada */}
      <div className="w-2/3 flex flex-col h-full bg-zinc-50 dark:bg-[#111217]">
        {selectedAttempt ? (
          <div className="flex flex-col h-full p-8 overflow-y-auto custom-scrollbar space-y-6">
            
            {/* Cabecera del Resumen */}
            <div className="bg-white dark:bg-zinc-900/50 p-6 rounded-2xl border border-line shadow-sm">
              <h3 className="text-sm font-bold uppercase tracking-wider text-text-muted mb-4">{i18n.t('admin.trainer_panel.performance_summary')}</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-zinc-50 dark:bg-[#0d0e12] p-4 rounded-xl border border-line">
                  <p className="text-[10px] text-text-muted uppercase font-semibold">{i18n.t('admin.trainer_panel.final_score')}</p>
                  <p className="text-3xl font-mono font-bold text-green-600 dark:text-green-400 mt-1">{selectedAttempt.score}%</p>
                </div>
                <div className="bg-zinc-50 dark:bg-[#0d0e12] p-4 rounded-xl border border-line col-span-2">
                  <p className="text-[10px] text-text-muted uppercase font-semibold">{i18n.t('admin.trainer_panel.challenge_location')}</p>
                  <p className="text-sm font-semibold text-text mt-1 truncate" title={selectedAttempt.module?.title_es}>
                    {selectedAttempt.module?.title_es || 'Módulo'}
                  </p>
                  <p className="text-xs text-text-muted truncate mt-0.5">{selectedAttempt.section?.heading_es}</p>
                </div>
              </div>
            </div>

            {/* Visualizador de Respuestas Enviadas con el nuevo Gráfico */}
            <div className="flex-1 bg-white dark:bg-[#0d0e12] border border-line rounded-2xl p-5 flex flex-col min-h-[260px] shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                    Respuestas de la plantilla ({formatGameType(selectedAttempt.game_type)})
                </h4>
                
                {/* Selector de Vistas */}
                <div className="flex bg-zinc-100 dark:bg-zinc-900 p-1 rounded-lg border border-line">
                  <button
                    type="button"
                    onClick={() => setViewMode('graphic')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all duration-200 ${
                      viewMode === 'graphic'
                        ? 'bg-white dark:bg-[#111217] text-text shadow-sm border border-line'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    <LayoutTemplate className="w-3.5 h-3.5" />
                    Gráfica
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('json')}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all duration-200 ${
                      viewMode === 'json'
                        ? 'bg-white dark:bg-[#111217] text-text shadow-sm border border-line'
                        : 'text-text-muted hover:text-text'
                    }`}
                  >
                    <Code className="w-3.5 h-3.5" />
                    JSON Raw
                  </button>
                </div>
              </div>

              {/* Contenedor Adaptable */}
              <div className="flex-1 overflow-y-auto bg-white dark:bg-[#0d0e12] p-2 rounded-xl custom-scrollbar max-h-64">
                {selectedAttempt.submitted_answers && Object.keys(selectedAttempt.submitted_answers).length > 0 ? (
                  <>
                    {/* Vista 1: Gráfica Analítica con Dona de Progreso */}
                    {viewMode === 'graphic' && renderAnalyticsView(selectedAttempt.submitted_answers, selectedAttempt.score)}
                    
                    {/* Vista 2: Código JSON Raw */}
                    {viewMode === 'json' && (
                      <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-line shadow-inner">
                        <pre className="font-mono text-[11px] text-text whitespace-pre-wrap word-break leading-relaxed">
                          {JSON.stringify(selectedAttempt.submitted_answers, null, 2)}
                        </pre>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-text-muted italic text-xs h-full flex items-center justify-center">
                    No se recuperaron variables en el JSON de esta simulación.
                  </p>
                )}
              </div>
            </div>

            {/* Formulario de Comentarios */}
            <form onSubmit={handleSubmitFeedback} className="pt-6 border-t border-line space-y-4 shrink-0">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-text-muted block mb-2">
                  Retroalimentación para el Aprendiz
                </label>
                <textarea 
                  value={comment} 
                  onChange={(e) => setComment(e.target.value)} 
                  placeholder={i18n.t('admin.trainer_panel.ph_observations')} 
                  rows={4} 
                  className="w-full bg-white dark:bg-[#0d0e12] border border-line rounded-xl p-4 text-sm text-text placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none focus:border-green-500/40 transition-colors resize-none custom-scrollbar shadow-inner" 
                  />
              </div>
              <div className="flex justify-end">
                <button 
                  type="submit" 
                  disabled={submitting || !comment.trim()} 
                  className="px-6 py-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 rounded-xl text-xs font-semibold uppercase tracking-wider text-white transition-all duration-200 select-none shadow-lg shadow-green-600/10"
                >
                  {submitting ? 'Guardando...' : 'Enviar Evaluación'}
                </button>
              </div>
            </form>
            
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-text-muted space-y-2 select-none">
            <p className="text-sm">{i18n.t('admin.trainer_panel.select_side')}</p>
            <p className="text-xs text-text-muted/60">{i18n.t('admin.trainer_panel.review_before')}</p>
          </div>
        )}
      </div>
    </div>
  );
};