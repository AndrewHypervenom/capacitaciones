import { type ReactNode, type ElementType } from 'react';
import { motion } from 'framer-motion';
import { Camera, Loader2, Plus } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';

/* ────────────────────────────────────────────────────────────────────────
   Encabezado del perfil, compartido por la vista propia (/profile) y la
   consulta de staff (/admin/users/:id). Una sola pieza para que ambas
   pantallas se vean exactamente igual de cuidadas: aurora corporativa de
   fondo, aro vivo alrededor de la foto y cifras que suben al entrar.
   Todo el movimiento respeta `prefers-reduced-motion`.
   ──────────────────────────────────────────────────────────────────────── */

export type RoleTone = 'amber' | 'violet' | 'green';

const toneMap: Record<RoleTone, { bg: string; text: string; ring: string }> = {
  amber: { bg: 'rgba(245,158,11,0.16)', text: '#d97706', ring: 'rgba(245,158,11,0.55)' },
  violet: { bg: 'rgba(179,61,158,0.16)', text: '#b33d9e', ring: 'rgba(179,61,158,0.55)' },
  green: { bg: 'rgba(16,212,81,0.16)', text: '#0ca23e', ring: 'rgba(16,212,81,0.55)' },
};

export interface HeroMeta {
  id: string;
  icon: ElementType;
  label: string;
  value: string | null;
  /** Si el dato se puede llenar desde aquí: el vacío se vuelve un botón. */
  onFill?: () => void;
  /** Texto del botón cuando el dato está vacío (p. ej. "Completar"). */
  fillLabel?: string;
}

export interface HeroStat {
  id: string;
  icon: ElementType;
  label: string;
  /** Valor numérico: se anima contando. Si es null se pinta un guion. */
  value: number | null;
  /** Sufijo del número (p. ej. '%'). */
  suffix?: string;
  accent?: string;
}

export interface ProfileHeroProps {
  name: string;
  jobTitle?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  roleLabel: string;
  roleTone: RoleTone;
  campaignName?: string | null;
  meta?: HeroMeta[];
  stats?: HeroStat[];
  /** Muestra el botón de cámara sobre la foto. */
  canEditPhoto?: boolean;
  uploadingPhoto?: boolean;
  onPickPhoto?: () => void;
  photoLabel?: string;
  /** Acciones a la derecha del nombre (editar perfil, etc.). */
  actions?: ReactNode;
}

export function ProfileHero({
  name,
  jobTitle,
  email,
  avatarUrl,
  roleLabel,
  roleTone,
  campaignName,
  meta = [],
  stats = [],
  canEditPhoto = false,
  uploadingPhoto = false,
  onPickPhoto,
  photoLabel,
  actions,
}: ProfileHeroProps) {
  const reduce = useReducedMotion();
  const tone = toneMap[roleTone];
  // En la vista propia los datos vacíos NO se esconden: se muestran como una
  // invitación a completarlos. Escondiéndolos, la única cosa editable a la
  // vista era la foto y nadie encontraba dónde llenar cargo, país o teléfono.
  const shownMeta = meta.filter((m) => m.value || m.onFill);

  return (
    <motion.section
      initial={reduce ? undefined : { opacity: 0, y: 18, filter: 'blur(8px)' }}
      animate={reduce ? undefined : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-[28px] border border-line bg-surface"
    >
      {/* Aurora corporativa: verde arriba-izquierda, magenta abajo-derecha */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute -left-24 -top-32 h-72 w-72 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(16,212,81,0.30), transparent 70%)' }}
          animate={reduce ? undefined : { x: [0, 26, 0], y: [0, 16, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -right-20 top-10 h-64 w-64 rounded-full blur-3xl"
          style={{ background: 'radial-gradient(circle, rgba(179,61,158,0.22), transparent 70%)' }}
          animate={reduce ? undefined : { x: [0, -22, 0], y: [0, 22, 0] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      </div>

      <div className="relative p-6 sm:p-8">
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-start sm:text-left">
          {/* Foto con aro vivo */}
          <div className="relative shrink-0">
            {!reduce && (
              <motion.span
                aria-hidden
                className="absolute -inset-1.5 rounded-full"
                style={{
                  background: `conic-gradient(from 0deg, ${tone.ring}, transparent 45%, ${tone.ring})`,
                  filter: 'blur(1px)',
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
              />
            )}
            <div className="relative rounded-full bg-surface p-1">
              <Avatar src={avatarUrl} name={name} size={104} />
            </div>
            {canEditPhoto && (
              <motion.button
                type="button"
                onClick={onPickPhoto}
                disabled={uploadingPhoto}
                aria-label={photoLabel}
                whileHover={reduce ? undefined : { scale: 1.08 }}
                whileTap={reduce ? undefined : { scale: 0.94 }}
                className="absolute -bottom-0.5 -right-0.5 flex h-10 w-10 items-center justify-center rounded-full border-2 border-surface bg-primary text-on-primary shadow-lg disabled:opacity-60"
              >
                {uploadingPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              </motion.button>
            )}
          </div>

          {/* Identidad */}
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-text sm:text-[30px]">
              {name}
            </h1>
            {jobTitle && <p className="mt-0.5 text-[14px] text-text-muted">{jobTitle}</p>}

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
                style={{ background: tone.bg, color: tone.text }}
              >
                {roleLabel}
              </span>
              {campaignName && (
                <span className="rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-text-muted">
                  {campaignName}
                </span>
              )}
              {email && <span className="truncate text-[12px] text-text-subtle">{email}</span>}
            </div>

            {shownMeta.length > 0 && (
              <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-3 sm:justify-start">
                {shownMeta.map(({ id, icon: Icon, label, value, onFill, fillLabel }) => (
                  <div key={id} className="flex items-center gap-2 text-left">
                    <Icon className="h-4 w-4 shrink-0 text-text-subtle" />
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-text-subtle">{label}</div>
                      {value ? (
                        <div className="truncate text-[13px] font-medium text-text">{value}</div>
                      ) : (
                        <button
                          type="button"
                          onClick={onFill}
                          className="flex items-center gap-1 text-[13px] font-medium text-text-subtle underline decoration-dotted underline-offset-4 transition-colors hover:text-primary"
                        >
                          <Plus className="h-3 w-3" />
                          {fillLabel}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {actions && <div className="flex shrink-0 flex-wrap gap-2 sm:self-start">{actions}</div>}
        </div>

        {stats.length > 0 && (
          <div className="mt-7 grid grid-cols-2 gap-3 border-t border-line pt-6 sm:grid-cols-4">
            {stats.map(({ id, icon: Icon, label, value, suffix, accent }, i) => (
              <motion.div
                key={id}
                initial={reduce ? undefined : { opacity: 0, y: 12 }}
                animate={reduce ? undefined : { opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 + i * 0.07, ease: [0.16, 1, 0.3, 1] }}
                className="min-w-0"
              >
                <Icon
                  className={cn('mb-2 h-4 w-4', !accent && 'text-text-subtle')}
                  style={accent ? { color: accent } : undefined}
                />
                <div className="text-[24px] font-bold leading-none tabular-nums text-text">
                  {value == null ? (
                    <span className="text-text-subtle">—</span>
                  ) : (
                    <>
                      <AnimatedNumber value={value} />
                      {suffix}
                    </>
                  )}
                </div>
                <div className="mt-1 truncate text-[11px] text-text-muted">{label}</div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.section>
  );
}
