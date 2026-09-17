import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Award, CalendarClock, Check, ClipboardCheck, Flame, GraduationCap, Hammer, ListChecks, Loader2, Lock, LogOut, Map, PhoneCall, Play, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { FadeIn } from '@/components/ui/motion';
import { supabase } from '@/lib/supabase';
import type { CourseScenario } from '@/services/scenarios.service';
import { useUserStore } from '@/stores/userStore';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/stores/authStore';
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode';
import {
  useProgressStore,
  useModuleDone,
  keyOfCourseModule,
  reviewValue,
  XP_REWARDS,
} from '@/stores/progressStore';
import { useActiveXPEvent } from '@/stores/xpEventStore';
import { XPBoostCard } from '@/components/gamification/XPBoostBanner';
import type { Lang } from '@/stores/gamificationStore';
import { useLearnerCourses, invalidateLearnerCoursesCache } from '@/hooks/useLearnerCourses';
import { useViewingPresence } from '@/hooks/usePresence';
import { selfEnroll, unenrollSelf } from '@/services/courses.service';
import { getScenariosForCourse } from '@/services/scenarios.service';
import { deadlineInfo, deadlineMode, formatDueDate } from '@/lib/courseDeadline';
import { useDesktopOnlyLock } from '@/components/course/DesktopOnlyLock';
import { getChoiceScenariosForCourse } from '@/services/choiceScenarios.service';
import type { CourseChoiceScenario } from '@/services/choiceScenarios.service';
import { getCourseAttempts, getCourseCertStatus } from '@/services/certification.service';
import { getExamState } from '@/services/exams.service';
import type { ExamState } from '@/types/exam';
import type { CourseCertStatus } from '@/types/database';
import { CountryFlag } from '@/components/layout/CountryFlag';
import { CourseCover, courseHasCover, COVER_BOX } from '@/components/course/CourseCover';
import { LegacyCourseNoticeModal, legacyNoticeSeenKey } from '@/components/course/LegacyCourseNotice';
import { SimulatorPickerModal, type SimPick } from '@/components/simulator/SimulatorPickerModal';
import { PracticeStop } from '@/components/simulator/PracticeStop';
import { toast } from '@/stores/toastStore';
import { RichText, stripMarkdown } from '@/components/ui/RichText';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import { pickLang } from '@/lib/contentLang';
import { buildCourseJourney, type JourneyStageKey } from '@/lib/courseJourney';
import { onboardingGate } from '@/lib/onboarding';
import { useCourseJourneys } from '@/hooks/useCourseJourneys';
import { OnboardingCourseLock } from '@/components/course/OnboardingGate';

/** Curva corporativa, la misma del catálogo y del kit de motion. */
const ease = [0.16, 1, 0.3, 1] as const;

/* Encabezado de sección — mismo patrón que /courses: título de 19px, conteo o
   dato al lado en gris y una línea de apoyo. Sin iconos de colores. */
function SectionHead({
  title,
  subtitle,
  aside,
  id,
}: {
  title: string;
  subtitle: string;
  aside?: React.ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className="mb-6 flex items-end justify-between gap-4 scroll-mt-24">
      <div>
        <h2 className="text-[19px] font-semibold tracking-tight text-text">{title}</h2>
        <p className="mt-0.5 text-[13px] text-text-muted">{subtitle}</p>
      </div>
      {aside}
    </div>
  );
}

/* Una etapa del recorrido: nombre, cuánto va y en qué estado está. Es la
   respuesta visual a "¿por qué no estoy en 100%?" — verde lo cumplido, gris lo
   que falta, candado lo que todavía no se abre. */
function JourneyChip({
  stage,
  label,
  color,
}: {
  stage: { key: JourneyStageKey; total: number; done: number; unlocked: boolean };
  label: string;
  color: string;
}) {
  const done = stage.done >= stage.total;
  const locked = !done && !stage.unlocked;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[12px] tabular-nums',
        done ? 'text-text' : locked ? 'text-text-subtle' : 'text-text-muted',
      )}
    >
      {done ? (
        <Check className="h-3 w-3 shrink-0" strokeWidth={3} style={{ color }} />
      ) : locked ? (
        <Lock className="h-3 w-3 shrink-0" />
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
      )}
      <span>{label}</span>
      {/* Una etapa de un solo paso (mundo, examen) no necesita "0/1": el icono
          ya dice si está o no. El contador es para lo que se cuenta. */}
      {stage.total > 1 && (
        <span className="text-text-subtle">
          {stage.done}/{stage.total}
        </span>
      )}
    </span>
  );
}

type ModuleStatus = 'completed' | 'available' | 'locked';

function pickText(es: string | null, en: string | null, pt: string | null, lang: string): string {
  return pickLang(es, en, pt, lang);
}

