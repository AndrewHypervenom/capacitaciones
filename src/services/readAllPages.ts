/** No convertir el límite de PostgREST en un total estadístico incompleto.
 * La consulta debe ordenar por una clave estable y crear un builder por página.
 */
export async function readAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: null }> {
  const data: T[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const result = await page(from, from + size - 1)
    if (result.error) throw result.error
    const batch = result.data ?? []
    data.push(...batch)
    if (batch.length < size) return { data, error: null }
  }
}
