import { AnimatePresence, motion } from 'framer-motion'
import { X, FileText, Lightbulb, Image, HelpCircle, LayoutTemplate, ZoomIn, Star, Layers, Clapperboard } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { cn } from '@/lib/cn'
import type { SectionTemplate } from './AddSectionMenu'

interface SectionTemplateGalleryProps {
  open: boolean
  onClose: () => void
  onSelect: (template: SectionTemplate) => void
}

type TemplateColor = 'green' | 'violet' | 'cyan' | 'amber' | 'blue'

interface TemplateCard {
  key: SectionTemplate
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  color: TemplateColor
  preview: React.ReactNode
}

function TextOnlyPreview() {
  return (
    <div className="space-y-1.5">
      <div className="h-2 rounded-full bg-white/20 w-3/4" />
      <div className="h-1.5 rounded-full bg-white/12 w-full" />
      <div className="h-1.5 rounded-full bg-white/12 w-5/6" />
      <div className="h-1.5 rounded-full bg-white/12 w-4/5" />
    </div>
  )
}

function TextCalloutPreview() {
  return (
    <div className="space-y-1.5">
      <div className="h-2 rounded-full bg-white/20 w-3/4" />
      <div className="h-1.5 rounded-full bg-white/12 w-full" />
      <div className="h-1.5 rounded-full bg-white/12 w-5/6" />
      <div className="h-7 rounded-lg border border-neon-green/30 bg-neon-green/8 flex items-center gap-1.5 px-2 mt-1">
        <div className="h-2 w-2 rounded-full bg-neon-green/60 shrink-0" />
        <div className="h-1.5 rounded-full bg-neon-green/30 w-full" />
      </div>
    </div>
  )
}

function TextMediaPreview() {
  return (
    <div className="flex gap-2">
      <div className="flex-1 space-y-1.5">
        <div className="h-2 rounded-full bg-white/20 w-full" />
        <div className="h-1.5 rounded-full bg-white/12 w-full" />
        <div className="h-1.5 rounded-full bg-white/12 w-4/5" />
      </div>
      <div className="w-12 h-12 rounded-lg bg-white/8 border border-white/10 shrink-0 flex items-center justify-center">
        <Image className="h-3.5 w-3.5 text-white/30" />
      </div>
    </div>
  )
}

function TextQuizPreview() {
  return (
    <div className="space-y-1.5">
      <div className="h-2 rounded-full bg-white/20 w-3/4" />
      <div className="h-1.5 rounded-full bg-white/12 w-full" />
      <div className="h-6 rounded-lg border border-white/12 bg-white/6 flex items-center gap-1.5 px-2 mt-1">
        <div className="h-2 w-2 rounded-full border border-white/30 shrink-0" />
        <div className="h-1.5 rounded-full bg-white/15 w-2/3" />
      </div>
      <div className="h-6 rounded-lg border border-white/8 flex items-center gap-1.5 px-2">
        <div className="h-2 w-2 rounded-full border border-white/20 shrink-0" />
        <div className="h-1.5 rounded-full bg-white/12 w-1/2" />
      </div>
    </div>
  )
}

// ... (se mantienen tus previews existentes sin cambios)
function FullPreview() {
  return (
    <div className="space-y-1.5">
      <div className="h-2 rounded-full bg-white/20 w-3/4" />
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <div className="h-1.5 rounded-full bg-white/12 w-full" />
          <div className="h-1.5 rounded-full bg-white/12 w-5/6" />
        </div>
        <div className="w-10 h-9 rounded-md bg-white/8 border border-white/10 shrink-0" />
      </div>
      <div className="h-6 rounded-lg border border-neon-green/30 bg-neon-green/8 flex items-center gap-1.5 px-2">
        <div className="h-1.5 w-1.5 rounded-full bg-neon-green/60 shrink-0" />
        <div className="h-1.5 rounded-full bg-neon-green/30 w-full" />
      </div>
      <div className="h-6 rounded-lg border border-white/10 bg-white/4 flex items-center gap-1.5 px-2">
        <div className="h-2 w-2 rounded-full border border-white/25 shrink-0" />
        <div className="h-1.5 rounded-full bg-white/15 w-3/5" />
      </div>
    </div>
  )
}

function HeroPreview() {
  return (
    <div className="relative rounded-lg overflow-hidden h-16 w-full">
      <div className="absolute inset-0 bg-gradient-to-br from-neon-green/20 to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-end p-2">
        <div className="h-2 rounded-full bg-white/70 w-2/3 mb-1" />
        <div className="h-1.5 rounded-full bg-white/30 w-1/2" />
      </div>
    </div>
  )
}

