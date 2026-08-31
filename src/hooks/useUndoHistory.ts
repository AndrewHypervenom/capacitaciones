import { useCallback, useEffect, useRef, useState } from 'react'
import { fingerprint } from '@/lib/fingerprint'

/**
 * Deshacer y rehacer (Ctrl+Z / Ctrl+Shift+Z) para un editor entero.
 *
 * Hasta ahora la única forma de volver atrás era acordarse de lo que había
 * antes y volver a escribirlo. Borrar un bloque, reordenar secciones o mover un
 * interruptor no tenía vuelta: si te equivocabas, lo rehacías a mano.
 *
 * En vez de que cada control lleve su propio historial, se guardan fotos del
 * estado editable completo (el mismo objeto que ya se usa para saber si hay
 * cambios sin guardar) y se vuelve a la anterior. Es tosco a propósito: no
 * distingue "qué" cambió, pero nunca se queda a medias ni deja el editor en un
 * estado que no existió.
 *
 * El atajo lo atiende el sitio TAMBIÉN dentro de los campos de texto. Cederlo
 * ahí al navegador parecía lo cortés —deshace letra por letra— pero su historial
 * es por elemento: no cruzaba de un campo al anterior y, con las pestañas
 * ES/EN/PT compartiendo el mismo <input>, deshacer en inglés escupía el texto
 * que habías escrito en español. Si aquí no hay nada que deshacer, el atajo se
 * deja pasar y el navegador hace lo suyo. Ver el registro al final del archivo.
 *
 * ── Lo que hacía que "Deshacer" fuera un botón que no deshacía nada ─────────
 *
 * 1. UNA FOTO NO ES UN PASO SI NADIE TOCÓ NADA. Un editor carga por partes: el
 *    curso pinta enseguida y las condiciones, el simulador o las asignaciones
 *    llegan después. Cada llegada cambiaba el estado y se guardaba como si
 *    fuera una edición. El primer Ctrl+Z gastaba ese paso fantasma: en pantalla
 *    no se movía nada (lo tuyo seguía escrito) y encima aparecía un cambio
 *    NUEVO sin guardar, porque acababa de devolver a sus valores por defecto
 *    algo que la base sí tenía. Ahora solo cuenta como paso lo que ocurre
 *    cerca de una acción humana de verdad (clic, tecla, pegar, soltar); lo
 *    demás se adopta en silencio como nuevo punto de partida.
 *
 * 2. DESHACER NUNCA CREA UN PASO. Si al volver atrás algún control devuelve un
 *    valor ligeramente distinto, eso no es una edición del usuario: se adopta,
 *    no se apila.
 *
 * 3. EL CAMBIO RECIÉN HECHO YA SE PUEDE DESHACER. Las fotos se toman cuando la
 *    edición "se asienta" (para no guardar una por letra), pero si pulsas
 *    Deshacer antes de que asiente, ese cambio se cierra en el acto en vez de
 *    quedarse fuera del historial.
 *
 * ```ts
 * const undo = useUndoHistory({
 *   state: { form, cond },
 *   apply: (s) => { setForm(s.form); setCond(s.cond) },
 *   enabled: !loading,
 * })
 * ```
 */
export interface UndoHistory {
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  /** Olvida el historial (al cargar otro registro). */
  reset: () => void
  /**
   * Toma el estado de ahora como punto de partida SIN registrar un paso. Para
   * cuando el editor sabe que lo que cambió no lo cambió una persona (datos que
   * acaban de llegar del servidor, un guardado que redefine la línea base).
   */
  adopt: () => void
}

/**
 * Un panel hijo (el examen, el pénsum, una sección) publica su deshacer al
 * editor que pinta la barra de guardado. Sin esto la barra ofrece un botón
 * "Deshacer" muerto cuando lo que está sin guardar vive dentro del panel.
 */
export type RegisterUndo = (fn: (() => void) | null, canUndo: boolean) => void
export type PanelUndo = { undo: () => void; canUndo: boolean } | null

