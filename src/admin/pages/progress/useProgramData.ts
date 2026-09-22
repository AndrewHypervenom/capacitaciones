// src/admin/pages/progress/useProgramData.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getPendingAttempts } from '@/services/activity.service';
import { getAllAudiences, matchesAudience } from '@/services/audiences.service';
import { getTestUnitIds, getActiveOrgId } from '@/services/org.service';
import { getSurveyResults, type SurveyResults } from '@/services/survey.service';
import { getExamResults } from '@/services/exams.admin.service';
import type { ExamResultRow } from '@/types/exam';
import { useAuth } from '@/hooks/useAuth';
import { shouldHideTestData } from '@/stores/testModeStore';
import { courseDueMs, type CourseDeadline } from '@/lib/courseDeadline';
import { rowText, pickLang } from '@/lib/contentLang';
import { buildCourseJourney, countPracticeDone, worldStage, type CourseJourney } from '@/lib/courseJourney';

/* ────────────────────────────────────────────────────────────────────────────
   Datos del Panorama de Progreso.

   Una sola carga que responde las preguntas de dirección: a cuánta gente llegó
   el programa, quiénes participaron de verdad, cómo van, cuántos se
   certificaron y qué opinan. Todo con las MISMAS fuentes que el resto del
   panel, para que ningún número se contradiga con otra pantalla:

     · profiles              → universo de personas (la RLS ya acota al capacitador)
     · courses               → universo de cursos vivos (sin borrado suave)
     · course_assignments    → cursos asignados a una persona (con `assigned_at`,
                               desde donde se cuenta el plazo por días)
     · course_audiences      → la REGLA país/área/CR con la que le llega el
                               curso a la gente (el programa ya no entrega nada)
     · courses (plazo)       → columnas deadline_* aparte, para que un curso sin
                               el SQL corrido no tumbe el resto del tablero
     · get_program_certificates() → certificados emitidos, con fecha y código
                               (la tabla `certifications` solo como respaldo)
     · getPendingAttempts()  → actividad real: entregas, notas y qué falta evaluar
     · module_time           → tiempo activo (DIFERIDO: se pide aparte, es pesado)
     · get_course_survey_results → NPS y comentarios (DIFERIDO, por curso)

   Todo degrada solo: si una consulta falla por permisos o porque su SQL aún no
   está corrido, esa dimensión se queda vacía y el resto del tablero funciona.
   ──────────────────────────────────────────────────────────────────────────── */

/** La más antigua de dos marcas ISO (ignora las vacías). */
function earliestDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

export interface ProgramPerson {
  id: string;
  name: string;
  email: string | null;
  role: 'superadmin' | 'capacitador' | 'learner';
  campaignId: string | null;
  campaignName: string | null;
  /** Cargo y país: los dos ejes de segmentación que el perfil ya guarda. */
  jobTitle: string | null;
  country: string | null;
  /** CR (operación) y área: los ejes con los que ahora se reparte la formación. */
  operationId: string | null;
  areaId: string | null;
  avatarUrl: string | null;
  createdAt: string | null;
  /** Cursos que le tocan (asignación directa o por campaña). */
  assigned: number;
  /** De esos, cuántos son de formación OBLIGATORIA (cumplimiento). */
  mandatory: number;
  /** Obligatorios que ya terminó (numerador de la tasa de cumplimiento). */
  mandatoryDone: number;
  /** De los asignados, en cuántos ha hecho algo. */
  started: number;
  /** Cursos terminados de verdad: certificado o temario completo. */
  completed: number;
  certified: number;
  /** Módulos completados y módulos que suman sus cursos (avance de temario). */
  modulesDone: number;
  modulesTotal: number;
  /** Promedio de sus entregas (null si no ha entregado nada). */
  avgScore: number | null;
  /** Entregas suyas que el capacitador todavía no evaluó. */
  pendingReviews: number;
  /** Cursos asignados cuyo plazo venció sin que los terminara. */
  overdue: number;
  /** Última señal de actividad (ms epoch) o null. */
  lastActivity: number | null;
  /** Tiempo activo acumulado en módulos (ms). 0 hasta que se cargue. */
  studyMs: number;
}

export interface ProgramCourse {
  id: string;
  title: string;
  campaignId: string | null;
  campaignName: string | null;
  published: boolean;
  icon: string | null;
  /** Módulos vivos del curso (el temario contra el que se mide todo). */
  modules: number;
  /** El curso es obligatorio para alguien (asignación de cumplimiento). */
  mandatory: boolean;
  /** Personas con el curso asignado. */
  assigned: number;
  /**
   * ¿El curso tiene regla país/área/CR que le llegue a alguien? Es lo que separa
   * "esto le toca a un grupo" de "esto le toca a tres personas", y sin ese dato
   * las dos cosas se leen igual en la tabla.
   */
  byRule: boolean;
  /** De los asignados, cuántos lo tienen por asignación individual. */
  directAssigned: number;
  started: number;
  completed: number;
  certified: number;
  avgScore: number | null;
  pendingReviews: number;
  /** Personas con el plazo del curso vencido y el curso sin terminar. */
  overdue: number;
  lastActivity: number | null;
}

/** Cruce persona × curso: la celda de la matriz exportable. */
export interface ProgramCell {
  userId: string;
  courseId: string;
  assigned: boolean;
  /** Le llegó por la regla país/área/CR del curso, no por asignación a ella. */
  viaRule: boolean;
  /** La asignación es obligatoria (formación de cumplimiento), no voluntaria. */
  mandatory: boolean;
  started: boolean;
  score: number | null;
  attempts: number;
  pending: number;
  /** Módulos del curso que la persona ya completó. */
  modulesDone: number;
  /** Módulos vivos que tiene el curso (0 si el curso no tiene módulos). */
  modulesTotal: number;
  /* ── Las otras etapas del curso, para ESTA persona ──────────────────────
     Un curso no es solo su temario: puede traer simuladores, un mundo y un
     examen final, y hasta que esos no están el aprendiz no se certifica. Se
     miden con la misma regla que ve él en su pantalla (src/lib/courseJourney).
     Si la lectura falló, llegan en 0 y el curso se mide solo por módulos, que
     es como se medía antes. */
  practiceTotal: number;
  practiceDone: number;
  worldTotal: number;
  worldDone: number;
  examTotal: number;
  examDone: number;
  /** Una lectura incompleta no permite afirmar que el curso está terminado. */
  journeyKnown?: boolean;
  lastAt: number | null;
  certifiedAt: string | null;
  certId: string | null;
  /** Cuándo vence el curso para esta persona (ms epoch), o null si no hay plazo. */
  dueAt: number | null;
  /** El plazo ya pasó y el curso no está terminado. */
  overdue: boolean;
}

/**
 * ¿La persona TERMINÓ el curso?
 *
 * Certificado emitido o todas las etapas publicadas completadas. Un curso
 * puede constar solo de simulación, mundo o examen; un curso vacío nunca está
 * completo. Si faltan datos no se infiere la finalización.
 */
export function isCourseCompleted(cell: ProgramCell): boolean {
  if (cell.certifiedAt) return true;
  if (cell.journeyKnown === false) return false;
  const j = cellJourney(cell);
  return j.complete;
}