function SpotlightPreview() {
  return (
    <div className="relative rounded-lg overflow-hidden h-16 w-full bg-black/40 border border-white/10">
      <div className="absolute inset-0 bg-gradient-to-br from-white/8 to-transparent" />
      <div className="absolute inset-0 flex flex-col justify-center items-center">
        <div className="h-2 rounded-full bg-white/80 w-3/5 mb-1.5" />
        <div className="h-1.5 rounded-full bg-white/30 w-2/5" />
      </div>
    </div>
  )
}

function FeaturePreview() {
  return (
    <div className="flex flex-col items-center space-y-1.5 w-full">
      <div className="h-7 w-7 rounded-xl bg-neon-green/15 border border-neon-green/25 flex items-center justify-center">
        <div className="h-3 w-3 rounded-sm bg-neon-green/50" />
      </div>
      <div className="h-2 rounded-full bg-white/20 w-2/3" />
      <div className="h-1.5 rounded-full bg-white/12 w-4/5" />
    </div>
  )
}

function VideoInteractivePreview() {
  return (
    <div className="flex gap-2 h-16 w-full">
      <div className="flex-1 rounded-lg bg-black/40 border border-blue-400/20 relative overflow-hidden flex items-end">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 rounded-full border-2 border-blue-400/50 flex items-center justify-center">
            <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[7px] border-l-blue-400/70 ml-0.5" />
          </div>
        </div>
        <div className="w-full px-2 pb-1.5">
          <div className="h-1 rounded-full bg-white/10 relative">
            <div className="absolute h-full w-2/5 bg-blue-400/60 rounded-full" />
            <div className="absolute h-2 w-2 rounded-full bg-blue-400 top-1/2 -translate-y-1/2" style={{ left: '40%' }} />
            <div className="absolute h-2 w-2 rounded-full bg-amber-400 top-1/2 -translate-y-1/2 border border-black/20" style={{ left: '65%' }} />
          </div>
        </div>
      </div>
      <div className="w-12 rounded-lg bg-white/6 border border-white/10 flex flex-col gap-1 p-1.5">
        <div className="h-1.5 rounded-full bg-blue-400/50 w-full" />
        <div className="h-1.5 rounded-full bg-white/15 w-3/4" />
      </div>
    </div>
  )
}

function GameSortPreview() {
  return (
    <div className="w-full space-y-1.5 flex flex-col justify-center">
      <div className="h-4 rounded-md border border-white/10 bg-white/8 flex items-center gap-2 px-2">
        <div className="h-1.5 w-3 rounded bg-white/40 shrink-0" />
        <div className="h-1 rounded-full bg-white/20 w-3/4" />
      </div>
      <div className="h-4 rounded-md border border-white/10 bg-white/4 flex items-center gap-2 px-2">
        <div className="h-1.5 w-3 rounded bg-white/20 shrink-0" />
        <div className="h-1 rounded-full bg-white/12 w-1/2" />
      </div>
    </div>
  )
}

// ─── 🌟 NUEVA MINIATURA ADICIONADA: Simula las 4 cajas punteadas de categorías de tu mockup ───
function GameClassifyPreview() {
  return (
    <div className="w-full grid grid-cols-2 gap-1.5 p-0.5">
      <div className="h-6 rounded border border-dashed border-purple-400/30 bg-purple-500/5 flex items-center justify-center">
        <div className="h-1 rounded bg-purple-400/30 w-2/3" />
      </div>
      <div className="h-6 rounded border border-dashed border-pink-400/30 bg-pink-500/5 flex items-center justify-center">
        <div className="h-1 rounded bg-pink-400/30 w-2/3" />
      </div>
      <div className="h-6 rounded border border-dashed border-red-400/30 bg-red-500/5 flex items-center justify-center">
        <div className="h-1 rounded bg-red-400/30 w-2/3" />
      </div>
      <div className="h-6 rounded border border-dashed border-orange-400/30 bg-orange-500/5 flex items-center justify-center">
        <div className="h-1 rounded bg-orange-400/30 w-2/3" />
      </div>
    </div>
  )
}