/** Cuánto se espera a que la edición "se asiente" antes de tomar la foto. */
const SETTLE_MS = 450
/**
 * Tope de espera. Si algo repinta la pantalla sin parar (presencia, un
 * cronómetro), el retardo se reiniciaría siempre y no se guardaría ni una foto:
 * pasado este tiempo se guarda igual.
 */
const MAX_WAIT_MS = 2200
/**
 * Cuánto vale una acción humana. La foto se toma 450 ms después del cambio, así
 * que la ventana tiene que ser holgada; lo que llega del servidor mucho después
 * de tu último clic no es una edición tuya.
 */
const USER_WINDOW_MS = 2500
/** Fotos guardadas como máximo (el contenido de un módulo pesa). */
const DEFAULT_LIMIT = 40

/** Eventos que delatan a una persona haciendo algo (no a una carga de datos). */
const USER_EVENTS = ['pointerdown', 'keydown', 'input', 'change', 'paste', 'drop'] as const

export function useUndoHistory<T>(opts: {
  /** Estado editable completo. Puede ser un literal nuevo en cada render. */
  state: T
  /** Devuelve el editor a una foto anterior. */
  apply: (state: T) => void
  /** Mientras sea false no se graba nada (p. ej. mientras carga). */
  enabled?: boolean
  limit?: number
  /**
   * El editor JURA que nada cambia su estado salvo una persona: lo que abre ya
   * viene cargado (no hay datos que lleguen después y se vuelquen solos).
   *
   * Con esto se deja de exigir que el cambio ocurra pegado a un clic o una
   * tecla, y ahí estaba el "Deshacer que no deshacía nada" del editor de
   * módulos: subir un PDF o una imagen a un bloque, generar contenido con IA o
   * migrar un medio viejo tardan SEGUNDOS. El cambio llega mucho después de tu
   * clic, la ventana de gesto humano ya se cerró y el paso se adoptaba en
   * silencio: la barra decía "1 cambio sin guardar" con el botón apagado y sin
   * forma de volver atrás.
   *
   * Solo para editores cuyo estado se inicializa entero al montar; si algo del
   * servidor puede volcarse después, se deja en false y se usa `adopt()`.
   */
  trustChanges?: boolean
}): UndoHistory {
  const { state, enabled = true, limit = DEFAULT_LIMIT, trustChanges = false } = opts

  const applyRef = useRef(opts.apply)
  const stateRef = useRef(state)
  useEffect(() => {
    applyRef.current = opts.apply
    stateRef.current = state
  })

  const pastRef = useRef<T[]>([])
  const futureRef = useRef<T[]>([])
  /** Última foto confirmada, con su huella para no recalcularla. */
  const currentRef = useRef<{ value: T; fp: string } | null>(null)
  // El tamaño de las pilas vive en estado (las pilas, en refs): leer un ref
  // durante el render no vuelve a pintar el botón cuando cambia.
  const [counts, setCounts] = useState({ past: 0, future: 0 })
  const syncCounts = useCallback(() => {
    setCounts({ past: pastRef.current.length, future: futureRef.current.length })
  }, [])
  /**
   * Hay una edición hecha que todavía no ha "asentado". Cuenta como deshacible
   * desde el primer instante: si no, el botón salía apagado justo después de
   * tocar algo —que es cuando uno se arrepiente— y parecía que no servía.
   */
  const [pendingEdit, setPendingEdit] = useState(false)
  /** Espejo en ref: el atajo de teclado no puede leer estado del render. */
  const pendingEditRef = useRef(false)
  useEffect(() => {
    pendingEditRef.current = pendingEdit
  }, [pendingEdit])

  /** Cuándo tocó algo una persona por última vez. */
  const lastInputRef = useRef(0)
  /** Cuándo se tecleó por última vez DENTRO de un campo de texto. */
  const lastTypeRef = useRef(0)
  /** Cuándo cambió por última vez el estado que este historial vigila. */
  const lastChangeRef = useRef(0)
  /** Se acaba de volver a una foto: lo que cambie por rebote no es un paso. */
  const justAppliedRef = useRef(false)
  /**
   * El editor avisó de que lo que viene no lo escribió una persona (recargar de
   * la base, datos que acaban de llegar). Se mantiene hasta que ese cambio se
   * cierre o hasta que alguien toque algo de verdad.
   */
  const adoptNextRef = useRef(false)
  /** Foto pendiente de cerrarse (el retardo de asentamiento). */
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Desde cuándo hay un cambio esperando a asentarse. */
  const pendingSinceRef = useRef(0)

  useEffect(() => {
    const mark = (e: Event) => {
      lastInputRef.current = Date.now()
      if (e.type === 'input' && isTextEntry(e.target)) lastTypeRef.current = Date.now()
      justAppliedRef.current = false
      adoptNextRef.current = false
    }
    // En captura: así se marca ANTES de que corra el manejador del propio
    // editor (o el atajo de aquí abajo) y el orden nunca depende del burbujeo.
    for (const ev of USER_EVENTS) document.addEventListener(ev, mark, true)
    return () => {
      for (const ev of USER_EVENTS) document.removeEventListener(ev, mark, true)
    }
  }, [])

  /**
   * Cierra el cambio que hay ahora mismo. `record` decide si es un paso del
   * historial o solo un nuevo punto de partida.
   */
  const commit = useCallback((record: boolean) => {
    const settled = stateRef.current
    const previous = currentRef.current
    const fp = fingerprint(settled)
    if (!previous) {
      currentRef.current = { value: settled, fp }
      return
    }
    setPendingEdit(false)
    if (fp === previous.fp) return
    if (record) {
      pastRef.current = [...pastRef.current, previous.value].slice(-limit)
      // Editar después de deshacer corta la rama: lo rehecho ya no aplica.
      futureRef.current = []
    }
    currentRef.current = { value: settled, fp }
    syncCounts()
  }, [limit, syncCounts])

  /** ¿El cambio pendiente lo hizo una persona? */
  const trustRef = useRef(trustChanges)
  trustRef.current = trustChanges
  const isUserEdit = () =>
    !justAppliedRef.current &&
    !adoptNextRef.current &&
    // Un rebote del propio salto o algo adoptado a propósito nunca es un paso,
    // se confíe o no en el resto. Lo que cambia con `trustChanges` es solo si
    // hace falta, además, un gesto reciente.
    (trustRef.current || Date.now() - lastInputRef.current <= USER_WINDOW_MS)

  const clearPending = useCallback(() => {
    if (pendingRef.current) clearTimeout(pendingRef.current)
    pendingRef.current = null
    pendingSinceRef.current = 0
  }, [])

  /** Cierra ya lo que estuviera esperando a asentarse. */
  const flush = useCallback(() => {
    if (!pendingRef.current) return
    clearPending()
    const record = isUserEdit()
    justAppliedRef.current = false
    adoptNextRef.current = false
    commit(record)
  }, [clearPending, commit])

  useEffect(() => {
    if (!enabled) return
    const fp = fingerprint(state)

    // Primera foto: el punto de partida. No es "un cambio".
    if (currentRef.current === null) {
      currentRef.current = { value: state, fp }
      return
    }
    if (fp === currentRef.current.fp) {
      pendingSinceRef.current = 0
      setPendingEdit(false)
      return
    }
    lastChangeRef.current = Date.now()

    if (isUserEdit()) setPendingEdit(true)

    const now = Date.now()
    if (pendingSinceRef.current === 0) pendingSinceRef.current = now

    const close = () => {
      const record = isUserEdit()
      justAppliedRef.current = false
      adoptNextRef.current = false
      clearPending()
      commit(record)
    }

    // Con retardo: escribir un título son veinte cambios y veinte fotos harían
    // del Ctrl+Z un borrador de letras. Se guarda cuando la edición se detiene…
    // …salvo que lleve demasiado esperando: hay pantallas que repintan solas y
    // el retardo se reiniciaría para siempre.
    if (now - pendingSinceRef.current >= MAX_WAIT_MS) {
      close()
      return
    }

    if (pendingRef.current) clearTimeout(pendingRef.current)
    const timer = setTimeout(close, SETTLE_MS)
    pendingRef.current = timer
    return () => {
      // Solo se cancela el temporizador: `pendingSinceRef` se mantiene para que
      // el tope de espera cuente desde el primer cambio, no desde el último
      // repintado.
      if (pendingRef.current === timer) {
        clearTimeout(timer)
        pendingRef.current = null
      }
    }
  }, [state, enabled, commit, clearPending])

  /**
   * Salta a una foto. `currentRef` se fija en el acto (no en el efecto): así
   * el efecto que corre tras el re-render ve la huella igual y no confunde el
   * salto con una edición nueva.
   */
  const jump = useCallback((target: T, from: 'past' | 'future') => {
    const previous = currentRef.current
    if (!previous) return
    if (from === 'past') futureRef.current = [previous.value, ...futureRef.current]
    else pastRef.current = [...pastRef.current, previous.value]
    currentRef.current = { value: target, fp: fingerprint(target) }
    // Si al repintar algún control devuelve un valor distinto, eso es un rebote
    // del salto, no una edición: se adoptará sin apilar un paso.
    justAppliedRef.current = true
    applyRef.current(target)
    syncCounts()
  }, [syncCounts])

  const undo = useCallback(() => {
    // Lo que acabas de tocar todavía puede estar esperando a asentarse: sin
    // esto, pulsar Deshacer enseguida no hacía nada (y el cambio se apilaba
    // medio segundo después, ya sin poder deshacerlo de un golpe).
    flush()
    const previous = pastRef.current[pastRef.current.length - 1]
    if (previous === undefined) return
    pastRef.current = pastRef.current.slice(0, -1)
    jump(previous, 'past')
  }, [flush, jump])

  const redo = useCallback(() => {
    flush()
    const next = futureRef.current[0]
    if (next === undefined) return
    futureRef.current = futureRef.current.slice(1)
    jump(next, 'future')
  }, [flush, jump])

  const reset = useCallback(() => {
    clearPending()
    pastRef.current = []
    futureRef.current = []
    currentRef.current = null
    justAppliedRef.current = false
    adoptNextRef.current = false
    setPendingEdit(false)
    syncCounts()
  }, [clearPending, syncCounts])

  const adopt = useCallback(() => {
    clearPending()
    const settled = stateRef.current
    currentRef.current = { value: settled, fp: fingerprint(settled) }
    justAppliedRef.current = false
    // El estado nuevo puede no haberse pintado todavía (adoptar suele llamarse
    // en el mismo suspiro en que se vuelca lo que llegó del servidor): la marca
    // hace que también ese cambio se adopte en vez de apilarse.
    adoptNextRef.current = true
    setPendingEdit(false)
  }, [clearPending])

  // Atajos. El oyente es UNO para toda la página (ver el registro de abajo) y
  // lee por ref: reinstalarlo en cada cambio de estado haría perder pulsaciones
  // a mitad de render.
  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  useEffect(() => {
    undoRef.current = undo
    redoRef.current = redo
  }, [undo, redo])

  useEffect(() => {
    if (!enabled) return
    return registerHistory({
      // A qué altura vive este editor: 0 = la página, 1 = dentro de un modal…
      // Así un modal abierto no deshace la página de detrás (ver `registerHistory`).
      depth: modalDepth(),
      canUndo: () => pastRef.current.length > 0 || pendingEditRef.current,
      /**
       * Dentro de un campo de texto solo se reclama el atajo si lo último que
       * se tecleó movió ESTE estado. Escribir en un buscador o en un filtro no
       * lo mueve: ahí el Ctrl+Z tiene que deshacer lo que acabas de escribir,
       * no revertir a tus espaldas un cambio del editor que hay debajo.
       * (300 ms de margen: el estado de React se asienta un render después.)
       */
      claimsInTextEntry: () =>
        lastTypeRef.current === 0 || lastTypeRef.current <= lastChangeRef.current + 300,
      canRedo: () => futureRef.current.length > 0,
      undo: () => undoRef.current(),
      redo: () => redoRef.current(),
    })
  }, [enabled])

  useEffect(() => () => clearPending(), [clearPending])

  return {
    canUndo: counts.past > 0 || pendingEdit,
    canRedo: counts.future > 0,
    undo,
    redo,
    reset,
    adopt,
  }
}

