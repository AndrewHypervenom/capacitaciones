import React, { useState, useEffect } from 'react';
import { getPendingAttempts, saveTrainerFeedback, FeedbackPayload } from '@/services/activity.service';
import { useAuth } from '@/hooks/useAuth';

// ─── Interfaces de Relaciones Estrictas ───────────────────────
interface PendingAttempt {
  id: string;
  user_id: string;
  game_type: string;
  score: number;
  submitted_answers: any;
  started_at: string;
  // Mapeos del JOIN de Supabase
  student?: {
    id: string;
    name: string;
    email: string;
  } | null;
  campaign?: {
    title_es: string;
  } | null;
  module?: {
    title_es: string;
  } | null;
  section?: {
    heading_es: string;
  } | null;
}

export const TrainerFeedbackPanel: React.FC = () => {
  const { user } = useAuth();
  
  // ESTADOS
  const [attempts, setAttempts] = useState<PendingAttempt[]>([]);
  const [selectedAttempt, setSelectedAttempt] = useState<PendingAttempt | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  // LÓGICA DE CARGA
  useEffect(() => {
  const loadAttempts = async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await getPendingAttempts();

    if (fetchError) {
      setError('No se pudieron cargar los intentos pendientes');
      console.error("Error al cargar en el componente:", fetchError);
    } else if (data) {
      //  Esto inyecta los alumnos reales y los juegos en las tarjetas de la izquierda
      setAttempts(data as PendingAttempt[]); 
    }
    setLoading(false);
  };

  loadAttempts();
}, []);
  // LIMPIEZA AL CAMBIAR DE SELECCIÓN
  useEffect(() => {
    setComment('');
  }, [selectedAttempt]);

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
    
    // Sincronizado estrictamente con el payload relacional de user_progress
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
  // RENDERIZADO DE ESTADOS
  if (loading) return <div className="flex h-screen items-center justify-center bg-[#0d0e12] text-white font-medium text-sm">Cargando entregas...</div>;
  if (error) return <div className="flex h-screen items-center justify-center bg-[#0d0e12] text-red-500 font-medium text-sm">{error}</div>;

  return (
    <div className="flex h-screen bg-[#0d0e12] text-white overflow-hidden font-sans">
      
      {/* COLUMNA IZQUIERDA: LISTADO DE ENTREGAS */}
      <div className="w-1/3 border-r border-zinc-800/60 flex flex-col h-full bg-[#0d0e12]">
        <div className="p-6 border-b border-zinc-800/60 shrink-0">
          <h2 className="text-xl font-bold tracking-tight">Evaluaciones Pendientes</h2>
          <p className="text-xs text-zinc-400 mt-1">Selecciona una entrega del panel para auditar</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {attempts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500 space-y-2">
              <p className="text-sm text-center">No hay actividades pendientes.</p>
              <p className="text-xs text-zinc-600">¡Todo al día!</p>
            </div>
          ) : (
            attempts.map((attempt) => (
              <div 
                key={attempt.id} 
                onClick={() => setSelectedAttempt(attempt)} 
                className={`p-4 rounded-xl cursor-pointer border transition-all duration-200 select-none ${
                  selectedAttempt?.id === attempt.id 
                    ? 'bg-zinc-900 border-green-500 shadow-lg shadow-green-500/5' 
                    : 'bg-zinc-900/40 border-zinc-800/60 hover:border-zinc-700/80'
                }`}
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-semibold text-zinc-200 truncate max-w-[180px]">
                    {attempt.student?.name || 'Usuario Paola'}
                  </span>
                  <span className="text-xs font-mono font-bold text-green-400">{attempt.score}%</span>
                </div>
                <h4 className="font-semibold text-[13px] text-zinc-100">{formatGameType(attempt.game_type)}</h4>
                {/* Muestra el nombre de la sección evaluada */}
                <p className="text-[11px] text-zinc-400 truncate mt-0.5">{attempt.section?.heading_es || 'Desafío Interactivo'}</p>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="w-2/3 flex flex-col h-full bg-[#111217]">
        {selectedAttempt ? (
          <div className="flex flex-col h-full p-8 overflow-y-auto custom-scrollbar space-y-6">
            
            {/* Cabecera del Resumen */}
            <div className="bg-zinc-900/50 p-6 rounded-2xl border border-zinc-800/80">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 mb-4">Resumen de Desempeño</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-[#0d0e12] p-4 rounded-xl border border-zinc-800/40">
                  <p className="text-[10px] text-zinc-400 uppercase font-semibold">Puntaje Final</p>
                  <p className="text-3xl font-mono font-bold text-green-400 mt-1">{selectedAttempt.score}%</p>
                </div>
                <div className="bg-[#0d0e12] p-4 rounded-xl border border-zinc-800/40 col-span-2">
                  <p className="text-[10px] text-zinc-400 uppercase font-semibold">Ubicación del Desafío</p>
                  <p className="text-sm font-semibold text-zinc-100 mt-1 truncate" title={selectedAttempt.module?.title_es}>
                    {selectedAttempt.module?.title_es || 'Módulo'}
                  </p>
                  <p className="text-xs text-zinc-400 truncate mt-0.5">{selectedAttempt.section?.heading_es}</p>
                </div>
              </div>
            </div>

            {/* Visualizador de Respuestas Enviadas */}
            <div className="flex-1 bg-[#0d0e12] border border-zinc-800/60 rounded-2xl p-5 flex flex-col min-h-[240px]">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3 flex items-center gap-1.5">
                📦 Payload enviado por la plantilla ({formatGameType(selectedAttempt.game_type)})
              </h4>
              <div className="flex-1 overflow-y-auto bg-zinc-950/60 p-4 rounded-xl border border-zinc-900 font-mono text-xs text-zinc-300 custom-scrollbar max-h-60 leading-relaxed">
                {selectedAttempt.submitted_answers && Object.keys(selectedAttempt.submitted_answers).length > 0 ? (
                  <pre className="whitespace-pre-wrap word-break">
                    {JSON.stringify(selectedAttempt.submitted_answers, null, 2)}
                  </pre>
                ) : (
                  <p className="text-zinc-500 italic">No se recuperaron variables en el JSON de esta simulación.</p>
                )}
              </div>
            </div>

            {/* Formulario de Comentarios */}
            <form onSubmit={handleSubmitFeedback} className="pt-6 border-t border-zinc-800/60 space-y-4 shrink-0">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-2">
                  Retroalimentación para el Aprendiz
                </label>
                <textarea 
                  value={comment} 
                  onChange={(e) => setComment(e.target.value)} 
                  placeholder="Escribe tus observaciones aquí para guiar al estudiante sobre sus aciertos o desvíos operativos..." 
                  rows={4} 
                  className="w-full bg-[#0d0e12] border border-zinc-800/60 rounded-xl p-4 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-green-500/40 transition-colors resize-none custom-scrollbar" 
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
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-2 select-none">
            <p className="text-sm">Selecciona una entrega del panel lateral.</p>
            <p className="text-xs text-zinc-600">Revisa las respuestas detalladas del alumno antes de comentar.</p>
          </div>
        )}
      </div>
    </div>
  );
};