/**
 * Prueba de que el refuerzo se repasó DE VERDAD.
 *
 * El check de la ruta de refuerzo se abría si el módulo estaba "completado" en
 * el progreso, y eso no probaba nada: para llegar al examen ya hay que haber
 * completado el curso. Tampoco basta con cronometrar la pestaña: dejarla
 * abierta mirando al techo no es repasar.
 *
 * Lo que se pide son DOS condiciones, independientes y las dos alcanzables
 * desde la propia pantalla:
 *
 *   1. TIEMPO: el mínimo del módulo (un tercio de su duración, entre 2 y 6 min),
 *      contado mientras la persona está delante. Cuenta todo el rato, esté donde
 *      esté dentro del módulo: sin topes ni cuotas por trozo.
 *   2. RECORRIDO: haber llegado al final del contenido (LECTURA_OBJETIVO % del
 *      alto). Si el módulo cabe en una pantalla, esto se cumple solo.
 *
 * Saltar al final no sirve (falta el tiempo) y quedarse arriba tampoco (falta el
 * recorrido).
 *
 * HISTORIA DE LAS DOS VERSIONES ANTERIORES, para no repetirlas:
 *   · v1 partía el contenido en franjas y le daba a cada una una cuota de
 *     tiempo. En un módulo de una sección se atascaba: llegabas al fondo, esa
 *     franja ya estaba pagada y el reloj se paraba sin nada más que hacer.
 *   · v2 quitó las cuotas pero seguía exigiendo pisar todas las franjas, y el
 *     número de franjas solo podía crecer. Si el documento se acortaba (un
 *     bloque que colapsa, contenido que se reacomoda al cargar), las últimas
 *     franjas quedaban fuera del alcance del scroll y el check no se abría
 *     nunca por mucho tiempo que pasaras.
 *   La profundidad de lectura no tiene ese problema: es un porcentaje del
 *   documento tal como está AHORA, así que siempre se puede llegar al final.
 *
 * QUIÉN MIDE QUÉ: el tiempo lo acredita el servidor con su propio reloj (RPC
 * `reinforcement_beat`), que es lo que no se puede falsear desde el navegador.
 * La profundidad la reporta la pantalla, porque solo ella sabe cuánto mide el
 * contenido. Lo que hay aquí en localStorage es caché para pintar.
 *
 * OJO: los ids de módulo son SIEMPRE el UUID real (module.dbId / el id que
 * devuelve la ruta de refuerzo), nunca el slug.
 */

/** Un módulo pendiente de repasar, tal como lo necesita la página del módulo. */
export interface ReinforcementModuleTarget {
  /** UUID real del módulo. */
  id: string;
  /** Mínimo de tiempo activo que hay que dedicarle, en ms. */
  requiredMs: number;
}

/** La ruta activa, guardada por la antesala del examen para que el módulo la lea. */
export interface ActiveReinforcement {
  reinforcementId: string;
  courseId: string;
  modules: ReinforcementModuleTarget[];
}

/** Lo repasado de un módulo. */
export interface StudyRecord {
  /** Tiempo dentro del módulo, en ms. */
  ms: number;
  /** Hasta dónde se ha leído, 0-100. */
  depth: number;
  /** Repaso cumplido: una vez true no vuelve a bajar. */
  done: boolean;
}

const ACTIVE_PREFIX = 'learningai.reinforcementActive:';
const STUDY_PREFIX = 'learningai.reinforcementStudy:';

/** Evento propio para que la antesala se entere en vivo sin recargar. */
export const REINFORCEMENT_STUDY_EVENT = 'learningai:reinforcement-study';

/**
 * Hasta dónde hay que bajar para dar el contenido por recorrido. No es 100
 * porque el final de la página son el pie y los botones: exigir el píxel exacto
 * convertiría un requisito razonable en una pelea con el scroll.
 */
export const DEPTH_TARGET = 90;

export const EMPTY_STUDY: StudyRecord = { ms: 0, depth: 0, done: false };

/**
 * Cuánto hay que repasar un módulo: un tercio de su duración, nunca menos de
 * 2 minutos (si no, no es un repaso) ni más de 6 (si no, es un castigo).
 * El servidor calcula esto mismo por su cuenta; aquí es solo para pintar.
 */
export function requiredStudyMs(durationMin: number | null | undefined): number {
  const dur = Number(durationMin) || 0;
  const third = (dur / 3) * 60_000;
  return Math.round(Math.min(Math.max(third, 2 * 60_000), 6 * 60_000));
}

/** Tiempo acreditado: todo el que se pasó dentro, tope al mínimo exigido. */
export function creditedMs(rec: StudyRecord, requiredMs: number): number {
  return Math.min(Math.max(0, rec.ms), requiredMs);
}

