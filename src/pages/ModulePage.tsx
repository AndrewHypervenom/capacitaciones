// src/pages/ModulePage.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Check,
  Clock,
  ChevronRight,
  Target,
  AlertTriangle,
  Lightbulb,
  UserCheck
} from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useAuth } from '@/hooks/useAuth';
import { useModules } from '@/hooks/useModules';
import { useProgressStore } from '@/stores/progressStore';
import { Button } from '@/components/ui/Button';
import { Reveal } from '@/components/ui/Reveal';
import { GlassCard } from '@/components/ui/GlassCard';
import { GradientHeading } from '@/components/ui/GradientHeading';
import { NeonBadge } from '@/components/ui/NeonBadge';
import { KnowledgeCheck } from '@/components/modules/KnowledgeCheck';
import { ModuleTOC } from '@/components/modules/ModuleTOC';
import { SectionLayout } from '@/components/modules/SectionLayout';
import { cn } from '@/lib/cn';
import type { ContentBlock } from '@/types/blocks';
import type { ModuleSection, SectionMedia } from '@/data/modules';
import { ModulePageSkeleton } from '@/components/ui/Skeleton';
import { BlockRenderer } from '@/components/modules/blocks/BlockRenderer';
import { toast } from '@/stores/toastStore';
import { getModuleFeedbackForUser } from '@/services/activity.service';
import type { Language } from '@/stores/userStore';
import { FeedbackModal } from '@/components/modules/FeedbackModal';


function getMediaClasses(media: SectionMedia) {
  const sizeMap: Record<string, string> = { sm: 'max-w-xs', md: 'max-w-2xl', lg: 'max-w-4xl', full: 'w-full', bleed: 'w-full' };
  const alignMap: Record<string, string> = { left: 'mr-auto', center: 'mx-auto', right: 'ml-auto' };
  return cn(sizeMap[media.size ?? 'full'] ?? 'w-full', media.size !== 'full' && media.size !== 'bleed' ? alignMap[media.align ?? 'center'] ?? 'mx-auto' : '');
}

function MediaBlock({ media, language }: { media: SectionMedia; language: Language }) {
  const wrapperCls = cn('rounded-2xl overflow-hidden border border-line', getMediaClasses(media), media.shadow && 'shadow-2xl shadow-black/12 ring-1 ring-black/5');
  return (
    <figure className={wrapperCls}>
      {media.type === 'image' && <img src={media.url} alt={media.caption?.[language] ?? ''} loading="lazy" className="w-full object-cover block" />}
      {media.type === 'youtube' && (
        <div className="relative w-full bg-black" style={{ paddingTop: '56.25%' }}>
          <iframe src={`https://www.youtube.com/embed/${media.url}?rel=0&modestbranding=1`} title={media.caption?.[language] ?? 'Video'} loading="lazy" allowFullScreen className="absolute inset-0 w-full h-full border-0" />
        </div>
      )}
      {media.caption?.[language] && <figcaption className="px-5 py-3 text-[12.5px] text-text-subtle border-t border-line bg-subtle">{media.caption[language]}</figcaption>}
    </figure>
  );
}

