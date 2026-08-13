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
import { useViewingPresence } from '@/hooks/usePresence';
import {
  useProgressStore,
  useModuleDone,
  keyOfModule,
  reviewValue,
  XP_REWARDS,
} from '@/stores/progressStore';
import { useActiveXPEvent } from '@/stores/xpEventStore';
import { ReviewButton } from '@/components/gamification/ReviewButton';
import { Button } from '@/components/ui/Button';
import { Reveal } from '@/components/ui/Reveal';
import { RichText, RichTextInline } from '@/components/ui/RichText';
import { KnowledgeCheck } from '@/components/modules/KnowledgeCheck';
import { InteractiveVideoModule } from '@/components/modules/InteractiveVideoModule';
import { ModuleTOC } from '@/components/modules/ModuleTOC';
import { VideoCinema } from '@/components/modules/VideoCinema';
import { isVideoOnlyModule } from '@/lib/videoPlaylist';
import { SectionLayout } from '@/components/modules/SectionLayout';
import { cn } from '@/lib/cn';
import { setQuizSoundTheme } from '@/lib/sound';
import { vimeoEmbedUrl } from '@/lib/vimeo';
import type { ContentBlock } from '@/types/blocks';
import type { LearningModule, ModuleSection, SectionMedia } from '@/data/modules';
import { getModuleById } from '@/services/modules.service';
import { ModulePageSkeleton } from '@/components/ui/Skeleton';
import { BlockRenderer } from '@/components/modules/blocks/BlockRenderer';
import { toast } from '@/stores/toastStore';
import { getModuleFeedbackForUser } from '@/services/activity.service';
import { getCourseModulePassPct } from '@/services/courses.service';
import { useModuleTimer } from '@/hooks/useModuleTimer';
import type { Language } from '@/stores/userStore';
import { FeedbackModal } from '@/components/modules/FeedbackModal';
import {
  getSimulationsUnlockedByModule,
  simulationPath,
  type UnlockedSimulation,
} from '@/services/moduleSimulations.service';
import { SimulationUnlockedModal } from '@/components/simulator/SimulationUnlockedModal';
import { ModulePracticeTeaser } from '@/components/simulator/ModulePracticeTeaser';


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
      {media.type === 'vimeo' && (
        <div className="relative w-full bg-black" style={{ paddingTop: '56.25%' }}>
          <iframe src={vimeoEmbedUrl(media.url)} title={media.caption?.[language] ?? 'Video'} loading="lazy" allowFullScreen className="absolute inset-0 w-full h-full border-0" />
        </div>
      )}
      {media.caption?.[language] && <figcaption className="px-5 py-3 text-[12.5px] text-text-subtle border-t border-line bg-subtle">{media.caption[language]}</figcaption>}
    </figure>
  );
}