/** Falta bajar: el tiempo puede estar hecho y el repaso no. */
export function needsCoverage(rec: StudyRecord): boolean {
  return rec.depth < DEPTH_TARGET;
}

/** Avance del repaso, 0-100. Solo llega a 100 si está cumplido del todo. */
export function studyPct(rec: StudyRecord, requiredMs: number): number {
  if (isStudyDone(rec, requiredMs)) return 100;
  return Math.min(99, Math.round((creditedMs(rec, requiredMs) / Math.max(1, requiredMs)) * 100));
}

/** Tiempo que falta, en ms (el recorrido pendiente se avisa aparte). */
export function remainingMs(rec: StudyRecord, requiredMs: number): number {
  if (rec.done) return 0;
  return Math.max(0, requiredMs - creditedMs(rec, requiredMs));
}

/** Cumplido = el tiempo mínimo Y haber llegado al final del contenido. */
export function isStudyDone(rec: StudyRecord, requiredMs: number): boolean {
  if (rec.done) return true;
  return creditedMs(rec, requiredMs) >= requiredMs && !needsCoverage(rec);
}

function activeKey(userId: string | undefined): string {
  return `${ACTIVE_PREFIX}${userId || 'anon'}`;
}

function studyKey(
  userId: string | undefined,
  reinforcementId: string,
  moduleId: string,
): string {
  return `${STUDY_PREFIX}${userId || 'anon'}:${reinforcementId}:${moduleId}`;
}

/** Todas las rutas vigentes, indexadas por curso (se puede deber refuerzo en varios). */
type ActiveMap = Record<string, ActiveReinforcement>;

function readActiveMap(userId: string | undefined): ActiveMap {
  try {
    const raw = localStorage.getItem(activeKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ActiveMap) : {};
  } catch {
    return {};
  }
}

/**
 * La antesala del examen publica su ruta vigente; con `active` en null la borra.
 * Se guarda por curso: alguien puede deber refuerzo en dos cursos y abrir la
 * antesala de uno no debe apagar el cronómetro del otro.
 */
export function saveActiveReinforcement(
  userId: string | undefined,
  courseId: string,
  active: ActiveReinforcement | null,
): void {
  try {
    const map = readActiveMap(userId);
    if (!active || active.modules.length === 0) {
      if (!(courseId in map)) return;
      delete map[courseId];
    } else {
      map[courseId] = active;
    }
    if (Object.keys(map).length === 0) localStorage.removeItem(activeKey(userId));
    else localStorage.setItem(activeKey(userId), JSON.stringify(map));
  } catch {
    /* localStorage lleno o no disponible: el repaso simplemente no se mide */
  }
}

/** Busca en qué ruta activa (si alguna) está este módulo. */
export function findActiveReinforcement(
  userId: string | undefined,
  moduleId: string,
): { active: ActiveReinforcement; target: ReinforcementModuleTarget } | null {
  const map = readActiveMap(userId);
  for (const active of Object.values(map)) {
    if (!active?.reinforcementId || !Array.isArray(active.modules)) continue;
    const target = active.modules.find((m) => m.id === moduleId);
    if (target) return { active, target };
  }
  return null;
}

export function readStudy(
  userId: string | undefined,
  reinforcementId: string,
  moduleId: string,
): StudyRecord {
  try {
    const raw = localStorage.getItem(studyKey(userId, reinforcementId, moduleId));
    if (!raw) return { ...EMPTY_STUDY };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_STUDY };

    // Formato de las versiones por franjas: se conserva el tiempo sumándolas,
    // que es lo único que sigue significando lo mismo.
    if (Array.isArray(parsed.stripes)) {
      const ms = parsed.stripes.reduce(
        (acc: number, v: unknown) => acc + (Number(v) || 0),
        0,
      );
      return { ms, depth: 0, done: parsed.done === true };
    }

    return {
      ms: Math.max(0, Number(parsed.ms) || 0),
      depth: Math.min(100, Math.max(0, Number(parsed.depth) || 0)),
      done: parsed.done === true,
    };
  } catch {
    return { ...EMPTY_STUDY };
  }
}

/** Guarda lo repasado y avisa a quien esté escuchando (la antesala del examen). */
export function writeStudy(
  userId: string | undefined,
  reinforcementId: string,
  moduleId: string,
  rec: StudyRecord,
): void {
  try {
    localStorage.setItem(studyKey(userId, reinforcementId, moduleId), JSON.stringify(rec));
    window.dispatchEvent(
      new CustomEvent(REINFORCEMENT_STUDY_EVENT, {
        detail: { reinforcementId, moduleId },
      }),
    );
  } catch {
    /* ignoramos: sin almacenamiento el repaso no se puede acreditar */
  }
}
