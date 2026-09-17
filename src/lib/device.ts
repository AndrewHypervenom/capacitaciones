/* ────────────────────────────────────────────────────────────────────────────
   ¿Desde qué aparato está entrando? (computador, tableta o celular)

   Lo usa la restricción «este curso solo se ve desde el computador»
   (`courses.desktop_only`): hay contenido —simuladores con teclado, tablas
   anchas, material normativo que se firma en el puesto de trabajo— que en un
   celular no se puede hacer bien, y terminarlo a medias en el bus es peor que
   no empezarlo.

   No existe forma exacta de saber el aparato desde el navegador, así que se
   cruzan varias señales y se prefiere ACERTAR EN EL CELULAR: el falso positivo
   caro es cerrarle el curso a alguien que sí está en su PC.

   Orden de las señales, de la más fiable a la menos:
     1. `userAgentData.mobile` — lo dice el propio navegador (Chrome/Edge).
     2. El texto del agente: iPhone, Android, iPad…
     3. iPadOS 13+ miente y se anuncia como «Macintosh»; se delata porque un Mac
        de verdad no tiene pantalla táctil (`maxTouchPoints`).
     4. Como último recurso: pantalla táctil sin ratón y pantalla pequeña.

   Nada de esto mira el ancho de la VENTANA: un PC con la ventana a medias sigue
   siendo un PC y no se le cierra el curso.
   ──────────────────────────────────────────────────────────────────────────── */

export type DeviceKind = 'desktop' | 'tablet' | 'phone'

/** Lo que Chrome/Edge publican en `navigator.userAgentData` (aún sin tipos). */
interface UADataLike {
  mobile?: boolean
}

function mediaMatches(query: string): boolean {
  try {
    return window.matchMedia(query).matches
  } catch {
    return false
  }
}

/** Qué aparato es, mirado AHORA. En el servidor (sin `window`) es 'desktop'. */
export function detectDeviceKind(): DeviceKind {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'desktop'

  const ua = navigator.userAgent || ''
  const uaData = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData
  const touchPoints = navigator.maxTouchPoints ?? 0
  // Táctil sin ratón: en un PC con pantalla táctil el puntero fino existe igual,
  // así que esto solo es verdad en tabletas y celulares de verdad.
  const touchOnly = mediaMatches('(pointer: coarse)') && !mediaMatches('(any-pointer: fine)')
  // Lado corto de la PANTALLA (no de la ventana) y sin importar la orientación:
  // un celular acostado sigue siendo un celular.
  const shortSide = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0)

  // Tabletas declaradas. Android pone «Mobile» en los celulares y lo quita en las
  // tabletas: sin esa palabra, un Android es tableta.
  const isTablet =
    /iPad|Tablet|PlayBook|Silk/i.test(ua) ||
    (/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
    // iPadOS 13+ disfrazado de escritorio.
    (/Macintosh/i.test(ua) && touchPoints > 1)
  if (isTablet) return 'tablet'

  if (/iPhone|iPod|Android|IEMobile|BlackBerry|Opera Mini|Mobile Safari/i.test(ua)) return 'phone'
  if (uaData?.mobile === true) return 'phone'

  // Sin pistas en el agente: solo el táctil puro con pantalla pequeña delata.
  if (touchOnly && shortSide > 0 && shortSide < 820) return 'phone'
  if (touchOnly && shortSide >= 820) return 'tablet'

  return 'desktop'
}

/** ¿Es un computador? (lo único que abre un curso marcado «solo computador»). */
export function isDesktopDevice(): boolean {
  return detectDeviceKind() === 'desktop'
}

/** La parte del curso que define la restricción (la fila de `courses`). */
export interface DesktopOnlyCourse {
  desktop_only?: boolean | null
}

/** ¿Este curso está cerrado en ESTE aparato? */
export function blockedByDevice(
  course: DesktopOnlyCourse | null | undefined,
  kind: DeviceKind,
): boolean {
  return course?.desktop_only === true && kind !== 'desktop'
}
