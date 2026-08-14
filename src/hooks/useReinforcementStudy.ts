import { useEffect, useRef, useState } from 'react';
import {
  DEPTH_TARGET,
  findActiveReinforcement,
  isStudyDone,
  needsCoverage,
  readStudy,
  remainingMs,
  studyPct,
  writeStudy,
  type StudyRecord,
} from '@/lib/reinforcementStudy';
import {
  beatReinforcementStudy,
  getReinforcementStudy,
} from '@/services/reinforcementStudy.service';

/**
 * Mide el repaso de un módulo de la ruta de refuerzo del examen.
 *
 * Dos condiciones, las dos alcanzables desde la propia pantalla (el porqué de
 * cada una está en `lib/reinforcementStudy.ts`):
 *   · TIEMPO — el mínimo del módulo, contado mientras la persona está delante.
 *   · RECORRIDO — haber bajado hasta el final del contenido.
 *
 * QUIÉN MANDA: el servidor. Esta pantalla late cada BEAT_EVERY_MS diciendo
 * "sigo aquí, voy por el X% del contenido" y el servidor acredita el tiempo con
 * SU reloj. Por eso repetir latidos, abrir varias pestañas o tocar el
 * almacenamiento del navegador no adelanta el repaso.
 *
 * El conteo local sigue existiendo como RESPALDO para cuando la base todavía no
 * tiene la función (SQL sin correr): ahí manda lo local y se avisa en
 * `serverBacked: false`.
 *
 * `moduleId` es el UUID real del módulo (module.dbId), igual que en la ruta.
 */

const TICK_MS = 1_000;
const PERSIST_EVERY_MS = 5_000;
/**
 * Cada cuánto se late. Tiene que ser bastante menor que el techo por latido de
 * la RPC (20 s): un hueco mayor lo toma el servidor por una ausencia y no
 * acredita ese intervalo.
 */
const BEAT_EVERY_MS = 10_000;
/**
 * Cuánto se aguanta sin NINGUNA señal antes de dar el repaso por abandonado.
 * Estaba en 45 s y era un error: leer no genera eventos, y con un PDF menos
 * todavía porque el visor va en un iframe y la página no ve nada. Diez minutos
 * ya no es "está leyendo", es "se fue".
 */
const IDLE_AFTER_MS = 600_000;

export interface ReinforcementStudy {
  /** El módulo está en la ruta de refuerzo vigente. */
  active: boolean;
  /** Avance del repaso, 0-100. Solo llega a 100 cuando queda cumplido. */
  pct: number;
  /** Tiempo que falta, en ms. */
  remainingMs: number;
  /** Hasta dónde se ha leído, 0-100. */
  depth: number;
  /** Por qué el reloj no está corriendo ahora mismo. */
  paused: 'idle' | 'hidden' | null;
  /**
   * El tiempo ya está y solo falta bajar hasta el final. Es lo único que puede
   * faltar cuando el reloj llegó al mínimo, y hay que decirlo: si no, la barra
   * parece atascada sin motivo.
   */
  needsCoverage: boolean;
  /** Ya se cumplió todo: el check de la antesala está habilitado. */
  ready: boolean;
  /** El avance lo valida la base (false = SQL sin correr, medición solo local). */
  serverBacked: boolean;
  /** A dónde volver para marcarlo (`/exam/:courseId`). */
  examHref: string | null;
}

const IDLE_STATE: ReinforcementStudy = {
  active: false,
  pct: 0,
  remainingMs: 0,
  depth: 0,
  paused: null,
  needsCoverage: false,
  ready: false,
  serverBacked: false,
  examHref: null,
};

/** Estado tal como lo devolvió la base en el último latido. */
interface ServerState {
  pct: number;
  remainingMs: number;
  depth: number;
  done: boolean;
}

/**
 * ¿Hay un video en marcha? Ver un video de 20 minutos es repasar, aunque nadie
 * toque el ratón. Con los embebidos (YouTube/Vimeo) no podemos saber si está
 * reproduciendo, así que basta con que estén presentes.
 */
function mediaPlaying(): boolean {
  const videos = document.querySelectorAll('video');
  for (const v of Array.from(videos)) {
    if (!v.paused && !v.ended && v.readyState > 2) return true;
  }
  return document.querySelector(
    'iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="vimeo"]',
  ) !== null;
}

