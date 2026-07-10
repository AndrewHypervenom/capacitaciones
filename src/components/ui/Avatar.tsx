import { cn } from '@/lib/cn';

interface AvatarProps {
  /** URL de la foto; si falta se muestra la inicial del nombre. */
  src?: string | null;
  name?: string | null;
  /** Diámetro en píxeles. */
  size?: number;
  className?: string;
}

/** Foto de perfil circular con respaldo a la inicial del nombre. */
export function Avatar({ src, name, size = 36, className }: AvatarProps) {
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-full bg-primary/10 text-primary',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={name ?? ''} className="h-full w-full object-cover" />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-bold uppercase"
          style={{ fontSize: Math.round(size * 0.42) }}
        >
          {initial}
        </span>
      )}
    </div>
  );
}
