// Portada responsive del curso (art-direction).
// Cada dispositivo carga la imagen que el capacitador subió para él; si falta
// alguna variante, cae al escritorio (cover_url) que es también el <img> base.
//
//   cover_url        ≥896px    (escritorio / PC — base)      1664×320  = 26/5
//   cover_url_tablet 640–895   (tablet)                      1680×360  = 14/3
//   cover_url_mobile <640px    (móvil)                       1200×400  = 3/1
//
// TODAS las cajas donde se pinta una portada usan COVER_BOX. Antes cada sitio
// fijaba su propio alto y la misma imagen se recortaba distinto en cada uno
// (el hero a 5.2:1, la tarjeta del catálogo a 3.1:1): lo que se subía con la
// medida sugerida perdía ~40% por los lados en el catálogo. Si agregas un lugar
// nuevo que muestre portada, usa COVER_BOX y nunca un `h-XX`.

/**
 * Caja estándar de portada. El alto sale del ancho, no se fija a mano.
 *
 * La proporción cambia por breakpoint para calzar EXACTO con la medida que se
 * le pide a cada slot (mismos cortes que los `media` del <picture> de abajo):
 * así la portada llena la caja sin franjas vacías y sin recorte. Una sola
 * proporción global no sirve: obligaría a re-exportar todo el material, que
 * está hecho en 3:1 (móvil), 14:3 (tablet) y 26:5 (escritorio).
 *
 * `min-h-0` es obligatorio: casi todas estas cajas son hijas de un flex column
 * y el `min-height:auto` del flex deja que el contenido pase por encima de la
 * proporción. Sin `overflow-hidden`: varias dejan asomar el birrete por debajo
 * a propósito.
 */
export const COVER_BOX =
  'w-full min-h-0 aspect-[3/1] sm:aspect-[14/3] [@media(min-width:896px)]:aspect-[26/5]'

export interface CourseCoverSources {
  cover_url?: string | null
  cover_url_mobile?: string | null
  cover_url_tablet?: string | null
}

/** ¿El curso tiene al menos una portada (en cualquier resolución)? */
export function courseHasCover(c: CourseCoverSources): boolean {
  return Boolean(c.cover_url || c.cover_url_mobile || c.cover_url_tablet)
}

interface Props {
  course: CourseCoverSources
  /** Clases del <img> (incluye object-cover/object-contain). */
  className?: string
  alt?: string
  loading?: 'lazy' | 'eager'
}

export function CourseCover({ course, className, alt = '', loading }: Props) {
  const { cover_url, cover_url_mobile, cover_url_tablet } = course
  // Fuente base (fallback del <img> y para los rangos sin variante propia).
  const base = cover_url || cover_url_tablet || cover_url_mobile
  if (!base) return null

  return (
    // El <picture> es inline y sin alto propio: sin `block h-full` el `h-full`
    // del <img> se resuelve contra un alto auto y la imagen se dibuja a su alto
    // natural, estirando la caja (una portada 16:9 hacía la tarjeta el doble de
    // alta que las demás).
    <picture className="block h-full w-full">
      {cover_url_tablet && (
        <source media="(min-width: 640px) and (max-width: 895px)" srcSet={cover_url_tablet} />
      )}
      {cover_url_mobile && <source media="(max-width: 639px)" srcSet={cover_url_mobile} />}
      <img src={base} alt={alt} className={className} loading={loading} />
    </picture>
  )
}
