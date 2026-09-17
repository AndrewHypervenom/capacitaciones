/* ────────────────────────────────────────────────────────────────────────────
   ¿Desde qué APARATO está entrando? (computador, tableta o celular)

   Lo usa la restricción «este curso solo se ve desde el computador»
   (`courses.desktop_only`). Es una RESTRICCIÓN DE APARATO, no un asunto de
   diseño: no se trata de que el curso se vea apretado en una pantalla pequeña,
   sino de que en un celular no se puede hacer bien —y hacerlo a medias en el
   bus es peor que no empezarlo—. Por eso aquí NO se mira ningún tamaño de
   ventana ni se usan puntos de quiebre: achicar la ventana de un PC no lo
   convierte en un celular, y un celular acostado o con «sitio de escritorio»
   sigue siendo un celular.

   Lo que se mira es el HARDWARE, que es lo único que el navegador no falsea:

     1. El texto del agente cuando lo dice claro (iPhone, Android, iPad…).
        iPadOS se anuncia como «Macintosh», pero se delata: un Mac de verdad no
        tiene pantalla táctil.
     2. TÁCTIL SIN RATÓN. Esta es la que cierra la puerta de verdad. «Solicitar
        versión de escritorio» cambia el agente y el ancho de la página, pero no
        le pone un ratón al teléfono: `any-pointer: fine` y `any-hover: hover`
        siguen diciendo que ahí solo hay dedos.

   Un PC táctil (todo-en-uno, portátil convertible) SÍ tiene ratón o panel
   táctil, así que pasa sin problema. El tamaño de la pantalla solo se usa
   después, y nada más que para saber si decirle «celular» o «tableta» en el
   texto de la pantalla de bloqueo.
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

/** Lado corto de la PANTALLA (no de la ventana), sin importar la orientación. */
function screenShortSide(): number {
  const w = window.screen?.width ?? 0
  const h = window.screen?.height ?? 0
  return w > 0 && h > 0 ? Math.min(w, h) : 0
}

/** Qué aparato es, mirado AHORA. En el servidor (sin `window`) es 'desktop'. */
export function detectDeviceKind(): DeviceKind {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'desktop'

  const ua = navigator.userAgent || ''
  const uaData = (navigator as Navigator & { userAgentData?: UADataLike }).userAgentData
  const touchPoints = navigator.maxTouchPoints ?? 0

  // ── 1. El agente, cuando habla claro ────────────────────────────────────
  // Android pone «Mobile» en los celulares y lo quita en las tabletas.
  const uaTablet =
    /iPad|Tablet|PlayBook|Silk/i.test(ua) ||
    (/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
    // iPadOS 13+ disfrazado de escritorio: ningún Mac tiene pantalla táctil.
    (/Macintosh/i.test(ua) && touchPoints > 1)
  if (uaTablet) return 'tablet'
  if (/iPhone|iPod|Android|IEMobile|BlackBerry|Opera Mini|Mobile Safari/i.test(ua)) return 'phone'
  if (uaData?.mobile === true) return 'phone'

  // ── 2. Táctil sin ratón ─────────────────────────────────────────────────
  // Aquí es donde cae el celular que pidió «versión de escritorio»: el agente
  // ya no lo delata, pero el aparato sigue sin tener con qué apuntar que no sea
  // el dedo. `any-*` mira TODOS los medios de entrada conectados, así que un PC
  // con pantalla táctil no se ve afectado: su ratón o su panel táctil cuentan.
  const hasTouch = touchPoints > 0 || 'ontouchstart' in window
  const hasMouse = mediaMatches('(any-pointer: fine)') && mediaMatches('(any-hover: hover)')

  // El disfraz concreto de Chrome en Android: en «versión de escritorio» se
  // presenta como un Linux de escritorio («X11; Linux x86_64»). Un PC con Linux
  // Y pantalla táctil Y sin ratón no existe en la práctica, así que si además
  // hay táctil, es un teléfono disfrazado. (Un Chromebook dice «CrOS» y queda
  // fuera: tiene panel táctil y es un computador de verdad.)
  if (hasTouch && /X11; Linux/i.test(ua) && !/CrOS/i.test(ua)) return 'phone'

  if (hasTouch && !hasMouse) {
    // El tamaño NO decide si se bloquea; solo elige la palabra del aviso.
    const shortSide = screenShortSide()
    return shortSide > 0 && shortSide < 820 ? 'phone' : 'tablet'
  }

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
