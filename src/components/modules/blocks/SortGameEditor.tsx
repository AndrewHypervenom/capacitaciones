import { useRef } from 'react';
import i18n from '@/i18n';
import { Plus, Trash2, GripVertical, PlusCircle } from 'lucide-react';
import type { GameSortBlock, GameSortProcess, GameSortStep } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { cn } from '@/lib/cn';

interface Props {
  block: GameSortBlock;
  onChange: (block: GameSortBlock) => void;
  lang: Language;
}

const emptyML = () => ({ es: '', en: '', pt: '' });

function newProcess(): GameSortProcess {
  return {
    id: crypto.randomUUID(),
    title: emptyML(),
    steps: [],
    feedback_correct: emptyML(),
    feedback_wrong: emptyML(),
  };
}

function newStep(): GameSortStep {
  return { id: crypto.randomUUID(), text: emptyML() };
}

export function SortGameEditor({ block, onChange, lang }: Props) {
  const dragStep = useRef<{ procIdx: number; stepIdx: number } | null>(null);

  // ── Helpers de procesos ──────────────────────────────────────────

  const updateProcess = (procIdx: number, updated: Partial<GameSortProcess>) => {
    const processes = block.processes.map((p, i) =>
      i === procIdx ? { ...p, ...updated } : p
    );
    onChange({ ...block, processes });
  };

  const addProcess = () => {
    onChange({ ...block, processes: [...block.processes, newProcess()] });
  };

  const removeProcess = (procIdx: number) => {
    onChange({ ...block, processes: block.processes.filter((_, i) => i !== procIdx) });
  };

  // ── Helpers de pasos ─────────────────────────────────────────────

  const updateStep = (procIdx: number, stepIdx: number, text: string) => {
    const steps = block.processes[procIdx].steps.map((s, i) =>
      i === stepIdx ? { ...s, text: { ...s.text, [lang]: text } } : s
    );
    updateProcess(procIdx, { steps });
  };

  const addStep = (procIdx: number) => {
    const steps = [...block.processes[procIdx].steps, newStep()];
    updateProcess(procIdx, { steps });
  };

  const removeStep = (procIdx: number, stepIdx: number) => {
    const steps = block.processes[procIdx].steps.filter((_, i) => i !== stepIdx);
    updateProcess(procIdx, { steps });
  };

  // ── Drag & drop de pasos (reordenar el orden correcto) ───────────

  const handleStepDragStart = (procIdx: number, stepIdx: number) => {
    dragStep.current = { procIdx, stepIdx };
  };

  const handleStepDrop = (procIdx: number, targetIdx: number) => {
    if (!dragStep.current) return;
    if (dragStep.current.procIdx !== procIdx) return;
    const { stepIdx } = dragStep.current;
    if (stepIdx === targetIdx) return;

    const steps = [...block.processes[procIdx].steps];
    const [moved] = steps.splice(stepIdx, 1);
    steps.splice(targetIdx, 0, moved);
    updateProcess(procIdx, { steps });
    dragStep.current = null;
  };

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Título e instrucciones del bloque */}
      <div className="space-y-3">
        <div>
          <label className="text-[11px] uppercase tracking-widest text-text-subtle mb-1 block">
            {i18n.t('admin.modules.be.ge_game_title')}
          </label>
          <input
            value={block.title?.[lang] ?? ''}
            onChange={(e) =>
              onChange({ ...block, title: { ...block.title, [lang]: e.target.value } })
            }
            placeholder={i18n.t('admin.modules.be.ge_ph_title_sort')}
            className="w-full px-3 py-2 rounded-lg glass border border-glass-border/20 text-[13.5px] text-text bg-transparent focus:outline-none focus:border-neon-green/40"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-widest text-text-subtle mb-1 block">
            {i18n.t('admin.modules.be.ge_instructions')}
          </label>
          <input
            value={block.instructions?.[lang] ?? ''}
            onChange={(e) =>
              onChange({ ...block, instructions: { ...block.instructions, [lang]: e.target.value } })
            }
            placeholder={i18n.t('admin.modules.be.ge_ph_instructions_sort')}
            className="w-full px-3 py-2 rounded-lg glass border border-glass-border/20 text-[13.5px] text-text bg-transparent focus:outline-none focus:border-neon-green/40"
          />
        </div>
      </div>

      {/* Lista de procesos */}
      {block.processes.map((proc, procIdx) => (
        <div
          key={proc.id}
          className="rounded-xl border border-glass-border/20 glass overflow-hidden"
        >
          {/* Header del proceso */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-glass-border/10">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-neon-green/10 border border-neon-green/20 text-neon-green text-[11px] font-bold flex items-center justify-center">
                {procIdx + 1}
              </span>
              <input
                value={proc.title?.[lang] ?? ''}
                onChange={(e) =>
                  updateProcess(procIdx, {
                   title: { es: '', en: '', pt: '', ...proc.title, [lang]: e.target.value },
                  })
                }
                placeholder={`Nombre del proceso ${procIdx + 1}`}
                className="bg-transparent text-[13.5px] font-medium text-text focus:outline-none placeholder:text-text-subtle/40 min-w-0 flex-1"
              />
            </div>
            {block.processes.length > 1 && (
              <button
                onClick={() => removeProcess(procIdx)}
                className="text-text-subtle/40 hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Pasos del proceso */}
          <div className="p-4 space-y-2">
            <p className="text-[11px] uppercase tracking-widest text-text-subtle mb-3">
              {i18n.t('admin.modules.be.ge_steps_hint')}
            </p>

            {proc.steps.length === 0 && (
              <p className="text-[12px] text-text-subtle/50 text-center py-3">
                {i18n.t('admin.modules.be.ge_no_steps')}
              </p>
            )}

            {proc.steps.map((step, stepIdx) => (
              <div
                key={step.id}
                draggable
                onDragStart={() => handleStepDragStart(procIdx, stepIdx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleStepDrop(procIdx, stepIdx)}
                className="flex items-center gap-2 group"
              >
                <GripVertical className="h-4 w-4 text-text-subtle/30 cursor-grab shrink-0" />
                <span className="text-[11px] text-text-subtle/50 w-4 text-center shrink-0">
                  {stepIdx + 1}
                </span>
                <input
                  value={step.text[lang] ?? ''}
                  onChange={(e) => updateStep(procIdx, stepIdx, e.target.value)}
                  placeholder={`Paso ${stepIdx + 1}`}
                  className="flex-1 px-3 py-2 rounded-lg glass border border-glass-border/15 text-[13px] text-text bg-transparent focus:outline-none focus:border-neon-green/40"
                />
                <button
                  onClick={() => removeStep(procIdx, stepIdx)}
                  className="text-text-subtle/30 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <button
              onClick={() => addStep(procIdx)}
              className="flex items-center gap-2 text-[12px] text-text-subtle hover:text-neon-green transition-colors mt-1"
            >
              <Plus className="h-3.5 w-3.5" />
              {i18n.t('admin.modules.be.ge_add_step')}
            </button>
          </div>

          {/* Feedback del proceso */}
          <div className="px-4 pb-4 space-y-2 border-t border-glass-border/10 pt-3">
            <p className="text-[11px] uppercase tracking-widest text-text-subtle">
              {i18n.t('admin.modules.be.ge_feedback_msgs')}
            </p>
            <input
              value={proc.feedback_correct?.[lang] ?? ''}
              onChange={(e) =>
                updateProcess(procIdx, {
                 feedback_correct: { es: '', en: '', pt: '', ...proc.feedback_correct, [lang]: e.target.value },
                })
              }
              placeholder={i18n.t('admin.modules.be.ge_ph_msg_correct')}
              className="w-full px-3 py-2 rounded-lg border border-neon-green/15 bg-neon-green/5 text-[12.5px] text-text focus:outline-none focus:border-neon-green/40 placeholder:text-text-subtle/40"
            />
            <input
              value={proc.feedback_wrong?.[lang] ?? ''}
              onChange={(e) =>
                updateProcess(procIdx, {
                 feedback_wrong: { es: '', en: '', pt: '', ...proc.feedback_wrong, [lang]: e.target.value },
                })
              }
              placeholder={i18n.t('admin.modules.be.ge_ph_msg_wrong')}
              className="w-full px-3 py-2 rounded-lg border border-red-500/15 bg-red-500/5 text-[12.5px] text-text focus:outline-none focus:border-red-500/30 placeholder:text-text-subtle/40"
            />
          </div>
        </div>
      ))}

      {/* Botón agregar proceso */}
      <button
        onClick={addProcess}
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-dashed border-glass-border/30 text-text-subtle text-[13px] hover:border-neon-green/30 hover:text-neon-green transition-colors"
      >
        <PlusCircle className="h-4 w-4" />
        {i18n.t('admin.modules.be.ge_add_process')}
      </button>

    </div>
  );
}