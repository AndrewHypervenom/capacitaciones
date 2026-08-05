/**
 * Lista de países para el perfil de las personas.
 *
 * El simulador tenía solo CO/MX/AR (los mercados donde se practica la llamada),
 * pero en el perfil eso deja fuera a quien vive en cualquier otro sitio: si su
 * país no está en la lista, no puede completar su ficha. Aquí va una lista
 * amplia de Iberoamérica + los destinos frecuentes de la operación.
 *
 * Los nombres van en español (audiencia LatAm) y no se traducen: son nombres
 * propios y basta con reconocerlos. La bandera ayuda a encontrarlos de un vistazo.
 */
export interface Country {
  code: string
  name: string
  flag: string
}

export const COUNTRIES: Country[] = [
  { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  { code: 'BO', name: 'Bolivia', flag: '🇧🇴' },
  { code: 'BR', name: 'Brasil', flag: '🇧🇷' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷' },
  { code: 'CU', name: 'Cuba', flag: '🇨🇺' },
  { code: 'DO', name: 'República Dominicana', flag: '🇩🇴' },
  { code: 'EC', name: 'Ecuador', flag: '🇪🇨' },
  { code: 'SV', name: 'El Salvador', flag: '🇸🇻' },
  { code: 'ES', name: 'España', flag: '🇪🇸' },
  { code: 'US', name: 'Estados Unidos', flag: '🇺🇸' },
  { code: 'GT', name: 'Guatemala', flag: '🇬🇹' },
  { code: 'HN', name: 'Honduras', flag: '🇭🇳' },
  { code: 'MX', name: 'México', flag: '🇲🇽' },
  { code: 'NI', name: 'Nicaragua', flag: '🇳🇮' },
  { code: 'PA', name: 'Panamá', flag: '🇵🇦' },
  { code: 'PY', name: 'Paraguay', flag: '🇵🇾' },
  { code: 'PE', name: 'Perú', flag: '🇵🇪' },
  { code: 'PR', name: 'Puerto Rico', flag: '🇵🇷' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
  { code: 'UY', name: 'Uruguay', flag: '🇺🇾' },
  { code: 'VE', name: 'Venezuela', flag: '🇻🇪' },
]

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]))

/** Nombre legible del país. Devuelve el propio código si no está en la lista. */
export function countryLabel(code?: string | null): string | null {
  if (!code) return null
  return BY_CODE.get(code)?.name ?? code
}

/** Nombre con bandera, para listas y fichas. */
export function countryLabelWithFlag(code?: string | null): string | null {
  if (!code) return null
  const c = BY_CODE.get(code)
  return c ? `${c.flag} ${c.name}` : code
}

/** Opciones listas para `<Select>`. */
export const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({
  value: c.code,
  label: `${c.flag} ${c.name}`,
}))