/**
 * ¿Está la persona delante? Con la pestaña enfocada damos por hecho que sí,
 * aunque no toque nada: leer es estarse quieto, y con un PDF o un video
 * embebido el foco lo tiene el iframe y la página no ve ni un evento.
 */
function present(lastActivity: number): boolean {
  if (document.hasFocus()) return true;
  if (mediaPlaying()) return true;
  return Date.now() - lastActivity <= IDLE_AFTER_MS;
}

/**
 * Hasta dónde se ha leído, en % del alto del contenido.
 *
 * `host` es quien scrollea de verdad: normalmente la página, pero si el módulo
 * vive dentro de un contenedor con scroll propio sería ese. Se descubre
 * escuchando el evento de scroll en captura, porque suponer que siempre es la
 * ventana deja la medición clavada en 0.
 *
 * Si el contenido cabe entero en la pantalla, no hay nada que recorrer: 100.
 */
function readingDepth(host: Element | null): number {
  const el = (host as HTMLElement) ?? document.scrollingElement ?? document.documentElement;
  const scrollHeight = el.scrollHeight;
  const clientHeight = el.clientHeight || window.innerHeight;
  if (scrollHeight <= clientHeight + 8) return 100;
  const seen = el.scrollTop + clientHeight;
  return Math.min(100, Math.max(0, Math.round((seen / scrollHeight) * 100)));
}