type GradedUnitType = 'KNOWLEDGE_CHECK' | 'SORT_PROCESS' | 'CLASSIFY_CASES' | 'VIDEO_QUIZ' | 'DOCUMENT_REVIEW';
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
  DOCUMENT_REVIEW: 'module.activity_document',
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

  const { markModule, updateStreak, reviewModule } = useProgressStore();
  // Se lee del store (no de un estado local) para que el botón se apague solo en
  // cuanto el repaso se cobra, incluso desde otra pestaña del mismo navegador.
  const reviewedAt = useProgressStore((s) => s.reviewedAt);
  const boostEvent = useActiveXPEvent();
  const boostMultiplier = boostEvent?.multiplier ?? 1;
  const isModuleDone = useModuleDone();
  // La LISTA va ligera (sin `blocks_data`): aquí solo se usa para los hermanos
  // del curso, la navegación al siguiente y los títulos de la retroalimentación.
  // El contenido pesado se pide de UN solo módulo, el que se está leyendo.
  // Antes esta pantalla descargaba el cuerpo de todos los módulos visibles —para
  // un superadmin, el de toda la plataforma— para mostrar uno.
  const { modules, loading: listLoading } = useModules({ lite: true });
  const { courses } = useLearnerCourses();

  // Quién PUEDE abrir este módulo se sigue decidiendo con la lista visible,
  // exactamente igual que antes: si no está ahí, es "Módulo no encontrado". La
  // consulta de contenido solo trae el cuerpo, nunca amplía el acceso — y va
  // contra el UUID que la lista ya resolvió, porque el slug no es único.
  const listed = useMemo(() => modules.find((m) => m.id === id), [id, modules]);
  const listedUuid = listed?.dbId ?? null;
  // El contenido se guarda JUNTO AL id que lo produjo. Así, al pasar de un
  // módulo al siguiente, el cuerpo anterior deja de contar por sí solo —sin
  // ningún efecto de limpieza— y nunca se pinta el módulo viejo con la URL nueva.
  const [content, setContent] = useState<{ id: string; module: LearningModule | null } | null>(null);
  useEffect(() => {
    if (!listedUuid) return;
    let active = true;
    getModuleById(listedUuid)
      .then((m) => { if (active) setContent({ id: listedUuid, module: m }) })
      .catch(() => { if (active) setContent({ id: listedUuid, module: null }) });
    return () => { active = false };
  }, [listedUuid]);

  const fresh = content?.id === listedUuid ? content : null;
  const module = listed && fresh?.module ? fresh.module : undefined;
  // Sigue "cargando" mientras la lista no llegue o mientras el contenido de ESTE
  // módulo esté en camino. Si la lista terminó y el módulo no está en ella, no
  // hay nada que esperar: es "Módulo no encontrado".
  const loading = listLoading || (!!listedUuid && !fresh);

  // Presencia: publico qué módulo estoy estudiando (modo 'view': aparezco en la
  // lista de "en línea" y en la píldora del módulo, pero no disparo el aviso de
  // coedición que es solo para quienes lo tienen abierto en el editor).
  // Usamos dbId (UUID real) porque es el id con el que lo publica el editor.
  useViewingPresence(
    module
      ? {
          type: 'module',
          id: module.dbId || module.id,
          title: module.title[language],
          campaignId: module.campaign_id ?? undefined,
          mode: 'view',
        }
      : null,
  );

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
  const completed = module ? isModuleDone(keyOfModule(module)) : false;

  // Repaso: cuánto pagaría ahora (con el evento del día aplicado) y si ya se
  // cobró hoy. Se calcula aquí para que el botón lo anuncie ANTES de pulsarlo.
  const reviewXPPreview = Math.round(reviewValue(XP_REWARDS.module) * boostMultiplier);
  const reviewedToday = useMemo(() => {
    if (!module) return false;
    const today = new Date().toISOString().split('T')[0];
    return [module.dbId, module.id].some((k) => !!k && reviewedAt[k] === today);
  }, [module, reviewedAt]);

  // Cronómetro real de tiempo activo en el módulo (se pausa al cambiar de
  // pestaña, sobrevive recargas, se persiste en BD y se congela al completar).
  // Usamos dbId (UUID real) porque module.id es el slug y el FK apunta a modules.id.
  const { label: activeTimeLabel } = useModuleTimer(module?.dbId ?? module?.id, userId, completed);

  // Enlace directo a una sección: `/modules/:slug#section-2`. Lo usa la vista
  // previa del panel ("ver esta sección como la ve el aprendiz"), pero sirve
  // para cualquier enlace. Se reintenta porque la sección puede montarse después
  // (media, bloques) y el ancla todavía no existe en el primer pintado.
  useEffect(() => {
    if (loading || !module) return;
    const hash = window.location.hash;
    if (!/^#section-\d+$/.test(hash)) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const el = document.getElementById(hash.slice(1));
      if (el) { el.scrollIntoView({ block: 'start' }); return; }
      if (tries++ < 20) timer = setTimeout(tick, 100);
    };
    tick();
    return () => clearTimeout(timer);
  }, [loading, module?.id]);

  const [attemptsFeedback, setAttemptsFeedback] = useState<any[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [apprenticeComment, setApprenticeComment] = useState('');
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [readingMode] = useState(false);

  // ─── Práctica anclada a ESTE módulo ─────────────────────────────────────
  // Simulaciones que se abren al terminarlo. Antes vivían solo al final de la
  // página del curso y nadie las relacionaba con el módulo que las ganaba:
  // ahora el módulo anuncia su premio antes y lo celebra al completarse.
  const [unlockedSims, setUnlockedSims] = useState<UnlockedSimulation[]>([]);
  const [unlockOpen, setUnlockOpen] = useState(false);
  useEffect(() => {
    const moduleUuid = module?.dbId;
    if (!moduleUuid) { setUnlockedSims([]); return; }
    let alive = true;
    getSimulationsUnlockedByModule(moduleUuid, language)
      .then((sims) => { if (alive) setUnlockedSims(sims); })
      .catch(() => { if (alive) setUnlockedSims([]); });
    return () => { alive = false; };
  }, [module?.dbId, language]);

  // El simulador necesita saber de qué curso viene (para el puntaje que cuenta
  // en la certificación) y a dónde volver al terminar.
  const goToSimulation = (sim: UnlockedSimulation) => {
    setUnlockOpen(false);
    nav(simulationPath(sim), {
      state: {
        courseId: module?.courseId ?? null,
        campaignId: module?.campaign_id ?? null,
        returnTo: backTo,
      },
    });
  };

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
          // Documento PDF marcado como obligatorio: revisar cuenta como unidad
          // calificable (score 100 al confirmar). Los opcionales no exigen nada.
          if (b?.type === 'pdf' && b.required !== false && b.url) {
            units.push({ key: `DOC__${sid}:b${bi}`, sectionIndex: i, type: 'DOCUMENT_REVIEW', detail: heading });
          }
          // Quiz DENTRO de un bloque de video. Se cruza con la misma llave que
          // usan la sección `video-interactive` y el registro de intentos
          // (`sección__VIDEO_QUIZ__marcador`), así que un video no cuenta distinto
          // por estar en un bloque en vez de ser la sección entera.
          if (b?.type === 'video' && Array.isArray(b.markers)) {
            for (const mk of b.markers as any[]) {
              if (mk?.type !== 'quiz') continue;
              units.push({
                key: `${sid}__VIDEO_QUIZ__${mk.id}`,
                sectionIndex: i,
                type: 'VIDEO_QUIZ',
                detail: (mk[`title_${language}`] as string) || mk.title_es || heading,
              });
            }
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
      } else if (a.game_type === 'DOCUMENT_REVIEW') {
        // Documento PDF: se cruza por su llave de bloque (varios PDFs por sección).
        key = `DOC__${a.submitted_answers?.doc_key ?? sid}`;
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
      } else if (a.game_type === 'DOCUMENT_REVIEW') {
        key = `DOC__${a.submitted_answers?.doc_key ?? sid}`;
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
      // El tiempo real lo aporta useModuleTimer; se inyecta al pasar a FeedbackModal.
      timeSpent: t('module.metric_pending'),
      efficiency: averageEfficiency,
      pendingSectionsCount: sectionsToCorrect,
      goodAt: approvedNames.length > 0 ? t('module.metric_good_strong', { names: approvedNames.slice(0, 2).join(', ') }) : t('module.metric_good_patterns'),
      badAt: failedNames.length > 0 ? t('module.metric_bad_anomalies', { names: failedNames.join(', ') }) : t('module.metric_bad_false_pos'),
      reinforce: failedNames.length > 0 ? t('module.metric_reinforce_repeat', { names: failedNames.slice(0, 2).join(', ') }) : t('module.metric_reinforce_typologies'),
      trainerNotes: latestTrainerComment
    };
  }, [latestAttemptsPerSection, module, language]);

  
  // ¿El módulo es solo video? Entonces se pinta en modo cine. La decisión es
  // conservadora: cualquier bloque que no sea video o texto de apoyo devuelve
  // el módulo a la vista normal (ver `lib/videoPlaylist`).
  const cinemaMode = useMemo(() => (module ? isVideoOnlyModule(module, language) : false), [module, language]);

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
    // El XP del módulo lo otorga `markModule` (ver XP_REWARDS): aquí duplicaba.
    updateStreak();
    markModule(keyOfModule(module), siblings.map(keyOfModule));
    toast.success(t('module.completed_toast', { title: module.title[language] }));
    // Si este módulo desbloquea práctica, ESE es el final del módulo: se celebra
    // y el aprendiz decide. Saltar solo al siguiente se llevaría por delante el
    // premio que se acaba de ganar (y nadie volvería a buscarlo).
    if (unlockedSims.length > 0) { setUnlockOpen(true); return; }
    if (nextModule) setTimeout(() => nav(`/modules/${nextModule.id}`), 600);
  };

  /**
   * Repaso: el módulo ya estaba completado y el aprendiz vuelve sobre él. Suma
   * racha y XP reducido (una vez al día por módulo, con tope diario); NO toca el
   * completado ni la certificación — repasar nunca quita nada de lo ganado.
   */
  const handleReview = () => {
    // La racha primero: volver un día más cuenta aunque el repaso ya se hubiera
    // cobrado hoy (es constancia, no producción).
    updateStreak();
    const result = reviewModule(keyOfModule(module), {
      courseModules: siblings.map(keyOfModule),
      courseId: module.courseId ?? null,
    });
    if (result.status === 'granted') {
      const total = result.xp + result.courseBonus;
      toast.success(
        result.courseBonus > 0
          ? t('module.review_course_toast', { xp: total })
          : t('module.review_toast', { xp: result.xp }),
      );
    } else if (result.status === 'already-today') {
      toast.info(t('module.review_already_today'));
    } else if (result.status === 'capped') {
      toast.info(t('module.review_capped'));
    }
  };

  // Cierre del módulo: lo que falta por aprobar y los botones de completar /
  // repasar / siguiente. Es el mismo en las dos vistas (normal y cine), así que
  // se arma una vez y cada una lo coloca donde le corresponde.
  const moduleFooter = (
    <>
      {/* Desglose: actividades que faltan por aprobar para completar el módulo */}
      {!completed && moduleGate.active && !moduleGate.canComplete && moduleGate.pending.length > 0 && (
        <div className="mt-14 rounded-2xl border border-line p-5">
          <div className="mb-1.5 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <h3 className="text-[14px] font-medium text-text">{t('module.pending_title')}</h3>
            <span className="ml-auto text-[12px] tabular-nums text-text-subtle">
              {t('module.pending_progress', { done: moduleGate.done, total: moduleGate.total })}
            </span>
          </div>
          <p className="mb-4 text-[12.5px] text-text-muted">
            {t('module.pending_hint', { threshold: coursePassPct, score: moduleGate.score })}
          </p>
          <ul className="space-y-2">
            {moduleGate.pending.map((p) => (
              <li key={p.unit.key}>
                <a
                  href={`#section-${p.unit.sectionIndex}`}
                  className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-300 hover:bg-subtle/60"
                >
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    p.status === 'failed' ? 'bg-neon-magenta/10 text-neon-magenta' : 'bg-subtle text-text-subtle')}>
                    {p.status === 'failed' ? <X className="h-3.5 w-3.5" strokeWidth={3} /> : <Lock className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-text">{t(ACTIVITY_LABEL_KEY[p.unit.type])}</div>
                    {p.unit.detail && <div className="truncate text-[11px] text-text-subtle">{p.unit.detail}</div>}
                  </div>
                  <span className={cn('shrink-0 text-[11.5px] tabular-nums',
                    p.status === 'failed' ? 'text-neon-magenta' : 'text-text-subtle')}>
                    {p.status === 'failed' ? `${p.score}/${coursePassPct}` : t('module.pending_not_started')}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-subtle transition-transform duration-500 ease-apple group-hover:translate-x-1" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Práctica que cuelga de este módulo: promesa antes de terminarlo,
          puerta de entrada después. */}
      <ModulePracticeTeaser
        simulations={unlockedSims}
        unlocked={completed}
        onStart={goToSimulation}
        className="mt-10"
      />

      <div className="mt-10 flex flex-col items-center justify-end gap-3 border-t border-line pt-6 sm:flex-row">
        {/* Sin halo ni icono latiendo: es una accion secundaria, no la principal. */}
        <button
          type="button"
          className="mr-auto flex w-full items-center justify-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary sm:w-auto"
          onClick={() => setIsModalOpen(true)}
        >
          <Target className="h-3.5 w-3.5" />
          {t('module.view_feedback_progress')}
        </button>
        {!completed && (
          <Button variant="neon" size="md" onClick={handleComplete} disabled={!moduleGate.canComplete}>
            <Check className="h-4 w-4" strokeWidth={3} /> {t('module.mark_complete')}
          </Button>
        )}
        {completed && (
          <ReviewButton
            done={reviewedToday}
            xp={reviewXPPreview}
            multiplier={boostMultiplier}
            onClick={handleReview}
          />
        )}
        {nextModule && (
          <Button variant={completed ? 'neon' : 'glass'} size="md" onClick={() => nav(`/modules/${nextModule.id}`)}>
            {t('module.next')} <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </>
  );

  return (
    <>
      <div className={cn('mx-auto px-5 pt-12 pb-28 transition-all duration-500', readingMode ? 'max-w-2xl' : 'max-w-6xl')}>
        {/* ── Portada del módulo: meta + título + subtítulo + objetivos ── */}
        <header className="mb-12">
          <Reveal>
            <Link
              to={backTo}
              className="group mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-subtle transition-colors hover:text-text"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-500 ease-apple group-hover:-translate-x-1" />
              {backLabel}
            </Link>
          </Reveal>
          <Reveal>
            {/* Ficha del modulo en texto plano: posicion, duracion y estado. Antes
                eran dos NeonBadge de colores compitiendo con el titulo. */}
            <div className="mb-4 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-text-subtle">
              {moduleIndex >= 0 && (
                <span>
                  {/* El total son los hermanos visibles (mismo curso o plan general),
                      no todos los módulos publicados de la plataforma. */}
                  {t('module.of_modules', { idx: moduleIndex + 1, total: siblings.length })}
                </span>
              )}
              {moduleIndex >= 0 && <span className="text-text-subtle/50">·</span>}
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {t('module.duration', { min: module.duration })}
              </span>
              {completed && (
                <>
                  <span className="text-text-subtle/50">·</span>
                  <span className="inline-flex items-center gap-1 font-medium text-primary">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    {t('module.marked_complete')}
                  </span>
                </>
              )}
            </div>

            <h1 className="max-w-4xl text-balance text-[30px] font-semibold leading-[1.12] tracking-[-0.03em] text-text sm:text-[42px]">
              {module.title[language]}
            </h1>

            {module.subtitle?.[language] && (
              <RichText
                text={module.subtitle[language]}
                className="mt-4 max-w-2xl text-[15.5px] leading-relaxed text-text-muted"
              />
            )}
          </Reveal>

          {module.objectives?.[language]?.length > 0 && (
            <Reveal delay={80}>
              {/* Objetivos: lista numerada, no una rejilla de tarjetas de cristal.
                  Son una promesa de lectura, no elementos accionables. */}
              <ul className="mt-8 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
                {module.objectives[language].map((o, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-[3px] shrink-0 text-[11px] tabular-nums text-text-subtle">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-[13.5px] leading-relaxed text-text-muted">{o}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          )}

          {/* Conteo de secciones sobre un hairline recto (los degradados a los
              lados hacian que la linea pareciera un adorno). */}
          <div className="mt-12 border-t border-line pt-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-subtle">
              {module.sections.length} {module.sections.length === 1 ? t('module.section_one') : t('module.section_other')}
              {totalQuizzes > 0 && ` · ${totalQuizzes} ${totalQuizzes === 1 ? t('module.check_one') : t('module.check_other')}`}
            </span>
          </div>
        </header>

        {/* Módulo de puro video: se cambia de vista. Un escenario, la lista de
            videos al lado y encadenado al terminar (ver VideoCinema). El índice
            de secciones no aporta nada cuando cada sección ES un video. */}
        {cinemaMode ? (
          <VideoCinema
            module={module}
            language={language}
            userId={targetUserId ?? undefined}
            campaignId={module.campaign_id}
            moduleId={module.dbId || module.id}
            attemptByUnit={attemptByUnit}
          >
            {moduleFooter}
          </VideoCinema>
        ) : (
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
                      <div className="mb-3 text-[11px] tabular-nums tracking-[0.14em] text-text-subtle">
                        {String(i + 1).padStart(2, '0')} / {String(module.sections.length).padStart(2, '0')}
                      </div>
                      <h2 className="mb-5 text-[clamp(1.45rem,2vw+0.5rem,1.95rem)] font-semibold leading-tight tracking-[-0.03em]">
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
                      {/* Material que acompaña al video (PDFs, texto, imágenes…):
                          los mismos bloques que en una sección normal. */}
                      {s.blocks && s.blocks.length > 0 && (
                        <div className="mt-8">
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
                      )}
                    </div>
                  </Reveal>
                );
              }

              return (
                <Reveal as="section" key={i} delay={Math.min(i * 60, 200)}>
                  <div id={`section-${i}`} className="scroll-mt-28">
                    <SectionLayout style={(s.style ?? 'default') as any} hasMedia={!!s.media} feedbackNode={null}>
                      <div className="mb-3 text-[11px] tabular-nums tracking-[0.14em] text-text-subtle">
                        {String(i + 1).padStart(2, '0')} / {String(module.sections.length).padStart(2, '0')}
                      </div>
                      <h2 className="mb-5 text-[clamp(1.45rem,2vw+0.5rem,1.95rem)] font-semibold leading-tight tracking-[-0.03em]">
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
                            <p key={j} className="whitespace-pre-line"><RichTextInline text={p} /></p>
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

            {moduleFooter}
          </article>
        </div>
        )}
      </div>
        
      <FeedbackModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        attempts={latestAttemptsPerSection}
        computedMetrics={{ ...computedMetrics, timeSpent: activeTimeLabel } as any}
      />

      {/* Celebración del desbloqueo: solo cuando ESTE módulo abre una práctica. */}
      <SimulationUnlockedModal
        open={unlockOpen}
        moduleTitle={module.title[language]}
        simulations={unlockedSims}
        color={backCourse?.color || undefined}
        onStart={goToSimulation}
        onClose={() => setUnlockOpen(false)}
        onNext={
          nextModule
            ? () => { setUnlockOpen(false); nav(`/modules/${nextModule.id}`); }
            : undefined
        }
      />
      {/* "Volver arriba" ya no es un botón suelto: es una acción del rincón
          flotante (CornerDock), montado una sola vez en la raíz. */}
    </>
  );
}
