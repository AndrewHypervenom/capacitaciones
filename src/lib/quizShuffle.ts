/**
 * Orden aleatorio para preguntas y opciones de un quiz.
 *
 * El problema que resuelve: cuando el orden es fijo, la respuesta deja de ser
 * conocimiento y pasa a ser memoria de posiciones — "la 1 es la B, la 2 la D" —
 * y el puntaje (y el XP que sale de él) se puede repetir sin volver a pensar.
 *
 * La regla de oro es que aquí SOLO se decide qué se pinta primero. La corrección,
 * el intento que se guarda (`opcion_index`) y todo lo que ya está en la base
 * siguen hablando en índices ORIGINALES: se baraja la vista, nunca los datos.
 * Por eso las funciones devuelven una permutación de índices y no listas nuevas.
 */

/**
 * Copia barajada de una lista (Fisher-Yates). Solo para listas cuyos elementos
 * se identifican solos (llevan su `id` o su `correct` encima); si la posición
 * ES el identificador, hay que usar `shuffledIndices` y barajar la vista.
 */
export function shuffleArray<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Como `shuffleArray`, pero no devuelve la lista en su orden original cuando hay
 * margen para moverla. Importa donde el orden ES el ejercicio ("ordena el
 * proceso"): salir ya resuelto regala el puntaje.
 */
export function shuffleArrayMoved<T>(arr: T[]): T[] {
  if (arr.length < 2) return [...arr]
  for (let attempt = 0; attempt < 5; attempt++) {
    const out = shuffleArray(arr)
    if (out.some((item, i) => item !== arr[i])) return out
  }
  return [...arr.slice(1), arr[0]]
}

/** Permutación de `0..n-1` (Fisher-Yates). Un orden nuevo en cada llamada. */
export function shuffledIndices(n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
}

/**
 * Igual que `shuffledIndices`, pero evita devolver el orden idéntico al original
 * cuando hay margen para moverlo. Con 2 o 3 opciones el azar repite el orden de
 * entrada con frecuencia molesta y el aprendiz jura que "nunca cambia".
 */
export function shuffledIndicesMoved(n: number): number[] {
  if (n < 2) return shuffledIndices(n)
  for (let attempt = 0; attempt < 5; attempt++) {
    const order = shuffledIndices(n)
    if (order.some((original, position) => original !== position)) return order
  }
  // Salida garantizada: rota una posición.
  return Array.from({ length: n }, (_, i) => (i + 1) % n)
}
