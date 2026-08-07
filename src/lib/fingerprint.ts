/**
 * Huella estable de una fila de la base, para saber si cambió desde que se cargó.
 *
 * La alternativa clásica sería comparar `updated_at`, pero varias tablas del
 * proyecto (`scenarios`, entre otras) no tienen esa columna y añadirla implicaba
 * DDL. La huella del contenido no necesita nada del servidor y detecta
 * exactamente lo que importa: que la fila que estoy a punto de sobrescribir ya
 * no es la que abrí.
 */

/** JSON con las llaves ordenadas: el mismo contenido da siempre el mismo texto. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

/** FNV-1a de 32 bits en hex. Rápido y suficiente: solo compara igual/distinto. */
export function fingerprint(value: unknown, ignoreKeys: string[] = []): string {
  const source =
    value && typeof value === 'object' && !Array.isArray(value) && ignoreKeys.length
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).filter(
            ([k]) => !ignoreKeys.includes(k),
          ),
        )
      : value

  const text = stableStringify(source)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}
