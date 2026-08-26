import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Loader2, X, AlertCircle, Clipboard } from 'lucide-react'
import {
  MAX_SHOTS, MAX_SHOT_BYTES, isAcceptedShot, removeShotFile, uploadFeedbackShot,
  type FeedbackShot,
} from '@/services/siteFeedback.service'
import { cn } from '@/lib/cn'
import i18n from '@/i18n'
import { useFileDrop } from '@/hooks/useFileDrop'
import { toast } from '@/stores/toastStore'
import { ShotThumb } from './ShotGallery'

/**
 * Traduce el fallo de la subida. Se distingue el "todavía no existe el bucket
 * ni sus políticas" del fallo pasajero: son problemas de personas distintas y
 * reintentar solo sirve para el segundo.
 */
function uploadErrorText(e: unknown, t: (k: string, d: string) => string): string {
  const msg = (e as { message?: string })?.message?.toLowerCase() ?? ''
  if (msg.includes('bucket not found') || msg.includes('row-level security') || msg.includes('policy')) {
    return t('site_feedback.shots.err_setup', 'Adjuntar capturas todavía no está habilitado en este sitio. Avísale al equipo.')
  }
  return t('site_feedback.shots.err_upload', 'No pudimos subir una de las capturas. Inténtalo otra vez.')
}

/** Una subida en curso: se pinta con la miniatura local antes de que llegue. */
interface Pending {
  id: string
  /** objectURL del archivo original: la previsualización es instantánea. */
  preview: string
  name: string
}

export interface ShotUploaderProps {
  /** Carpeta dentro del bucket que agrupa las capturas de esta opinión. */
  folder: string
  shots: FeedbackShot[]
  onChange: (shots: FeedbackShot[]) => void
  /**
   * Sube y persiste en una opinión ya enviada. Si no se pasa, las capturas se
   * quedan en memoria y se guardan al enviar el formulario.
   */
  onPersist?: (added: FeedbackShot[]) => Promise<FeedbackShot[]>
  onPersistRemove?: (path: string) => Promise<FeedbackShot[]>
  /** Color del acento (el tipo de opinión tiñe todo el panel). */
  accent?: string
  /** Escucha el pegado en toda la ventana (útil en el panel del formulario). */
  captureGlobalPaste?: boolean
  className?: string
  compact?: boolean
}

/**
 * Adjuntar capturas con las tres vías que la gente ya conoce: pegar (Ctrl+V,
 * que es como sale una captura recién tomada), arrastrar al recuadro, o elegir
 * archivo. Cada imagen se comprime en el navegador antes de viajar.
 */