/**
 * Avance del curso, 0-100 (null si no se conoce ni el temario).
 *
 * Cuenta lo mismo que la pantalla del aprendiz: módulos, simuladores, mundo y
 * examen. Antes solo miraba módulos y el tablero daba por cerrada gente a la
 * que todavía le faltaba la mitad de lo que el certificado exige.
 */
export function coursePct(cell: ProgramCell): number | null {
  if (cell.journeyKnown === false) return null;
  const j = cellJourney(cell);
  if (j.total <= 0) return null;
  return Math.min(100, Math.round(j.pct * 100));
}

/** El recorrido de una celda, con la MISMA función que usa el aprendiz. */
export function cellJourney(cell: ProgramCell): CourseJourney {
  return buildCourseJourney({
    modules: { total: cell.modulesTotal, done: cell.modulesDone },
    practice: { total: cell.practiceTotal, done: cell.practiceDone },
    world: { total: cell.worldTotal, done: cell.worldDone },
    exam: { total: cell.examTotal, done: cell.examDone },
  });
}

/** Un módulo del temario de un curso. */
export interface ProgramModule {
  id: string;
  title: string;
  order: number;
}

export interface CampaignLite {
  id: string;
  name: string;
}

/** Lo que el panel necesita saber de una entrega para las listas de actividad. */
export interface ActivityRow {
  id: string;
  userId: string;
  userName: string;
  courseId: string | null;
  courseTitle: string | null;
  moduleTitle: string | null;
  sectionTitle: string | null;
  gameType: string;
  score: number;
  at: number;
  evaluated: boolean;
  isReview: boolean;
}

export interface SurveyEntry {
  courseId: string;
  results: SurveyResults;
}

export interface ProgramData {
  loading: boolean;
  error: string | null;
  people: ProgramPerson[];
  courses: ProgramCourse[];
  cells: ProgramCell[];
  campaigns: CampaignLite[];
  activity: ActivityRow[];
  /** Certificados en bruto, para la hoja de Excel y la lista de emitidos. */
  certificates: CertificateRow[];
  /** ¿Se pudo leer la asignación (course_assignments/course_campaigns)? */
  assignmentsKnown: boolean;
  /** ¿Se pudieron leer los certificados? (false ⇒ "no sé", no "no hay") */
  certificatesKnown: boolean;
  /**
   * ¿Se pudieron leer las etapas que no son módulos (simuladores, mundo,
   * examen)? Con `false` la finalización se mide solo por temario y puede salir
   * MÁS ALTA de lo que es: no es un dato que se pueda reportar hacia afuera sin
   * decirlo.
   */
  journeyKnown: boolean;
  /** Temario de cada curso, en orden (para el detalle por módulo). */
  modulesByCourse: Record<string, ProgramModule[]>;
  /** Módulos completados, indexado por `${userId}|${courseId}`. */
  doneModules: Record<string, string[]>;
  /** Tiempo de estudio: estado de la carga diferida. */
  study: { loading: boolean; loaded: boolean; partial: boolean; totalMs: number };
  /**
   * Tiempo de estudio por persona y curso (`userId → courseId → ms`). Es lo que
   * hay que sumar cuando el tablero se filtra por UN curso: `studyMs` de la
   * persona es su total en todo el sitio.
   */
  studyByUserCourse: Record<string, Record<string, number>>;
  loadStudyTime: () => void;
  /**
   * Encuestas: estado de la carga diferida (una llamada por curso).
   * Devuelve los resultados además de guardarlos, para que quien no pueda
   * esperar al re-render (la exportación) los use de una vez.
   */
  surveys: { loading: boolean; loaded: boolean; byCourse: Record<string, SurveyResults> };
  loadSurveys: (courseIds: string[]) => Promise<Record<string, SurveyResults>>;
  /** Exámenes finales: igual de diferidos, y por la misma razón. */
  exams: { loading: boolean; loaded: boolean; byCourse: Record<string, ExamResultRow[]> };
  loadExams: (courseIds: string[]) => Promise<Record<string, ExamResultRow[]>>;
  reload: () => void;
}

export interface CertificateRow {
  userId: string;
  courseId: string;
  certId: string;
  score: number;
  issuedAt: string;
}

/** Filas por página al paginar consultas grandes (el tope de Supabase es 1000). */
const PAGE = 1000;
/** Techo de seguridad del tiempo de estudio: más allá se avisa que va parcial. */
const STUDY_MAX_ROWS = 20_000;

type Lang = 'es' | 'en' | 'pt';

function pickTitle(
  row: { title_es: string; title_en: string | null; title_pt: string | null },
  lang: Lang,
): string {
  return pickLang(row.title_es, row.title_en, row.title_pt, lang);
}

/** Trae una tabla entera en páginas de 1000 (Supabase nunca devuelve más de eso). */
async function fetchAll<T>(
  table: string,
  columns: string,
  maxRows = 50_000,
): Promise<{ rows: T[]; partial: boolean }> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as unknown as T[];
    out.push(...batch);
    if (batch.length < PAGE) return { rows: out, partial: false };
  }
  return { rows: out, partial: true };
}

/** Una fila de `certifications`, tal como la necesita el tablero. */
type RawCertificate = {
  user_id: string;
  course_id: string;
  cert_id: string;
  score: number;
  issued_at: string;
};

/**
 * Certificados emitidos, con el alcance del rol resuelto EN LA BASE.
 *
 * Leer `certifications` directo deja el resultado en manos de la RLS de esa
 * tabla, que sigue razonando por `campaign_id`: al staff se le caían filas de
 * gente que el resto del tablero sí le muestra. Y una fila que no llega se lee
 * igual que un certificado que no existe, así que la persona salía con su nota
 * y la casilla "Certificado" en blanco aunque el diploma estuviera emitido.
 *
 * `get_program_certificates()` (SECURITY DEFINER) devuelve los certificados de
 * "mi gente" —la misma definición de alcance que usa el resto del panel, ver
 * get_my_people_ids—. Si ese SQL todavía no se ha corrido se cae a la tabla:
 * peor alcance, pero nunca menos de lo que había antes. `ok` en false significa
 * "no pude leerlos", que NO es lo mismo que "no hay": el panel lo dice en vez
 * de pintar un cero que parece un dato.
 */
async function fetchCertificates(): Promise<{ rows: RawCertificate[]; ok: boolean }> {
  const { data, error } = await supabase.rpc('get_program_certificates');
  if (!error) return { rows: (data ?? []) as unknown as RawCertificate[], ok: true };
  try {
    const { rows } = await fetchAll<RawCertificate>(
      'certifications',
      'user_id, course_id, cert_id, score, issued_at',
    );
    return { rows, ok: true };
  } catch {
    return { rows: [], ok: false };
  }
}