export function useReinforcementStudy(
  moduleId: string | undefined,
  userId: string | undefined,
): ReinforcementStudy {
  const [state, setState] = useState<ReinforcementStudy>(IDLE_STATE);

  // Conteo local (respaldo y ritmo del latido), en refs para no reiniciar nada.
  const recRef = useRef<StudyRecord>({ ms: 0, depth: 0, done: false });
  const serverRef = useRef<ServerState | null>(null);

  useEffect(() => {
    if (!moduleId) {
      setState(IDLE_STATE);
      return;
    }

    const found = findActiveReinforcement(userId, moduleId);
    if (!found) {
      setState(IDLE_STATE);
      return;
    }

    const { active, target } = found;
    const { reinforcementId, courseId } = active;
    const requiredMs = target.requiredMs;
    const examHref = `/exam/${courseId}`;

    const rec = readStudy(userId, reinforcementId, moduleId);
    recRef.current = rec;
    serverRef.current = null;

    let cancelled = false;
    let lastActivity = Date.now();
    let lastPersist = Date.now();
    let lastBeatAt = 0;
    let beating = false;
    let serverKnown = false;
    let scrollHost: Element | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    /* Lo que se pinta: la barra avanza cada segundo con el conteo local, aunque
       el servidor solo se entere cada latido — una barra que salta de 10 en 10
       segundos parece congelada. Se queda en 99 hasta que la base confirma,
       para que nunca se vea llena con el check todavía apagado. */
    const publish = (paused: 'idle' | 'hidden' | null) => {
      const srv = serverRef.current;
      const r = recRef.current;
      const ready = srv ? srv.done : isStudyDone(r, requiredMs);
      const localPct = studyPct(r, requiredMs);
      const localLeft = remainingMs(r, requiredMs);
      const timeLeft = ready ? 0 : Math.min(srv?.remainingMs ?? localLeft, localLeft);
      setState({
        active: true,
        pct: ready ? 100 : Math.min(99, Math.max(srv?.pct ?? 0, localPct)),
        remainingMs: timeLeft,
        depth: Math.max(r.depth, srv?.depth ?? 0),
        paused: ready ? null : paused,
        // Solo se avisa del recorrido cuando ya no falta tiempo: mientras el
        // reloj siga corriendo, pedir además que baje sería ruido.
        needsCoverage: !ready && timeLeft <= 0 && needsCoverage(r),
        ready,
        serverBacked: srv !== null,
        examHref,
      });
    };

    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    const applyServer = (row: Awaited<ReturnType<typeof beatReinforcementStudy>>) => {
      if (!row) return false;
      serverRef.current = {
        pct: row.completedAt ? 100 : row.progressPct,
        remainingMs: row.completedAt ? 0 : Math.max(0, row.requiredMs - row.creditedMs),
        depth: row.depthPct,
        done: row.completedAt !== null,
      };
      // El servidor lleva la cuenta buena del tiempo: si va por delante (otro
      // equipo, otra sesión), el conteo local se pone al día en vez de exigirlo
      // dos veces.
      if (row.creditedMs > recRef.current.ms) {
        recRef.current = { ...recRef.current, ms: row.creditedMs };
      }
      if (row.completedAt && !recRef.current.done) {
        recRef.current = { ...recRef.current, done: true };
      }
      writeStudy(userId, reinforcementId, moduleId, recRef.current);
      return true;
    };

    /** Un latido: el servidor acredita el tiempo, nosotros decimos por dónde vamos. */
    const beat = async () => {
      if (beating) return;
      beating = true;
      try {
        const row = await beatReinforcementStudy(
          reinforcementId,
          moduleId,
          recRef.current.depth,
        );
        if (cancelled) return;
        serverKnown = true;
        if (applyServer(row)) {
          if (serverRef.current?.done) stop();
          publish(null);
        }
      } finally {
        beating = false;
      }
    };

    const persist = () => {
      writeStudy(userId, reinforcementId, moduleId, recRef.current);
      lastPersist = Date.now();
    };

    const onActivity = () => {
      lastActivity = Date.now();
    };

    // Quién scrollea de verdad. En captura, porque el scroll de un contenedor
    // interno no burbujea hasta window.
    const onScroll = (e: Event) => {
      lastActivity = Date.now();
      const t = e.target;
      scrollHost =
        t === document || t === window || !(t instanceof Element)
          ? document.scrollingElement
          : t;
    };

    const tick = () => {
      if (serverRef.current?.done) {
        stop();
        publish(null);
        return;
      }
      if (document.hidden) {
        publish('hidden');
        return;
      }
      if (!present(lastActivity)) {
        // Ni foco, ni video, ni un evento en diez minutos: se fue.
        publish('idle');
        return;
      }

      const r = recRef.current;
      recRef.current = {
        ms: r.ms + TICK_MS,
        // La profundidad solo sube: haber bajado y vuelto arriba no lo deshace.
        depth: Math.max(r.depth, readingDepth(scrollHost)),
        done: r.done,
      };
      recRef.current.done = isStudyDone(recRef.current, requiredMs);

      /* El latido va por RELOJ, no por ticks acumulados: si el navegador
         entrega los ticks con retraso, lo que no puede pasar es que el hueco
         entre latidos supere el techo de la RPC. */
      if (Date.now() - lastBeatAt >= BEAT_EVERY_MS || recRef.current.done) {
        lastBeatAt = Date.now();
        void beat();
      }

      if (recRef.current.done) {
        persist();
        publish(null);
        // Sin servidor detrás, el conteo local es lo único que hay: se cierra.
        // Con servidor, sigue latiendo hasta que la base lo dé por cumplido.
        if (serverKnown && !serverRef.current) stop();
        return;
      }
      if (Date.now() - lastPersist >= PERSIST_EVERY_MS) persist();
      publish(null);
    };

    publish(null);

    const events = ['wheel', 'pointerdown', 'pointermove', 'keydown', 'touchstart'];
    for (const ev of events) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });

    /* Estado de partida: lo que la base ya tiene de este módulo. Además de
       pintar el avance real (aunque se repasara en otro equipo), el primer
       latido deja fijada la marca de tiempo contra la que se medirá el resto. */
    void getReinforcementStudy(userId ?? '', reinforcementId).then((remote) => {
      if (cancelled) return;
      const row = remote[moduleId];
      if (row) {
        applyServer(row);
        publish(null);
      }
      if (!serverRef.current?.done) {
        lastBeatAt = Date.now();
        void beat();
      }
    });

    interval = setInterval(tick, TICK_MS);

    return () => {
      cancelled = true;
      for (const ev of events) window.removeEventListener(ev, onActivity);
      document.removeEventListener('scroll', onScroll, { capture: true });
      stop();
      writeStudy(userId, reinforcementId, moduleId, recRef.current);
    };
  }, [moduleId, userId]);

  return state;
}

export { DEPTH_TARGET };
