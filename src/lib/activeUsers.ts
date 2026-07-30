/**
 * Cuentas dadas de baja: cómo se esconden en los paneles.
 *
 * Cuando Talento Humano deja de reportar a alguien, su cuenta se inactiva
 * (`profiles.is_active = false`) pero su historial se conserva. Los paneles de
 * capacitador NO deben mostrarla: su gente es la que está hoy. El superadmin sí
 * la ve, porque es quien responde por la auditoría.
 *
 * `is_active` puede llegar `undefined` mientras el SQL de altas y bajas no se
 * haya corrido: ahí todo el mundo cuenta como activo. Por eso el filtro es
 * `!== false` y las consultas piden `*` en vez de nombrar la columna (nombrarla
 * haría fallar la consulta completa contra una base sin ella).
 */

export interface MaybeActive {
  is_active?: boolean | null
}

/** ¿Esta cuenta está vigente? Tolerante a que la columna todavía no exista. */
export function isActiveAccount(row: MaybeActive | null | undefined): boolean {
  return !row || row.is_active !== false
}

/** Quita las cuentas dadas de baja de una lista. */
export function onlyActive<T extends MaybeActive>(rows: T[]): T[] {
  return rows.filter(isActiveAccount)
}

/**
 * Aplica el filtro solo para quien no debe ver las bajas. El superadmin recibe
 * la lista completa.
 */
export function hideInactiveUnlessSuperAdmin<T extends MaybeActive>(
  rows: T[],
  isSuperAdmin: boolean,
): T[] {
  return isSuperAdmin ? rows : onlyActive(rows)
}
