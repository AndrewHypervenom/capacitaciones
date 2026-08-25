import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';

interface InstructorBadgeProps {
  /** Nombre tal como se escribió: puede ser alguien sin cuenta en el sitio. */
  name: string;
  /** Solo cuando el nombre es el de ese perfil; si no, va la inicial. */
  avatarUrl?: string | null;
  /** Rótulo bajo el nombre, ya traducido. */
  role: string;
  /** `sm` para la vista previa del panel; `md` para la pantalla del aprendiz. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Quien dictó el curso, presentado con cara y nombre.
 *
 * Vive en un componente compartido a propósito: lo pintan la pantalla del
 * aprendiz y la vista previa del panel, y si cada una lo dibujara por su lado
 * el capacitador terminaría configurando a ciegas —vería una cosa y el
 * aprendiz otra— que es justo lo que la vista previa existe para evitar.
 *
 * Sin caja, sin degradado de fondo: solo la cara, el nombre y una línea fina
 * que lo separa de la pregunta. Va DEBAJO del texto —de ahí el borde superior—
 * porque lo primero que tiene que leer el aprendiz es qué se le pregunta; la
 * persona es el detalle que responde "¿y de quién hablamos?". Todo el rastro
 * de marca es el hilo verde del anillo de la foto.
 */
export function InstructorBadge({
  name,
  avatarUrl,
  role,
  size = 'md',
  className,
}: InstructorBadgeProps) {
  const compact = size === 'sm';
  return (
    <div
      className={cn(
        'flex items-center border-t border-line/60',
        compact ? 'gap-2.5 pt-2.5' : 'gap-3 pt-3.5',
        className,
      )}
    >
      {/*
        `aria-hidden`: la foto lleva el nombre en su `alt`, y con el nombre ya
        escrito al lado se leía —y se copiaba— dos veces seguidas. Aquí es pura
        decoración; quien no la ve no se pierde nada.
      */}
      <div aria-hidden className="shrink-0 rounded-full ring-1 ring-brand-green/30">
        <Avatar src={avatarUrl} name={name} size={compact ? 28 : 38} />
      </div>
      <div className="min-w-0">
        <div
          className={cn(
            'truncate font-medium tracking-tight text-text',
            compact ? 'text-[12px]' : 'text-[14px]',
          )}
        >
          {name}
        </div>
        <div
          className={cn(
            'truncate text-text-subtle',
            compact ? 'text-[10px]' : 'text-[11px]',
          )}
        >
          {role}
        </div>
      </div>
    </div>
  );
}
