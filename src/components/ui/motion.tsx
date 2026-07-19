import {
  motion,
  useMotionValue,
  useSpring,
  useMotionTemplate,
  type Variants,
  type HTMLMotionProps,
} from 'framer-motion';
import { type ReactNode, type ElementType, type ComponentType } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';

/* ────────────────────────────────────────────────────────────────────────
   Kit de animación compartido — extrae el vocabulario de movimiento de la
   landing (curva "apple", desenfoque de entrada, resortes, magnetismo,
   spotlight) para reutilizarlo en todo el sitio de forma coherente. Todo
   respeta `prefers-reduced-motion`: si el usuario lo pide, no hay transforms.
   ──────────────────────────────────────────────────────────────────────── */

/** Curva de suavizado corporativa (misma que `ease-apple` de Tailwind). */
export const ease = [0.16, 1, 0.3, 1] as const;

/* Caché de componentes Motion por tag. IMPRESCINDIBLE: nunca llamar `motion(as)`
   dentro del render — crea un componente NUEVO en cada render, y React desmonta y
   vuelve a montar el subárbol cada vez que el padre se re-renderiza (la animación
   de entrada se reproduce sin parar → "parpadeo"). Al cachear por tag devolvemos
   siempre la MISMA referencia y el subárbol se mantiene estable. */
type AnyMotion = ComponentType<HTMLMotionProps<'div'>>;
const motionTagCache = new Map<string, AnyMotion>();
function motionTag(as: ElementType): AnyMotion {
  if (typeof as === 'string') {
    let c = motionTagCache.get(as);
    if (!c) {
      c = motion(as as keyof typeof motion) as unknown as AnyMotion;
      motionTagCache.set(as, c);
    }
    return c;
  }
  // Para componentes personalizados (no usado hoy): sin caché, pero estable si el
  // caller pasa siempre la misma referencia.
  return motion(as as never) as unknown as AnyMotion;
}

/* ── FadeIn: revela al entrar en viewport (fade + subida + leve desenfoque) ─ */
export interface FadeInProps extends Omit<HTMLMotionProps<'div'>, 'ref'> {
  /** Retardo en segundos. */
  delay?: number;
  /** Desplazamiento vertical inicial en px (por defecto 20). */
  y?: number;
  /** Duración en segundos (por defecto 0.6). */
  duration?: number;
  /** Aplica un leve desenfoque de entrada (por defecto true). */
  blur?: boolean;
  /** Se anima solo la primera vez (por defecto true). */
  once?: boolean;
  /**
   * Revelar al entrar en el viewport (scroll-reveal) en vez de animar al montar.
   * Por defecto FALSE: anima al montar. El `whileInView` es frágil dentro de
   * contenedores con scroll propio (p.ej. el panel admin, que scrollea en un div
   * interno y vive fuera de AppShell): el contenido bajo el pliegue puede quedar
   * en opacidad 0 y "no cargar". Para páginas de contenido queremos que aparezca
   * siempre; el scroll-reveal solo tiene sentido en secciones tipo landing.
   */
  inView?: boolean;
  as?: ElementType;
  children?: ReactNode;
}

export function FadeIn({
  delay = 0,
  y = 20,
  duration = 0.6,
  blur = true,
  once = true,
  inView = false,
  as = 'div',
  className,
  children,
  ...props
}: FadeInProps) {
  const reduce = useReducedMotion();
  const MotionTag = motionTag(as);

  if (reduce) {
    return (
      <MotionTag className={className} {...props}>
        {children}
      </MotionTag>
    );
  }

  const target = { opacity: 1, y: 0, filter: 'blur(0px)' };
  const trigger = inView
    ? { whileInView: target, viewport: { once, margin: '-60px' } }
    : { animate: target };

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y, filter: blur ? 'blur(6px)' : 'blur(0px)' }}
      {...trigger}
      transition={{ duration, ease, delay }}
      {...props}
    >
      {children}
    </MotionTag>
  );
}

/* ── Stagger: contenedor que escalona a sus hijos <StaggerItem> ──────────── */
const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 16, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease } },
};

export interface StaggerProps extends Omit<HTMLMotionProps<'div'>, 'ref'> {
  /** Segundos entre cada hijo (por defecto 0.07). */
  gap?: number;
  once?: boolean;
  /** Revelar al hacer scroll en vez de animar al montar (ver FadeIn.inView). Por defecto false. */
  inView?: boolean;
  as?: ElementType;
  children?: ReactNode;
}

export function Stagger({ gap = 0.07, once = true, inView = false, as = 'div', className, children, ...props }: StaggerProps) {
  const reduce = useReducedMotion();
  const MotionTag = motionTag(as);

  if (reduce) {
    return (
      <MotionTag className={className} {...props}>
        {children}
      </MotionTag>
    );
  }

  const trigger = inView
    ? { whileInView: 'show' as const, viewport: { once, margin: '-60px' } }
    : { animate: 'show' as const };

  return (
    <MotionTag
      className={className}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: 0.05 } } }}
      initial="hidden"
      {...trigger}
      {...props}
    >
      {children}
    </MotionTag>
  );
}

export function StaggerItem({ as = 'div', className, children, ...props }: Omit<HTMLMotionProps<'div'>, 'ref'> & { as?: ElementType; children?: ReactNode }) {
  const MotionTag = motionTag(as);
  return (
    <MotionTag className={className} variants={staggerItem} {...props}>
      {children}
    </MotionTag>
  );
}

// Exportadas por si se prefiere componer variantes a mano.
export const variants = { container: staggerContainer, item: staggerItem };

/* ── Magnetic: el elemento se atrae hacia el cursor con física de resorte ── */
export function Magnetic({
  children,
  strength = 0.35,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 200, damping: 15, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 200, damping: 15, mass: 0.4 });

  if (reduce) return <span className={cn('inline-flex', className)}>{children}</span>;

  const onMove = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.span
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ x: sx, y: sy }}
      className={cn('inline-flex', className)}
    >
      {children}
    </motion.span>
  );
}

/* ── HoverLift: eleva con resorte al pasar el cursor (para tarjetas) ─────── */
export function HoverLift({
  children,
  className,
  lift = -6,
  ...props
}: Omit<HTMLMotionProps<'div'>, 'ref'> & { lift?: number; children?: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      whileHover={reduce ? undefined : { y: lift }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/* ── SpotlightCard: halo + borde reactivo que siguen al cursor ──────────── */
export function SpotlightCard({
  children,
  className,
  color = 'rgb(var(--neon-green))',
  lift = true,
}: {
  children: ReactNode;
  className?: string;
  /** Color del halo (cualquier valor CSS con alfa; por defecto verde marca). */
  color?: string;
  lift?: boolean;
}) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(-200);
  const my = useMotionValue(-200);
  const halo = useMotionTemplate`radial-gradient(240px circle at ${mx}px ${my}px, ${color}, transparent 70%)`;

  const onMove = (e: React.MouseEvent) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(e.clientX - r.left);
    my.set(e.clientY - r.top);
  };

  return (
    <motion.div
      onMouseMove={onMove}
      whileHover={reduce || !lift ? undefined : { y: -6 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className={cn('group relative overflow-hidden', className)}
    >
      {!reduce && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: halo }}
        />
      )}
      <div className="relative">{children}</div>
    </motion.div>
  );
}
