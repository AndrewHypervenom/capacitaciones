/**
 * La zona de "sube un documento" del sitio: un solo aspecto, un solo
 * comportamiento. Se puede hacer clic O soltar el archivo encima.
 *
 * Dos cosas que se aprendieron a golpes y no hay que deshacer:
 *
 *  1. Es una FILA, no un cajón. La versión en columna gastaba cuatro renglones
 *     (ícono, título, formatos en dos líneas, "o arrástralo aquí") y por sí sola
 *     empujaba los botones de los modales fuera de la pantalla.
 *  2. El texto principal DICE "arrastra". Con un título del tipo "Subir archivo"
 *     la zona parecía un botón corriente: nadie adivina que acepta un archivo
 *     soltado encima si no se lo dicen. El borde punteado que camina al pasar por
 *     encima y el ícono que flota rematan el mensaje sin gastar altura.
 *
 * La detección de arrastre vive en `useFileDrop` (contador de entradas, filtro
 * por `accept`, y el arrastre fuera de la zona no navega). Ver ese archivo.
 */
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Upload } from 'lucide-react'
import i18n from '@/i18n'
import { cn } from '@/lib/cn'
import { ease } from '@/components/ui/motion'
import { MarchingDashes } from '@/components/ui/MarchingDashes'
import { Tooltip } from '@/components/ui/Tooltip'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { useFileDrop } from '@/hooks/useFileDrop'
import { toast } from '@/stores/toastStore'

interface Props {
  /** Lista tipo `accept`: ".pdf,.docx" o "image/*". */
  accept: string
  onFile: (file: File) => void
  /** Título. Por defecto "Arrastra tu archivo aquí" — cámbialo solo con razón. */
  label?: string
  /** Formatos admitidos, en corto. Se muestra tras "o haz clic para elegirlo". */
  hint?: ReactNode
  /** Lista completa de formatos, para el globo de ayuda. */
  hintFull?: string
  icon?: ReactNode
  disabled?: boolean
  /** `sm` aprieta el alto para modales; `md` da un poco más de aire. */
  size?: 'sm' | 'md'
  className?: string
}

export function FileDropZone({
  accept, onFile, label, hint, hintFull, icon, disabled = false, size = 'md', className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const reduce = useReducedMotion()
  const [hover, setHover] = useState(false)
  const { dragging, dropProps } = useFileDrop({
    accept,
    disabled,
    onFiles: (files) => onFile(files[0]),
    onReject: (name) => toast.error(i18n.t('common.drop_invalid', { name })),
  })

  // El trazo camina al pasar por encima y mientras el archivo está encima: es la
  // señal de "esto recibe algo", y en reposo se queda quieto para no distraer.
  const marching = !disabled && (hover || dragging)

  const title = dragging
    ? i18n.t('common.drop_here')
    : (label ?? i18n.t('common.drop_title'))
  const sub = dragging
    ? i18n.t('common.drop_release')
    : hint
      ? <>{i18n.t('common.drop_hint')} <span className="opacity-50">·</span> {hint}</>
      : i18n.t('common.drop_hint')

  const subLine = (
    <p className="truncate text-[11px] leading-snug text-text-subtle">{sub}</p>
  )

  return (
    <motion.div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={typeof title === 'string' ? title : undefined}
      onClick={() => { if (!disabled) inputRef.current?.click() }}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() }
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      {...dropProps}
      animate={reduce ? undefined : { scale: dragging ? 1.01 : 1 }}
      transition={{ duration: 0.28, ease }}
      className={cn(
        'group relative isolate w-full cursor-pointer overflow-hidden rounded-2xl text-left',
        'outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-brand-violet/40',
        dragging ? 'bg-brand-violet/[0.09]' : 'bg-glass/[0.03]',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <MarchingDashes
        marching={marching}
        tone={dragging ? 'on' : hover ? 'hover' : 'soft'}
      />

      {/* Halo cálido que se enciende al pasar por encima o al arrastrar: es el
          detalle que separa un recuadro punteado cualquiera de algo cuidado. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 -z-10 transition-opacity duration-500',
          dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
        style={{
          background:
            'radial-gradient(120% 130% at 18% 0%, rgb(var(--neon-violet) / 0.16), transparent 62%)',
        }}
      />

      <div className={cn('flex items-center gap-3.5', size === 'sm' ? 'px-3.5 py-3' : 'px-4 py-3.5')}>
        <span
          className={cn(
            'relative flex shrink-0 items-center justify-center rounded-xl ring-1 transition-colors duration-300',
            size === 'sm' ? 'h-9 w-9' : 'h-10 w-10',
            dragging
              ? 'bg-brand-violet/15 text-brand-violet ring-brand-violet/30'
              : 'bg-glass/8 text-text-muted ring-glass-border/15 group-hover:text-brand-violet',
          )}
        >
          {/* Anillo que se expande al arrastrar: el "suéltalo ya" sin palabras. */}
          {dragging && !reduce && (
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-xl ring-1 ring-brand-violet/50"
              initial={{ opacity: 0.7, scale: 1 }}
              animate={{ opacity: 0, scale: 1.45 }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeOut' }}
            />
          )}
          {/* El ícono flota siempre, apenas dos píxeles: quieto parece un botón;
              en movimiento se lee como "aquí cae algo". */}
          <motion.span
            animate={reduce ? undefined : dragging ? { y: [-2.5, 1.5, -2.5] } : { y: [0, -2.5, 0] }}
            transition={{
              duration: dragging ? 1 : 2.8,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="flex"
          >
            {icon ?? <Upload className={size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />}
          </motion.span>
        </span>

        <div className="min-w-0 flex-1">
          <p className={cn(
            'truncate text-[13px] font-medium transition-colors',
            dragging ? 'text-brand-violet' : 'text-text',
          )}>
            {title}
          </p>
          {/* El globo lleva la lista completa de formatos, que en la fila va en
              corto para no partirse en dos renglones. */}
          {hintFull && !dragging
            // `min-w-0 max-w-full`: sin eso el envoltorio del globo (inline-flex)
            // no encoge y la línea se pasa por debajo de la pastilla "Elegir".
            ? <Tooltip label={hintFull} maxWidth={280} anchor="element" className="min-w-0 max-w-full">{subLine}</Tooltip>
            : subLine}
        </div>

        {/* Pastilla de acción: deja claro que la fila entera se puede pulsar. */}
        {!dragging && (
          <span className="hidden shrink-0 rounded-full border border-glass-border/20 px-2.5 py-1 text-[11px] font-medium text-text-muted transition-colors group-hover:border-brand-violet/30 group-hover:text-brand-violet sm:block">
            {i18n.t('common.drop_browse')}
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onFile(f)
        }}
      />
    </motion.div>
  )
}
