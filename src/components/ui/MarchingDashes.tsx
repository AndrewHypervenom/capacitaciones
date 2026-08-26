/**
 * El borde punteado que camina — la señal de "aquí se puede soltar un archivo".
 *
 * Va en SVG y no con `border-dashed` porque el punteado de CSS no se puede poner
 * en marcha, y ese movimiento es justo lo que delata que la zona recibe algo.
 *
 * Se usa en la zona de subir documentos, en las portadas del curso y (en su
 * variante redonda, dibujada aparte) alrededor de la foto de perfil.
 */
import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/hooks/useReducedMotion'

/** Largo del patrón; el trazo avanza justo un ciclo por vuelta. */
const DASH = 10
const GAP = 7

interface Props {
  /** El trazo se mueve (al pasar por encima o mientras el archivo está encima). */
  marching: boolean
  /** Intensidad del color: `on` mientras se arrastra, `soft` en reposo. */
  tone: 'on' | 'hover' | 'soft'
  /** Radio de las esquinas, en px. Debe coincidir con el `rounded-*` de la caja. */
  radius?: number
  className?: string
}

export function MarchingDashes({ marching, tone, radius = 15, className }: Props) {
  const reduce = useReducedMotion()

  return (
    <svg aria-hidden className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}>
      <motion.rect
        x="0.75" y="0.75" width="calc(100% - 1.5px)" height="calc(100% - 1.5px)"
        rx={radius} ry={radius}
        fill="none"
        strokeWidth="1.5"
        strokeDasharray={`${DASH} ${GAP}`}
        className={cn(
          'transition-colors duration-300',
          tone === 'on'
            ? 'stroke-brand-violet/70'
            : tone === 'hover'
              ? 'stroke-brand-violet/45'
              : 'stroke-glass-border/35',
        )}
        animate={reduce || !marching ? { strokeDashoffset: 0 } : { strokeDashoffset: [0, -(DASH + GAP)] }}
        transition={reduce || !marching
          ? { duration: 0.2 }
          : { duration: 0.9, repeat: Infinity, ease: 'linear' }}
      />
    </svg>
  )
}
