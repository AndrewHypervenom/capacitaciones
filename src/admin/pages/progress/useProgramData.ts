// src/admin/pages/progress/useProgramData.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getPendingAttempts } from '@/services/activity.service';
import { getSurveyResults, type SurveyResults } from '@/services/survey.service';
import { getExamResults } from '@/services/exams.admin.service';
import type { ExamResultRow } from '@/types/exam';
import { useAuth } from '@/hooks/useAuth';
import { shouldHideTestData } from '@/stores/testModeStore';

/* ────────────────────────────────────────────────────────────────────────────
   Datos del Panorama de Progreso.

   Una sola carga que responde las preguntas de dirección: a cuánta gente llegó
   el programa, quiénes participaron de verdad, cómo van, cuántos se
   certificaron y qué opinan. Todo con las MISMAS fuentes que el resto del
   panel, para que ningún número se contradiga con otra pantalla:

     · profiles              → universo de personas (la RLS ya acota al capacitador)
     · courses               → universo de cursos vivos (sin borrado suave)
     · course_assignments    → cursos asignados a una persona
     · course_campaigns      → cursos asignados a una campaña entera
     · certifications        → certificados emitidos, con fecha y código
     · getPendingAttempts()  → actividad real: entregas, notas y qué falta evaluar
     · module_time           → tiempo activo (DIFERIDO: se pide aparte, es pesado)
     · get_course_survey_results → NPS y comentarios (DIFERIDO, por curso)

   Todo degrada solo: si una consulta falla por permisos o porque su SQL aún no
   está corrido, esa dimensión se queda vacía y el resto del tablero funciona.
   ──────────────────────────────────────────────────────────────────────────── */

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
  started: number;
  completed: number;
  certified: number;
  avgScore: number | null;
  pendingReviews: number;
  lastActivity: number | null;
}

/** Cruce persona × curso: la celda de la matriz exportable. */
export interface ProgramCell {
  userId: string;
  courseId: string;
  assigned: boolean;
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
  lastAt: number | null;
  certifiedAt: string | null;
  certId: string | null;
}

/**
 * ¿La persona TERMINÓ el curso?
 *
 * Certificado emitido, o el temario completo: todos los módulos del curso
 * marcados como completados. Nada más cuenta.
 *
 * La definición anterior —"tiene alguna entrega aprobada y nada pendiente de
 * evaluar"— daba por terminado un curso de cuarenta actividades a quien
 * resolvió una sola. Inflaba la tasa de finalización, que es justo la cifra que
 * se reporta hacia afuera. Un curso sin módulos (o del que no sabemos su
 * temario) NO se puede dar por terminado sin certificado: preferimos quedarnos
 * cortos a firmar un número que no es.
 */
export function isCourseCompleted(cell: ProgramCell): boolean {
  if (cell.certifiedAt) return true;
  return cell.modulesTotal > 0 && cell.modulesDone >= cell.modulesTotal;
}

