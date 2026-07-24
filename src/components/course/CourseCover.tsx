// Portada responsive del curso (art-direction).
// Cada dispositivo carga la imagen que el capacitador subió para él; si falta
// alguna variante, cae al escritorio (cover_url) que es también el <img> base.
//
//   cover_url        ≥896px    (escritorio / PC — base)      ~1664×320
//   cover_url_tablet 640–895   (tablet)                      ~1680×360
//   cover_url_mobile <640px    (móvil)                       ~1200×400

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
    <picture>
      {cover_url_tablet && (
        <source media="(min-width: 640px) and (max-width: 895px)" srcSet={cover_url_tablet} />
      )}
      {cover_url_mobile && <source media="(max-width: 639px)" srcSet={cover_url_mobile} />}
      <img src={base} alt={alt} className={className} loading={loading} />
    </picture>
  )
}
