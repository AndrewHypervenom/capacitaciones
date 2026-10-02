/**
 * Cómo se pinta la imagen de un ítem de acordeón: tamaño, ubicación y forma.
 *
 * Vive aparte para que el lector (AccordionBlock) y la vista previa del editor
 * hablen el mismo idioma. Las clases van escritas completas, nunca armadas por
 * partes: Tailwind solo genera las que encuentra literales en el código.
 *
 * Los tamaños son a propósito contenidos: la imagen acompaña la respuesta, no la
 * reemplaza. Hasta la "L" deja respirar al texto.
 */
import type {
  AccordionImagePosition,
  AccordionImageShape,
  AccordionImageSize,
  AccordionImageStyle,
} from '@/types/blocks';

export const ACC_IMAGE_DEFAULTS: Required<AccordionImageStyle> = {
  size: 'sm',
  position: 'left',
  shape: 'original',
};

export function resolveAccImageStyle(style?: AccordionImageStyle): Required<AccordionImageStyle> {
  return { ...ACC_IMAGE_DEFAULTS, ...style };
}

/** ¿La imagen va al lado del texto (y no encima o debajo)? */
export const isSidePosition = (p: AccordionImagePosition) => p === 'left' || p === 'right';

/** Contenedor imagen + texto. En celular, izquierda/derecha se apilan con la imagen arriba. */
export const ACC_LAYOUT_CLASS: Record<AccordionImagePosition, string> = {
  left: 'flex flex-col gap-4 sm:flex-row sm:items-start',
  right: 'flex flex-col gap-4 sm:flex-row-reverse sm:items-start',
  top: 'flex flex-col gap-4',
  bottom: 'flex flex-col-reverse gap-4',
};

/** Ancho máximo del marco: al lado del texto es más angosto que arriba/abajo. */
const SIDE_MAX_W: Record<AccordionImageSize, string> = {
  sm: 'max-w-[9rem]',
  md: 'max-w-[13rem]',
  lg: 'max-w-[18rem]',
};
const STACK_MAX_W: Record<AccordionImageSize, string> = {
  sm: 'max-w-[12rem]',
  md: 'max-w-[18rem]',
  lg: 'max-w-[28rem]',
};

/** Alto máximo cuando la imagen va sin recortar (forma "original"). */
const ORIGINAL_MAX_H: Record<AccordionImageSize, string> = {
  sm: 'max-h-28',
  md: 'max-h-44',
  lg: 'max-h-72',
};

const SHAPE_ASPECT: Record<Exclude<AccordionImageShape, 'original'>, string> = {
  square: 'aspect-square',
  landscape: 'aspect-[16/10]',
  portrait: 'aspect-[3/4]',
};

/** Clases del marco (el botón que se toca para ampliar). */
export function accFrameClass(s: Required<AccordionImageStyle>): string {
  const maxW = isSidePosition(s.position) ? SIDE_MAX_W[s.size] : STACK_MAX_W[s.size];
  // Sin recortar el marco se ajusta a la imagen; recortada ocupa su ancho máximo.
  return s.shape === 'original' ? maxW : `w-full ${maxW}`;
}

/** Clases de la imagen dentro del marco. */
export function accImageClass(s: Required<AccordionImageStyle>): string {
  if (s.shape === 'original') return `h-auto w-auto max-w-full ${ORIGINAL_MAX_H[s.size]} object-contain`;
  return `w-full ${SHAPE_ASPECT[s.shape]} object-cover`;
}