/** Avance del temario, 0-100 (null si no se conoce el temario del curso). */
export function coursePct(cell: ProgramCell): number | null {
  if (cell.modulesTotal <= 0) return null;
  return Math.min(100, Math.round((cell.modulesDone / cell.modulesTotal) * 100));
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
  /** Temario de cada curso, en orden (para el detalle por módulo). */
  modulesByCourse: Record<string, ProgramModule[]>;
  /** Módulos completados, indexado por `${userId}|${courseId}`. */
  doneModules: Record<string, string[]>;
  /** Tiempo de estudio: estado de la carga diferida. */
  study: { loading: boolean; loaded: boolean; partial: boolean; totalMs: number };
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
  if (lang === 'en') return row.title_en || row.title_es;
  if (lang === 'pt') return row.title_pt || row.title_es;
  return row.title_es;
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

export function useProgramData(lang: Lang, excludeSuperadmins: boolean): ProgramData {
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

  const reload = useCallback(() => {
    studyStarted.current = false;
    surveysRun.current = null;
    examsRun.current = null;
    setStudy({ loading: false, loaded: false, partial: false });
    setSurveyState({ loading: false, loaded: false });
    setExamState({ loading: false, loaded: false });
    setSurveyMap({});
    setExamMap({});
    setStudyRows([]);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        // Todo en paralelo y con `allSettled`: una dimensión sin permiso no
        // puede tumbar el tablero entero.
        const [
          profilesRes, campaignsRes, coursesRes, assignRes, campAssignRes, certsRes, credsRes,
          modulesRes, progressRes, attemptsRes,
        ] = await Promise.allSettled([
            supabase.from('profiles').select('id, display_name, role, campaign_id, avatar_url, created_at, job_title, country'),
            supabase.from('campaigns').select('id, name, deleted_at, is_test').order('name'),
            supabase.from('courses').select('id, title_es, title_en, title_pt, campaign_id, is_published, icon, deleted_at'),
            supabase.from('course_assignments').select('course_id, user_id, is_mandatory'),
            supabase.from('course_campaigns').select('course_id, campaign_id, is_mandatory'),
            supabase.from('certifications').select('user_id, course_id, cert_id, score, issued_at'),
            supabase.from('user_temp_credentials').select('user_id, email'),
            // El temario: qué módulos vivos tiene cada curso. Es el denominador
            // de la finalización, así que sin esto no se puede dar por
            // terminado ningún curso (ver `isCourseCompleted`).
            supabase.from('modules').select('id, slug, title_es, title_en, title_pt, sort_order, course_id, deleted_at'),
            // Lo que cada persona lleva completado, leído de la MISMA fuente que
            // ve el aprendiz en su panel (`user_progress.completed_modules`).
            fetchAll<{ user_id: string; completed_modules: string[] | null }>(
              'user_progress', 'user_id, completed_modules',
            ),
            getPendingAttempts({ excludeSuperadmins }),
          ]);
        if (cancelled) return;

        const ok = <T,>(r: PromiseSettledResult<{ data: T[] | null; error: unknown }>): T[] =>
          r.status === 'fulfilled' && !r.value.error ? (r.value.data ?? []) : [];

        const profileRows = ok<{
          id: string; display_name: string | null; role: string;
          campaign_id: string | null; avatar_url: string | null; created_at: string | null;
          job_title: string | null; country: string | null;
        }>(profilesRes as never);
        // Las campañas también se borran en suave: una eliminada no puede seguir
        // ofreciéndose como filtro ni ponerle nombre a una columna del Excel.
        const campaignRaw = ok<{ id: string; name: string; deleted_at: string | null; is_test?: boolean | null }>(campaignsRes as never)
          .filter((c) => !c.deleted_at);
        // Ids de prueba a esconder. Si `is_test` todavía no existe en la base,
        // el conjunto queda vacío y el tablero se comporta como siempre.
        const hiddenCampaignIds = new Set(
          hideTest ? campaignRaw.filter((c) => c.is_test === true).map((c) => c.id) : [],
        );
        const campaignRows = campaignRaw
          .filter((c) => !hiddenCampaignIds.has(c.id))
          .map(({ id, name }) => ({ id, name }));
        const courseRows = ok<{
          id: string; title_es: string; title_en: string | null; title_pt: string | null;
          campaign_id: string | null; is_published: boolean; icon: string | null; deleted_at: string | null;
        }>(coursesRes as never)
          .filter((c) => !c.campaign_id || !hiddenCampaignIds.has(c.campaign_id));
        const assignRows = ok<{ course_id: string; user_id: string; is_mandatory: boolean }>(assignRes as never);
        const campAssignRows = ok<{ course_id: string; campaign_id: string; is_mandatory: boolean }>(campAssignRes as never);
        const moduleRows = ok<{
          id: string; slug: string; title_es: string; title_en: string | null; title_pt: string | null;
          sort_order: number | null; course_id: string | null; deleted_at: string | null;
        }>(modulesRes as never);
        // `fetchAll` no devuelve `{data,error}`: se lee aparte.
        const progressRows =
          progressRes.status === 'fulfilled' ? progressRes.value.rows : [];
        const certRows = ok<{
          user_id: string; course_id: string; cert_id: string; score: number; issued_at: string;
        }>(certsRes as never);
        const credRows = ok<{ user_id: string; email: string }>(credsRes as never);

        const attemptRows: RawAttempt[] =
          attemptsRes.status === 'fulfilled' && !attemptsRes.value.error
            ? ((attemptsRes.value.data ?? []) as RawAttempt[])
            : [];

        // Si NINGUNA de las dos tablas de asignación respondió, no se puede
        // hablar de "asignados": el tablero lo dice en vez de inventar un 0.
        const noAssignData =
          (assignRes.status !== 'fulfilled' || !!assignRes.value.error) &&
          (campAssignRes.status !== 'fulfilled' || !!campAssignRes.value.error);
        setAssignmentsKnown(!noAssignData);

        const campaignName = new Map(campaignRows.map((c) => [c.id, c.name]));
        const emailOf = new Map(credRows.map((c) => [c.user_id, c.email]));

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
          if (!isLiveModule(m) || !m.course_id) continue;
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
            assigned: 0, started: 0, completed: 0, certified: 0,
            avgScore: null, pendingReviews: 0, lastActivity: null,
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
          personById.set(p.id, {
            id: p.id,
            name: p.display_name || emailOf.get(p.id) || p.id.slice(0, 8),
            email: emailOf.get(p.id) ?? null,
            role,
            campaignId: p.campaign_id,
            campaignName: p.campaign_id ? campaignName.get(p.campaign_id) ?? null : null,
            jobTitle: p.job_title?.trim() || null,
            country: p.country?.trim() || null,
            avatarUrl: p.avatar_url,
            createdAt: p.created_at,
            assigned: 0, mandatory: 0, mandatoryDone: 0, started: 0, completed: 0, certified: 0,
            modulesDone: 0, modulesTotal: 0,
            avgScore: null, pendingReviews: 0, lastActivity: null, studyMs: 0,
          });
        }

        // ── Celdas persona × curso ────────────────────────────────────────
        const cellMap = new Map<string, ProgramCell & { scoreSum: number }>();
        const cellOf = (userId: string, courseId: string) => {
          const key = `${userId}|${courseId}`;
          let cell = cellMap.get(key);
          if (!cell) {
            const done = doneByUserCourse.get(`${userId}|${courseId}`)?.size ?? 0;
            cell = {
              userId, courseId, assigned: false, mandatory: false, started: false, score: null,
              attempts: 0, pending: 0,
              modulesDone: done,
              modulesTotal: modulesPerCourse.get(courseId) ?? 0,
              lastAt: null, certifiedAt: null, certId: null,
              scoreSum: 0,
            };
            cellMap.set(key, cell);
          }
          return cell;
        };

        // Asignación directa.
        for (const a of assignRows) {
          if (!personById.has(a.user_id) || !courseById.has(a.course_id)) continue;
          const cell = cellOf(a.user_id, a.course_id);
          cell.assigned = true;
          if (a.is_mandatory) cell.mandatory = true;
        }
        // Asignación por campaña: le toca a toda la gente de esa campaña.
        const peopleByCampaign = new Map<string, string[]>();
        for (const p of personById.values()) {
          if (!p.campaignId) continue;
          const list = peopleByCampaign.get(p.campaignId) ?? [];
          list.push(p.id);
          peopleByCampaign.set(p.campaignId, list);
        }
        for (const ca of campAssignRows) {
          if (!courseById.has(ca.course_id)) continue;
          for (const uid of peopleByCampaign.get(ca.campaign_id) ?? []) {
            const cell = cellOf(uid, ca.course_id);
            cell.assigned = true;
            if (ca.is_mandatory) cell.mandatory = true;
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
            moduleTitle: a.module?.title_es ?? null,
            sectionTitle: a.section?.heading_es ?? null,
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

        // ── Cierre de cuentas por celda, persona y curso ──────────────────
        const finalCells: ProgramCell[] = [];
        for (const cell of cellMap.values()) {
          // "Iniciado" no puede depender solo de haber ENTREGADO algo: un módulo
          // de solo lectura se completa sin generar entrega, y un certificado
          // implica haber hecho el curso entero. Sin esto salían cursos con más
          // completados que iniciados, que es imposible de explicar.
          if (cell.modulesDone > 0 || cell.certifiedAt) cell.started = true;
          const { scoreSum, ...rest } = cell;
          const score = cell.attempts > 0 ? Math.round(scoreSum / cell.attempts) : null;
          finalCells.push({ ...rest, score });

          const person = personById.get(cell.userId);
          const course = courseById.get(cell.courseId);
          if (!person || !course) continue;

          if (cell.assigned) { person.assigned++; course.assigned++; }
          if (cell.mandatory) { person.mandatory++; course.mandatory = true; }
          if (cell.started) { person.started++; course.started++; }
          if (cell.certifiedAt) { person.certified++; course.certified++; }
          person.pendingReviews += cell.pending;
          course.pendingReviews += cell.pending;
          // Avance de temario: módulos hechos sobre los que trae el curso.
          person.modulesDone += cell.modulesDone;
          person.modulesTotal += cell.assigned ? cell.modulesTotal : 0;
          // Terminado = certificado o temario completo (ver isCourseCompleted).
          if (isCourseCompleted({ ...rest, score })) {
            person.completed++;
            course.completed++;
            if (cell.mandatory) person.mandatoryDone++;
          }
          if (cell.lastAt && (!course.lastActivity || cell.lastAt > course.lastActivity)) {
            course.lastActivity = cell.lastAt;
          }
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
  }, [lang, excludeSuperadmins, nonce]);

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

  /* ── Encuestas (diferido) ───────────────────────────────────────────────
     Una llamada por curso, de a 5, y solo de los cursos visibles. Si el SQL de
     la encuesta no está corrido, cada llamada devuelve resultados vacíos y el
     panel lo dice sin romperse. */
  const loadSurveys = useCallback((courseIds: string[]) => {
    if (surveysRun.current) return surveysRun.current;
    if (courseIds.length === 0) return Promise.resolve({});
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
    if (examsRun.current) return examsRun.current;
    if (courseIds.length === 0) return Promise.resolve({});
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
    modulesByCourse,
    doneModules,
    study: { ...study, totalMs: studyTotalMs },
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