/* ── Un solo atajo para toda la página ──────────────────────────────────────
 *
 * Antes cada editor instalaba su propio oyente y se repartían el Ctrl+Z por
 * orden de llegada, con dos agujeros que dejaban el botón como adorno:
 *
 *  · DENTRO DE UN CAMPO DE TEXTO el atajo se le cedía al navegador. Suena
 *    razonable —el navegador deshace letra a letra— pero su historial es POR
 *    ELEMENTO y no sabe nada del editor: escribías en el título, luego en el
 *    subtítulo, y el segundo Ctrl+Z ya no encontraba nada que deshacer; el
 *    cambio del título se quedaba. Peor con los idiomas: las pestañas ES/EN/PT
 *    comparten el MISMO <input>, así que al deshacer en inglés el navegador
 *    metía ahí el texto que habías escrito en español. Por eso ahora manda
 *    siempre el historial del sitio… salvo que no tenga nada que deshacer, y
 *    entonces sí se deja pasar (en un buscador o en un campo suelto el Ctrl+Z
 *    del navegador sigue siendo lo correcto).
 *
 *  · QUIÉN ATIENDE cuando hay varios editores vivos se decidía con
 *    `defaultPrevented`, que depende del orden en que se instalaron los
 *    oyentes: la página se registra ANTES que el modal que abre encima, así
 *    que el de fuera contestaba primero. Ahora hay un solo oyente y contesta
 *    el más INTERNO que tenga algo que deshacer.
 */