export default function ModulePage() {
  const { id } = useParams(); 
  const { t } = useTranslation();
  const nav = useNavigate();
  const { profile } = useAuth();
  const language = useUserStore((s) => s.language);
  const userRole = profile?.role ?? null;
  const userId = profile?.id;
  
  const isTrainer = userRole === 'capacitador' || userRole === 'superadmin';
  const targetUserId = userId; 
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [gameScores, setGameScores] = useState<Record<string, { aciertos: number; total: number }>>({});
  
  const handleGameScore = (sectionId: string, aciertos: number, total: number) => {
    setGameScores(prev => ({
      ...prev,
      [sectionId]: { aciertos, total }
    }));
  };

  const { completedModules, markModule, earnXP, updateStreak } = useProgressStore();
  const { modules, loading } = useModules();
  const module = useMemo(() => modules.find((m) => m.id === id), [id, modules]);
  const moduleIndex = useMemo(() => modules.findIndex((m) => m.id === id), [id, modules]);
  const nextModule = moduleIndex >= 0 ? modules[moduleIndex + 1] : undefined;
  const completed = module ? completedModules.includes(module.id) : false;
  
  const [attemptsFeedback, setAttemptsFeedback] = useState<any[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [apprenticeComment, setApprenticeComment] = useState('');
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [readingMode] = useState(false);

  const fetchModuleFeedback = async () => {
    if (!module || !targetUserId) return;
    const realUuid = module.dbId || module.id; 
    
    try {
      const { data, error } = await getModuleFeedbackForUser(realUuid, targetUserId);
      if (data) {
        setAttemptsFeedback(data);
      } else if (error) {
        console.error("Error al obtener feedback:", error);
      }
    } catch (err) {
      console.error("Error inesperado en fetch:", err);
    }
  };

  useEffect(() => {
    fetchModuleFeedback();
  }, [module?.dbId, module?.id, id, targetUserId, refreshKey]);

  useEffect(() => {
    const handleAttemptSaved = () => {
      setRefreshKey((k) => k + 1); // dispara fetchModuleFeedback() de nuevo
    };

    window.addEventListener('activity_attempt_saved', handleAttemptSaved);
    return () => {
      window.removeEventListener('activity_attempt_saved', handleAttemptSaved);
    };
  }, []);

  // ─── PANEL DEL APRENDIZ: solo el intento MÁS RECIENTE por sección ───
  const latestAttemptsPerSection = useMemo(() => {
    if (!attemptsFeedback || attemptsFeedback.length === 0) return [];

    // Ordenamos por started_at (fecha real del intento) antes de deduplicar.
    const ordenados = [...attemptsFeedback].sort((a: any, b: any) => {
      const fechaA = a.started_at ? new Date(a.started_at).getTime() : 0;
      const fechaB = b.started_at ? new Date(b.started_at).getTime() : 0;
      return fechaA - fechaB; // ascendente: el más viejo primero
    });

    const bySection = new Map<string, any>();
    ordenados.forEach((attempt: any) => {
      const key = `${attempt.section_id || attempt.id}__${attempt.game_type || 'unknown'}`;
      bySection.set(key, attempt);
    });

    // Enriquecemos cada intento con el nombre real de SU módulo
    return Array.from(bySection.values()).map((attempt: any) => {
      const ownerModule = modules.find((m) => m.dbId === attempt.module_id);
      return {
        ...attempt,
        module_title: ownerModule ? ownerModule.title[language] : 'Plantilla sin módulo asociado',
      };
    });
  }, [attemptsFeedback, modules, language]);
  
  // ─── PROCESAMIENTO DINÁMICO DE MÉTRICAS CARD LATERAL ───
  const computedMetrics = useMemo(() => {
    const sectionsCount = module && module.sections ? module.sections.length : 0;
    
    if (!latestAttemptsPerSection || latestAttemptsPerSection.length === 0) {
      return {
        timeSpent: 'Pendiente', efficiency: 0, pendingSectionsCount: sectionsCount,
        goodAt: 'Comprensión inicial en curso.', badAt: 'Ninguna alerta registrada.',
        reinforce: 'Completa los desafíos prácticos obligatorios.', trainerNotes: null
      };
    }

    const currentAttempts = latestAttemptsPerSection;
    let approvedCount = 0;
    const failedNames: string[] = [];
    const approvedNames: string[] = [];
    let latestTrainerComment: string | null = null;

    currentAttempts.forEach((attempt: any) => {
      const targetSection = module && module.sections ? module.sections.find((s) => s.id === attempt.section_id) : null;
      const sectionTitle = (targetSection as any)?.heading?.[language] || attempt.module_title || `Desafío Práctico`;
      
      if (attempt.score >= 70) {
        approvedCount++;
        approvedNames.push(sectionTitle);
      } else {
        failedNames.push(sectionTitle);
      }
      if (attempt.trainer_comment) latestTrainerComment = attempt.trainer_comment;
    });

    const totalScoresSum = currentAttempts.reduce((acc: number, curr: any) => acc + (curr.score || 0), 0);
    const averageEfficiency = currentAttempts.length > 0 ? Math.round(totalScoresSum / currentAttempts.length) : 0;
    const sectionsToCorrect = currentAttempts.filter((a: any) => (a.score || 0) < 70).length;

    return {
      timeSpent: '12 min 45 s',
      efficiency: averageEfficiency, 
      pendingSectionsCount: sectionsToCorrect,
      goodAt: approvedNames.length > 0 ? `Sólido dominio en: ${approvedNames.slice(0, 2).join(', ')}.` : 'Identificación de patrones de suplantación y flujos críticos.',
      badAt: failedNames.length > 0 ? `Anomalías en: ${failedNames.join(', ')}.` : 'Falsos positivos en alertas de riesgo operativo temprano.',
      reinforce: failedNames.length > 0 ? `Revisar y repetir flujos de: ${failedNames.slice(0, 2).join(', ')}.` : 'Revisar la sección de tipologías avanzadas de fraude.',
      trainerNotes: latestTrainerComment
    };
  }, [latestAttemptsPerSection, module, language]);

  
  const totalQuizzes = useMemo(() => (module && module.sections ? module.sections.filter((s) => !!s.quiz).length : 0), [module]);
  const quizIndexMap = useMemo(() => {
    let count = 0;
    return (module && module.sections ? module.sections.map((s) => (s.quiz ? count++ : -1)) : []);
  }, [module]);

  const handleSendApprenticeFeedback = async () => {
    if (!apprenticeComment.trim()) return;
    setIsSendingFeedback(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800)); 
      toast.success('¡Gracias! Tu opinión nos ayuda a mejorar el contenido del módulo.');
      setApprenticeComment('');
    } catch {
      toast.error('No se pudo enviar.');
    } finally {
      setIsSendingFeedback(false);
    }
  };

  if (loading) return <ModulePageSkeleton />;
  if (!module) return <div className="text-center pt-20 text-text-muted">Módulo no encontrado.</div>;

  const handleComplete = () => {
    earnXP(100);
    updateStreak();
    markModule(module.id, modules.length);
    toast.success(`¡${module.title[language]} completado!`);
    if (nextModule) setTimeout(() => nav(`/modules/${nextModule.id}`), 600);
  };

  return (
    <>
      <div className={cn('mx-auto px-5 pt-12 pb-28 transition-all duration-500', readingMode ? 'max-w-2xl' : 'max-w-6xl')}>
        <div className={cn(readingMode ? 'block' : 'grid md:grid-cols-[280px_1fr] gap-12')}>
            
          {!readingMode && (
            <aside className="flex flex-col justify-between sticky top-24 self-start h-[calc(100vh-140px)] pr-2 w-full">
              <div className="w-full overflow-y-auto custom-scrollbar max-h-[70vh] pb-4">
                <ModuleTOC sections={module.sections} language={language} sectionPrefix="section" />
              </div>
            </aside>
          )}

          <article className="space-y-20 min-w-0">
            {module.sections.map((s: ModuleSection, i: number) => {
              if (s.style === 'video-interactive') return null;
              const quizIdx = quizIndexMap[i];
          
              return (
                <Reveal as="section" key={i} delay={Math.min(i * 60, 200)}>
                  <div id={`section-${i}`} className="scroll-mt-28">
                    <SectionLayout style={(s.style ?? 'default') as any} hasMedia={!!s.media} feedbackNode={null}>
                      <div className="text-[10.5px] uppercase tracking-widest text-text-subtle mb-4">
                        {String(i + 1).padStart(2, '0')} — {String(module.sections.length).padStart(2, '0')}
                      </div>
                      <h2 className="font-bold text-[clamp(1.6rem,2.5vw+0.5rem,2.2rem)] tracking-[-0.03em] leading-tight mb-5">
                        {(s.heading as any)?.[language]}
                      </h2>
                      
                      {s.blocks && s.blocks.length > 0 ? (
                        <div>
                          {s.blocks.map((block, j) => (
                            <BlockRenderer
                              key={j}
                              block={block as ContentBlock}
                              language={language}
                              moduleId={module.dbId || module.id}
                              sectionId={s.id}
                              blockIndex={j} 
                              userId={targetUserId ?? ''}
                              campaignId={module.campaign_id}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-5 text-[16px] leading-[1.8] text-text/92">
                          {(s.body as any)?.[language]?.map((p: any, j: number) => (
                            <p key={j}>{p}</p>
                          ))}
                        </div>
                      )}

                      {s.media && <div className="mt-8"><MediaBlock media={s.media} language={language} /></div>}
                      
                      {s.quiz && (
                      <KnowledgeCheck
                        moduleId={module.dbId || module.id}
                        sectionIdx={quizIdx}
                        sectionId={s.id}
                        userId={targetUserId}
                        campaignId={module.campaign_id}
                        quiz={s.quiz}
                        language={language}
                        quizIndex={quizIdx >= 0 ? quizIdx : undefined}
                        totalQuizzes={totalQuizzes}
                      />
                    )}
                    </SectionLayout>
                  </div>
                </Reveal>
              );
            })}

            <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-6 border-t border-glass-border/10">
              <button 
                type="button"
                className="w-full sm:w-auto mr-auto px-5 py-2.5 flex items-center justify-center gap-2 border border-neon-green/30 text-neon-green bg-neon-green/5 hover:bg-neon-green/10 transition-all rounded-xl text-[13px] font-medium shadow-[0_0_15px_rgba(0,255,100,0.05)]"
                onClick={() => setIsModalOpen(true)}
              >
                <Target className="h-4 w-4 text-neon-green animate-pulse" />
                Ver Feedback y Progreso
              </button>
              {!completed && (
                <Button variant="neon" size="md" onClick={handleComplete}>
                  <Check className="h-4 w-4" strokeWidth={3} /> {t('module.mark_complete')}
                </Button>
              )}
              {nextModule && (
                <Button variant={completed ? 'neon' : 'glass'} size="md" onClick={() => nav(`/modules/${nextModule.id}`)}>
                  {t('module.next')} <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </article>
        </div>
      </div>
        
      <FeedbackModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)} 
        attempts={latestAttemptsPerSection} 
        computedMetrics={computedMetrics as any} 
      />
    </>
  );
}
