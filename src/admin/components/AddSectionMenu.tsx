import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Lightbulb,
  Image,
  HelpCircle,
  LayoutTemplate,
  Plus,
  Loader2,
  ChevronDown,
  ZoomIn,
  Star,
  Layers,
  Clapperboard,
} from 'lucide-react';

export type SectionTemplate = 'text' | 'text-callout' | 'text-media' | 'text-quiz' | 'full' | 'hero' | 'spotlight' | 'feature' | 'video-interactive';

interface Props {
  disabled?: boolean;
  onSelect: (template: SectionTemplate) => void;
}

interface TemplateOption {
  key: SectionTemplate;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}

export function AddSectionMenu({ disabled, onSelect }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const templates = useMemo<TemplateOption[]>(() => [
    { key: 'text',         icon: FileText,       label: 'Solo texto',                                  description: 'Encabezado + párrafos' },
    { key: 'text-callout', icon: Lightbulb,      label: 'Texto + Callout',                             description: 'Con caja de aviso' },
    { key: 'text-media',   icon: Image,          label: 'Texto + Media',                               description: 'Con imagen o video' },
    { key: 'text-quiz',    icon: HelpCircle,     label: 'Texto + Quiz',                                description: 'Con verificación' },
    { key: 'full',         icon: LayoutTemplate, label: 'Completo',                                    description: 'Todo incluido' },
    { key: 'hero',              icon: ZoomIn,        label: t('admin.modules.template_hero'),              description: 'Imagen de fondo full' },
    { key: 'spotlight',         icon: Star,          label: t('admin.modules.template_spotlight'),         description: 'Sección oscura premium' },
    { key: 'feature',           icon: Layers,        label: t('admin.modules.template_feature'),           description: 'Centrado, estilo Apple' },
    { key: 'video-interactive', icon: Clapperboard,  label: t('admin.modules.template_video_interactive'), description: 'Video + capítulos + quizzes' },
  ], [t]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = (key: SectionTemplate) => {
    setOpen(false);
    onSelect(key);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] font-medium text-text-muted hover:text-text hover:bg-subtle transition-colors border border-line disabled:opacity-50"
      >
        {disabled ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {t('admin.modules.add_from_template')}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-64 rounded-2xl border border-line bg-surface shadow-xl z-20 overflow-hidden py-1.5">
          {templates.map(({ key, icon: Icon, label, description }) => (
            <button
              key={key}
              onClick={() => handleSelect(key)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-subtle transition-colors text-left group"
            >
              <div className="h-7 w-7 rounded-lg bg-subtle group-hover:bg-surface border border-line flex items-center justify-center shrink-0 transition-colors">
                <Icon className="h-3.5 w-3.5 text-text-muted" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-text leading-tight">{label}</div>
                <div className="text-[11px] text-text-subtle leading-tight">{description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
