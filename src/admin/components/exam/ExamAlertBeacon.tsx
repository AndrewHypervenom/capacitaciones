import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'

const ease = [0.16, 1, 0.3, 1] as const

/* Verde corporativo en hex: va dentro de keyframes de `box-shadow`, y ahí no se
   puede componer `rgb(var(--brand-green) / .3)` desde una variable de Tailwind.
   El resto de la cápsula sí usa los tokens (`brand-green`, `brand-magenta`). */
const GREEN = '#10D451'

/* ────────────────────────────────────────────────────────────────────────────
   El aviso que sube contigo.

   La pestaña del examen es larguísima: el semáforo con todo lo que falta vive
   arriba del todo, y cuando estás abajo escribiendo preguntas no existe. Esto
   es una cápsula que se pega al borde superior en cuanto el semáforo sale de
   la vista, respira para que el rabillo del ojo la pille, y al pulsarla te
   lleva de vuelta con un destello sobre la tarjeta para que sepas QUÉ mirar.

   Aparece solo cuando hay algo que decir y desaparece sola en cuanto la
   tarjeta vuelve a estar en pantalla: no es una barra permanente.
   ──────────────────────────────────────────────────────────────────────────── */

export function ExamAlertBeacon({
  show,
  count,
  onGo,
}: {
  show: boolean
  /** Cuántos avisos hay. Cambiarlo hace saltar el contador. */
  count: number
  onGo: () => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()

  /* Portal al `body` y posición fija: dentro de la página iría colgando de la
     columna del editor, y ahí cualquier `transform` de una animación padre o un
     `overflow` intermedio la deja pegada o recortada. Fuera del árbol no hay
     nada que la pueda romper. `md:left-56` la centra sobre el contenido, no
     debajo de la barra lateral; en móvil arranca bajo la barra fija de 56px. */
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[9970] flex justify-center px-4 md:left-56 md:top-4">
      <AnimatePresence>
        {show && (
          <motion.div
            className="pointer-events-none"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -28, scale: 0.94, filter: 'blur(8px)' }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.96, filter: 'blur(6px)' }}
            transition={
              reduce
                ? { duration: 0.15 }
                : {
                    type: 'spring',
                    stiffness: 420,
                    damping: 32,
                    mass: 0.8,
                    // El desenfoque va aparte: un muelle rebota por debajo del
                    // objetivo y `blur(-0.02px)` no es un valor válido — el
                    // navegador descartaba el fotograma y el filtro parpadeaba.
                    filter: { type: 'tween', duration: 0.32, ease },
                  }
            }
          >
            <div className="pointer-events-auto relative">
              {/* Halo que respira, en el VERDE corporativo (#10D451): va detrás
                  y no recibe clics — es el rabillo del ojo, no un elemento más.
                  El magenta de marca queda para el aviso en sí (el triángulo y
                  el contador), que es lo que reclama atención. */}
              {!reduce && (
                <motion.span
                  aria-hidden
                  className="pointer-events-none absolute -inset-1 rounded-full"
                  animate={{
                    boxShadow: [
                      `0 0 0 0 ${GREEN}55`,
                      `0 0 0 12px ${GREEN}00`,
                    ],
                  }}
                  transition={{ duration: 2.1, ease: 'easeOut', repeat: Infinity, repeatDelay: 1.4 }}
                />
              )}

              <motion.button
                onClick={onGo}
                whileHover={reduce ? undefined : { y: -2 }}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 340, damping: 24 }}
                className={cn(
                  'group relative flex items-center gap-2.5 overflow-hidden rounded-full',
                  'border border-brand-green/40 bg-surface/85 py-2 pl-3 pr-3.5 backdrop-blur-xl',
                  'shadow-[0_8px_30px_-8px_rgba(16,212,81,0.45)] transition-shadow',
                  'hover:border-brand-green/70 hover:shadow-[0_12px_38px_-8px_rgba(16,212,81,0.6)]',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/50',
                )}
                aria-label={t('admin.exam.beacon_aria', {
                  n: count,
                  defaultValue: 'Ir arriba: hay {{n}} cosas que revisar en el examen',
                })}
              >
                {/* Brillo que barre la cápsula cada pocos segundos. Es el
                    detalle que la hace sentir viva sin pedir nada a gritos. */}
                {!reduce && (
                  <motion.span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 w-24 -skew-x-12 bg-gradient-to-r from-transparent via-brand-green/25 to-transparent"
                    initial={{ x: '-140%' }}
                    animate={{ x: '340%' }}
                    transition={{ duration: 1.5, ease: 'easeInOut', repeat: Infinity, repeatDelay: 4 }}
                  />
                )}

                <span className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-magenta/12">
                  <motion.span
                    className="grid place-items-center text-brand-magenta"
                    animate={reduce ? undefined : { rotate: [0, -9, 9, -5, 0] }}
                    transition={{ duration: 0.9, ease, repeat: Infinity, repeatDelay: 3.4 }}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </motion.span>
                </span>

                <span className="relative text-[12.5px] font-medium text-text">
                  {count === 1
                    ? t('admin.exam.beacon_one', 'Hay 1 cosa que revisar arriba')
                    : t('admin.exam.beacon_many', {
                        n: count,
                        defaultValue: 'Hay {{n}} cosas que revisar arriba',
                      })}
                </span>

                {/* El número salta cuando cambia: se nota que algo se resolvió
                    (o que apareció otro aviso) sin tener que subir a mirar. */}
                <span className="relative grid h-5 min-w-[1.25rem] place-items-center overflow-hidden rounded-full bg-brand-magenta/12 px-1.5">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={count}
                      initial={reduce ? undefined : { y: 10, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={reduce ? undefined : { y: -10, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                      className="text-[11px] font-semibold tabular-nums text-brand-magenta"
                    >
                      {count}
                    </motion.span>
                  </AnimatePresence>
                </span>

                <motion.span
                  aria-hidden
                  className="relative text-text-subtle transition-colors group-hover:text-primary"
                  animate={reduce ? undefined : { y: [0, -2.5, 0] }}
                  transition={{ duration: 1.6, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.6 }}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </motion.span>
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
