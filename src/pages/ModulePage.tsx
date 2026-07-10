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
  Lock,
  UserCheck,
  X
} from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useAuth } from '@/hooks/useAuth';
import { useModules } from '@/hooks/useModules';
import { useLearnerCourses } from '@/hooks/useLearnerCourses';
import { useProgressStore } from '@/stores/progressStore';
import { Button } from '@/components/ui/Button';
import { Reveal } from '@/components/ui/Reveal';
import { GlassCard } from '@/components/ui/GlassCard';
import { GradientHeading } from '@/components/ui/GradientHeading';
import { NeonBadge } from '@/components/ui/NeonBadge';
import { KnowledgeCheck } from '@/components/modules/KnowledgeCheck';
import { InteractiveVideoModule } from '@/components/modules/InteractiveVideoModule';
import { ModuleTOC } from '@/components/modules/ModuleTOC';
import { SectionLayout } from '@/components/modules/SectionLayout';
import { cn } from '@/lib/cn';
import { setQuizSoundTheme } from '@/lib/sound';
import type { ContentBlock } from '@/types/blocks';
import type { ModuleSection, SectionMedia } from '@/data/modules';
import { ModulePageSkeleton } from '@/components/ui/Skeleton';
import { ScrollToTopButton } from '@/components/ui/ScrollToTopButton';
import { BlockRenderer } from '@/components/modules/blocks/BlockRenderer';
import { toast } from '@/stores/toastStore';
import { getModuleFeedbackForUser } from '@/services/activity.service';
import { getCourseModulePassPct } from '@/services/courses.service';
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