export function useProgramData(
  lang: Lang,
  excludeSuperadmins: boolean,
  /**
   * Si se consulta algo.
   *
   * El tablero lee dieciocho tablas de un tirón. Hacerlo al abrir la pantalla
   * —antes de que nadie haya dicho qué quiere mirar— es trabajo que casi siempre
   * se tira: quien entra viene a ver UN CR, UN área o UN curso. Se espera a que
   * lo diga. En `false` no se pide NADA y `loading` queda en false: la pantalla
   * no puede quedarse girando a la espera de algo que no va a pasar.
   */
  enabled = true,
): ProgramData {
  // Entorno de pruebas: con el Modo pruebas apagado, las campañas marcadas
  // `is_test` no existen para este tablero — ni su gente, ni sus cursos, ni su
  // progreso. Es lo que evita que las cuentas de prueba ensucien los KPIs, el
  // NPS y los Excel que se mandan afuera.
  const { isSuperAdmin } = useAuth();
  const hideTest = shouldHideTestData(isSuperAdmin);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const [people, setPeople] = useState<ProgramPerson[]>([]);
  const [courses, setCourses] = useState<ProgramCourse[]>([]);
  const [cells, setCells] = useState<ProgramCell[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [certificates, setCertificates] = useState<CertificateRow[]>([]);
  const [assignmentsKnown, setAssignmentsKnown] = useState(true);
  const [certificatesKnown, setCertificatesKnown] = useState(true);
  const [journeyKnown, setJourneyKnown] = useState(true);
  const [modulesByCourse, setModulesByCourse] = useState<Record<string, ProgramModule[]>>({});
  const [doneModules, setDoneModules] = useState<Record<string, string[]>>({});

  // El tiempo se guarda crudo (una fila por persona y módulo) y se suma después
  // contra el catálogo vivo: el borrado de un módulo tiene que descontar sus
  // horas sin volver a pedir nada, y las dos cargas son independientes.
  const [studyRows, setStudyRows] = useState<Array<{ user_id: string; module_id: string; elapsed_ms: number }>>([]);
  const [liveModuleIds, setLiveModuleIds] = useState<Set<string>>(new Set());
  const [study, setStudy] = useState({ loading: false, loaded: false, partial: false });
  const [surveyMap, setSurveyMap] = useState<Record<string, SurveyResults>>({});
  const [surveyState, setSurveyState] = useState({ loading: false, loaded: false });
  const [examMap, setExamMap] = useState<Record<string, ExamResultRow[]>>({});
  const [examState, setExamState] = useState({ loading: false, loaded: false });

  // Evita relanzar las cargas diferidas si el usuario va y vuelve de pestaña.
  // Encuestas y exámenes guardan la promesa, no un booleano: quien llegue
  // mientras la carga va en camino (abrir la pestaña y exportar a la vez) se
  // engancha a la misma y recibe los mismos datos.
  const studyStarted = useRef(false);
  const surveysRun = useRef<Promise<Record<string, SurveyResults>> | null>(null);
  const examsRun = useRef<Promise<Record<string, ExamResultRow[]>> | null>(null);
  const surveysScope = useRef('');
  const examsScope = useRef('');
  const surveysVersion = useRef(0);
  const examsVersion = useRef(0);

  const reload = useCallback(() => {
    studyStarted.current = false;
    surveysRun.current = null;
    examsRun.current = null;
    surveysVersion.current++;
    examsVersion.current++;
    setStudy({ loading: false, loaded: false, partial: false });
    setSurveyState({ loading: false, loaded: false });
    setExamState({ loading: false, loaded: false });
    setSurveyMap({});
    setExamMap({});
    setStudyRows([]);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    /* Sin alcance elegido no se pide nada, y `loading` se apaga: una pantalla
       girando a la espera de algo que nadie pidió es peor que una vacía. */
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        // Todo en paralelo y con `allSettled`: una dimensión sin permiso no
        // puede tumbar el tablero entero.
        const [
          profilesRes, campaignsRes, coursesRes, assignRes, audienceRes, certsRes,
          modulesRes, progressRes, attemptsRes, deadlineRes,
          callScnRes, choiceScnRes, simAttemptRes,
          worldRes, worldLevelRes, worldProgressRes,
          examRes, examAttemptRes, worldAttemptRes,
        ] = await Promise.allSettled([
            // TODO lo que puede pasar de 1000 filas va por `fetchAll`: PostgREST
            // corta ahí en silencio, sin error y sin aviso. Leer `profiles` de un
            // tirón hacía que, pasadas las mil personas, campañas ENTERAS
            // desaparecieran del tablero (salían con 0 gente aunque tuvieran
            // decenas de aprendices activos), y lo mismo con las asignaciones,
            // los certificados y el temario.
            fetchAll<{
              id: string; display_name: string | null; role: string;
              campaign_id: string | null; avatar_url: string | null; created_at: string | null;
              job_title: string | null; country: string | null; email: string | null;
              operation_id: string | null; area_id: string | null; is_client: boolean | null;
              org_id: string | null;
            }>('profiles', 'id, display_name, role, campaign_id, avatar_url, created_at, job_title, country, email, operation_id, area_id, is_client, org_id'),
            supabase.from('campaigns').select('id, name, deleted_at, is_test, org_id').order('name'),
            fetchAll<{
              id: string; title_es: string; title_en: string | null; title_pt: string | null;
              campaign_id: string | null; is_published: boolean; icon: string | null; deleted_at: string | null;
              shared_with_group: boolean | null;
            }>('courses', 'id, title_es, title_en, title_pt, campaign_id, is_published, icon, deleted_at, shared_with_group'),
            fetchAll<{ course_id: string; user_id: string; is_mandatory: boolean; assigned_at: string | null }>(
              'course_assignments', 'course_id, user_id, is_mandatory, assigned_at',
            ),
            getAllAudiences(),
            // Por RPC, no contra la tabla: el alcance lo decide la base (ver
            // fetchCertificates). Es lo que devolvió al tablero los diplomas de
            // gente que sí se ve en todas las demás columnas.
            fetchCertificates(),
            // El temario: qué módulos vivos tiene cada curso. Es el denominador
            // de la finalización, así que sin esto no se puede dar por
            // terminado ningún curso (ver `isCourseCompleted`).
            fetchAll<{
              id: string; slug: string; title_es: string; title_en: string | null; title_pt: string | null;
              sort_order: number | null; course_id: string | null; deleted_at: string | null;
              is_published: boolean;
            }>('modules', 'id, slug, title_es, title_en, title_pt, sort_order, course_id, deleted_at, is_published'),
            // Lo que cada persona lleva completado, leído de la MISMA fuente que
            // ve el aprendiz en su panel (`user_progress.completed_modules`).
            fetchAll<{ user_id: string; completed_modules: string[] | null }>(
              'user_progress', 'user_id, completed_modules',
            ),
            getPendingAttempts({ excludeSuperadmins }),
            // El plazo del curso va en SU PROPIA consulta a propósito: si el SQL
            // de `deadline_*` todavía no se corrió, PostgREST responde 400 por
            // columna inexistente. Pedirlo junto al catálogo se llevaría por
            // delante el tablero entero; aquí solo se queda vacía la columna
            // "Vencidos" y todo lo demás sigue igual.
            supabase.from('courses').select('id, deadline_mode, deadline_days, deadline_date, deadline_blocks'),
            // ── Las etapas del curso que NO son módulos ────────────────────
            // Simuladores, mundo y examen final: sin esto el tablero daba por
            // terminado a quien solo había hecho el temario, mientras su propia
            // pantalla le decía que le faltaba la mitad para certificarse.
            // Cada una va suelta y con `allSettled`: si a alguna le falta la
            // tabla o el permiso, el curso se mide por módulos como antes.
            supabase.from('scenarios').select('slug, course_id, pass_score').eq('is_published', true).is('deleted_at', null),
            supabase.from('choice_scenarios').select('slug, course_id, pass_score').eq('is_published', true).is('deleted_at', null),
            fetchAll<{ user_id: string; scenario_slug: string | null; score: number | null; created_at: string }>(
              'simulator_attempts', 'user_id, scenario_slug, score, created_at',
            ),
            supabase.from('worlds').select('id, course_id').eq('status', 'published'),
            fetchAll<{ id: string; world_id: string }>('world_levels', 'id, world_id'),
            fetchAll<{ user_id: string; world_id: string; level_id: string; completed: boolean; completed_at: string | null; started_at: string }>(
              'world_progress', 'user_id, world_id, level_id, completed, completed_at, started_at',
            ),
            supabase.from('course_exams').select('course_id, pass_score').eq('is_published', true),
            fetchAll<{ user_id: string; course_id: string; passed: boolean | null; score_pct: number | null; status: string; started_at: string; submitted_at: string | null }>(
              'exam_attempts', 'user_id, course_id, passed, score_pct, status, started_at, submitted_at',
            ),
            fetchAll<{ user_id: string; world_id: string; level_id: string; completed_at: string }>(
              'world_level_attempts', 'user_id, world_id, level_id, completed_at',
            ),
          ]);
        if (cancelled) return;

        const ok = <T,>(r: PromiseSettledResult<{ data: T[] | null; error: unknown }>): T[] =>
          r.status === 'fulfilled' && !r.value.error ? (r.value.data ?? []) : [];

        /** Resultado de `fetchAll`: no trae `{data,error}`, y si falló hay que
            saberlo — un catálogo vacío por error se lee igual que uno vacío de
            verdad, y así es como el tablero "perdía" una campaña sin decir nada. */
        const rowsOf = <T,>(r: PromiseSettledResult<{ rows: T[]; partial: boolean }>): T[] =>
          r.status === 'fulfilled' ? r.value.rows : [];

        // Sin gente no hay tablero: si la lectura de perfiles se cayó, se avisa
        // en vez de pintar ceros que parecen un dato.
        if (profilesRes.status === 'rejected') {
          throw profilesRes.reason instanceof Error
            ? profilesRes.reason
            : new Error(String(profilesRes.reason));
        }
        // LOS CLIENTES NO ENTRAN EN NINGUNA CIFRA DE ESTE TABLERO.
        // Son gente de paso —alguien de fuera al que se le dio un curso suelto
        // para que conociera el sitio—, no plantilla: si cuentan, el
        // cumplimiento, el avance medio y el total de personas hablan de una
        // compañía que no es esta. Su progreso individual sigue existiendo y se
        // ve en su ficha; lo que no hace es promediar con el de nadie.
        // ORGANIZACIÓN ACTIVA: el superadmin ve todas las orgs, pero el tablero
        // es de la que tiene elegida en el selector (LATAM o Brasil). Sin esto,
        // cambiar de org no cambiaba ni una cifra. Al resto del staff ya se lo
        // acota la base (solo su org).
        const activeOrgId = isSuperAdmin ? await getActiveOrgId() : null;
        const profileRows = rowsOf(profilesRes).filter(
          (p) => p.is_client !== true && (!activeOrgId || p.org_id === activeOrgId),
        );
        // Las campañas también se borran en suave: una eliminada no puede seguir
        // ofreciéndose como filtro ni ponerle nombre a una columna del Excel.
        const campaignAll = ok<{ id: string; name: string; deleted_at: string | null; is_test?: boolean | null; org_id?: string | null }>(campaignsRes as never)
          .filter((c) => !c.deleted_at);
        const orgCampaignIds = activeOrgId
          ? new Set(campaignAll.filter((c) => c.org_id === activeOrgId).map((c) => c.id))
          : null;
        const campaignRaw = orgCampaignIds ? campaignAll.filter((c) => orgCampaignIds.has(c.id)) : campaignAll;
        // Ids de prueba a esconder. Si `is_test` todavía no existe en la base,
        // el conjunto queda vacío y el tablero se comporta como siempre.
        const hiddenUnitIds = new Set(hideTest ? await getTestUnitIds() : []);
        const hiddenCampaignIds = new Set(
          hideTest ? campaignRaw.filter((c) => c.is_test === true).map((c) => c.id) : [],
        );
        const campaignRows = campaignRaw
          .filter((c) => !hiddenCampaignIds.has(c.id))
          .map(({ id, name }) => ({ id, name }));
        const courseRows = rowsOf(coursesRes)
          .filter((c) => !c.campaign_id || !hiddenCampaignIds.has(c.campaign_id))
          // De la org activa, más los que la otra org del grupo le comparte (su
          // gente también los cursa).
          .filter((c) => !orgCampaignIds || (!!c.campaign_id && orgCampaignIds.has(c.campaign_id)) || c.shared_with_group === true);
        const assignRows = rowsOf(assignRes);
        const audiences = audienceRes.status === 'fulfilled' ? audienceRes.value : new Map();
        const moduleRows = rowsOf(modulesRes);
        // `fetchAll` no devuelve `{data,error}`: se lee aparte.
        const progressRows =
          progressRes.status === 'fulfilled' ? progressRes.value.rows : [];
        // Certificados: `ok` distingue "no hay ninguno" de "no pude leerlos".
        const certResult = certsRes.status === 'fulfilled'
          ? certsRes.value
          : { rows: [] as RawCertificate[], ok: false };
        const certRows = certResult.rows;
        setCertificatesKnown(certResult.ok);
        // Plazo por curso. Si la consulta falló (columnas aún sin crear) el mapa
        // queda vacío y `courseDueMs` devuelve null para todos: sin vencidos.
        const deadlineOf = new Map<string, CourseDeadline>(
          ok<{ id: string } & CourseDeadline>(deadlineRes as never).map((r) => [r.id, r]),
        );

        const attemptRows: RawAttempt[] =
          attemptsRes.status === 'fulfilled' && !attemptsRes.value.error
            ? ((attemptsRes.value.data ?? []) as RawAttempt[])
            : [];

        // Si NINGUNA de las dos tablas de asignación respondió, no se puede
        // hablar de "asignados": el tablero lo dice en vez de inventar un 0.
        // Ya no hay `{data,error}` que mirar: `fetchAll` lanza, así que un
        // rechazo es la única forma de "no pude leer".
        const noAssignData =
          assignRes.status !== 'fulfilled' && audienceRes.status !== 'fulfilled';
        setAssignmentsKnown(!noAssignData);

        const campaignName = new Map(campaignRows.map((c) => [c.id, c.name]));
        // El correo sale de `profiles.email` (2026-08-31_profiles_email.sql). Antes
        // se leía de `user_temp_credentials`, que solo tiene fila mientras la
        // persona no haya entrado: quien ya usaba la plataforma salía sin correo.
        const emailOf = new Map(
          profileRows.flatMap((p) => (p.email ? [[p.id, p.email] as const] : [])),
        );

        // ── Temario: módulos vivos por curso, y el índice para leer el
        //    progreso (que guarda UUID y slug indistintamente) ─────────────
        const modulesPerCourse = new Map<string, number>();
        // Temario por curso, en orden: es lo que se pinta al abrir un curso.
        const syllabus: Record<string, ProgramModule[]> = {};
        // Cualquier clave con la que el progreso pueda nombrar un módulo (UUID o
        // slug) apunta a su UUID real y a su curso. `completed_modules` guarda
        // las dos formas —doble escritura del cliente— y sin normalizar, el
        // mismo módulo se contaría dos veces y el curso saldría "terminado".
        const moduleIdOfKey = new Map<string, string>();
        const courseOfModuleId = new Map<string, string>();
        // Borrar un curso no marca sus módulos, pero deja de haber contenido:
        // igual que en el panel de entregas, curso eliminado ⇒ sus módulos
        // tampoco cuentan, aunque el módulo siga vivo por su cuenta.
        const deletedCourseIds = new Set(
          courseRows.filter((c) => c.deleted_at).map((c) => c.id),
        );
        const isLiveModule = (m: { deleted_at: string | null; course_id: string | null }) =>
          !m.deleted_at && !(m.course_id && deletedCourseIds.has(m.course_id));

        // Ids de TODOS los módulos vivos, tengan curso o no: es contra esto que
        // se juzga si unas horas de estudio siguen valiendo.
        const liveModules = new Set<string>();
        for (const m of moduleRows) if (isLiveModule(m)) liveModules.add(m.id);

        for (const m of moduleRows) {
          if (!isLiveModule(m) || !m.course_id || !m.is_published) continue;
          modulesPerCourse.set(m.course_id, (modulesPerCourse.get(m.course_id) ?? 0) + 1);
          (syllabus[m.course_id] ??= []).push({
            id: m.id,
            title: pickTitle(m, lang),
            order: m.sort_order ?? 0,
          });
          courseOfModuleId.set(m.id, m.course_id);
          moduleIdOfKey.set(m.id, m.id);
          if (m.slug) moduleIdOfKey.set(m.slug, m.id);
        }

        // Módulos completados por persona y curso, contados por módulo único.
        const doneByUserCourse = new Map<string, Set<string>>();
        for (const row of progressRows) {
          for (const key of row.completed_modules ?? []) {
            const moduleId = moduleIdOfKey.get(key);
            const courseId = moduleId ? courseOfModuleId.get(moduleId) : undefined;
            if (!moduleId || !courseId) continue;
            const mapKey = `${row.user_id}|${courseId}`;
            const set = doneByUserCourse.get(mapKey) ?? new Set<string>();
            set.add(moduleId);
            doneByUserCourse.set(mapKey, set);
          }
        }

        // ── Cursos vivos ──────────────────────────────────────────────────
        const courseById = new Map<string, ProgramCourse>();
        for (const c of courseRows) {
          if (c.deleted_at) continue; // borrado suave: fuera de todas las cuentas
          courseById.set(c.id, {
            id: c.id,
            title: pickTitle(c, lang),
            campaignId: c.campaign_id,
            campaignName: c.campaign_id ? campaignName.get(c.campaign_id) ?? null : null,
            published: c.is_published,
            icon: c.icon,
            modules: modulesPerCourse.get(c.id) ?? 0,
            mandatory: false,
            byRule: false,
            directAssigned: 0,
            assigned: 0, started: 0, completed: 0, certified: 0,
            avgScore: null, pendingReviews: 0, overdue: 0, lastActivity: null,
          });
        }

        // ── Personas ──────────────────────────────────────────────────────
        const personById = new Map<string, ProgramPerson>();
        for (const p of profileRows) {
          const role = (p.role === 'superadmin' || p.role === 'capacitador' ? p.role : 'learner') as ProgramPerson['role'];
          if (excludeSuperadmins && role === 'superadmin') continue;
          // Gente del entorno de pruebas: fuera de la tabla, de los KPIs y del
          // Excel mientras el Modo pruebas esté apagado.
          if (p.campaign_id && hiddenCampaignIds.has(p.campaign_id)) continue;
          // … y la del CR de pruebas, que es el que reemplaza al programa.
          if (p.operation_id && hiddenUnitIds.has(p.operation_id)) continue;
          personById.set(p.id, {
            id: p.id,
            name: p.display_name || emailOf.get(p.id) || p.id.slice(0, 8),
            email: emailOf.get(p.id) ?? null,
            role,
            campaignId: p.campaign_id,
            campaignName: p.campaign_id ? campaignName.get(p.campaign_id) ?? null : null,
            jobTitle: p.job_title?.trim() || null,
            country: p.country?.trim() || null,
            operationId: p.operation_id ?? null,
            areaId: p.area_id ?? null,
            avatarUrl: p.avatar_url,
            createdAt: p.created_at,
            assigned: 0, mandatory: 0, mandatoryDone: 0, started: 0, completed: 0, certified: 0,
            modulesDone: 0, modulesTotal: 0,
            avgScore: null, pendingReviews: 0, overdue: 0, lastActivity: null, studyMs: 0,
          });
        }

        // ── Celdas persona × curso ────────────────────────────────────────
        const cellMap = new Map<string, ProgramCell & { scoreSum: number; assignedAt: string | null }>();
        const cellOf = (userId: string, courseId: string) => {
          const key = `${userId}|${courseId}`;
          let cell = cellMap.get(key);
          if (!cell) {
            const done = doneByUserCourse.get(`${userId}|${courseId}`)?.size ?? 0;
            cell = {
              userId, courseId, assigned: false, viaRule: false, mandatory: false, started: false, score: null,
              attempts: 0, pending: 0,
              modulesDone: done,
              modulesTotal: modulesPerCourse.get(courseId) ?? 0,
              // Las otras etapas se rellenan más abajo, cuando ya existen todas
              // las celdas: dependen de escenarios, mundos y exámenes que se
              // leyeron en la misma tanda.
              practiceTotal: 0, practiceDone: 0,
              worldTotal: 0, worldDone: 0,
              examTotal: 0, examDone: 0,
              lastAt: null, certifiedAt: null, certId: null,
              dueAt: null, overdue: false,
              scoreSum: 0,
              assignedAt: null,
            };
            cellMap.set(key, cell);
          }
          return cell;
        };

        // El progreso previo no desaparece al retirar una asignación.
        for (const key of doneByUserCourse.keys()) {
          const [userId, courseId] = key.split('|');
          if (personById.has(userId) && courseById.has(courseId)) cellOf(userId, courseId);
        }

        // Asignación directa.
        for (const a of assignRows) {
          if (!personById.has(a.user_id) || !courseById.has(a.course_id)) continue;
          const cell = cellOf(a.user_id, a.course_id);
          cell.assigned = true;
          if (a.is_mandatory) cell.mandatory = true;
          cell.assignedAt = earliestDate(cell.assignedAt, a.assigned_at);
        }
        // Asignación por REGLA país/área/CR: le toca a quien la cumpla. Es la
        // única vía de entrega en bloque desde que se retiró el programa; contar
        // `course_campaigns` aquí daba "asignado" a gente a la que el curso ya
        // no le llega. Solo cursos publicados: un borrador no le llega a nadie.
        for (const course of courseById.values()) {
          const rule = audiences.get(course.id);
          if (!rule || !course.published) continue;
          for (const person of personById.values()) {
            if (!matchesAudience(rule, {
              country: person.country, operation_id: person.operationId, area_id: person.areaId,
            })) continue;
            course.byRule = true;
            const cell = cellOf(person.id, course.id);
            cell.assigned = true;
            cell.viaRule = true;
            if (rule.isMandatory) cell.mandatory = true;
          }
        }

        // Certificados.
        const certificateRows: CertificateRow[] = [];
        for (const c of certRows) {
          if (!personById.has(c.user_id) || !courseById.has(c.course_id)) continue;
          const cell = cellOf(c.user_id, c.course_id);
          cell.certifiedAt = c.issued_at;
          cell.certId = c.cert_id;
          certificateRows.push({
            userId: c.user_id, courseId: c.course_id,
            certId: c.cert_id, score: c.score, issuedAt: c.issued_at,
          });
        }

        // Actividad real (entregas).
        //
        // BORRADO SUAVE, segunda pasada: `getPendingAttempts` ya descarta lo que
        // sabe eliminado, pero solo puede saberlo si logra LEER la fila del
        // módulo. Cuando la RLS ya se la oculta, el intento llega "huérfano"
        // (module_id que no existe, curso en blanco) y se colaba al Excel como
        // una fila sin curso ni módulo. Aquí se contrasta contra el catálogo vivo
        // que este mismo tablero acaba de traer: si el intento dice pertenecer a
        // un módulo o a un curso que no está vivo, no entra. Los intentos
        // antiguos que no dicen a qué módulo pertenecen se conservan, como antes:
        // de esos no se puede afirmar que estén borrados.
        const activityRows: ActivityRow[] = [];
        for (const a of attemptRows) {
          const person = personById.get(a.user_id);
          if (!person) continue;
          // Contra `liveModules`, no contra el índice del temario: un módulo vivo
          // sin curso (biblioteca) no está en el temario y sus entregas sí valen.
          if (a.module_id && !liveModules.has(a.module_id)) continue;
          if (a.course_id && !courseById.has(a.course_id)) continue;
          const at = new Date(a.started_at).getTime();
          const when = Number.isNaN(at) ? null : at;
          activityRows.push({
            id: a.id,
            userId: a.user_id,
            userName: person.name,
            courseId: a.course_id ?? null,
            courseTitle: a.course_title ?? null,
            moduleTitle: rowText(a.module) || null,
            sectionTitle: rowText(a.section, 'heading') || null,
            gameType: a.game_type,
            score: a.score,
            at: when ?? 0,
            evaluated: !!a.is_evaluated,
            isReview: !!a.is_review,
          });
          if (when && (!person.lastActivity || when > person.lastActivity)) person.lastActivity = when;
          if (!a.course_id || !courseById.has(a.course_id)) continue;
          const cell = cellOf(a.user_id, a.course_id);
          cell.started = true;
          cell.attempts++;
          cell.scoreSum += a.score;
          if (!a.is_evaluated) cell.pending++;
          if (when && (!cell.lastAt || when > cell.lastAt)) cell.lastAt = when;
        }

        /* ── Las otras etapas del curso, celda a celda ─────────────────────
           Mismo criterio que ve el aprendiz: una práctica está hecha cuando su
           mejor puntaje llega al umbral del escenario, el mundo cuando están
           todos sus niveles, el examen cuando está aprobado. Todo se resuelve
           con las funciones de src/lib/courseJourney para que el tablero y la
           pantalla del curso no puedan discrepar.

           `journeyKnown` distingue "este curso no tiene más etapas" de "no pude
           leerlas": sin esa diferencia, un fallo de permisos subiría las tasas
           de finalización sin que nadie se enterara. */
        const scnRows = [
          ...ok<{ slug: string; course_id: string | null; pass_score: number | null }>(callScnRes as never),
          ...ok<{ slug: string; course_id: string | null; pass_score: number | null }>(choiceScnRes as never),
        ];
        const journeyKnown =
          callScnRes.status === 'fulfilled' && choiceScnRes.status === 'fulfilled' &&
          simAttemptRes.status === 'fulfilled' && worldRes.status === 'fulfilled' &&
          worldLevelRes.status === 'fulfilled' && worldProgressRes.status === 'fulfilled' &&
          examRes.status === 'fulfilled' && examAttemptRes.status === 'fulfilled' &&
          !callScnRes.value.error && !choiceScnRes.value.error &&
          !worldRes.value.error && !examRes.value.error &&
          modulesRes.status === 'fulfilled' && !modulesRes.value.partial &&
          progressRes.status === 'fulfilled' && !progressRes.value.partial &&
          !simAttemptRes.value.partial && !worldLevelRes.value.partial &&
          !worldProgressRes.value.partial && !examAttemptRes.value.partial &&
          worldAttemptRes.status === 'fulfilled' && !worldAttemptRes.value.partial;
        setJourneyKnown(journeyKnown);

        const scenariosByCourse = new Map<string, Array<{ slug: string; passScore: number }>>();
        for (const r of scnRows) {
          if (!r.course_id || !courseById.has(r.course_id)) continue;
          const arr = scenariosByCourse.get(r.course_id) ?? [];
          arr.push({ slug: r.slug, passScore: r.pass_score ?? 70 });
          scenariosByCourse.set(r.course_id, arr);
        }
        // Mejor puntaje por persona y escenario.
        const simBest = new Map<string, Record<string, number>>();
        const startedByUserCourse = new Set<string>();
        const markActivity = (userId: string, courseId: string, timestamp: string | null) => {
          if (!personById.has(userId) || !courseById.has(courseId)) return;
          const cell = cellOf(userId, courseId);
          startedByUserCourse.add(`${userId}|${courseId}`);
          const at = timestamp ? Date.parse(timestamp) : NaN;
          if (Number.isFinite(at) && (!cell.lastAt || at > cell.lastAt)) cell.lastAt = at;
        };
        const courseByScenario = new Map(scnRows.filter(r => r.course_id).map(r => [r.slug, r.course_id!]));
        for (const a of rowsOf(simAttemptRes)) {
          if (!a.scenario_slug) continue;
          const simCourse = courseByScenario.get(a.scenario_slug);
          if (simCourse && personById.has(a.user_id)) {
            markActivity(a.user_id, simCourse, a.created_at);
          }
          const byUser = simBest.get(a.user_id) ?? {};
          byUser[a.scenario_slug] = Math.max(byUser[a.scenario_slug] ?? 0, a.score ?? 0);
          simBest.set(a.user_id, byUser);
        }

        const worldsOfCourse = new Map<string, string[]>();
        const courseOfWorld = new Map<string, string>();
        for (const w of ok<{ id: string; course_id: string | null }>(worldRes as never)) {
          if (w.course_id) {
            courseOfWorld.set(w.id, w.course_id);
            const ids = worldsOfCourse.get(w.course_id) ?? [];
            ids.push(w.id);
            worldsOfCourse.set(w.course_id, ids);
          }
        }
        const levelsPerWorld = new Map<string, number>();
        const liveWorldLevels = new Map<string, string>();
        for (const l of rowsOf(worldLevelRes)) {
          liveWorldLevels.set(l.id, l.world_id);
          levelsPerWorld.set(l.world_id, (levelsPerWorld.get(l.world_id) ?? 0) + 1);
        }
        // Niveles ÚNICOS terminados por persona y mundo (una fila repetida no
        // puede contar dos veces).
        const worldDoneBy = new Map<string, Set<string>>();
        for (const p2 of rowsOf(worldProgressRes)) {
          if (liveWorldLevels.get(p2.level_id) !== p2.world_id) continue;
          const worldCourse = courseOfWorld.get(p2.world_id);
          if (worldCourse && personById.has(p2.user_id)) {
            markActivity(p2.user_id, worldCourse, p2.completed_at ?? p2.started_at);
          }
          if (!p2.completed) continue;
          const key = `${p2.user_id}|${p2.world_id}`;
          const set = worldDoneBy.get(key) ?? new Set<string>();
          set.add(p2.level_id);
          worldDoneBy.set(key, set);
        }
        for (const a of rowsOf(worldAttemptRes)) {
          const worldCourse = courseOfWorld.get(a.world_id);
          if (worldCourse && liveWorldLevels.get(a.level_id) === a.world_id) {
            markActivity(a.user_id, worldCourse, a.completed_at);
          }
        }

        const examMinOf = new Map<string, number>();
        for (const e of ok<{ course_id: string; pass_score: number | null }>(examRes as never)) {
          examMinOf.set(e.course_id, e.pass_score ?? 80);
        }
        const examBestOf = new Map<string, number>();
        for (const a of rowsOf(examAttemptRes)) {
          if (examMinOf.has(a.course_id) && personById.has(a.user_id)) {
            markActivity(a.user_id, a.course_id, a.submitted_at ?? a.started_at);
          }
          if (a.status !== 'submitted') continue;
          const key = `${a.user_id}|${a.course_id}`;
          const score = a.passed ? 100 : (a.score_pct ?? 0);
          examBestOf.set(key, Math.max(examBestOf.get(key) ?? 0, score));
        }

        for (const cell of cellMap.values()) {
          cell.journeyKnown = journeyKnown;
          const scns = scenariosByCourse.get(cell.courseId) ?? [];
          cell.practiceTotal = scns.length;
          cell.practiceDone = countPracticeDone(scns, simBest.get(cell.userId) ?? {});

          const worldIds = worldsOfCourse.get(cell.courseId) ?? [];
          const w = worldStage(
            worldIds.reduce((sum, id) => sum + (levelsPerWorld.get(id) ?? 0), 0),
            worldIds.reduce((sum, id) => sum + (worldDoneBy.get(`${cell.userId}|${id}`)?.size ?? 0), 0),
          );
          cell.worldTotal = w.total;
          cell.worldDone = w.done;

          const examMin = examMinOf.get(cell.courseId);
          cell.examTotal = examMin === undefined ? 0 : 1;
          cell.examDone =
            examMin !== undefined && (examBestOf.get(`${cell.userId}|${cell.courseId}`) ?? 0) >= examMin
              ? 1
              : 0;
        }

        // ── Cierre de cuentas por celda, persona y curso ──────────────────
        // Un solo "ahora" para toda la pasada: si se leyera el reloj por celda,
        // dos filas de la misma carga podrían caer a lados distintos del plazo.
        const now = Date.now();
        const finalCells: ProgramCell[] = [];
        for (const cell of cellMap.values()) {
          // "Iniciado" no puede depender solo de haber ENTREGADO algo: un módulo
          // de solo lectura se completa sin generar entrega, y un certificado
          // implica haber hecho el curso entero. Sin esto salían cursos con más
          // completados que iniciados, que es imposible de explicar.
          if (cell.modulesDone > 0 || cell.certifiedAt || startedByUserCourse.has(`${cell.userId}|${cell.courseId}`)) cell.started = true;
          const { scoreSum, assignedAt, ...rest } = cell;
          const score = cell.attempts > 0 ? Math.round(scoreSum / cell.attempts) : null;
          // Vencido = tiene plazo, ya pasó, le está asignado y NO lo terminó.
          // Sin asignación no hay plazo que exigir (curso de catálogo suelto).
          rest.dueAt = cell.assigned
            ? courseDueMs(deadlineOf.get(cell.courseId), assignedAt)
            : null;
          rest.overdue =
            rest.dueAt !== null &&
            rest.dueAt < now &&
            !isCourseCompleted({ ...rest, score });
          finalCells.push({ ...rest, score });

          const person = personById.get(cell.userId);
          const course = courseById.get(cell.courseId);
          if (!person || !course) continue;

          if (cell.assigned) {
            person.assigned++;
            course.assigned++;
            if (!cell.viaRule) course.directAssigned++;
          }
          if (rest.overdue) { person.overdue++; course.overdue++; }
          if (cell.mandatory) { person.mandatory++; course.mandatory = true; }
          if (cell.started) { person.started++; course.started++; }
          if (cell.certifiedAt) { person.certified++; course.certified++; }
          person.pendingReviews += cell.pending;
          course.pendingReviews += cell.pending;
          // Avance de temario: módulos hechos sobre los que trae el curso.
          person.modulesDone += cell.modulesDone;
          person.modulesTotal += cell.assigned || cell.started ? cell.modulesTotal : 0;
          // Terminado = certificado o temario completo (ver isCourseCompleted).
          if (isCourseCompleted({ ...rest, score })) {
            person.completed++;
            course.completed++;
            if (cell.mandatory) person.mandatoryDone++;
          }
          if (cell.lastAt && (!course.lastActivity || cell.lastAt > course.lastActivity)) {
            course.lastActivity = cell.lastAt;
          }
          if (cell.lastAt && (!person.lastActivity || cell.lastAt > person.lastActivity)) person.lastActivity = cell.lastAt;
        }

        // Promedios: se calculan sobre las entregas, no sobre las celdas, para
        // que un curso con muchas actividades pese lo que de verdad pesa.
        const personScore = new Map<string, { sum: number; n: number }>();
        const courseScore = new Map<string, { sum: number; n: number }>();
        for (const a of activityRows) {
          const ps = personScore.get(a.userId) ?? { sum: 0, n: 0 };
          ps.sum += a.score; ps.n++;
          personScore.set(a.userId, ps);
          if (!a.courseId) continue;
          const cs = courseScore.get(a.courseId) ?? { sum: 0, n: 0 };
          cs.sum += a.score; cs.n++;
          courseScore.set(a.courseId, cs);
        }
        for (const p of personById.values()) {
          const s = personScore.get(p.id);
          p.avgScore = s && s.n > 0 ? Math.round(s.sum / s.n) : null;
        }
        for (const c of courseById.values()) {
          const s = courseScore.get(c.id);
          c.avgScore = s && s.n > 0 ? Math.round(s.sum / s.n) : null;
        }

        for (const list of Object.values(syllabus)) list.sort((a, b) => a.order - b.order);
        setLiveModuleIds(liveModules);
        setModulesByCourse(syllabus);
        setDoneModules(
          Object.fromEntries([...doneByUserCourse.entries()].map(([k, v]) => [k, [...v]])),
        );

        setPeople([...personById.values()]);
        setCourses([...courseById.values()]);
        setCells(finalCells);
        setCampaigns(campaignRows);
        setActivity(activityRows.sort((a, b) => b.at - a.at));
        setCertificates(certificateRows);
      } catch (e) {
        if (!cancelled) {
          console.error('useProgramData:', e);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [lang, excludeSuperadmins, nonce, enabled]);

  /* ── Tiempo de estudio (diferido) ───────────────────────────────────────
     `module_time` tiene una fila por persona y módulo: en un sitio grande son
     decenas de miles. Por eso NO viaja en la carga inicial — se pide cuando el
     tablero lo necesita y se avisa si llegó al techo. */
  const loadStudyTime = useCallback(() => {
    if (studyStarted.current) return;
    studyStarted.current = true;
    setStudy((s) => ({ ...s, loading: true }));
    void (async () => {
      try {
        // Se pide `module_id` además del tiempo: sin él no hay forma de saber si
        // esas horas son de un módulo que todavía existe.
        const { rows, partial } = await fetchAll<{
          user_id: string; module_id: string; elapsed_ms: number;
        }>('module_time', 'user_id, module_id, elapsed_ms', STUDY_MAX_ROWS);
        setStudyRows(rows);
        setStudy({ loading: false, loaded: true, partial });
      } catch (e) {
        console.warn('loadStudyTime:', e);
        setStudyRows([]);
        setStudy({ loading: false, loaded: true, partial: false });
      }
    })();
  }, []);

  /* Horas por persona, contando SOLO módulos vivos. Mientras el catálogo no haya
     llegado no se suma nada: es preferible un tablero que dice "cargando" a uno
     que enseña horas de contenido borrado. */
  const { studyMs, studyTotalMs } = useMemo(() => {
    const map: Record<string, number> = {};
    let total = 0;
    if (liveModuleIds.size > 0) {
      for (const r of studyRows) {
        if (!liveModuleIds.has(r.module_id)) continue;
        const ms = Number(r.elapsed_ms) || 0;
        map[r.user_id] = (map[r.user_id] ?? 0) + ms;
        total += ms;
      }
    }
    return { studyMs: map, studyTotalMs: total };
  }, [studyRows, liveModuleIds]);

  const studyByUserCourse = useMemo(() => {
    const courseOfModule = new Map<string, string>();
    for (const [courseId, mods] of Object.entries(modulesByCourse)) {
      for (const m of mods) courseOfModule.set(m.id, courseId);
    }
    const out: Record<string, Record<string, number>> = {};
    for (const r of studyRows) {
      const courseId = courseOfModule.get(r.module_id);
      if (!courseId) continue;
      const byCourse = (out[r.user_id] ??= {});
      byCourse[courseId] = (byCourse[courseId] ?? 0) + (Number(r.elapsed_ms) || 0);
    }
    return out;
  }, [studyRows, modulesByCourse]);

  /* ── Encuestas (diferido) ───────────────────────────────────────────────
     Una llamada por curso, de a 5, y solo de los cursos visibles. Si el SQL de
     la encuesta no está corrido, cada llamada devuelve resultados vacíos y el
     panel lo dice sin romperse. */
  const loadSurveys = useCallback((courseIds: string[]) => {
    const scope = [...new Set(courseIds)].sort().join(',');
    if (surveysRun.current && surveysScope.current === scope) return surveysRun.current;
    if (courseIds.length === 0) return Promise.resolve({});
    surveysScope.current = scope;
    const version = ++surveysVersion.current;
    setSurveyState({ loading: true, loaded: false });
    const run = (async () => {
      const out: Record<string, SurveyResults> = {};
      const queue = [...courseIds];
      const worker = async () => {
        for (;;) {
          const id = queue.shift();
          if (!id) return;
          out[id] = await getSurveyResults(id);
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker));
      if (surveysVersion.current !== version) return out;
      setSurveyMap(out);
      setSurveyState({ loading: false, loaded: true });
      return out;
    })();
    surveysRun.current = run;
    return run;
  }, []);

  /* ── Exámenes finales (diferido) ────────────────────────────────────────
     `get_exam_results` es por curso y devuelve una fila por persona con sus
     intentos, su mejor nota y los dominios en los que falló. Si el curso no
     tiene examen (o el SQL no está corrido) devuelve lista vacía. */
  const loadExams = useCallback((courseIds: string[]) => {
    const scope = [...new Set(courseIds)].sort().join(',');
    if (examsRun.current && examsScope.current === scope) return examsRun.current;
    if (courseIds.length === 0) return Promise.resolve({});
    examsScope.current = scope;
    const version = ++examsVersion.current;
    setExamState({ loading: true, loaded: false });
    const run = (async () => {
      const out: Record<string, ExamResultRow[]> = {};
      const queue = [...courseIds];
      const worker = async () => {
        for (;;) {
          const id = queue.shift();
          if (!id) return;
          try {
            const rows = await getExamResults(id);
            if (rows.length > 0) out[id] = rows;
          } catch {
            // Curso sin examen o sin permiso: no es un error del tablero.
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker));
      if (examsVersion.current !== version) return out;
      setExamMap(out);
      setExamState({ loading: false, loaded: true });
      return out;
    })();
    examsRun.current = run;
    return run;
  }, []);

  // El tiempo de estudio entra en las personas sin rehacer toda la carga.
  const peopleWithStudy = useMemo(
    () => (study.loaded ? people.map((p) => ({ ...p, studyMs: studyMs[p.id] ?? 0 })) : people),
    [people, studyMs, study.loaded],
  );

  return {
    loading,
    error,
    people: peopleWithStudy,
    courses,
    cells,
    campaigns,
    activity,
    certificates,
    assignmentsKnown,
    certificatesKnown,
    journeyKnown,
    modulesByCourse,
    doneModules,
    study: { ...study, totalMs: studyTotalMs },
    studyByUserCourse,
    loadStudyTime,
    surveys: { ...surveyState, byCourse: surveyMap },
    loadSurveys,
    exams: { ...examState, byCourse: examMap },
    loadExams,
    reload,
  };
}

/** Forma cruda de una entrega tal como la devuelve `getPendingAttempts`. */
interface RawAttempt {
  id: string;
  user_id: string;
  course_id?: string | null;
  course_title?: string | null;
  /** UUID real del módulo. Sirve para descartar contenido ya borrado. */
  module_id?: string | null;
  game_type: string;
  score: number;
  started_at: string;
  is_evaluated?: boolean;
  is_review?: boolean;
  module?: { title_es: string } | null;
  section?: { heading_es: string } | null;
}

/* ── NPS ─────────────────────────────────────────────────────────────────────
   La pregunta 2 de la encuesta es "de 0 a 10, la experiencia general": la misma
   escala del NPS clásico. Promotores 9-10, pasivos 7-8, detractores 0-6.
   NPS = %promotores − %detractores, en el rango −100..100. */

export interface NpsBreakdown {
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
  /** null cuando nadie ha contestado: un NPS de 0 sin respuestas es mentira. */
  score: number | null;
}

export function npsFromHistogram(hist: Record<string, number> | undefined): NpsBreakdown {
  let promoters = 0, passives = 0, detractors = 0;
  for (const [value, count] of Object.entries(hist ?? {})) {
    const v = Number(value);
    const n = Number(count) || 0;
    if (!Number.isFinite(v) || n <= 0) continue;
    if (v >= 9) promoters += n;
    else if (v >= 7) passives += n;
    else detractors += n;
  }
  const total = promoters + passives + detractors;
  return {
    promoters,
    passives,
    detractors,
    total,
    score: total === 0 ? null : Math.round(((promoters - detractors) / total) * 100),
  };
}

/** Suma los histogramas de varios cursos para dar un NPS del programa entero. */
export function mergeNps(results: SurveyResults[]): NpsBreakdown {
  const merged: Record<string, number> = {};
  for (const r of results) {
    for (const [k, v] of Object.entries(r.q2_hist ?? {})) {
      merged[k] = (merged[k] ?? 0) + (Number(v) || 0);
    }
  }
  return npsFromHistogram(merged);
}