const TEMPLATES: TemplateCard[] = [
  {
    key: 'text',
    label: 'Solo texto',
    description: 'Encabezado y párrafos de contenido',
    icon: FileText,
    color: 'green',
    preview: <TextOnlyPreview />,
  },
  {
    key: 'text-callout',
    label: 'Texto + Callout',
    description: 'Contenido con caja de aviso destacada',
    icon: Lightbulb,
    color: 'green',
    preview: <TextCalloutPreview />,
  },
  {
    key: 'text-media',
    label: 'Texto + Media',
    description: 'Contenido con imagen o video',
    icon: Image,
    color: 'cyan',
    preview: <TextMediaPreview />,
  },
  {
    key: 'text-quiz',
    label: 'Texto + Quiz',
    description: 'Contenido con verificación de conocimiento',
    icon: HelpCircle,
    color: 'violet',
    preview: <TextQuizPreview />,
  },
  {
    key: 'full',
    label: 'Completo',
    description: 'Todo incluido: texto, media, callout y quiz',
    icon: LayoutTemplate,
    color: 'amber',
    preview: <FullPreview />,
  },
  {
    key: 'hero',
    label: 'Hero',
    description: 'Imagen de fondo a pantalla completa',
    icon: ZoomIn,
    color: 'green',
    preview: <HeroPreview />,
  },
  {
    key: 'spotlight',
    label: 'Spotlight',
    description: 'Sección oscura premium, centrada',
    icon: Star,
    color: 'violet',
    preview: <SpotlightPreview />,
  },
  {
    key: 'feature',
    label: 'Feature',
    description: 'Estilo Apple centrado con ícono',
    icon: Layers,
    color: 'cyan',
    preview: <FeaturePreview />,
  },
  {
    key: 'video-interactive',
    label: 'Video Interactivo',
    description: 'Video con capítulos y quizzes integrados',
    icon: Clapperboard,
    color: 'blue',
    preview: <VideoInteractivePreview />,
  },
  {
    key: 'game-sort',
    label: 'Juego: Ordenar Procesos',
    description: 'Actividad interactiva de arrastrar y ordenar pasos',
    icon: FileText,
    color: 'blue',
    preview: <GameSortPreview />,
  },
  {
    key: 'game-classify', 
    label: 'Juego: Clasificar Casos',
    description: 'Arrastrar casos operativos a categorías de fraude',
    icon: Layers,   
    color: 'blue', 
    preview: <GameClassifyPreview /> 
  },
]

const colorMap: Record<TemplateColor, string> = {
  green: 'hover:border-neon-green/25 group-hover:text-neon-green',
  violet: 'hover:border-glass-border/22 group-hover:text-text',
  cyan: 'hover:border-glass-border/22 group-hover:text-text',
  amber: 'hover:border-amber-400/25 group-hover:text-amber-400',
  blue: 'hover:border-blue-400/25 group-hover:text-blue-400',
}

const iconBgMap: Record<TemplateColor, string> = {
  green: 'bg-neon-green/10 text-neon-green ring-1 ring-neon-green/15',
  violet: 'bg-glass/8 text-text-muted ring-1 ring-glass-border/10',
  cyan: 'bg-glass/8 text-text-muted ring-1 ring-glass-border/10',
  amber: 'bg-amber-400/10 text-amber-400 ring-1 ring-amber-400/15',
  blue: 'bg-blue-400/10 text-blue-400 ring-1 ring-blue-400/15',
}

export function SectionTemplateGallery({ open, onClose, onSelect }: SectionTemplateGalleryProps) {
  const handleSelect = (key: SectionTemplate) => {
    onSelect(key)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

          <motion.div
            className="relative z-10 w-full max-w-2xl"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <GlassCard intensity="strong" rounded="3xl" className="overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-neon-green/40 to-transparent" />

              <div className="p-6">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <NeonBadge color="green" dot className="mb-2">
                      Editor · Secciones
                    </NeonBadge>
                    <GradientHeading as="h2" variant="white" size="headline">
                      Elige un template
                    </GradientHeading>
                    <p className="text-[13px] text-text-muted mt-1">
                      Cada template predefine el tipo de contenido de la sección.
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-xl glass text-text-muted hover:text-text transition-colors shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-1">
                  {TEMPLATES.map(({ key, label, description, icon: Icon, color, preview }) => (
                    <button
                      key={key}
                      onClick={() => handleSelect(key)}
                      className={cn(
                        'group flex flex-col gap-3 p-4 rounded-2xl text-left transition-all duration-200',
                        'glass border border-glass-border/8',
                        colorMap[color],
                      )}
                    >
                      <div className="w-full rounded-xl bg-black/20 border border-glass-border/8 p-3 min-h-[80px] flex items-center">
                        {preview}
                      </div>
                      <div className="flex items-start gap-3">
                        <div className={cn('h-7 w-7 rounded-lg flex items-center justify-center shrink-0', iconBgMap[color])}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <div className="text-[13px] font-semibold text-text leading-tight">{label}</div>
                          <div className="text-[11px] text-text-muted leading-snug mt-0.5">{description}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}