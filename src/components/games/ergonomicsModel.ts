export type ErgoKey = 'back' | 'seat' | 'screen' | 'distance' | 'reach' | 'feet' | 'glare'
export type ErgoSetup = Record<ErgoKey, number>
export const IDEAL: ErgoSetup = { back: 105, seat: 47, screen: 0, distance: 65, reach: 0, feet: 1, glare: 0 }
export const INITIAL: ErgoSetup = { back: 75, seat: 55, screen: -14, distance: 35, reach: 22, feet: 0, glare: 1 }
export const ADJUSTMENTS: { key: ErgoKey; label: string; min: number; max: number; step: number; unit: string; good: [number, number]; hint: string; issue: string }[] = [
  { key: 'back', label: 'Espalda y cuello', min: 70, max: 125, step: 5, unit: '°', good: [95, 110], hint: 'Apoya la espalda y la zona lumbar. Mantén la cabeza alineada y los hombros relajados; cambia de posición con frecuencia.', issue: 'Acerca la espalda al respaldo sin inclinar la cabeza hacia la pantalla.' },
  { key: 'seat', label: 'Altura de la silla', min: 39, max: 57, step: 1, unit: ' cm', good: [46, 49], hint: 'En este personaje, 46–49 cm alinean los codos con la mesa. En tu puesto, ajusta a tu cuerpo, con espacio detrás de las rodillas.', issue: 'Ajusta la silla para que los antebrazos queden cerca de la altura de la mesa.' },
  { key: 'screen', label: 'Elevación de pantalla', min: -15, max: 15, step: 1, unit: ' cm', good: [-5, 0], hint: 'El borde superior queda a la altura de los ojos o un poco por debajo. Con lentes multifocales puede convenir bajarla más.', issue: 'Sube o baja el monitor: su borde superior debe quedar a la altura de los ojos o algo por debajo.' },
  { key: 'distance', label: 'Distancia de pantalla', min: 30, max: 100, step: 5, unit: ' cm', good: [50, 80], hint: 'Busca una distancia cómoda para leer sin adelantar la cabeza. Aumenta el tamaño del texto si lo necesitas.', issue: 'Prueba una distancia de 50–80 cm en este escenario y evita acercar la cabeza para leer.' },
  { key: 'reach', label: 'Teclado y ratón', min: 0, max: 25, step: 1, unit: ' cm extra', good: [0, 5], hint: 'Teclado y ratón cerca, en el mismo plano; codos junto al cuerpo y muñecas alineadas con los antebrazos.', issue: 'Acerca teclado y ratón para evitar estirar los brazos o doblar las muñecas.' },
  { key: 'feet', label: 'Apoyo de los pies', min: 0, max: 1, step: 1, unit: '', good: [1, 1], hint: 'Apoya toda la planta. Este personaje necesita reposapiés con esta mesa; si llegas bien al suelo, no es necesario.', issue: 'Los pies de este personaje quedan sin apoyo: coloca el reposapiés.' },
  { key: 'glare', label: 'Luz y reflejos', min: 0, max: 1, step: 1, unit: '', good: [0, 0], hint: 'Sitúa la pantalla de lado a la ventana y controla los reflejos con persianas o iluminación indirecta.', issue: 'Cierra la persiana para quitar el reflejo de la pantalla.' },
]
export function isAligned(key: ErgoKey, setup: ErgoSetup) {
  const rule = ADJUSTMENTS.find(a => a.key === key)!
  return setup[key] >= rule.good[0] && setup[key] <= rule.good[1]
}
export function alignmentCount(setup: ErgoSetup) { return ADJUSTMENTS.filter(a => isAligned(a.key, setup)).length }
export const CHALLENGES: { title: string; description: string; setup: ErgoSetup }[] = [
  { title: 'Rescata este puesto', description: 'Encuentra y corrige los 7 ajustes. Toca los puntos de la escena o explora los controles.', setup: INITIAL },
  { title: 'Una pantalla que incomoda', description: 'La silla ya está preparada. Corrige lo que obliga a forzar la vista y adelantar el cuerpo.', setup: { ...IDEAL, screen: 12, distance: 95, reach: 20, glare: 1 } },
  { title: 'El apoyo lo cambia todo', description: 'Revisa espalda, altura de la silla y pies. Comprueba el resultado desde la vista lateral.', setup: { ...IDEAL, back: 75, seat: 56, feet: 0 } },
]
export const BREAKS = [
  { title: 'Suelta los hombros', instruction: 'Eleva y baja suavemente los hombros. Respira con normalidad y deja los brazos sueltos.', seconds: 20 },
  { title: 'Moviliza las manos', instruction: 'Separa las manos del teclado. Abre y cierra los dedos suavemente, sin forzar las muñecas.', seconds: 20 },
  { title: 'Cambia de posición', instruction: 'Si te resulta cómodo, ponte de pie y da unos pasos. También puedes mover las piernas sentado.', seconds: 20 },
  { title: 'Descansa la mirada', instruction: 'Mira un objeto lejano y parpadea con naturalidad. Relaja la mandíbula y respira a tu ritmo.', seconds: 20 },
]