type GradedUnitType = 'KNOWLEDGE_CHECK' | 'SORT_PROCESS' | 'CLASSIFY_CASES' | 'VIDEO_QUIZ';
interface GradedUnit {
  key: string;
  sectionIndex: number;
  type: GradedUnitType;
  detail: string;
}
const ACTIVITY_LABEL_KEY: Record<GradedUnitType, string> = {
  KNOWLEDGE_CHECK: 'module.activity_quiz',
  SORT_PROCESS: 'module.activity_sort',
  CLASSIFY_CASES: 'module.activity_classify',
  VIDEO_QUIZ: 'module.activity_video',
};

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

  const { completedModules, markModule, earnXP, updateStreak } = useProgressStore();
  const { modules, loading } = useModules();
  const { courses } = useLearnerCourses();
  const module = useMemo(() => modules.find((m) => m.id === id), [id, modules]);

  // Tema de sonido de los quizzes (elegido por el capacitador en el módulo).
  useEffect(() => {
    setQuizSoundTheme(module?.soundTheme);
  }, [module?.soundTheme]);
  // Botón "Volver": si el módulo pertenece a un curso, regresa a su página; si no,
  // al panel del aprendiz. El curso se enruta por slug, no por id.
  const backCourse = useMemo(
    () => (module?.courseId ? courses.find((c) => c.id === module.courseId) : undefined),
    [courses, module?.courseId],
  );
  const backTo = backCourse ? `/courses/${backCourse.slug}` : '/dashboard';
  const backLabel = backCourse ? t('module.back_to_course') : t('module.back');
  // Los hermanos de navegación son los módulos del mismo curso (ordenados por
  // su posición en el curso) o, si no pertenece a un curso, los del plan general.
  const siblings = useMemo(() => {
    if (!module) return modules;
    return module.courseId
      ? modules
          .filter((m) => m.courseId === module.courseId)
          .sort((a, b) => (a.courseSortOrder ?? 0) - (b.courseSortOrder ?? 0))
      : modules.filter((m) => !m.courseId);
  }, [modules, module]);
  const moduleIndex = useMemo(() => siblings.findIndex((m) => m.id === id), [id, siblings]);
  const nextModule = moduleIndex >= 0 ? siblings[moduleIndex + 1] : undefined;
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
        module_title: ownerModule ? ownerModule.title[language] : t('module.no_module_template'),
      };
    });
  }, [attemptsFeedback, modules, language]);

  // ─── COMPUERTA DE APROBACIÓN DEL MÓDULO ──────────────────────────────────
  // Un módulo solo se completa si el promedio de sus actividades calificables
  // (quizzes + juegos) alcanza el umbral configurado por el curso (default 80).
  // Un intento no realizado cuenta como 0, así que hay que hacerlas y aprobarlas.
  const [coursePassPct, setCoursePassPct] = useState<number>(80);
  useEffect(() => {
    const cid = module?.courseId;
    if (!cid) { setCoursePassPct(80); return; }
    let active = true;
    getCourseModulePassPct(cid)
      .then((p) => { if (active) setCoursePassPct(p); })
      .catch(() => { /* mantiene default */ });
    return () => { active = false; };
  }, [module?.courseId]);

  // Actividades calificables esperadas del módulo, con la misma clave que usa
  // el registro de intentos (`section_id__GAME_TYPE`) para poder cruzarlas.
  const gradedUnits = useMemo<GradedUnit[]>(() => {
    const GRADED_BLOCK: Record<string, 'SORT_PROCESS' | 'CLASSIFY_CASES'> = {
      'game-sort': 'SORT_PROCESS',
      'game-classify': 'CLASSIFY_CASES',
    };
    const units: GradedUnit[] = [];
    const secs = (module?.sections ?? []) as any[];
    secs.forEach((s, i) => {
      const sid = s.id;
      if (!sid) return; // sin id no se puede cruzar con los intentos → no se exige
      const heading = (s.heading?.[language] as string) ?? '';
      if (s.quiz) units.push({ key: `${sid}__KNOWLEDGE_CHECK`, sectionIndex: i, type: 'KNOWLEDGE_CHECK', detail: heading });
      if (Array.isArray(s.blocks)) {
        s.blocks.forEach((b: any, bi: number) => {
          const gt = GRADED_BLOCK[b?.type];
          if (gt) { units.push({ key: `${sid}__${gt}`, sectionIndex: i, type: gt, detail: heading }); return; }
          // Quiz como bloque dinámico (módulos de IA): cada uno es una unidad
          // calificable independiente, identificada por su llave `sid:bIndex`.
          if (b?.type === 'quiz') {
            units.push({ key: `KC__${sid}:b${bi}`, sectionIndex: i, type: 'KNOWLEDGE_CHECK', detail: heading });
          }
        });
      }
      // Video interactivo: cada marcador tipo quiz es una unidad independiente.
      if (Array.isArray(s.videoMarkers)) {
        for (const mk of s.videoMarkers as any[]) {
          if (mk?.type === 'quiz') {
            units.push({
              key: `${sid}__VIDEO_QUIZ__${mk.id}`,
              sectionIndex: i,
              type: 'VIDEO_QUIZ',
              detail: (mk.title?.[language] as string) || heading,
            });
          }
        }
      }
    });
    const seen = new Set<string>();
    return units.filter((u) => (seen.has(u.key) ? false : (seen.add(u.key), true)));
  }, [module, language]);

  // Puntaje por unidad calificable, tomando el ÚLTIMO intento de cada una.
  // Se construye desde los intentos crudos (no los colapsados por sección) para
  // poder desglosar el video interactivo por marcador (marker_id).
  const scoreByUnit = useMemo(() => {
    const ordered = [...(attemptsFeedback ?? [])].sort((a: any, b: any) => {
      const ta = a.started_at ? new Date(a.started_at).getTime() : 0;
      const tb = b.started_at ? new Date(b.started_at).getTime() : 0;
      return ta - tb; // ascendente: el intento más nuevo pisa al viejo
    });
    const m = new Map<string, number>();
    for (const a of ordered as any[]) {
      const sid = a.section_id || a.id;
      const quizKey = a.submitted_answers?.quiz_key;
      let key: string;
      if (a.game_type === 'VIDEO_QUIZ') {
        key = `${sid}__VIDEO_QUIZ__${a.submitted_answers?.marker_id ?? 'default'}`;
      } else if (a.game_type === 'KNOWLEDGE_CHECK' && quizKey) {
        // Quiz-bloque: se cruza por su llave única, no por sección.
        key = `KC__${quizKey}`;
      } else {
        key = `${sid}__${a.game_type}`;
      }
      m.set(key, typeof a.score === 'number' ? a.score : 0);
    }
    return m;
  }, [attemptsFeedback]);

  // Igual que scoreByUnit pero guardando el intento COMPLETO (no solo el score),
  // para que cada actividad interactiva pueda restaurar su estado "ya completado"
  // desde la base y el aprendiz no tenga que rehacerla al volver al módulo.
  const attemptByUnit = useMemo(() => {
    const ordered = [...(attemptsFeedback ?? [])].sort((a: any, b: any) => {
      const ta = a.started_at ? new Date(a.started_at).getTime() : 0;
      const tb = b.started_at ? new Date(b.started_at).getTime() : 0;
      return ta - tb; // ascendente: el intento más nuevo pisa al viejo
    });
    const m = new Map<string, any>();
    for (const a of ordered as any[]) {
      const sid = a.section_id || a.id;
      const quizKey = a.submitted_answers?.quiz_key;
      let key: string;
      if (a.game_type === 'VIDEO_QUIZ') {
        key = `${sid}__VIDEO_QUIZ__${a.submitted_answers?.marker_id ?? 'default'}`;
      } else if (a.game_type === 'KNOWLEDGE_CHECK' && quizKey) {
        key = `KC__${quizKey}`;
      } else {
        key = `${sid}__${a.game_type}`;
      }
      m.set(key, a);
    }
    return m;
  }, [attemptsFeedback]);

  // Resultados guardados de los quizzes de video, por sección → por marcador.
  // Permite que el reproductor restaure "quiz ya hecho" y no obligue a repetirlo
  // para poder avanzar el video (la compuerta de avance mira completedQuizzes).
  const videoQuizResultsBySection = useMemo(() => {
    const out: Record<string, Record<string, { score: number; total: number }>> = {};
    const secs = (module?.sections ?? []) as any[];
    for (const s of secs) {
      if (!s.id || !Array.isArray(s.videoMarkers)) continue;
      for (const mk of s.videoMarkers as any[]) {
        if (mk?.type !== 'quiz') continue;
        const at = attemptByUnit.get(`${s.id}__VIDEO_QUIZ__${mk.id}`);
        if (!at) continue;
        const sa = at.submitted_answers ?? {};
        const total = typeof sa.total === 'number' ? sa.total : (mk.questions?.length ?? 0);
        const score = typeof sa.aciertos === 'number' ? sa.aciertos : 0;
        (out[s.id] ??= {})[mk.id] = { score, total };
      }
    }
    return out;
  }, [attemptByUnit, module]);

  const moduleGate = useMemo(() => {
    type Pending = { unit: GradedUnit; status: 'failed' | 'pending'; score: number | null };
    const total = gradedUnits.length;
    // Módulo sin actividades calificables → no hay compuerta (solo lectura).
    if (total === 0) return { active: false, score: 100, done: 0, total: 0, canComplete: true, pending: [] as Pending[] };
    let sum = 0;
    let done = 0;
    const pending: Pending[] = [];
    for (const u of gradedUnits) {
      const has = scoreByUnit.has(u.key);
      const sc = scoreByUnit.get(u.key) ?? 0;
      sum += sc;
      if (has) done++;
      if (sc < coursePassPct) pending.push({ unit: u, status: has ? 'failed' : 'pending', score: has ? sc : null });
    }
    const score = Math.round(sum / total);
    return { active: true, score, done, total, canComplete: score >= coursePassPct, pending };
  }, [gradedUnits, scoreByUnit, coursePassPct]);
  
  // ─── PROCESAMIENTO DINÁMICO DE MÉTRICAS CARD LATERAL ───
  const computedMetrics = useMemo(() => {
    const sectionsCount = module && module.sections ? module.sections.length : 0;
    
    if (!latestAttemptsPerSection || latestAttemptsPerSection.length === 0) {
      return {
        timeSpent: t('module.metric_pending'), efficiency: 0, pendingSectionsCount: sectionsCount,
        goodAt: t('module.metric_good_default'), badAt: t('module.metric_no_alerts'),
        reinforce: t('module.metric_reinforce_default'), trainerNotes: null
      };
    }

    const currentAttempts = latestAttemptsPerSection;
    let approvedCount = 0;
    const failedNames: string[] = [];
    const approvedNames: string[] = [];
    let latestTrainerComment: string | null = null;

    currentAttempts.forEach((attempt: any) => {
      const targetSection = module && module.sections ? module.sections.find((s) => s.id === attempt.section_id) : null;
      const sectionTitle = (targetSection as any)?.heading?.[language] || attempt.module_title || t('module.challenge_practical');
      
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
      goodAt: approvedNames.length > 0 ? t('module.metric_good_strong', { names: approvedNames.slice(0, 2).join(', ') }) : t('module.metric_good_patterns'),
      badAt: failedNames.length > 0 ? t('module.metric_bad_anomalies', { names: failedNames.join(', ') }) : t('module.metric_bad_false_pos'),
      reinforce: failedNames.length > 0 ? t('module.metric_reinforce_repeat', { names: failedNames.slice(0, 2).join(', ') }) : t('module.metric_reinforce_typologies'),
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
      toast.success(t('module.feedback_thanks'));
      setApprenticeComment('');
    } catch {
      toast.error(t('module.send_error'));
    } finally {
      setIsSendingFeedback(false);
    }
  };

  if (loading) return <ModulePageSkeleton />;
  if (!module) return <div className="text-center pt-20 text-text-muted">{t('module.not_found')}</div>;

  const handleComplete = () => {
    if (!moduleGate.canComplete) return; // compuerta: no aprobó las actividades
    earnXP(100);
    updateStreak();
    markModule(module.id, siblings.length);
    toast.success(t('module.completed_toast', { title: module.title[language] }));
    if (nextModule) setTimeout(() => nav(`/modules/${nextModule.id}`), 600);
  };

  return (
    <>
      <div className={cn('mx-auto px-5 pt-12 pb-28 transition-all duration-500', readingMode ? 'max-w-2xl' : 'max-w-6xl')}>
        {/* ── Portada del módulo: meta + título + subtítulo + objetivos ── */}
        <header className="mb-12">
          <Reveal>
            <Link
              to={backTo}
              className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors mb-6"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {backLabel}
            </Link>
          </Reveal>
          <Reveal>
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <NeonBadge color="neutral">
                {t('module.of_modules', { idx: moduleIndex + 1, total: modules.length })}
              </NeonBadge>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-muted">
                <Clock className="h-3.5 w-3.5" />
                {t('module.duration', { min: module.duration })}
              </span>
              {completed && (
                <NeonBadge color="green">
                  <Check className="h-3 w-3" strokeWidth={3} />
                  {t('module.marked_complete')}
                </NeonBadge>
              )}
            </div>

            <GradientHeading as="h1" variant="white" size="display-lg" className="mb-5 text-balance">
              {module.title[language]}
            </GradientHeading>

            {module.subtitle?.[language] && (
              <p className="text-[17px] text-text-muted leading-relaxed max-w-2xl mb-10">
                {module.subtitle[language]}
              </p>
            )}
          </Reveal>

          {module.objectives?.[language]?.length > 0 && (
            <Reveal delay={80}>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                {module.objectives[language].map((o, i) => (
                  <GlassCard
                    key={i}
                    intensity="subtle"
                    interactive
                    padding="sm"
                    rounded="2xl"
                    className="flex items-start gap-3"
                  >
                    <span className="mt-0.5 h-5 w-5 rounded-full bg-glass-border/10 text-text-muted flex items-center justify-center text-[10px] font-bold shrink-0 ring-1 ring-glass-border/8">
                      {i + 1}
                    </span>
                    <span className="text-[13px] text-text leading-snug">{o}</span>
                  </GlassCard>
                ))}
              </div>
            </Reveal>
          )}

          {/* Separador con conteo de secciones */}
          <div className="flex items-center gap-4 mt-12">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-glass-border/15" />
            <span className="text-[11px] text-text-subtle uppercase tracking-wider font-medium">
              {module.sections.length} {module.sections.length === 1 ? t('module.section_one') : t('module.section_other')}
              {totalQuizzes > 0 && ` · ${totalQuizzes} ${totalQuizzes === 1 ? t('module.check_one') : t('module.check_other')}`}
            </span>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-glass-border/15" />
          </div>
        </header>

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
              const quizIdx = quizIndexMap[i];

              // Video interactivo: se renderiza (con ids reales) para que el
              // aprendiz responda sus quizzes y cuenten en la compuerta.
              if (s.style === 'video-interactive') {
                return (
                  <Reveal as="section" key={i} delay={Math.min(i * 60, 200)}>
                    <div id={`section-${i}`} className="scroll-mt-28">
                      <div className="text-[10.5px] uppercase tracking-widest text-text-subtle mb-4">
                        {String(i + 1).padStart(2, '0')} — {String(module.sections.length).padStart(2, '0')}
                      </div>
                      <h2 className="font-bold text-[clamp(1.6rem,2.5vw+0.5rem,2.2rem)] tracking-[-0.03em] leading-tight mb-5">
                        {(s.heading as any)?.[language]}
                      </h2>
                      <InteractiveVideoModule
                        section={s}
                        language={language}
                        userId={targetUserId ?? undefined}
                        campaignId={module.campaign_id}
                        moduleId={module.dbId || module.id}
                        savedQuizResults={s.id ? videoQuizResultsBySection[s.id] : undefined}
                      />
                    </div>
                  </Reveal>
                );
              }

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
                              savedAttempts={attemptByUnit}
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
                        savedAttempt={s.id ? attemptByUnit.get(`${s.id}__KNOWLEDGE_CHECK`) : undefined}
                      />
                    )}
                    </SectionLayout>
                  </div>
                </Reveal>
              );
            })}

            {/* Desglose: actividades que faltan por aprobar para completar el módulo */}
            {!completed && moduleGate.active && !moduleGate.canComplete && moduleGate.pending.length > 0 && (
              <div className="mt-14 rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-5">
                <div className="flex items-center gap-2 mb-1.5">
                  <Lock className="h-4 w-4 text-amber-500 shrink-0" />
                  <h3 className="text-[14px] font-semibold text-text">{t('module.pending_title')}</h3>
                  <span className="ml-auto text-[12px] tabular-nums text-text-muted">
                    {t('module.pending_progress', { done: moduleGate.done, total: moduleGate.total })}
                  </span>
                </div>
                <p className="text-[12px] text-text-muted mb-4">
                  {t('module.pending_hint', { threshold: coursePassPct, score: moduleGate.score })}
                </p>
                <ul className="space-y-2">
                  {moduleGate.pending.map((p) => (
                    <li key={p.unit.key}>
                      <a
                        href={`#section-${p.unit.sectionIndex}`}
                        className="group flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5 transition-colors hover:border-primary/40"
                      >
                        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          p.status === 'failed' ? 'bg-neon-magenta/10 text-neon-magenta' : 'bg-subtle text-text-muted')}>
                          {p.status === 'failed' ? <X className="h-4 w-4" strokeWidth={3} /> : <Lock className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-text truncate">{t(ACTIVITY_LABEL_KEY[p.unit.type])}</div>
                          {p.unit.detail && <div className="text-[11px] text-text-subtle truncate">{p.unit.detail}</div>}
                        </div>
                        <span className={cn('shrink-0 text-[11px] font-semibold tabular-nums',
                          p.status === 'failed' ? 'text-neon-magenta' : 'text-text-subtle')}>
                          {p.status === 'failed' ? `${p.score}/${coursePassPct}` : t('module.pending_not_started')}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle transition-colors group-hover:text-primary" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
                <Button variant="neon" size="md" onClick={handleComplete} disabled={!moduleGate.canComplete}>
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

      <ScrollToTopButton />
    </>
  );
}
