import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check, ChevronRight, ChevronLeft, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Campaign } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

interface CampaignWizardProps {
  open: boolean
  onClose: () => void
  onCreated: (campaign: Campaign & { moduleCount: number }) => void
}

type WizardStep = 1 | 2 | 3

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 40)
}

function GlassInput({
  placeholder,
  value,
  onChange,
  type = 'text',
  className,
  hint,
}: {
  placeholder?: string
  value: string
  onChange: (v: string) => void
  type?: string
  className?: string
  hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full rounded-xl px-4 py-3 text-[14px] text-text',
          'bg-glass/5 border border-glass-border/10',
          'focus:border-neon-green/30 focus:bg-glass/8 focus:outline-none',
          'placeholder:text-text-subtle transition-all duration-200',
          className,
        )}
      />
      {hint && <p className="text-[11px] text-text-subtle pl-1">{hint}</p>}
    </div>
  )
}

function GlassTextarea({
  placeholder,
  value,
  onChange,
}: {
  placeholder?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <textarea
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      className={cn(
        'w-full rounded-xl px-4 py-3 text-[14px] text-text resize-none',
        'bg-glass/5 border border-glass-border/10',
        'focus:border-neon-green/30 focus:bg-glass/8 focus:outline-none',
        'placeholder:text-text-subtle transition-all duration-200',
      )}
    />
  )
}