type Registered = {
  depth: number
  canUndo: () => boolean
  claimsInTextEntry: () => boolean
  canRedo: () => boolean
  undo: () => void
  redo: () => void
}

/** Historiales vivos, en orden de montaje (el último es el más interno). */
const registry: Registered[] = []

/** Cuántas capas de modal hay abiertas ahora mismo. */
function modalDepth(): number {
  if (typeof document === 'undefined') return 0
  return document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length
}

function onShortcut(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  if (!(e.ctrlKey || e.metaKey)) return
  const key = e.key.toLowerCase()
  if (key !== 'z' && key !== 'y') return
  const wantsRedo = key === 'y' || e.shiftKey
  // Con un modal abierto solo contestan los historiales que viven DENTRO de él:
  // si el modal no tiene el suyo, el atajo se deja pasar en vez de deshacer a
  // ciegas la página que hay detrás.
  const depth = modalDepth()
  const inText = isTextEntry(e.target)
  for (let i = registry.length - 1; i >= 0; i--) {
    const entry = registry[i]
    if (entry.depth < depth) continue
    if (inText && !entry.claimsInTextEntry()) continue
    if (!(wantsRedo ? entry.canRedo() : entry.canUndo())) continue
    e.preventDefault()
    if (wantsRedo) entry.redo()
    else entry.undo()
    return
  }
}

function registerHistory(entry: Registered): () => void {
  registry.push(entry)
  if (registry.length === 1) document.addEventListener('keydown', onShortcut)
  return () => {
    const i = registry.indexOf(entry)
    if (i >= 0) registry.splice(i, 1)
    if (registry.length === 0) document.removeEventListener('keydown', onShortcut)
  }
}

/** ¿El foco está en un campo donde el navegador lleva su propio deshacer? */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  // Los de valor discreto (casillas, color, rango) no tienen deshacer propio.
  return !['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit'].includes(type)
}
