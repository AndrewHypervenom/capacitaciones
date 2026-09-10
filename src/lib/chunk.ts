/**
 * Parte una lista en trozos.
 *
 * Existe por una razón concreta: PostgREST recibe los filtros `in.(...)` en la
 * URL, y el proxy de Supabase rechaza con **400 Bad Request** cualquier URL de
 * más de ~8 KB. Un UUID ocupa 37 caracteres con su coma, así que a partir de
 * unos 200 ids la consulta deja de funcionar — y como el error llega como un
 * 400 seco, el código que se traga los errores lo ve igual que "no hay filas".
 *
 * 100 es deliberadamente conservador: ~3,7 KB de filtro, con sitio de sobra
 * para el resto de la URL y las cabeceras.
 */
export const PG_IN_CHUNK = 100

export function chunk<T>(items: T[], size: number = PG_IN_CHUNK): T[][] {
  if (items.length <= size) return items.length ? [items] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