function StepIndicator({ current, total }: { current: WizardStep; total: number }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-8">
      {Array.from({ length: total }, (_, i) => {
        const stepNum = (i + 1) as WizardStep
        const isCompleted = stepNum < current
        const isActive = stepNum === current
        return (
          <div key={i} className="flex items-center gap-3">
            <motion.div
              animate={isActive ? { scale: 1.1 } : { scale: 1 }}
              className={cn(
                'flex items-center justify-center rounded-full font-semibold text-[12px] transition-all duration-300',
                isActive && 'h-8 w-8 bg-neon-green text-black shadow-neon-green',
                isCompleted && 'h-7 w-7 bg-neon-green/20 border border-neon-green/30 text-neon-green',
                !isActive && !isCompleted && 'h-7 w-7 glass border-glass-border/10 text-text-subtle',
              )}
            >
              {isCompleted ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : stepNum}
            </motion.div>
            {i < total - 1 && (
              <div className={cn(
                'h-px w-8 transition-colors duration-500',
                isCompleted ? 'bg-neon-green/40' : 'bg-glass-border/10',
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function CampaignWizard({ open, onClose, onCreated }: CampaignWizardProps) {
  const [step, setStep] = useState<WizardStep>(1)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [isActive, setIsActive] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleNameChange = (v: string) => {
    setName(v)
    setSlug(slugify(v))
  }

  const handleSubmit = async () => {
    if (!name.trim() || !slug.trim()) return
    setSubmitting(true)
    setError('')
    const { data, error: err } = await supabase
      .from('campaigns')
      .insert({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
        logo_url: logoUrl.trim() || null,
        is_active: isActive,
      })
      .select()
      .single()

    setSubmitting(false)
    if (err || !data) {
      setError('Error al crear la campaña. Verifica que el slug sea único e inténtalo de nuevo.')
      return
    }
    onCreated({ ...data, moduleCount: 0 })
    handleClose()
  }

  const handleClose = () => {
    setStep(1)
    setName('')
    setSlug('')
    setDescription('')
    setLogoUrl('')
    setIsActive(false)
    setError('')
    onClose()
  }

  const canGoNext = step === 1 ? name.trim().length > 0 && slug.trim().length > 0 : true

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            className="relative z-10 w-full max-w-lg"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <GlassCard intensity="strong" rounded="3xl" className="overflow-hidden">
              {/* Borde superior neón */}
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-green/40 to-transparent" />

              <div className="p-8">
                {/* Header */}
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <NeonBadge color="green" dot className="mb-2">
                      Paso {step} de 3
                    </NeonBadge>
                    <GradientHeading as="h2" variant="white" size="headline">
                      Crear campaña
                    </GradientHeading>
                  </div>
                  <button
                    onClick={handleClose}
                    className="p-2 rounded-xl glass text-text-muted hover:text-text transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <StepIndicator current={step} total={3} />

                {/* Contenido de cada paso */}
                <AnimatePresence mode="wait">
                  {step === 1 && (
                    <motion.div
                      key="step1"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="space-y-4"
                    >
                      <div>
                        <label className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2 block">
                          Nombre de la campaña
                        </label>
                        <GlassInput
                          placeholder="Ej: Abbott Diagnostics"
                          value={name}
                          onChange={handleNameChange}
                        />
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2 block">
                          Slug (URL amigable)
                        </label>
                        <GlassInput
                          placeholder="abbott-diagnostics"
                          value={slug}
                          onChange={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                          className="font-mono"
                          hint="Solo letras minúsculas, números y guiones. Debe ser único."
                        />
                      </div>
                      <div>
                        <label className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2 block">
                          Descripción (opcional)
                        </label>
                        <GlassTextarea
                          placeholder="Breve descripción de la campaña..."
                          value={description}
                          onChange={setDescription}
                        />
                      </div>
                    </motion.div>
                  )}

                  {step === 2 && (
                    <motion.div
                      key="step2"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="space-y-5"
                    >
                      <div>
                        <label className="text-[12px] font-medium text-text-muted uppercase tracking-wider mb-2 block">
                          URL del logo (opcional)
                        </label>
                        <GlassInput
                          placeholder="https://empresa.com/logo.png"
                          value={logoUrl}
                          onChange={setLogoUrl}
                          type="url"
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <div
                            onClick={() => setIsActive(!isActive)}
                            className={cn(
                              'relative h-6 w-11 rounded-full transition-all duration-300 flex-shrink-0',
                              isActive ? 'bg-neon-green shadow-neon-green' : 'glass border-glass-border/15',
                            )}
                          >
                            <motion.span
                              animate={{ x: isActive ? 20 : 2 }}
                              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                              className="absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm"
                            />
                          </div>
                          <div>
                            <div className="text-[14px] font-medium text-text">
                              Activar campaña inmediatamente
                            </div>
                            <div className="text-[12px] text-text-subtle">
                              Los aprendices solo acceden a campañas activas
                            </div>
                          </div>
                        </label>
                      </div>
                    </motion.div>
                  )}

                  {step === 3 && (
                    <motion.div
                      key="step3"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="space-y-3"
                    >
                      <p className="text-[14px] text-text-muted mb-4">
                        Revisa los datos antes de crear la campaña.
                      </p>
                      <div className="glass rounded-2xl divide-y divide-glass-border/8">
                        {[
                          { label: 'Nombre', value: name },
                          { label: 'Slug', value: slug, mono: true },
                          description && { label: 'Descripción', value: description },
                          logoUrl && { label: 'Logo URL', value: logoUrl },
                          { label: 'Estado', value: isActive ? 'Activa' : 'Inactiva', colored: true },
                        ].filter(Boolean).map((row: any) => (
                          <div key={row.label} className="flex items-start gap-4 px-4 py-3">
                            <span className="text-[11px] uppercase tracking-wider text-text-subtle w-24 shrink-0 pt-0.5">
                              {row.label}
                            </span>
                            <span className={cn(
                              'text-[14px] text-text flex-1 break-all',
                              row.mono && 'font-mono text-neon-green/80',
                              row.colored && isActive && 'text-neon-green',
                            )}>
                              {row.value}
                            </span>
                          </div>
                        ))}
                      </div>
                      {error && (
                        <p className="text-[12px] text-danger mt-2">{error}</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Navegación */}
                <div className="flex items-center justify-between mt-8 pt-5 border-t border-glass-border/8">
                  <button
                    onClick={() => step > 1 && setStep((s) => (s - 1) as WizardStep)}
                    disabled={step === 1}
                    className="flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </button>

                  {step < 3 ? (
                    <Button
                      variant="neon"
                      size="sm"
                      disabled={!canGoNext}
                      onClick={() => setStep((s) => (s + 1) as WizardStep)}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button
                      variant="neon"
                      size="sm"
                      disabled={submitting}
                      onClick={handleSubmit}
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creando...
                        </>
                      ) : (
                        <>
                          <Check className="h-4 w-4" />
                          Crear campaña
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