export function ShotUploader({
  folder, shots, onChange, onPersist, onPersistRemove,
  accent = 'rgb(var(--brand-green))', captureGlobalPaste, className, compact,
}: ShotUploaderProps) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [error, setError] = useState<string | null>(null)
  /** Solo mientras el componente vive: evita setState tras desmontar. */
  // Lista siempre al día: si sueltan una segunda tanda mientras la primera aún
  // sube, el closure de aquella tiene la lista vieja y borraría lo recién hecho.
  const shotsRef = useRef(shots)
  useEffect(() => { shotsRef.current = shots }, [shots])

  const total = shots.length + pending.length
  const room = MAX_SHOTS - total

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setError(null)

    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) {
      setError(t('site_feedback.shots.err_type', 'Solo podemos adjuntar imágenes.'))
      return
    }
    if (images.some((f) => f.size > MAX_SHOT_BYTES)) {
      setError(t('site_feedback.shots.err_size', 'Cada imagen debe pesar menos de 12 MB.'))
    }

    const accepted = images.filter(isAcceptedShot).slice(0, Math.max(0, room))
    if (accepted.length === 0) {
      if (room <= 0) setError(t('site_feedback.shots.err_max', 'Puedes adjuntar hasta {{n}} capturas.', { n: MAX_SHOTS }))
      return
    }
    if (images.length > accepted.length && room > 0) {
      setError(t('site_feedback.shots.err_max', 'Puedes adjuntar hasta {{n}} capturas.', { n: MAX_SHOTS }))
    }

    const marks: Pending[] = accepted.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      preview: URL.createObjectURL(f),
      name: f.name,
    }))
    setPending((p) => [...p, ...marks])

    // En serie y no en paralelo: son archivos grandes y en una conexión pobre
    // tres subidas a la vez se estorban entre sí y ninguna termina.
    const done: FeedbackShot[] = []
    for (let i = 0; i < accepted.length; i++) {
      try {
        done.push(await uploadFeedbackShot(folder, accepted[i]))
      } catch (e) {
        console.error('shot upload error:', e)
        setError(uploadErrorText(e, t))
      } finally {
        // Pase lo que pase, la miniatura en carga se retira: dejarla girando
        // para siempre es peor que decir que falló.
        setPending((p) => p.filter((x) => x.id !== marks[i].id))
        URL.revokeObjectURL(marks[i].preview)
      }
    }
    if (done.length === 0) return

    if (onPersist) {
      try {
        onChange(await onPersist(done))
        return
      } catch (e) {
        console.error('shot persist error:', e)
        // El archivo ya está arriba pero no quedó ligado a nada: se limpia
        // para no dejar huérfanos en el bucket.
        await Promise.all(done.map((s) => removeShotFile(s.path).catch(() => {})))
        setError(t('site_feedback.shots.err_save', 'No pudimos guardar las capturas en tu opinión.'))
        return
      }
    }
    onChange([...shotsRef.current, ...done])
  }, [folder, onChange, onPersist, room, t])

  // Mismo arrastre que en el resto del sitio: sin parpadeo al pasar sobre los
  // hijos y descartando lo que no sea una imagen.
  const { dragging, dropProps } = useFileDrop({
    accept: 'image/*',
    multiple: true,
    onFiles: (files) => void addFiles(files),
    onReject: (name) => toast.error(i18n.t('common.drop_invalid', { name })),
  })

  async function remove(shot: FeedbackShot) {
    setError(null)
    if (onPersistRemove) {
      try {
        onChange(await onPersistRemove(shot.path))
      } catch (e) {
        console.error(e)
        setError(t('site_feedback.shots.err_remove', 'No pudimos quitar la captura.'))
      }
      return
    }
    onChange(shotsRef.current.filter((s) => s.path !== shot.path))
    await removeShotFile(shot.path).catch(() => {})
  }

  // Pegar: la vía natural tras un Impr Pant o un Win+Shift+S.
  useEffect(() => {
    if (!captureGlobalPaste) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length === 0) return
      e.preventDefault()
      void addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [captureGlobalPaste, addFiles])

  const busy = pending.length > 0

  return (
    <div className={className}>
      {/* ── Zona para soltar / elegir ── */}
      {room > 0 && (
        <motion.button
          type="button"
          onClick={() => inputRef.current?.click()}
          {...dropProps}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files)
            if (files.length) { e.preventDefault(); void addFiles(files) }
          }}
          whileTap={reduce ? undefined : { scale: 0.99 }}
          className={cn(
            'group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-dashed px-3.5 text-left transition-colors duration-300',
            compact ? 'py-2.5' : 'py-3.5',
            dragging ? 'bg-subtle/70' : 'border-line bg-subtle/25 hover:bg-subtle/50',
          )}
          style={dragging ? { borderColor: accent, background: `${accent}14` } : undefined}
        >
          {/* Brillo que recorre el borde al arrastrar encima: dice "suéltalo aquí" */}
          <AnimatePresence>
            {dragging && !reduce && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-0"
                style={{ background: `radial-gradient(120% 120% at 50% 0%, ${accent}22, transparent 70%)` }}
                aria-hidden
              />
            )}
          </AnimatePresence>

          <motion.span
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors"
            style={{ background: `${accent}1f`, color: accent }}
            animate={dragging && !reduce ? { scale: 1.12, rotate: -6 } : { scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 22 }}
          >
            <ImagePlus className="h-4.5 w-4.5" />
          </motion.span>

          <span className="relative min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-text">
              {dragging
                ? t('site_feedback.shots.drop_now', 'Suelta la imagen aquí')
                : t('site_feedback.shots.cta', 'Adjuntar una captura')}
            </span>
            <span className="mt-0.5 flex items-center gap-1 text-[11.5px] leading-snug text-text-muted">
              <Clipboard className="h-3 w-3 shrink-0" />
              {t('site_feedback.shots.hint', 'Pega con Ctrl+V, arrástrala o elígela · quedan {{n}}', { n: room })}
            </span>
          </span>
        </motion.button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []))
          e.target.value = '' // permite volver a elegir el mismo archivo
        }}
      />

      {/* ── Aviso ── */}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={reduce ? false : { opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            className="mt-2 flex items-start gap-1.5 overflow-hidden text-[11.5px] leading-snug text-amber-400"
          >
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {/* ── Miniaturas ── */}
      {(shots.length > 0 || busy) && (
        <div className="mt-3 flex flex-wrap gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {shots.map((s) => (
              <motion.div
                key={s.path}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, scale: 0.8, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.75, filter: 'blur(4px)' }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              >
                <ShotThumb shot={s} shots={shots} onRemove={() => void remove(s)} />
              </motion.div>
            ))}

            {pending.map((p) => (
              <motion.div
                key={p.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                className="relative h-[4.5rem] w-[4.5rem] overflow-hidden rounded-xl border border-line"
              >
                <img src={p.preview} alt="" className="h-full w-full scale-105 object-cover opacity-40 blur-[1px]" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                </span>
                {/* Barrido de carga: dice "trabajando" sin fingir un porcentaje */}
                {!reduce && (
                  <motion.span
                    className="absolute inset-y-0 w-1/2"
                    style={{ background: `linear-gradient(90deg, transparent, ${accent}55, transparent)` }}
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                    aria-hidden
                  />
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {room <= 0 && !busy && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-text-subtle">
          <X className="h-3 w-3" />
          {t('site_feedback.shots.full', 'Llegaste al máximo de {{n}} capturas.', { n: MAX_SHOTS })}
        </p>
      )}
    </div>
  )
}