export default function CoursePage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Si llegaste desde la vista de cursos, volver ahí; si no, a la página principal.
  const fromCourses = (location.state as { from?: string } | null)?.from === 'courses';
  const backTo = fromCourses ? '/courses' : '/dashboard';
  const backLabel = fromCourses ? t('courses.back_to_courses') : t('courses.back_to_home');
  const language = useUserStore((s) => s.language);
  // El mundo es solo para staff (preview del CMS); el aprendiz ya no lo ve.
  const { isAdminOrCapacitador, user } = useAuth();
  // Rol REAL: dentro de la vista previa `useAuth` reporta 'learner' a propósito.
  // Sin esto, el staff que revisa el curso en la vista previa no está asignado
  // NI cuenta como staff, así que el mundo (y todo lo que cuelga de "es mi
  // curso") desaparecía aunque estuviera publicado. Mismo guarda que
  // `useLearnerCourses`.
  const realRole = useAuthStore((s) => s.profile?.role ?? null);
  const previewStaff =
    IS_LEARNER_PREVIEW && (realRole === 'superadmin' || realRole === 'capacitador');
  const isModuleDone = useModuleDone();
  const reduce = useReducedMotion();

  // Repaso: qué paga hoy cada módulo terminado y cuáles ya se cobraron.
  const reviewedAt = useProgressStore((s) => s.reviewedAt);
  const courseReviewCount = useProgressStore((s) => s.courseReviewCount);
  const boostMultiplier = useActiveXPEvent()?.multiplier ?? 1;
  const reviewedTodayIn = (m: { id: string; slug: string }) => {
    const today = new Date().toISOString().split('T')[0];
    return [m.id, m.slug].some((k) => !!k && reviewedAt[k] === today);
  };
  const { courses, loading, reload } = useLearnerCourses();
  const [enrollBusy, setEnrollBusy] = useState(false);

  const course = useMemo(() => courses.find((c) => c.slug === slug), [courses, slug]);

  // Onboarding sin terminar: un curso que no es de inducción no se abre ni
  // entrando por el enlace directo. El staff (fuera de la vista previa) no pasa
  // por la compuerta: revisa cursos, no los cursa.
  const { journeys: allJourneys, loaded: journeysLoaded, failed: journeysFailed } = useCourseJourneys(courses);
  const gate = useMemo(
    () => onboardingGate(courses, allJourneys, isModuleDone, { loaded: journeysLoaded, failed: journeysFailed }),
    [courses, allJourneys, isModuleDone, journeysLoaded, journeysFailed],
  );

  // Presencia: publico en qué curso estoy (modo 'view', ver ModulePage).
  useViewingPresence(
    course
      ? {
          type: 'course',
          id: course.id,
          title: pickText(course.title_es, course.title_en, course.title_pt, language),
          mode: 'view',
        }
      : null,
  );

  // Simulador y certificación del curso (capa de evaluación).
  const [scenarios, setScenarios] = useState<CourseScenario[]>([]);
  const [choiceScenarios, setChoiceScenarios] = useState<CourseChoiceScenario[]>([]);
  /** La lectura de simulaciones falló (≠ el curso no tiene ninguna). */
  const [simLoadFailed, setSimLoadFailed] = useState(false);
  const [rawCertStatus, setRawCertStatus] = useState<CourseCertStatus | null>(null);
  const [examState, setExamState] = useState<ExamState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (!course?.id) {
      setScenarios([]);
      setChoiceScenarios([]);
      setRawCertStatus(null);
      setExamState(null);
      return;
    }
    let active = true;
    // Un fallo al leer NO es lo mismo que "este curso no tiene simulaciones".
    // Sin distinguirlos, cualquier tropiezo de red o de RLS le decía al aprendiz
    // que le pidiera a su capacitador algo que el capacitador ya había hecho.
    setSimLoadFailed(false);
    getScenariosForCourse(course.id)
      .then((s) => { if (active) setScenarios(s); })
      .catch(() => { if (active) { setScenarios([]); setSimLoadFailed(true); } });
    getChoiceScenariosForCourse(course.id)
      .then((s) => { if (active) setChoiceScenarios(s); })
      .catch(() => { if (active) { setChoiceScenarios([]); setSimLoadFailed(true); } });
    getCourseCertStatus(course.id)
      .then((st) => { if (active) setRawCertStatus(st); })
      .catch(() => { if (active) setRawCertStatus(null); });
    // Examen final: solo existe si el capacitador lo creó y publicó.
    getExamState(course.id)
      .then((st) => { if (active) setExamState(st); })
      .catch(() => { if (active) setExamState(null); });
    return () => { active = false; };
  }, [course?.id, isModuleDone]);

  // Migración slug → UUID: esta pantalla conoce ambas claves de cada módulo, así
  // que aprovecha para completar la que falte en el progreso local (ver
  // docs/plan-migracion-progreso-uuid.md).
  const reconcileModuleKeys = useProgressStore((s) => s.reconcileModuleKeys);
  useEffect(() => {
    if (!course) return;
    reconcileModuleKeys(course.modules.map(keyOfCourseModule));
  }, [course, reconcileModuleKeys]);

  // El progreso local (localStorage) va por delante del RPC: el espejo a BD
  // (useProgressSync) tiene rebote de ~1.2 s, así que al terminar un módulo el
  // RPC todavía lee "0/1". Mostramos el contador optimista para que "X/Y
  // módulos" se sienta instantáneo.
  //
  // Pero el CANDADO del certificado sale SOLO del servidor. Antes esto hacía
  // `all_met: rawCertStatus.all_met || allMet` con un Math.max del progreso
  // local, y como localStorage lo edita el usuario, se podía desbloquear el
  // botón del certificado a mano. Ahora lo local solo puede mostrar, nunca
  // abrir: el RPC re-consulta al cambiar el progreso local, así que el botón
  // aparece igual en cuanto el espejo se escribe.
  const certStatus = useMemo<CourseCertStatus | null>(() => {
    if (!rawCertStatus) return null;
    const localTotal = course?.modules.length ?? 0;
    const localDone = course
      ? course.modules.filter((m) => isModuleDone(keyOfCourseModule(m))).length
      : 0;
    return {
      ...rawCertStatus,
      modules_total: rawCertStatus.modules_total || localTotal,
      modules_done: Math.max(rawCertStatus.modules_done, localDone),
      // modules_ok / all_met quedan tal cual los devolvió el servidor.
    };
  }, [rawCertStatus, course, isModuleDone]);

  // Mundo (juego) publicado de este curso, si existe, para el botón "Jugar el
  // mundo" y para el paso "Mundo" del recorrido. Además de saber que EXISTE hay
  // que saber si ya se terminó: sin eso el porcentaje del curso no puede
  // contarlo y el aprendiz vería 100% con el mundo sin tocar.
  const [world, setWorld] = useState<{
    id: string;
    name: string;
    name_en: string | null;
    name_pt: string | null;
    icon: string;
  } | null>(null);
  const worldId = world?.id ?? null;
  const [worldLevels, setWorldLevels] = useState(0);
  const [worldLevelsDone, setWorldLevelsDone] = useState(0);
  useEffect(() => {
    if (!course?.id) { setWorld(null); setWorldLevels(0); setWorldLevelsDone(0); return; }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('worlds')
        .select('id, status, campaign_id, name, name_en, name_pt, icon')
        .eq('course_id', course.id)
        .maybeSingle();
      const row = data?.status === 'published' ? data : null;
      if (!active) return;
      setWorld(
        row
          ? {
              id: row.id as string,
              name: (row.name as string) ?? '',
              name_en: (row.name_en as string | null) ?? null,
              name_pt: (row.name_pt as string | null) ?? null,
              icon: (row.icon as string) || '🗺️',
            }
          : null,
      );
      const id = row?.id as string | undefined;
      if (!id) { setWorldLevels(0); setWorldLevelsDone(0); return; }
      // Niveles del mundo y cuáles ya completó ESTA persona. Un fallo de lectura
      // deja el mundo en 0 niveles, y entonces no aporta pasos: preferimos no
      // contarlo a inventar un pendiente que el aprendiz no puede resolver.
      const [levelsRes, progressRes] = await Promise.all([
        supabase.from('world_levels').select('id', { count: 'exact', head: true }).eq('world_id', id),
        user?.id
          ? supabase
              .from('world_progress')
              .select('level_id')
              .eq('world_id', id)
              .eq('user_id', user.id)
              .eq('completed', true)
          : Promise.resolve({ data: [] as Array<{ level_id: string }> }),
      ]);
      if (!active) return;
      setWorldLevels(levelsRes.count ?? 0);
      const doneIds = new Set(
        ((progressRes.data ?? []) as Array<{ level_id: string }>).map((r) => r.level_id),
      );
      setWorldLevelsDone(doneIds.size);
    })();
    return () => { active = false; };
  }, [course?.id, user?.id, isModuleDone]);

  /* ── Aviso de curso migrado de Sinergy ──────────────────────────────────
     Se abre SOLO la primera vez que esta persona entra al curso: un modal en
     cada visita es un peaje para quien de verdad está haciendo el curso. Pero
     tampoco puede desaparecer para siempre por un clic distraído, así que
     después queda un botón junto al título para volver a abrirlo.

     El "ya lo vio" es por navegador (localStorage). Es información, no un
     permiso: verlo dos veces desde otro equipo no le hace daño a nadie, y
     guardarlo en la base sería una escritura por cada apertura de curso. */
  const legacyOn = !!course?.cert_conditions?.legacy_notice;
  const [legacyOpen, setLegacyOpen] = useState(false);
  useEffect(() => {
    if (!legacyOn || !course?.id) return;
    try {
      if (localStorage.getItem(legacyNoticeSeenKey(course.id))) return;
    } catch {
      // Almacenamiento bloqueado (incógnito estricto): se muestra igual. Que
      // el aviso salga de más es mucho mejor que no salga.
    }
    setLegacyOpen(true);
  }, [legacyOn, course?.id]);

  const closeLegacy = useCallback(() => {
    setLegacyOpen(false);
    if (!course?.id) return;
    try {
      localStorage.setItem(legacyNoticeSeenKey(course.id), '1');
    } catch { /* modo privado: volverá a salir, y no pasa nada */ }
  }, [course?.id]);

  // Simulaciones YA APROBADAS por esta persona en este curso, por escenario.
  // `certStatus.best_score` es un único mejor puntaje del curso entero: sirve
  // para el requisito del certificado, pero no dice CUÁNTAS de las prácticas
  // asignadas están hechas, que es lo que el recorrido necesita contar.
  const [simBestBySlug, setSimBestBySlug] = useState<Record<string, number>>({});
  /** La lectura por escenario no se pudo hacer (RLS, red): NO es "no practicó". */
  const [simBestFailed, setSimBestFailed] = useState(false);
  useEffect(() => {
    if (!course?.id || !user?.id) { setSimBestBySlug({}); setSimBestFailed(false); return; }
    let active = true;
    getCourseAttempts(course.id, user.id)
      .then((rows) => {
        if (!active) return;
        const best: Record<string, number> = {};
        for (const r of rows) {
          const slug = r.scenario_slug;
          if (!slug) continue;
          best[slug] = Math.max(best[slug] ?? 0, r.score ?? 0);
        }
        setSimBestBySlug(best);
        setSimBestFailed(false);
      })
      .catch(() => { if (active) { setSimBestBySlug({}); setSimBestFailed(true); } });
    return () => { active = false; };
  }, [course?.id, user?.id]);

  const handleEnroll = async () => {
    if (!course) return;
    setEnrollBusy(true);
    try {
      await selfEnroll(course.id);
      invalidateLearnerCoursesCache();
      toast.success(t('courses.enrolled_ok'));
      reload();
    } catch {
      toast.error(t('courses.enroll_error'));
    } finally {
      setEnrollBusy(false);
    }
  };

  // Salir de un curso al que uno mismo se inscribió (catálogo). Es del aprendiz:
  // el staff ya no se matricula en ningún sitio, así que no hay caso especial.
  const handleLeave = async () => {
    if (!course) return;
    setEnrollBusy(true);
    try {
      await unenrollSelf(course.id);
      invalidateLearnerCoursesCache();
      toast.success(t('courses.left_ok'));
      reload();
    } catch {
      toast.error(t('courses.enroll_error'));
    } finally {
      setEnrollBusy(false);
    }
  };

  // Límite de tiempo del curso. Va aquí arriba —antes del `return` de carga—
  // porque los módulos se cierran con él: si el plazo venció y el curso está
  // configurado para bloquear, no queda nada por empezar.
  // Curso «solo desde el computador»: la puerta se resuelve arriba (es un hook)
  // y se cierra abajo, antes de pintar nada del curso.
  const deviceLock = useDesktopOnlyLock(course);

  const deadline = useMemo(() => {
    if (!course) return deadlineInfo(null);
    const allDone =
      course.modules.length > 0 &&
      course.modules.every((m) => isModuleDone(keyOfCourseModule(m)));
    return deadlineInfo(course, { assignedAt: course.assignedAt, completed: allDone });
  }, [course, isModuleDone]);

  const items = useMemo(() => {
    if (!course) return [];
    return course.modules.map((m, idx) => {
      let status: ModuleStatus;
      if (isModuleDone(keyOfCourseModule(m))) status = 'completed';
      // Plazo vencido con bloqueo: lo ya hecho se conserva (y se puede repasar),
      // pero no se abre nada nuevo hasta que el capacitador amplíe el plazo.
      else if (deadline.blocked) status = 'locked';
      else if (idx === 0 || isModuleDone(keyOfCourseModule(course.modules[idx - 1])))
        status = 'available';
      else status = 'locked';
      return { module: m, status };
    });
  }, [course, isModuleDone, deadline.blocked]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 pt-12 pb-24 sm:px-8 sm:pt-16">
        <div className="space-y-8">
          <div className="h-40 rounded-3xl bg-subtle skeleton-shine" />
          <div className="space-y-3">
            <div className="h-8 w-72 max-w-full rounded-xl bg-subtle skeleton-shine" />
            <div className="h-4 w-96 max-w-full rounded-lg bg-subtle skeleton-shine" />
          </div>
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-2xl bg-subtle skeleton-shine"
                style={{ animationDelay: `${i * 90}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (deviceLock) return deviceLock;

  if (course && gate.active && !gate.ids.has(course.id) && !isAdminOrCapacitador) {
    if (!gate.settled) return <div className="mx-auto h-64 max-w-4xl px-5 pt-24"><div className="h-full rounded-3xl bg-subtle skeleton-shine" /></div>;
    return <OnboardingCourseLock gate={gate} />;
  }

  if (!course) {
    return (
      <div className="mx-auto max-w-4xl px-5 pt-24 pb-24 text-center">
        <GraduationCap className="mx-auto mb-4 h-8 w-8 text-text-subtle" />
        <h1 className="mb-1 text-[17px] font-medium text-text">{t('courses.not_found_title')}</h1>
        <p className="mb-6 text-[13.5px] text-text-muted">{t('courses.not_found_subtitle')}</p>
        <Link
          to="/courses"
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[13px] text-text-muted transition-colors duration-300 hover:border-text-subtle hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('courses.back_to_courses')}
        </Link>
      </div>
    );
  }

  const total = course.modules.length;
  const done = course.modules.filter((m) => isModuleDone(keyOfCourseModule(m))).length;
  const pct = total > 0 ? done / total : 0;
  const totalMin = course.modules.reduce((acc, m) => acc + m.duration_min, 0);
  const nextItem = items.find((i) => i.status === 'available');
  const completed = total > 0 && done === total;

  /* ── Estado del certificado, en UN solo lugar ──────────────────────────────
     Lo leen la fila de acciones (botón "Ver certificado" / "Próximamente") y la
     sección Acreditar de más abajo. Antes cada una lo calculaba a su manera —
     arriba bastaba `examState.passed`, abajo se exigía además el puntaje — y el
     botón podía prometer un certificado que la sección seguía negando. */
  const requireExam = !!course.cert_conditions?.require_exam;
  const examMin = course.cert_conditions?.exam_min_score ?? 80;
  const examOk = !!examState && examState.passed && examState.best_score >= examMin;
  /* El capacitador marcó el curso como "en construcción": todavía falta contenido
     por publicar. Retiene el certificado aunque el aprendiz cumpla TODO lo que hay
     hoy — así no quedan diplomas de una versión a medias. Lo ya EMITIDO no se toca:
     un certificado entregado no se revoca por publicar más módulos (para eso está
     la recertificación). Ver [[cert_coming_soon]] y Curso → Certificación. */
  const comingSoon = !!course.cert_conditions?.coming_soon && !certStatus?.certified;
  const comingSoonNote = (course.cert_conditions?.coming_soon_note ?? '').trim();
  /* El servidor no conoce todavía el examen en `all_met`: se exige aquí y, de
     forma inviolable, en el trigger de `certifications` (ver el SQL). */
  const certReady =
    !!certStatus &&
    (certStatus.all_met || certStatus.certified) &&
    (!requireExam || examOk) &&
    !comingSoon;
  /* Qué le falta, en palabras, para el tooltip del botón "Próximamente". */
  const certMissing: string[] = [];
  if (certStatus && !certReady && !comingSoon) {
    if (certStatus.require_all_modules && !certStatus.modules_ok) {
      certMissing.push(
        t('course_cert.missing_modules', {
          done: certStatus.modules_done,
          total: certStatus.modules_total,
        }),
      );
    }
    if (certStatus.require_simulator && !certStatus.simulator_ok) {
      certMissing.push(t('course_cert.missing_simulator', { score: certStatus.min_score }));
    }
    if (requireExam && !examOk) certMissing.push(t('course_cert.missing_exam', { score: examMin }));
  }

  // Qué dice el aviso del plazo. Sin plazo fechado, un curso de catálogo con
  // límite por días anuncia cuánto tendrá desde que se inscriba.
  const daysFromEnroll =
    deadline.state === 'none' && !completed && deadlineMode(course) === 'days'
      ? (course.deadline_days ?? 0)
      : 0;
  const deadlineBanner =
    deadline.dueMs === null
      ? daysFromEnroll > 0
        ? t('courses.deadline_from_enroll', { count: daysFromEnroll })
        : null
      : deadline.state === 'overdue'
        ? t('courses.deadline_overdue', { count: Math.abs(deadline.daysLeft) })
        : deadline.daysLeft === 0
          ? t('courses.deadline_today')
          : t('courses.deadline_left', { count: deadline.daysLeft });

  // Regla VIEJA del curso. Ya no decide nada por sí sola: solo se usa como
  // respaldo para las simulaciones que todavía no tienen su propio punto,
  // porque la migración 2026-08-12_sim_after_module.sql no se ha corrido.
  // El `??` no es cosmético: en los cursos viejos la columna viene NULL.
  const simRule = course.sim_unlock_rule ?? 'after_modules';

  // ── Dónde aparece cada simulación en el recorrido ──────────────────────
  // Cada una responde una sola pregunta (`unlockMode`): al inicio, después de
  // un módulo, o al final del curso. Las dos primeras se pintan como una parada
  // dentro de la lista de módulos; la tercera se queda en la sección
  // "Practicar" del final, que es donde ha estado siempre.
  //
  // `unlockMode === null` = la migración todavía no se corrió: se cae a la
  // regla vieja del curso para que nada cambie de sitio mientras tanto.
  type Placement = { at: 'start' } | { at: 'module'; moduleId: string } | { at: 'end' };
  const courseModuleIds = new Set(course.modules.map((m) => m.id));
  const placementOf = (s: {
    unlockMode: 'from_start' | 'after_module' | 'after_all' | null;
    unlockModuleId: string | null;
  }): Placement => {
    const mode = s.unlockMode ?? (simRule === 'after_module' ? 'after_module' : simRule === 'from_start' ? 'from_start' : 'after_all');
    const moduleId = s.unlockMode ? s.unlockModuleId : course.sim_unlock_module_id;
    if (mode === 'from_start') return { at: 'start' };
    // Un módulo que ya no está en el curso (lo movieron, lo borraron) no puede
    // sostener una parada: la simulación cae al final, que es donde se la puede
    // encontrar, en vez de desaparecer del curso.
    if (mode === 'after_module' && moduleId && courseModuleIds.has(moduleId)) {
      return { at: 'module', moduleId };
    }
    return { at: 'end' };
  };
  const moduleDone = (moduleId: string) => {
    const m = course.modules.find((x) => x.id === moduleId);
    return !!m && isModuleDone(keyOfCourseModule(m));
  };
  const placementUnlocked = (p: Placement) =>
    p.at === 'start' ? true : p.at === 'module' ? moduleDone(p.moduleId) : completed;

  interface PracticeStopItem {
    key: string;
    pick: SimPick;
    kind: 'call' | 'choice';
    title: string;
    summary: string;
    passScore: number;
    difficulty?: 1 | 2 | 3;
    level?: 'basico' | 'medio' | 'avanzado';
  }
  // Objeto y no Map: `Map` aquí es el icono de lucide (el del botón "Jugar el
  // mundo"), que tapa al Map del lenguaje.
  const stopsByModule: Record<string, PracticeStopItem[]> = {};
  const startStops: PracticeStopItem[] = [];
  const tailScenarios = scenarios.filter((s) => placementOf(s).at === 'end');
  const tailChoiceScenarios = choiceScenarios.filter((s) => placementOf(s).at === 'end');

  const place = (p: Placement, stop: PracticeStopItem) => {
    if (p.at === 'start') startStops.push(stop);
    else if (p.at === 'module') (stopsByModule[p.moduleId] ??= []).push(stop);
  };
  for (const scn of scenarios) {
    place(placementOf(scn), {
      key: `call-${scn.rowId}`,
      pick: { kind: 'call', id: scn.id },
      kind: 'call',
      title: scn.title[language],
      summary: scn.summary[language],
      passScore: scn.passScore,
      difficulty: scn.difficulty,
    });
  }
  for (const scn of choiceScenarios) {
    place(placementOf(scn), {
      key: `choice-${scn.rowId}`,
      pick: { kind: 'choice', id: scn.id },
      kind: 'choice',
      title: scn.title[language],
      summary: stripMarkdown(scn.description[language]),
      passScore: scn.passScore,
      level: scn.level,
    });
  }

  // Acceso directo a la simulación: si hay una sola y está desbloqueada, entra de una;
  // si hay varias o está bloqueada, el modal deja elegir / explica el motivo. Antes
  // esto hacía scrollIntoView a la sección Practicar, invisible cuando la sección ya
  // estaba en pantalla: el botón parecía no hacer nada.
  const totalScenarios = scenarios.length + choiceScenarios.length;
  const tailTotal = tailScenarios.length + tailChoiceScenarios.length;
  // Lo que se puede jugar AHORA. El botón y el selector se arman con esto, para
  // que ninguno de los dos ofrezca algo que después dice "bloqueado".
  const isPlayable = (s: {
    unlockMode: 'from_start' | 'after_module' | 'after_all' | null;
    unlockModuleId: string | null;
  }) => placementUnlocked(placementOf(s));
  const playableScenarios = scenarios.filter(isPlayable);
  const playableChoiceScenarios = choiceScenarios.filter(isPlayable);
  const playableTotal = playableScenarios.length + playableChoiceScenarios.length;

  const simState = {
    courseId: course.id,
    campaignId: course.campaign_id,
    returnTo: `/courses/${course.slug}`,
  };
  const goToSim = ({ kind, id }: SimPick) => {
    navigate(kind === 'call' ? `/simulator/run/${id}` : `/simulator/choice/${id}`, { state: simState });
  };
  const startSimulation = () => {
    if (playableTotal === 1) {
      goToSim(
        playableChoiceScenarios.length === 1
          ? { kind: 'choice', id: playableChoiceScenarios[0].id }
          : { kind: 'call', id: playableScenarios[0].id },
      );
    } else {
      setPickerOpen(true);
    }
  };
  /* "Este curso es mío": asignado de verdad, o la vista previa del staff, que
     existe justo para revisar el curso tal como lo verá el aprendiz. Sin lo
     segundo, la vista previa escondía el mundo (nadie asignado, y `useAuth`
     reporta 'learner' a propósito). */
  const asLearnerOfCourse = course.isAssigned || previewStaff;

  // Desbloqueo del mundo (juego), mismo esquema configurable que el simulador.
  const worldRule = course.world_unlock_rule ?? 'after_modules';
  const worldUnlockModule = course.world_unlock_module_id
    ? course.modules.find((m) => m.id === course.world_unlock_module_id)
    : null;
  const worldUnlocked =
    worldRule === 'from_start' ||
    (worldRule === 'after_modules' && completed) ||
    (worldRule === 'after_module' && !!worldUnlockModule && isModuleDone(keyOfCourseModule(worldUnlockModule))) ||
    (worldRule === 'after_module' && !worldUnlockModule && completed);
  const worldLockedReason =
    worldRule === 'after_module' && worldUnlockModule
      ? t('course_practice.locked_after_module', {
          title: pickText(
            pickText(worldUnlockModule.title_es, worldUnlockModule.title_en, worldUnlockModule.title_pt, language),
            worldUnlockModule.title_en,
            worldUnlockModule.title_pt,
            language,
          ),
        })
      : t('courses.world_locked');

  // Motivo del candado cuando NO hay nada jugable. Si todo lo que falta cuelga
  // de módulos, se nombra el primer módulo pendiente que abre una práctica —
  // que es lo que el aprendiz tiene que hacer ahora. Si no, es el final del
  // curso.
  const firstLockedAnchor = tailTotal === 0
    ? course.modules.find((m) => stopsByModule[m.id]?.length && !isModuleDone(keyOfCourseModule(m)))
    : undefined;

  const simLockedReason = firstLockedAnchor
    ? t('course_practice.locked_after_module', {
        title: pickText(
          pickText(firstLockedAnchor.title_es, firstLockedAnchor.title_en, firstLockedAnchor.title_pt, language),
          firstLockedAnchor.title_en,
          firstLockedAnchor.title_pt,
          language,
        ),
      })
    : t('course_practice.locked_after_modules');

  /* ── El recorrido del curso ────────────────────────────────────────────────
     El % del curso ya no es "módulos hechos": son PASOS hechos. Si el curso
     trae simulaciones, mundo o examen final, cada uno cuenta, y terminar solo
     el temario ya no dice 100%. Ver src/lib/courseJourney.ts. */
  const simDone = (sc: { id: string; passScore: number }) =>
    (simBestBySlug[sc.id] ?? 0) >= sc.passScore;
  /* Si la lectura por escenario no se pudo hacer, el requisito del certificado
     manda: es lo que el servidor ya sabe del simulador. Sin este respaldo, un
     tropiezo de RLS dejaría el curso atascado por debajo del 100% para siempre,
     que es peor que contar de más. */
  const practiceDone = simBestFailed
    ? (certStatus?.simulator_ok ? totalScenarios : 0)
    : scenarios.filter(simDone).length + choiceScenarios.filter(simDone).length;
  /* El mundo cuenta como UN paso, no como un paso por nivel: si no, un mundo de
     veinte niveles se comería el porcentaje del curso entero. Solo lo aporta si
     el aprendiz lo tiene (el staff lo ve en modo vista previa, y esa preview no
     es parte de su recorrido). */
  const worldInJourney = !!worldId && asLearnerOfCourse && worldLevels > 0;
  const worldDone = worldInJourney && worldLevelsDone >= worldLevels;
  const journey = buildCourseJourney({
    modules: { total, done },
    practice: { total: totalScenarios, done: practiceDone, unlocked: playableTotal > 0 },
    world: { total: worldInJourney ? 1 : 0, done: worldDone ? 1 : 0, unlocked: worldUnlocked },
    exam: {
      total: examState ? 1 : 0,
      done: examOk ? 1 : 0,
      unlocked: !!examState?.unlocked,
    },
  });
  /* Lo que sigue, en una frase. Solo aparece cuando el temario ya está hecho y
     el curso todavía no: es justo el momento en que antes el aprendiz se
     quedaba sin instrucciones frente a un 100% que no certificaba. */
  const journeyNextStage = journey.present.find((st) => st.key === journey.next);
  const journeyNextHint =
    journey.next && journey.next !== 'modules'
      ? journey.next === 'exam' && !journeyNextStage?.unlocked
        ? t('courses.journey_next_exam_locked')
        : t(`courses.journey_next_${journey.next}`)
      : null;

  return (
    <>
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-10 sm:px-8 sm:pt-14">
      <FadeIn>
        <Link
          to={backTo}
          className="group mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-subtle transition-colors hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-500 ease-apple group-hover:-translate-x-1" />
          {backLabel}
        </Link>
      </FadeIn>

      {/* Portada. Sin tarjeta alrededor: la imagen es la imagen, y debajo va la
          identidad del curso en texto. */}
      <FadeIn delay={0.05}>
        <div
          className={`relative overflow-hidden rounded-3xl border border-line ${COVER_BOX}`}
          style={{
            background: courseHasCover(course)
              ? course.cover_fit === 'contain'
                ? `linear-gradient(120deg, ${course.color}1F, ${course.color}08)`
                : undefined
              : `linear-gradient(120deg, ${course.color}33, ${course.color}0A)`,
          }}
        >
          <CourseCover
            course={course}
            alt={pickText(course.title_es, course.title_en, course.title_pt, language)}
            className={`h-full w-full ${course.cover_fit === 'contain' ? 'object-contain' : 'object-cover'}`}
          />
        </div>
      </FadeIn>

      <FadeIn delay={0.1} className="relative z-10 -mt-7 mb-12 px-1 sm:px-2">
        {/* Emblema y avance: sustituyen al panel del anillo que antes iba en su
            propia caja al lado del titulo. */}
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-sm ring-4 ring-bg"
            style={{ background: course.color }}
          >
            <GraduationCap className="h-6 w-6" />
          </div>
        </div>

        {/* Clasificacion en texto plano: obligatorio / nivel / categoria / campana.
            Antes eran tres capsulas de colores apiladas sobre el titulo. */}
        <div className="mb-2 flex flex-wrap items-center gap-x-1.5 text-[12px] text-text-subtle">
          {course.isMandatory && (
            <span className="inline-flex items-center gap-1.5 font-medium text-danger">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
              {t('courses.mandatory')}
            </span>
          )}
          {[t(`courses.level_${course.level}`), course.category]
            .filter(Boolean)
            .map((chunk, i) => (
              <span key={String(chunk)} className="inline-flex items-center gap-1.5">
                {(i > 0 || course.isMandatory) && <span className="text-text-subtle/50">.</span>}
                {chunk}
              </span>
            ))}
        </div>

        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] text-text sm:text-[36px]">
          {pickText(course.title_es, course.title_en, course.title_pt, language)}
        </h1>
        <RichText
          text={pickText(course.description_es, course.description_en, course.description_pt, language)}
          className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-text-muted"
        />

        <div className="mt-3 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-text-subtle">
          <span>{t('courses.modules_count', { count: total })}</span>
          {totalMin > 0 && (
            <>
              <span className="text-text-subtle/50">.</span>
              <span>{totalMin} min</span>
            </>
          )}
        </div>

        {/* El aviso ya salió como modal al entrar. Esto es la puerta de vuelta:
            sin ella, cerrarlo sin leer lo perdería para siempre. */}
        {legacyOn && (
          <button
            type="button"
            onClick={() => setLegacyOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/[0.06] px-3.5 py-1.5 text-[12.5px] font-medium text-primary transition-colors duration-300 hover:border-primary/50"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('courses.legacy_notice_title')}
          </button>
        )}

        {/* ── Límite de tiempo ────────────────────────────────────────────
            Un solo aviso, del color de lo que pasa: gris mientras sobra
            tiempo, rojo cuando aprieta o ya venció. Si el curso bloquea al
            vencer, también dice qué hacer (pedir ampliación), porque el
            aprendiz no puede resolverlo solo. */}
        {/* Curso en construccion: se anuncia ANTES que el plazo porque cambia lo
            que el aprendiz puede esperar del curso entero, no solo la fecha. */}
        {comingSoon && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/8 px-4 py-3">
            <Hammer className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium text-text">
                {t('course_cert.coming_soon_title')}
              </p>
              <p className="mt-0.5 text-[12.5px] text-text-muted [overflow-wrap:anywhere]">
                {comingSoonNote || t('course_cert.coming_soon_hint')}
              </p>
            </div>
          </div>
        )}

        {deadlineBanner && (
          <div
            className={cn(
              'mt-5 flex items-start gap-3 rounded-2xl border px-4 py-3',
              deadline.state === 'overdue' || deadline.state === 'soon'
                ? 'border-danger/40 bg-danger/8'
                : 'border-line bg-subtle/50',
            )}
          >
            <span
              className={cn(
                'mt-0.5 shrink-0',
                deadline.state === 'overdue' || deadline.state === 'soon'
                  ? 'text-danger'
                  : 'text-text-subtle',
              )}
            >
              {deadline.blocked ? <Lock className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  'text-[13.5px] font-medium',
                  deadline.state === 'overdue' || deadline.state === 'soon'
                    ? 'text-danger'
                    : 'text-text',
                )}
              >
                {deadlineBanner}
              </p>
              {deadline.dueMs !== null && (
                <p className="mt-0.5 text-[12.5px] text-text-muted">
                  {t('courses.deadline_due_on', { date: formatDueDate(deadline.dueMs, language) })}
                  {deadline.blocked && ` · ${t('courses.deadline_blocked_hint')}`}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Avance: el numero se lee solo, alineado con el hilo de 3px. Antes iba
            apretado dentro de un anillo de 34px, que a 100% no respiraba.

            Y ahora mide el CURSO, no el temario: si hay simuladores, mundo o
            examen final, cuentan. Debajo va el desglose por etapa, para que el
            porcentaje no sea una cifra que hay que creer sino una que se puede
            comprobar de un vistazo. */}
        {journey.total > 0 && (
          <div className="mt-5 w-full max-w-md">
            <div className="mb-2 flex items-baseline gap-2">
              <span
                className="text-[15px] font-semibold tabular-nums leading-none tracking-[-0.02em]"
                style={{ color: course.color }}
              >
                {Math.round(journey.pct * 100)}%
              </span>
              <span className="text-[12.5px] tabular-nums text-text-subtle">
                {journey.present.length > 1
                  ? t('courses.journey_steps', { done: journey.done, count: journey.total })
                  : t('courses.progress', { done, count: total })}
              </span>
            </div>
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-subtle">
              <motion.div
                className="h-full rounded-full"
                style={{ background: course.color }}
                initial={{ width: reduce ? `${Math.round(journey.pct * 100)}%` : 0 }}
                animate={{ width: `${Math.round(journey.pct * 100)}%` }}
                transition={{ duration: reduce ? 0 : 1.1, ease, delay: reduce ? 0 : 0.2 }}
              />
            </div>

            {/* Desglose por etapa. Con una sola etapa sobra: la barra ya lo dijo. */}
            {journey.present.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {journey.present.map((stage) => (
                  <JourneyChip
                    key={stage.key}
                    stage={stage}
                    label={t(`courses.journey_${stage.key}`)}
                    color={course.color}
                  />
                ))}
              </div>
            )}

            {journeyNextHint && (
              <p className="mt-2.5 text-[12.5px] text-text-muted">{journeyNextHint}</p>
            )}
          </div>
        )}

        {/* Acciones. UNA sola llena (la que toca ahora); el resto, contorno. */}
        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          {nextItem && (
            <motion.div whileTap={reduce ? undefined : { scale: 0.97 }} className="inline-flex">
              <Link
                to={`/modules/${nextItem.module.slug}`}
                className="group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90"
              >
                <Play className="h-3.5 w-3.5" />
                {done > 0 ? t('courses.cta_continue') : t('courses.cta_start')}
                <span className="transition-transform duration-500 ease-apple group-hover:translate-x-1">-&gt;</span>
              </Link>
            </motion.div>
          )}

          {certStatus && certReady && (
            <Link
              to={`/certificate/${course.id}`}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13.5px] font-medium transition-colors duration-300',
                nextItem
                  ? 'border border-line text-text-muted hover:border-primary/50 hover:text-primary'
                  : 'bg-primary text-on-primary hover:opacity-90',
              )}
            >
              <Award className="h-3.5 w-3.5" />
              {t('course_cert.view')}
            </Link>
          )}

          {/* Certificado todavia no: el aprendiz ve que EXISTE y que le falta.
              Antes no habia rastro del certificado hasta cumplirlo todo, y el
              curso parecia no darlo. No navega a /certificate (el trigger lo
              negaria): lleva a la seccion Acreditar, donde estan los requisitos. */}
          {comingSoon && (
            <Tooltip
              anchor="element"
              variant="panel"
              maxWidth={260}
              describedBy
              label={
                <span className="block text-left [overflow-wrap:anywhere]">
                  {comingSoonNote || t('course_cert.coming_soon_hint')}
                </span>
              }
            >
              <span className="inline-flex cursor-default items-center gap-2 rounded-full border border-dashed border-amber-500/40 px-5 py-2.5 text-[13.5px] font-medium text-amber-600 dark:text-amber-400">
                <Hammer className="h-3.5 w-3.5" />
                {t('course_cert.coming_soon_badge')}
              </span>
            </Tooltip>
          )}

          {certStatus && !certReady && certMissing.length > 0 && (
            <Tooltip
              anchor="element"
              variant="panel"
              maxWidth={260}
              describedBy
              label={
                <span className="block text-left">
                  {t('course_cert.soon_hint')}
                  {certMissing.map((m) => (
                    <span key={m} className="mt-0.5 block">&middot; {m}</span>
                  ))}
                </span>
              }
            >
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById('cert-section')
                    ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
                }
                className="inline-flex items-center gap-2 rounded-full border border-dashed border-line px-5 py-2.5 text-[13.5px] font-medium text-text-subtle transition-colors duration-300 hover:border-primary/40 hover:text-text-muted"
              >
                <Award className="h-3.5 w-3.5" />
                {t('course_cert.soon')}
                <span className="tabular-nums text-text-subtle">
                  {t('course_cert.soon_count', { count: certMissing.length })}
                </span>
              </button>
            </Tooltip>
          )}

          {certStatus?.require_simulator && !certStatus.simulator_ok && totalScenarios > 0 && (
            <button
              onClick={startSimulation}
              className="inline-flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13.5px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary"
            >
              <PhoneCall className="h-3.5 w-3.5" />
              {t('course_practice.do_simulation')}
            </button>
          )}

          {/* Examen final: cuando esta disponible es LA accion del curso. */}
          {examState && !examState.passed && examState.unlocked && !examState.reinforcement && (
            <Link
              to={`/exam/${course.id}`}
              className={cn(
                'inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13.5px] font-medium transition-colors duration-300',
                nextItem
                  ? 'border border-line text-text-muted hover:border-primary/50 hover:text-primary'
                  : 'bg-primary text-on-primary hover:opacity-90',
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {t('exam.cta_start', 'Comenzar examen')}
            </Link>
          )}

          {/* El mundo se desbloquea segun la regla configurada por el capacitador
              (desde el inicio / tras los modulos / tras un modulo). El staff
              (superadmin/capacitador) siempre puede entrar (preview). */}
          {worldId && (isAdminOrCapacitador || asLearnerOfCourse) && (
            isAdminOrCapacitador || previewStaff || worldUnlocked ? (
              <Link
                to="/world"
                state={{ worldId, from: 'course' }}
                className="inline-flex items-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13.5px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary"
              >
                <Map className="h-3.5 w-3.5" />
                {t('courses.play_world')}
              </Link>
            ) : (
              <Tooltip label={worldLockedReason}>
                <span className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-line px-5 py-2.5 text-[13.5px] font-medium text-text-subtle">
                  <Lock className="h-3.5 w-3.5" />
                  {t('courses.play_world')}
                </span>
              </Tooltip>
            )
          )}

          {!course.isAssigned && (
            <motion.button
              onClick={handleEnroll}
              disabled={enrollBusy}
              whileTap={reduce ? undefined : { scale: 0.96 }}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-on-primary transition-opacity duration-300 hover:opacity-90 disabled:opacity-60"
            >
              {enrollBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {t('courses.enroll')}
            </motion.button>
          )}

          {course.selfEnrolled && (
            <button
              onClick={handleLeave}
              disabled={enrollBusy}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2.5 text-[13px] text-text-subtle transition-colors duration-300 hover:text-danger disabled:opacity-60"
            >
              <LogOut className="h-3.5 w-3.5" />
              {t('courses.leave')}
            </button>
          )}
        </div>

        {/* "Curso completado" solo cuando el curso ENTERO está: con el temario
            hecho pero el simulador, el mundo o el examen pendientes, el banner
            nombra lo que falta en vez de felicitar de más. */}
        {completed && (
          <p
            className={cn(
              'mt-5 inline-flex items-center gap-2 text-[13px] font-medium',
              journey.complete ? 'text-primary' : 'text-text-muted',
            )}
          >
            <Check
              className={cn('h-3.5 w-3.5', journey.complete ? '' : 'text-primary')}
              strokeWidth={3}
            />
            {journey.complete
              ? t('courses.completed_banner')
              : t('courses.modules_done_banner_journey', {
                  what: journey.pending
                    .map((k) => t(`courses.journey_${k}`).toLowerCase())
                    .join(' · '),
                })}
          </p>
        )}
      </FadeIn>

      {/* Día de XP multiplicado (si lo hay): también aquí, porque es donde se
          decide entrar a un módulo. */}
      <XPBoostCard lang={language as Lang} className="mb-8" />

      {/* Curso terminado → invitación explícita a repasar. Sin esto, el aprendiz
          que ya se certificó no tiene ninguna razón visible para volver. */}
      {completed && (
        <FadeIn className="mb-10">
          <div className="flex flex-col gap-3 rounded-2xl border border-line p-5 sm:flex-row sm:items-center">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <RefreshCw className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[14.5px] font-medium text-text">
                {t('courses.review_title', 'Repasa y sigue sumando')}
              </h3>
              <p className="text-[13px] text-text-muted">
                {t('courses.review_desc', {
                  xp: Math.round(reviewValue(XP_REWARDS.module) * boostMultiplier),
                  bonus: Math.round(reviewValue(XP_REWARDS.certification) * boostMultiplier),
                  defaultValue:
                    'Tu certificado no se toca. Cada módulo que repases suma {{xp}} XP (una vez al día) y, al repasar el curso entero, {{bonus}} XP extra.',
                })}
              </p>
            </div>
            <span className="shrink-0 text-[12px] tabular-nums text-text-subtle">
              {t('courses.review_round', {
                n: courseReviewCount[course.id] ?? 0,
                defaultValue: 'Vueltas: {{n}}',
              })}
            </span>
          </div>
        </FadeIn>
      )}

      {/* Modulos */}
      <FadeIn>
        <SectionHead title={t('courses.content_title')} subtitle={t('courses.content_subtitle')} />
      </FadeIn>

      {/* Lista, no rejilla de tarjetas: cada modulo es una fila separada por un
          hairline. La jerarquia la marca el estado del numero, no un borde de
          color por fila. */}
      <FadeIn delay={0.05} className="divide-y divide-line border-y border-line">
        {items.length === 0 && (
          <div className="py-12 text-center text-[13.5px] text-text-muted">
            {t('courses.no_modules')}
          </div>
        )}

        {/* Práctica "al inicio": va ANTES del módulo 1, abierta desde el primer
            día. Su sitio en la lista ES el mensaje. */}
        {startStops.map((stop, i) => (
          <PracticeStop
            key={stop.key}
            kind={stop.kind}
            title={stop.title}
            summary={stop.summary}
            unlocked
            unlockModuleTitle=""
            passScore={stop.passScore}
            difficulty={stop.difficulty}
            level={stop.level}
            color={course.color}
            index={i}
            onStart={() => goToSim(stop.pick)}
          />
        ))}

        {items.map(({ module, status }, idx) => {
          const interactive = status !== 'locked';
          const Wrapper: React.ElementType = interactive ? Link : 'div';
          const wrapperProps = interactive ? { to: `/modules/${module.slug}` } : {};
          const stops = stopsByModule[module.id] ?? [];
          const moduleTitle = pickText(module.title_es, module.title_en, module.title_pt, language);
          return (
            <React.Fragment key={module.id}>
            <Wrapper
              {...wrapperProps}
              className={cn(
                'group flex items-center gap-4 px-2 py-4 transition-colors duration-300 sm:px-3',
                interactive ? 'cursor-pointer hover:bg-subtle/60' : 'opacity-50',
              )}
            >
              {/* Estado */}
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-medium tabular-nums transition-colors duration-300',
                  status === 'completed' && 'bg-primary/10 text-primary',
                  status === 'available' && 'text-white',
                  status === 'locked' && 'bg-subtle text-text-subtle',
                )}
                style={status === 'available' ? { background: course.color } : undefined}
              >
                {status === 'completed' ? (
                  <Check className="h-4 w-4" strokeWidth={3} />
                ) : status === 'locked' ? (
                  <Lock className="h-3.5 w-3.5" />
                ) : (
                  idx + 1
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[14.5px] font-medium tracking-tight text-text">
                  {pickText(module.title_es, module.title_en, module.title_pt, language)}
                </h3>
                <p className="truncate text-[12.5px] text-text-muted">
                  {status === 'locked'
                    ? deadline.blocked
                      ? t('courses.deadline_module_locked_hint')
                      : t('courses.module_locked_hint')
                    : stripMarkdown(pickText(module.subtitle_es, module.subtitle_en, module.subtitle_pt, language))}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3 text-[12px] text-text-subtle">
                <span className="hidden tabular-nums sm:inline">{module.duration_min} min</span>
                {status === 'completed' && (
                  <>
                    {/* El modulo terminado deja de ser un callejon sin salida:
                        dice que se lleva por volver, o que ya lo cobro hoy. */}
                    {reviewedTodayIn(module) ? (
                      <span className="hidden sm:inline">{t('courses.review_done_today', 'Repasado hoy')}</span>
                    ) : (
                      <span
                        className={cn(
                          'tabular-nums',
                          boostMultiplier > 1 ? 'text-neon-magenta' : 'text-primary',
                        )}
                      >
                        +{Math.round(reviewValue(XP_REWARDS.module) * boostMultiplier)} XP
                      </span>
                    )}
                  </>
                )}
                {interactive && (
                  <span className="text-text-subtle transition-all duration-500 ease-apple group-hover:translate-x-1 group-hover:text-text">
                    &rarr;
                  </span>
                )}
              </div>
            </Wrapper>

            {/* Paradas de práctica que cuelgan de este módulo: van AQUÍ, dentro
                del recorrido, no en una sección aparte al final. */}
            {stops.map((stop, i) => (
              <PracticeStop
                key={stop.key}
                kind={stop.kind}
                title={stop.title}
                summary={stop.summary}
                unlocked={moduleDone(module.id)}
                unlockModuleTitle={moduleTitle}
                passScore={stop.passScore}
                difficulty={stop.difficulty}
                level={stop.level}
                color={course.color}
                index={i}
                onStart={() => goToSim(stop.pick)}
              />
            ))}
            </React.Fragment>
          );
        })}
      </FadeIn>

      {/* ── Practicar: las simulaciones que se pusieron AL FINAL del curso. Las
             de inicio y las de módulo ya salieron arriba, en su punto del
             recorrido. Se abren al terminar todos los módulos. ── */}
      {tailTotal > 0 && (() => {
        return (
          <FadeIn className="mt-14">
            <SectionHead
              id="practice-section"
              title={t('course_practice.title')}
              subtitle={t('course_practice.subtitle')}
              aside={
                completed && certStatus && certStatus.best_score > 0 ? (
                  <span className="shrink-0 text-[12.5px] tabular-nums text-text-muted">
                    {t('course_practice.best_score', { score: certStatus.best_score })}
                  </span>
                ) : undefined
              }
            />

            {!completed ? (
              <div className="flex items-center gap-3 rounded-2xl border border-line px-5 py-4">
                <Lock className="h-4 w-4 shrink-0 text-text-subtle" />
                <p className="text-[13.5px] text-text-muted">
                  {t('course_practice.locked_after_modules')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {tailChoiceScenarios.map((scn) => (
                  <button
                    key={scn.id}
                    onClick={() =>
                      navigate(`/simulator/choice/${scn.id}`, {
                        state: {
                          courseId: course.id,
                          campaignId: course.campaign_id,
                          returnTo: `/courses/${course.slug}`,
                        },
                      })
                    }
                    className="group rounded-2xl border border-line p-5 text-left transition-all duration-500 ease-apple hover:-translate-y-1 hover:shadow-card-hover"
                  >
                    <div className="mb-3 flex items-center gap-1.5 text-[12px] text-text-subtle">
                      <ListChecks className="h-3.5 w-3.5" />
                      <span>{t('simulator.choice_section_title')}</span>
                      <span className="text-text-subtle/50">·</span>
                      <span>
                        {t(`simulator.choice.level_${scn.level === 'basico' ? 'basic' : scn.level === 'medio' ? 'medium' : 'advanced'}`)}
                      </span>
                    </div>
                    <h3 className="mb-1.5 text-[15px] font-medium tracking-tight text-text">
                      {scn.title[language]}
                    </h3>
                    <p className="mb-4 line-clamp-2 text-[13px] leading-relaxed text-text-muted">
                      {stripMarkdown(scn.description[language])}
                    </p>
                    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-text">
                      {t('simulator.take_call')}
                      <span className="transition-transform duration-500 ease-apple group-hover:translate-x-1">&rarr;</span>
                    </span>
                  </button>
                ))}
                {tailScenarios.map((scn) => (
                  <button
                    key={scn.id}
                    onClick={() =>
                      navigate(`/simulator/run/${scn.id}`, {
                        state: {
                          courseId: course.id,
                          campaignId: course.campaign_id,
                          returnTo: `/courses/${course.slug}`,
                        },
                      })
                    }
                    className="group rounded-2xl border border-line p-5 text-left transition-all duration-500 ease-apple hover:-translate-y-1 hover:shadow-card-hover"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[12px] text-text-subtle">
                        <CountryFlag code={scn.country} size={16} />
                        <span>{t(`simulator.countries.${scn.country}`, scn.country)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3].map((d) => (
                          <Flame
                            key={d}
                            className={cn('h-3 w-3', d <= scn.difficulty ? 'text-primary' : 'text-line')}
                            fill={d <= scn.difficulty ? 'currentColor' : 'none'}
                          />
                        ))}
                      </div>
                    </div>
                    <h3 className="mb-1.5 text-[15px] font-medium tracking-tight text-text">
                      {scn.title[language]}
                    </h3>
                    <p className="mb-4 line-clamp-2 text-[13px] leading-relaxed text-text-muted">
                      {scn.summary[language]}
                    </p>
                    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-text">
                      {t('simulator.take_call')}
                      <span className="transition-transform duration-500 ease-apple group-hover:translate-x-1">&rarr;</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </FadeIn>
        );
      })()}

      {/* ── El mundo del curso (juego) ──────────────────────────────────────
           Antes el mundo solo existía como un botón más en la fila de acciones
           de la cabecera: el aprendiz podía terminar el curso sin enterarse de
           que había un mundo, aunque cuenta como un paso del recorrido. Ahora
           tiene su parada propia, con el mismo lenguaje que el examen final. */}
      {worldId && (isAdminOrCapacitador || asLearnerOfCourse) && worldLevels > 0 && (() => {
        const openable = isAdminOrCapacitador || previewStaff || worldUnlocked;
        const done = worldLevelsDone >= worldLevels;
        const card = (
          <>
            <div
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                openable ? 'bg-primary/10 text-primary' : 'bg-subtle text-text-subtle',
              )}
            >
              {done ? <Award className="h-5 w-5" /> : openable ? <Map className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-subtle">
                {done
                  ? t('courses.world_section_done', 'Completado')
                  : openable
                    ? t('courses.world_section_ready', 'Disponible')
                    : t('courses.world_section_locked', 'Bloqueado')}
              </p>
              <div className="mt-0.5 truncate text-[16px] font-medium tracking-tight text-text">
                <span className="mr-1.5">{world?.icon}</span>
                {pickText(world?.name ?? '', world?.name_en ?? null, world?.name_pt ?? null, language)}
              </div>
              <p className="mt-0.5 text-[12.5px] text-text-muted">
                {openable
                  ? t('courses.world_section_meta', {
                      done: worldLevelsDone,
                      total: worldLevels,
                      defaultValue: '{{done}} de {{total}} niveles superados',
                    })
                  : worldLockedReason}
              </p>
            </div>

            <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-text-muted">
              {t('courses.play_world')}
              <span className="transition-transform duration-500 ease-apple group-hover:translate-x-1">&rarr;</span>
            </span>
          </>
        );
        return (
          <FadeIn className="mt-14">
            <SectionHead
              id="world-section"
              title={t('courses.world_section_title', 'Mundo del curso')}
              subtitle={t(
                'courses.world_section_subtitle',
                'El juego del curso: niveles con retos hechos con el contenido de sus modulos.',
              )}
              aside={
                <span className="shrink-0 text-[12.5px] tabular-nums text-text-muted">
                  {worldLevelsDone}/{worldLevels}
                </span>
              }
            />
            {openable ? (
              <Link
                to="/world"
                state={{ worldId, from: 'course' }}
                className="group flex items-center gap-4 rounded-2xl border border-line p-5 transition-all duration-500 ease-apple hover:-translate-y-1 hover:shadow-card-hover"
              >
                {card}
              </Link>
            ) : (
              <div className="flex cursor-not-allowed items-center gap-4 rounded-2xl border border-line p-5 opacity-70">
                {card}
              </div>
            )}
          </FadeIn>
        );
      })()}

      {/* ── Examen final de certificacion ── */}
      {examState && (
        <FadeIn className="mt-14">
          <SectionHead
            id="exam-section"
            title={t('exam.section_title', 'Examen final')}
            subtitle={t(
              'exam.section_subtitle',
              'La prueba que acredita el curso. Se sortea de un banco de preguntas y entrega un informe por area.',
            )}
            aside={
              examState.attempts_used > 0 ? (
                <span className="shrink-0 text-[12.5px] tabular-nums text-text-muted">
                  {t('exam.section_best', { score: examState.best_score, defaultValue: 'Mejor: {{score}}%' })}
                </span>
              ) : undefined
            }
          />

          <Link
            to={`/exam/${course.id}`}
            className="group flex items-center gap-4 rounded-2xl border border-line p-5 transition-all duration-500 ease-apple hover:-translate-y-1 hover:shadow-card-hover"
          >
            <div
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                examState.passed
                  ? 'bg-primary/10 text-primary'
                  : examState.unlocked
                    ? 'bg-primary/10 text-primary'
                    : 'bg-subtle text-text-subtle',
              )}
            >
              {examState.passed ? (
                <Award className="h-5 w-5" />
              ) : examState.unlocked ? (
                <ClipboardCheck className="h-5 w-5" />
              ) : (
                <Lock className="h-5 w-5" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-subtle">
                {examState.passed
                  ? t('exam.status_passed', 'Aprobado')
                  : examState.reinforcement
                    ? t('exam.section_reinforcing', 'Refuerzo pendiente')
                    : examState.unlocked
                      ? t('exam.section_ready', 'Disponible')
                      : t('exam.section_locked', 'Bloqueado')}
              </p>
              <div className="mt-0.5 truncate text-[16px] font-medium tracking-tight text-text">
                {pickText(examState.title_es, examState.title_en, examState.title_pt, language)}
              </div>
              <p className="mt-0.5 text-[12.5px] text-text-muted">
                {t('exam.section_meta', {
                  n: examState.question_count,
                  score: examState.pass_score,
                  defaultValue: '{{n}} preguntas · {{score}}% para aprobar',
                })}
                {examState.time_limit_min > 0 && ` · ${examState.time_limit_min} min`}
              </p>
            </div>

            <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-text-muted">
              {examState.passed
                ? t('exam.section_view_report', 'Ver informe')
                : t('exam.section_open', 'Abrir')}
              <span className="transition-transform duration-500 ease-apple group-hover:translate-x-1">&rarr;</span>
            </span>
          </Link>
        </FadeIn>
      )}

      {/* ── Acreditar: certificado del curso ── */}
      {(() => {
        // El examen final es un requisito más del certificado: requireExam /
        // examMin / examOk se calculan arriba, junto al boton de la cabecera.
        if (!certStatus) return null;
        if (!certStatus.require_all_modules && !certStatus.require_simulator && !requireExam) {
          return null;
        }
        const reqTotal =
          (certStatus.require_all_modules ? 1 : 0) +
          (certStatus.require_simulator ? 1 : 0) +
          (requireExam ? 1 : 0);
        const reqMet =
          (certStatus.require_all_modules && certStatus.modules_ok ? 1 : 0) +
          (certStatus.require_simulator && certStatus.simulator_ok ? 1 : 0) +
          (requireExam && examOk ? 1 : 0);
        const ready = certReady;
        const modulesPct =
          certStatus.modules_total > 0 ? certStatus.modules_done / certStatus.modules_total : 0;
        const simPct =
          certStatus.min_score > 0 ? Math.min(1, certStatus.best_score / certStatus.min_score) : 0;
        const examPct =
          examMin > 0 ? Math.min(1, (examState?.best_score ?? 0) / examMin) : 0;

        return (
          <FadeIn className="mt-14">
            <SectionHead
              id="cert-section"
              title={t('course_cert.title')}
              subtitle={t('course_cert.subtitle')}
              aside={
                !ready ? (
                  <span className="shrink-0 text-[12.5px] tabular-nums text-text-muted">
                    {t('course_cert.reqs_met', { done: reqMet, total: reqTotal })}
                  </span>
                ) : undefined
              }
            />

            {/* Recertificacion: su certificado sigue siendo valido y visible.
                Esto informa, no bloquea - el aprendiz decide cuando rehacerlo. */}
            {certStatus.certified && certStatus.needs_recert && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-line px-4 py-3.5">
                <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <div className="text-[13px] text-text-muted">
                  <span className="mb-0.5 block font-medium text-text">
                    {certStatus.expired
                      ? t('course_cert.recert_expired_title')
                      : t('course_cert.recert_title')}
                  </span>
                  {certStatus.expired
                    ? t('course_cert.recert_expired_hint')
                    : t('course_cert.recert_hint')}
                  {certStatus.new_modules_count > 0 && (
                    <span className="mt-1 block">
                      {t('course_cert.recert_new_modules', {
                        count: certStatus.new_modules_count,
                      })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Lo que falta no lo puede resolver el aprendiz: falta contenido por
                publicar. Se dice arriba de los requisitos para que no crea que el
                candado es suyo. */}
            {comingSoon && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/8 px-4 py-3.5">
                <Hammer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <div className="min-w-0 text-[13px] text-text-muted">
                  <span className="mb-0.5 block font-medium text-text">
                    {t('course_cert.coming_soon_title')}
                  </span>
                  <span className="[overflow-wrap:anywhere]">
                    {comingSoonNote || t('course_cert.coming_soon_hint')}
                  </span>
                </div>
              </div>
            )}

            {ready ? (
              <Link
                to={`/certificate/${course.id}`}
                className="group flex items-center gap-4 rounded-2xl border border-line p-5 transition-all duration-500 ease-apple hover:-translate-y-1 hover:shadow-card-hover"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Award className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary">
                    {t('course_cert.ready_tag')}
                  </p>
                  <div className="mt-0.5 text-[16px] font-medium tracking-tight text-text">
                    {t('course_cert.ready_title')}
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 text-[13px] text-text-muted">
                  {t('course_cert.view')}
                  <span className="transition-transform duration-500 ease-apple group-hover:translate-x-1">&rarr;</span>
                </span>
              </Link>
            ) : (
              <div className="space-y-6 rounded-2xl border border-line p-6">
                {/* Requisito: modulos */}
                {certStatus.require_all_modules && (
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12.5px] font-medium',
                        certStatus.modules_ok ? 'bg-primary/10 text-primary' : 'bg-subtle text-text-muted',
                      )}
                    >
                      {certStatus.modules_ok ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : '1'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 text-[13.5px] text-text">{t('course_cert.req_modules')}</div>
                      <div className="h-[3px] w-full overflow-hidden rounded-full bg-subtle">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          initial={{ width: reduce ? `${modulesPct * 100}%` : 0 }}
                          animate={{ width: `${modulesPct * 100}%` }}
                          transition={{ duration: reduce ? 0 : 1, ease }}
                        />
                      </div>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-[12px] tabular-nums',
                        certStatus.modules_ok ? 'text-primary' : 'text-text-subtle',
                      )}
                    >
                      {certStatus.modules_done}/{certStatus.modules_total}
                    </span>
                  </div>
                )}
                {/* Requisito: simulador */}
                {certStatus.require_simulator && (
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12.5px] font-medium',
                        certStatus.simulator_ok ? 'bg-primary/10 text-primary' : 'bg-subtle text-text-muted',
                      )}
                    >
                      {certStatus.simulator_ok ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : '2'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 text-[13.5px] text-text">
                        {t('course_cert.req_simulator', { score: certStatus.min_score })}
                      </div>
                      <div className="h-[3px] w-full overflow-hidden rounded-full bg-subtle">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          initial={{ width: reduce ? `${simPct * 100}%` : 0 }}
                          animate={{ width: `${simPct * 100}%` }}
                          transition={{ duration: reduce ? 0 : 1, ease }}
                        />
                      </div>
                      {!certStatus.simulator_ok && totalScenarios > 0 && (
                        <button
                          onClick={startSimulation}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-1.5 text-[12.5px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary"
                        >
                          <PhoneCall className="h-3.5 w-3.5" />
                          {t('course_practice.do_simulation')}
                        </button>
                      )}
                      {!certStatus.simulator_ok && totalScenarios === 0 && (
                        <p className="mt-2 text-[12px] text-text-muted">
                          {simLoadFailed
                            ? t('course_cert.sim_load_failed')
                            : t('course_cert.no_sim_available')}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-[12px] tabular-nums',
                        certStatus.simulator_ok ? 'text-primary' : 'text-text-subtle',
                      )}
                    >
                      {certStatus.best_score}/{certStatus.min_score}
                    </span>
                  </div>
                )}
                {/* Requisito: examen final */}
                {requireExam && (
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12.5px] font-medium',
                        examOk ? 'bg-primary/10 text-primary' : 'bg-subtle text-text-muted',
                      )}
                    >
                      {examOk ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : reqTotal}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 text-[13.5px] text-text">
                        {t('course_cert.req_exam', {
                          score: examMin,
                          defaultValue: 'Aprobar el examen final con al menos {{score}}%',
                        })}
                      </div>
                      <div className="h-[3px] w-full overflow-hidden rounded-full bg-subtle">
                        <motion.div
                          className="h-full rounded-full bg-primary"
                          initial={{ width: reduce ? `${examPct * 100}%` : 0 }}
                          animate={{ width: `${examPct * 100}%` }}
                          transition={{ duration: reduce ? 0 : 1, ease }}
                        />
                      </div>
                      {!examOk && examState && (
                        <Link
                          to={`/exam/${course.id}`}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-1.5 text-[12.5px] font-medium text-text-muted transition-colors duration-300 hover:border-primary/50 hover:text-primary"
                        >
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          {examState.attempts_used > 0
                            ? t('exam.section_open', 'Abrir')
                            : t('exam.cta_start', 'Comenzar examen')}
                        </Link>
                      )}
                      {!examOk && !examState && (
                        <p className="mt-2 text-[12px] text-text-muted">
                          {t('course_cert.no_exam_available', 'El examen todavía no está publicado.')}
                        </p>
                      )}
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-[12px] tabular-nums',
                        examOk ? 'text-primary' : 'text-text-subtle',
                      )}
                    >
                      {examState?.best_score ?? 0}/{examMin}
                    </span>
                  </div>
                )}
                <p className="pt-1 text-[13px] text-text-muted">{t('course_cert.pending_hint')}</p>
              </div>
            )}
          </FadeIn>
        );
      })()}

    </div>
    {legacyOpen && (
      <LegacyCourseNoticeModal
        email={course.cert_conditions?.legacy_notice_email}
        onClose={closeLegacy}
      />
    )}
    {pickerOpen && (
      <SimulatorPickerModal
        /* Solo lo que se puede jugar ahora: con simulaciones ancladas a módulos
           ya no hay un único candado para todas, y ofrecer una bloqueada aquí
           sería prometer algo que la siguiente pantalla niega. */
        scenarios={playableTotal > 0 ? playableScenarios : tailScenarios}
        choiceScenarios={playableTotal > 0 ? playableChoiceScenarios : tailChoiceScenarios}
        language={language}
        accent={course.color}
        unlocked={playableTotal > 0}
        lockedReason={simLockedReason}
        bestScore={certStatus?.best_score}
        onPick={(pick) => {
          setPickerOpen(false);
          goToSim(pick);
        }}
        onClose={() => setPickerOpen(false)}
      />
    )}
    </>
  );
}
