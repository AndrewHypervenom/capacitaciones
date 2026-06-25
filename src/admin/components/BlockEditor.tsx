import { useState, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  GripVertical, Plus, Trash2, ChevronUp, ChevronDown,
  Type, AlignLeft, List, Image as ImageIcon, Video, Lightbulb,
  HelpCircle, CreditCard, ChevronDown as AccIcon, Layers, Code,
  Quote, Minus, Columns, Clock, Table,
} from 'lucide-react';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import {
  type BlockWithId,
  type ContentBlock,
  type BlockType,
  emptyBlock,
} from '@/types/blocks';
import { BlockInsertMenu } from './BlockInsertMenu';
import { MediaUploader } from './MediaUploader';
import { cn } from '@/lib/cn';

// Context for uploading media from within the block editor
interface MediaContext {
  moduleId: string;
  sectionId: string;
  campaignId: string;
}

// ─── Language type ─────────────────────────────────────────────
type Lang = 'es' | 'en' | 'pt';
const LANGS: Lang[] = ['es', 'en', 'pt'];
const LANG_LABELS: Record<Lang, string> = { es: 'ES', en: 'EN', pt: 'PT' };

// ─── Inline text field for multilingual blocks ─────────────────

function MLInput({
  value, onChange, placeholder, multiline, lang,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  lang: Lang;
}) {
  if (multiline) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? `Texto (${lang})...`}
        rows={3}
        className="w-full bg-transparent text-[14px] text-text placeholder:text-text-subtle outline-none resize-none leading-relaxed"
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? `Texto (${lang})...`}
      className="w-full bg-transparent text-[14px] text-text placeholder:text-text-subtle outline-none"
    />
  );
}

// ─── Individual block editors ──────────────────────────────────

function ParagraphEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'paragraph' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  return (
    <MLInput
      value={block.text[lang]}
      onChange={(v) => onChange({ ...block, text: { ...block.text, [lang]: v } })}
      multiline
      lang={lang}
    />
  );
}

function HeadingEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'heading' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  return (
    <div className="flex items-center gap-3">
      <select
        value={block.level}
        onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 2 | 3 })}
        className="glass rounded-lg px-2 py-1 text-[12px] text-text-muted bg-transparent outline-none"
      >
        <option value={2}>H2</option>
        <option value={3}>H3</option>
      </select>
      <MLInput
        value={block.text[lang]}
        onChange={(v) => onChange({ ...block, text: { ...block.text, [lang]: v } })}
        lang={lang}
        placeholder={`Título (${lang})...`}
      />
    </div>
  );
}

function ListEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'list' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  const items = block.items;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-2">
        <label className="text-[12px] text-text-muted">Tipo:</label>
        <select
          value={block.ordered ? 'ordered' : 'bullet'}
          onChange={(e) => onChange({ ...block, ordered: e.target.value === 'ordered' })}
          className="glass rounded-lg px-2 py-1 text-[12px] text-text-muted bg-transparent outline-none"
        >
          <option value="bullet">Bullet</option>
          <option value="ordered">Numerada</option>
        </select>
      </div>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-text-subtle text-[12px] w-4 text-right shrink-0">{block.ordered ? `${i + 1}.` : '•'}</span>
          <input
            type="text"
            value={item[lang]}
            onChange={(e) => {
              const next = items.map((it, j) => j === i ? { ...it, [lang]: e.target.value } : it);
              onChange({ ...block, items: next });
            }}
            placeholder={`Ítem ${i + 1} (${lang})...`}
            className="flex-1 bg-transparent text-[13.5px] text-text placeholder:text-text-subtle outline-none"
          />
          <button
            onClick={() => onChange({ ...block, items: items.filter((_, j) => j !== i) })}
            className="text-text-subtle hover:text-red-400 transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange({ ...block, items: [...items, { es: '', en: '', pt: '' }] })}
        className="text-[12px] text-text-subtle hover:text-neon-green transition-colors flex items-center gap-1 mt-1"
      >
        <Plus className="h-3 w-3" /> Añadir ítem
      </button>
    </div>
  );
}

function CalloutEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'callout' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  const kinds = ['tip', 'important', 'warning', 'success', 'quote', 'note'] as const;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button
            key={k}
            onClick={() => onChange({ ...block, kind: k })}
            className={cn(
              'px-3 py-1 rounded-full text-[11px] font-medium transition-colors',
              block.kind === k ? 'bg-neon-green/15 text-neon-green border border-neon-green/20' : 'glass text-text-muted hover:text-text',
            )}
          >
            {k}
          </button>
        ))}
      </div>
      <MLInput
        value={block.text[lang]}
        onChange={(v) => onChange({ ...block, text: { ...block.text, [lang]: v } })}
        multiline lang={lang}
        placeholder="Texto del callout..."
      />
    </div>
  );
}

function ImageEditor({
  block, onChange, mediaContext,
}: {
  block: ContentBlock & { type: 'image' };
  onChange: (b: ContentBlock) => void;
  mediaContext?: MediaContext;
}) {
  return (
    <div className="space-y-3">
      {mediaContext ? (
        <MediaUploader
          moduleId={mediaContext.moduleId}
          sectionId={mediaContext.sectionId}
          campaignId={mediaContext.campaignId}
          currentType={block.url ? 'image' : null}
          currentUrl={block.url || null}
          onSaved={(_type, url) => onChange({ ...block, url })}
          onCleared={() => onChange({ ...block, url: '' })}
        />
      ) : (
        <>
          <input
            type="url"
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="URL de la imagen..."
            className="w-full glass rounded-xl px-3 py-2 text-[13px] text-text placeholder:text-text-subtle outline-none"
          />
          {block.url && (
            <img src={block.url} alt="" className="w-full max-h-48 object-cover rounded-xl border border-line" />
          )}
        </>
      )}
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-text-muted">Tamaño:</label>
          <select value={block.size ?? 'full'} onChange={(e) => onChange({ ...block, size: e.target.value as 'sm' | 'md' | 'lg' | 'full' })}
            className="glass rounded-lg px-2 py-1 text-[12px] text-text-muted bg-transparent outline-none">
            {['sm','md','lg','full'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-text-muted">Alinear:</label>
          <select value={block.align ?? 'center'} onChange={(e) => onChange({ ...block, align: e.target.value as 'left' | 'center' | 'right' })}
            className="glass rounded-lg px-2 py-1 text-[12px] text-text-muted bg-transparent outline-none">
            {['left','center','right'].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer">
          <input type="checkbox" checked={block.shadow ?? false} onChange={(e) => onChange({ ...block, shadow: e.target.checked })}
            className="accent-neon-green" />
          Sombra
        </label>
      </div>
    </div>
  );
}

function VideoEditor({
  block, onChange, mediaContext,
}: {
  block: ContentBlock & { type: 'video' };
  onChange: (b: ContentBlock) => void;
  mediaContext?: MediaContext;
}) {
  if (block.kind !== 'youtube' && mediaContext) {
    return (
      <div className="space-y-3">
        <div className="flex gap-1.5">
          <button onClick={() => onChange({ ...block, kind: 'youtube' })}
            className="glass px-3 py-1 rounded-full text-[11px] font-medium text-text-muted hover:text-text transition-colors">
            YouTube
          </button>
          <span className="px-3 py-1 rounded-full text-[11px] font-medium bg-neon-green/15 text-neon-green border border-neon-green/20">
            Archivo
          </span>
        </div>
        <MediaUploader
          moduleId={mediaContext.moduleId}
          sectionId={mediaContext.sectionId}
          campaignId={mediaContext.campaignId}
          currentType={block.url ? 'video' : null}
          currentUrl={block.url || null}
          onSaved={(_type, url) => onChange({ ...block, url })}
          onCleared={() => onChange({ ...block, url: '' })}
        />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['youtube', 'upload'] as const).map((k) => (
          <button key={k} onClick={() => onChange({ ...block, kind: k })}
            className={cn('px-3 py-1 rounded-full text-[11px] font-medium transition-colors',
              block.kind === k ? 'bg-neon-green/15 text-neon-green border border-neon-green/20' : 'glass text-text-muted hover:text-text')}>
            {k === 'youtube' ? 'YouTube' : 'Archivo'}
          </button>
        ))}
      </div>
      <input
        type="url"
        value={block.url}
        onChange={(e) => onChange({ ...block, url: e.target.value })}
        placeholder="ID o URL de YouTube..."
        className="w-full glass rounded-xl px-3 py-2 text-[13px] text-text placeholder:text-text-subtle outline-none"
      />
    </div>
  );
}

function QuizEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'quiz' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  return (
    <div className="space-y-3">
      <input
        type="text"
        value={block.question[lang]}
        onChange={(e) => onChange({ ...block, question: { ...block.question, [lang]: e.target.value } })}
        placeholder={`Pregunta (${lang})...`}
        className="w-full bg-transparent text-[13.5px] text-text placeholder:text-text-subtle outline-none font-medium"
      />
      <div className="space-y-2">
        {block.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="radio" name="correct" checked={block.correct === i}
              onChange={() => onChange({ ...block, correct: i })}
              className="accent-neon-green shrink-0" />
            <input
              type="text"
              value={opt.text[lang]}
              onChange={(e) => {
                const next = block.options.map((o, j) => j === i ? { text: { ...o.text, [lang]: e.target.value } } : o);
                onChange({ ...block, options: next });
              }}
              placeholder={`Opción ${i + 1} (${lang})...`}
              className={cn('flex-1 bg-transparent text-[13px] placeholder:text-text-subtle outline-none',
                block.correct === i ? 'text-neon-green' : 'text-text-muted')}
            />
          </div>
        ))}
      </div>
      <input
        type="text"
        value={block.explanation[lang]}
        onChange={(e) => onChange({ ...block, explanation: { ...block.explanation, [lang]: e.target.value } })}
        placeholder={`Explicación (${lang})...`}
        className="w-full bg-transparent text-[12.5px] text-text-subtle placeholder:text-text-subtle outline-none italic"
      />
    </div>
  );
}

function FlashcardEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'flashcard' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  return (
    <div className="space-y-3">
      {block.cards.map((card, i) => (
        <div key={i} className="glass rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-subtle font-medium">Tarjeta {i + 1}</span>
            <button onClick={() => onChange({ ...block, cards: block.cards.filter((_, j) => j !== i) })}
              className="text-text-subtle hover:text-red-400 transition-colors">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <input type="text" value={card.front[lang]}
            onChange={(e) => {
              const next = block.cards.map((c, j) => j === i ? { ...c, front: { ...c.front, [lang]: e.target.value } } : c);
              onChange({ ...block, cards: next });
            }}
            placeholder={`Frente (${lang})...`}
            className="w-full bg-transparent text-[13px] text-text placeholder:text-text-subtle outline-none" />
          <div className="h-px bg-glass-border/10" />
          <input type="text" value={card.back[lang]}
            onChange={(e) => {
              const next = block.cards.map((c, j) => j === i ? { ...c, back: { ...c.back, [lang]: e.target.value } } : c);
              onChange({ ...block, cards: next });
            }}
            placeholder={`Reverso (${lang})...`}
            className="w-full bg-transparent text-[13px] text-text-muted placeholder:text-text-subtle outline-none" />
        </div>
      ))}
      <button onClick={() => onChange({ ...block, cards: [...block.cards, { front: { es: '', en: '', pt: '' }, back: { es: '', en: '', pt: '' } }] })}
        className="text-[12px] text-text-subtle hover:text-neon-green transition-colors flex items-center gap-1">
        <Plus className="h-3 w-3" /> Añadir tarjeta
      </button>
    </div>
  );
}

function AccordionEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'accordion' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  return (
    <div className="space-y-2">
      {block.items.map((item, i) => (
        <div key={i} className="glass rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-subtle">Ítem {i + 1}</span>
            <button onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== i) })}
              className="text-text-subtle hover:text-red-400 transition-colors"><Trash2 className="h-3 w-3" /></button>
          </div>
          <input type="text" value={item.question[lang]}
            onChange={(e) => {
              const next = block.items.map((it, j) => j === i ? { ...it, question: { ...it.question, [lang]: e.target.value } } : it);
              onChange({ ...block, items: next });
            }}
            placeholder={`Pregunta (${lang})...`}
            className="w-full bg-transparent text-[13px] font-medium text-text placeholder:text-text-subtle outline-none" />
          <textarea value={item.answer[lang]}
            onChange={(e) => {
              const next = block.items.map((it, j) => j === i ? { ...it, answer: { ...it.answer, [lang]: e.target.value } } : it);
              onChange({ ...block, items: next });
            }}
            placeholder={`Respuesta (${lang})...`}
            rows={2}
            className="w-full bg-transparent text-[13px] text-text-muted placeholder:text-text-subtle outline-none resize-none" />
        </div>
      ))}
      <button onClick={() => onChange({ ...block, items: [...block.items, { question: { es: '', en: '', pt: '' }, answer: { es: '', en: '', pt: '' } }] })}
        className="text-[12px] text-text-subtle hover:text-neon-green transition-colors flex items-center gap-1">
        <Plus className="h-3 w-3" /> Añadir ítem
      </button>
    </div>
  );
}

function TabsEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'tabs' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  const emptyML = () => ({ es: '', en: '', pt: '' });
  return (
    <div className="space-y-3">
      {block.tabs.map((tab, i) => (
        <div key={i} className="glass rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-text-subtle uppercase tracking-wide">Pestaña {i + 1}</span>
            <button
              onClick={() => onChange({ ...block, tabs: block.tabs.filter((_, j) => j !== i) })}
              className="text-text-subtle hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          <input
            type="text"
            value={tab.label[lang]}
            onChange={(e) => {
              const next = block.tabs.map((t, j) => j === i ? { ...t, label: { ...t.label, [lang]: e.target.value } } : t);
              onChange({ ...block, tabs: next });
            }}
            placeholder={`Nombre de pestaña (${lang})...`}
            className="w-full bg-transparent text-[13px] font-medium text-text placeholder:text-text-subtle outline-none border-b border-glass-border/10 pb-1"
          />
          <textarea
            value={tab.content[lang]}
            onChange={(e) => {
              const next = block.tabs.map((t, j) => j === i ? { ...t, content: { ...t.content, [lang]: e.target.value } } : t);
              onChange({ ...block, tabs: next });
            }}
            placeholder={`Contenido (${lang})...`}
            rows={3}
            className="w-full bg-transparent text-[13px] text-text-muted placeholder:text-text-subtle outline-none resize-none"
          />
        </div>
      ))}
      <button
        onClick={() => onChange({ ...block, tabs: [...block.tabs, { label: emptyML(), content: emptyML() }] })}
        className="text-[12px] text-text-subtle hover:text-neon-green transition-colors flex items-center gap-1"
      >
        <Plus className="h-3 w-3" /> Añadir pestaña
      </button>
    </div>
  );
}

function TimelineEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'timeline' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  const emptyML = () => ({ es: '', en: '', pt: '' });
  return (
    <div className="space-y-3">
      {block.items.map((item, i) => (
        <div key={i} className="glass rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-5 w-5 rounded-full bg-neon-green/15 border border-neon-green/25 flex items-center justify-center">
                <span className="text-[9px] font-bold text-neon-green">{i + 1}</span>
              </div>
              <span className="text-[11px] font-semibold text-text-subtle uppercase tracking-wide">Evento {i + 1}</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={item.icon ?? ''}
                onChange={(e) => {
                  const next = block.items.map((it, j) => j === i ? { ...it, icon: e.target.value } : it);
                  onChange({ ...block, items: next });
                }}
                placeholder="emoji"
                className="w-12 bg-transparent text-[13px] text-center text-text placeholder:text-text-subtle outline-none"
              />
              <button
                onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== i) })}
                className="text-text-subtle hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
          <input
            type="text"
            value={item.label[lang]}
            onChange={(e) => {
              const next = block.items.map((it, j) => j === i ? { ...it, label: { ...it.label, [lang]: e.target.value } } : it);
              onChange({ ...block, items: next });
            }}
            placeholder={`Título del evento (${lang})...`}
            className="w-full bg-transparent text-[13px] font-medium text-text placeholder:text-text-subtle outline-none"
          />
          <textarea
            value={item.description[lang]}
            onChange={(e) => {
              const next = block.items.map((it, j) => j === i ? { ...it, description: { ...it.description, [lang]: e.target.value } } : it);
              onChange({ ...block, items: next });
            }}
            placeholder={`Descripción (${lang})...`}
            rows={2}
            className="w-full bg-transparent text-[13px] text-text-muted placeholder:text-text-subtle outline-none resize-none"
          />
        </div>
      ))}
      <button
        onClick={() => onChange({ ...block, items: [...block.items, { label: emptyML(), description: emptyML() }] })}
        className="text-[12px] text-text-subtle hover:text-neon-green transition-colors flex items-center gap-1"
      >
        <Plus className="h-3 w-3" /> Añadir evento
      </button>
    </div>
  );
}

function ComparisonEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'comparison' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  const emptyML = () => ({ es: '', en: '', pt: '' });
  const colCount = block.headers.length;

  const addColumn = () => {
    onChange({
      ...block,
      headers: [...block.headers, emptyML()],
      rows: block.rows.map((row) => [...row, emptyML()]),
    });
  };

  const removeColumn = (ci: number) => {
    if (colCount <= 1) return;
    onChange({
      ...block,
      headers: block.headers.filter((_, j) => j !== ci),
      rows: block.rows.map((row) => row.filter((_, j) => j !== ci)),
    });
  };

  const addRow = () => {
    onChange({ ...block, rows: [...block.rows, Array.from({ length: colCount }, emptyML)] });
  };

  const removeRow = (ri: number) => {
    onChange({ ...block, rows: block.rows.filter((_, j) => j !== ri) });
  };

  const updateHeader = (ci: number, val: string) => {
    const next = block.headers.map((h, j) => j === ci ? { ...h, [lang]: val } : h);
    onChange({ ...block, headers: next });
  };

  const updateCell = (ri: number, ci: number, val: string) => {
    const next = block.rows.map((row, j) =>
      j === ri ? row.map((cell, k) => k === ci ? { ...cell, [lang]: val } : cell) : row
    );
    onChange({ ...block, rows: next });
  };

  return (
    <div className="space-y-3 overflow-x-auto">
      {/* Headers row */}
      <div className="flex gap-1 items-center">
        <span className="text-[10px] text-text-subtle w-6 shrink-0" />
        {block.headers.map((h, ci) => (
          <div key={ci} className="flex-1 flex items-center gap-1 min-w-0">
            <input
              type="text"
              value={h[lang]}
              onChange={(e) => updateHeader(ci, e.target.value)}
              placeholder={`Col ${ci + 1} (${lang})`}
              className="flex-1 glass rounded-lg px-2 py-1.5 text-[12px] font-semibold text-text placeholder:text-text-subtle outline-none min-w-0"
            />
            <button
              onClick={() => removeColumn(ci)}
              className="shrink-0 text-text-subtle hover:text-red-400 transition-colors"
              title="Eliminar columna"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          onClick={addColumn}
          className="shrink-0 text-[11px] text-text-subtle hover:text-neon-green transition-colors"
          title="Agregar columna"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {block.rows.map((row, ri) => (
          <div key={ri} className="flex gap-1 items-center">
            <span className="text-[10px] text-text-subtle w-6 shrink-0 text-right">{ri + 1}</span>
            {row.map((cell, ci) => (
              <input
                key={ci}
                type="text"
                value={cell[lang]}
                onChange={(e) => updateCell(ri, ci, e.target.value)}
                placeholder={`Celda (${lang})`}
                className="flex-1 glass rounded-lg px-2 py-1.5 text-[12px] text-text placeholder:text-text-subtle outline-none min-w-0"
              />
            ))}
            <button
              onClick={() => removeRow(ri)}
              className="shrink-0 text-text-subtle hover:text-red-400 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        className="text-[12px] text-text-subtle hover:text-neon-green transition-colors flex items-center gap-1"
      >
        <Plus className="h-3 w-3" /> Añadir fila
      </button>
    </div>
  );
}

function ColumnsEditor({ block, onChange, lang }: { block: ContentBlock & { type: 'columns' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  const colCount = block.columns.length;

  const setColCount = (n: 2 | 3) => {
    if (n === colCount) return;
    if (n === 3) {
      onChange({ ...block, columns: [...block.columns, { blocks: [] }] });
    } else {
      onChange({ ...block, columns: block.columns.slice(0, 2) });
    }
  };

  // Each column's text content: concatenate paragraph block texts for editing
  const getColText = (ci: number): string =>
    block.columns[ci].blocks
      .filter((b) => b.type === 'paragraph')
      .map((b) => (b.type === 'paragraph' ? b.text[lang] : ''))
      .join('\n\n');

  const setColText = (ci: number, raw: string) => {
    const paragraphs = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const blocks: ContentBlock[] = paragraphs.map((p) => ({
      type: 'paragraph' as const,
      text: { es: lang === 'es' ? p : (block.columns[ci].blocks.find((b) => b.type === 'paragraph') as { type: 'paragraph'; text: Record<string, string> } | undefined)?.text?.es ?? p, en: lang === 'en' ? p : '', pt: lang === 'pt' ? p : '' },
    }));
    const next = block.columns.map((col, i) => i === ci ? { blocks } : col);
    onChange({ ...block, columns: next });
  };

  return (
    <div className="space-y-3">
      {/* Column count toggle */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-text-muted">Columnas:</span>
        {([2, 3] as const).map((n) => (
          <button
            key={n}
            onClick={() => setColCount(n)}
            className={cn(
              'px-3 py-1 rounded-full text-[11px] font-medium transition-colors',
              colCount === n
                ? 'bg-neon-green/15 text-neon-green border border-neon-green/20'
                : 'glass text-text-muted hover:text-text',
            )}
          >
            {n} columnas
          </button>
        ))}
      </div>

      {/* Column text areas */}
      <div className={cn('grid gap-3', colCount === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {block.columns.map((col, ci) => (
          <div key={ci} className="space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-text-subtle font-semibold">
              Col {ci + 1} · {col.blocks.length} bloque{col.blocks.length !== 1 ? 's' : ''}
            </p>
            <textarea
              value={getColText(ci)}
              onChange={(e) => setColText(ci, e.target.value)}
              placeholder={`Texto columna ${ci + 1} (${lang})...\n\nSepara párrafos con línea en blanco`}
              rows={5}
              className="w-full glass rounded-xl px-3 py-2 text-[12.5px] text-text placeholder:text-text-subtle outline-none resize-none leading-relaxed"
            />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-text-subtle italic">Separa párrafos con una línea en blanco. Para contenido complejo usa bloques individuales.</p>
    </div>
  );
}

function CodeEditorBlock({ block, onChange }: { block: ContentBlock & { type: 'code' }; onChange: (b: ContentBlock) => void }) {
  return (
    <div className="space-y-2">
      <input type="text" value={block.language}
        onChange={(e) => onChange({ ...block, language: e.target.value })}
        placeholder="Lenguaje / tipo (javascript, python, sql, bash...)"
        className="w-full glass rounded-lg px-3 py-1.5 text-[12px] text-text-muted placeholder:text-text-subtle outline-none" />
      <textarea value={block.code}
        onChange={(e) => onChange({ ...block, code: e.target.value })}
        placeholder="Contenido del fragmento..."
        rows={6}
        className="w-full glass rounded-xl p-3 text-[12.5px] font-mono text-text placeholder:text-text-subtle outline-none resize-y" />
    </div>
  );
}

function QuoteEditorBlock({ block, onChange, lang }: { block: ContentBlock & { type: 'quote' }; onChange: (b: ContentBlock) => void; lang: Lang }) {
  return (
    <div className="space-y-2">
      <MLInput value={block.text[lang]} onChange={(v) => onChange({ ...block, text: { ...block.text, [lang]: v } })} multiline lang={lang} placeholder="Cita..." />
      <input type="text" value={block.author?.[lang] ?? ''}
        onChange={(e) => onChange({ ...block, author: { ...(block.author ?? { es: '', en: '', pt: '' }), [lang]: e.target.value } })}
        placeholder={`Autor (${lang}, opcional)...`}
        className="w-full bg-transparent text-[12.5px] italic text-text-subtle placeholder:text-text-subtle outline-none" />
    </div>
  );
}
// ─── INICIO: CÓDIGO AGREGADO POR JEANNY TOLE ───────────────────
// Formulario de configuración exclusivo para el juego de ordenar procesos
function SortGameEditor({ 
  block, 
  onChange, 
  lang 
}: { 
  block: any; 
  onChange: (b: any) => void; 
  lang: 'es' | 'en' | 'pt'; 
}) {
  const title = block.title?.[lang] ?? '';
  const instructions = block.instructions?.[lang] ?? '';
  const steps = block.steps ?? [];

  // 1. Función para añadir un paso nuevo vacío a la lista
  const handleAddStep = () => {
    const newStep = {
      id: crypto.randomUUID(), // Le da un código único al paso
      text: { es: '', en: '', pt: '' } // Espacio libre para los idiomas
    };
    onChange({ ...block, steps: [...steps, newStep] });
  };

  // 2. Función para editar el texto de un paso en tiempo real
  const handleEditStep = (id: string, value: string) => {
    const updatedSteps = steps.map((step: any) => {
      if (step.id === id) {
        return { ...step, text: { ...step.text, [lang]: value } };
      }
      return step;
    });
    onChange({ ...block, steps: updatedSteps });
  };

  // 3. Función para eliminar un paso de la lista cuando presionas la ✕
  const handleDeleteStep = (id: string) => {
    const updatedSteps = steps.filter((step: any) => step.id !== id);
    onChange({ ...block, steps: updatedSteps });
  };

  return (
    <div className="space-y-4 border-l-2 border-blue-500/30 pl-3 pt-2">
      {/* Título del Juego */}
      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-wider text-text-subtle font-bold">Título del Juego:</label>
        <div className="glass rounded-xl px-3 py-1.5 border border-glass-border/10">
          <input
            type="text"
            value={title}
            onChange={(e) => onChange({ ...block, title: { ...block.title, [lang]: e.target.value } })}
            placeholder="Ej: Ordena el protocolo operativo..."
            className="w-full bg-transparent text-[14px] text-text outline-none"
          />
        </div>
      </div>

      {/* Instrucciones del Juego */}
      <div className="space-y-1">
        <label className="text-[11px] uppercase tracking-wider text-text-subtle font-bold">Instrucciones:</label>
        <div className="glass rounded-xl px-3 py-1.5 border border-glass-border/10">
          <input
            type="text"
            value={instructions}
            onChange={(e) => onChange({ ...block, instructions: { ...block.instructions, [lang]: e.target.value } })}
            placeholder="Ej: Arrastra los pasos al orden correcto..."
            className="w-full bg-transparent text-[14px] text-text outline-none"
          />
        </div>
      </div>

      {/* ─── SECCIÓN DE LOS PASOS DINÁMICOS ─── */}
      <div className="space-y-2 pt-2">
        <label className="text-[11px] uppercase tracking-wider text-text-subtle font-bold block mb-1">
          Pasos del Proceso (Escríbelos en el orden correcto):
        </label>
        
        {/* Recorremos la lista de pasos que tiene el capacitador */}
        {steps.map((step: any, index: number) => (
          <div key={step.id} className="flex items-center gap-2">
            {/* Número automático según su posición (1, 2, 3...) */}
            <span className="text-[12px] font-bold text-blue-400 w-5 text-center">
              {index + 1}.
            </span>
            
            {/* Input para escribir el paso individual */}
            <div className="flex-1 glass rounded-xl px-3 py-1.5 border border-glass-border/10">
              <input
                type="text"
                value={step.text?.[lang] ?? ''}
                onChange={(e) => handleEditStep(step.id, e.target.value)}
                placeholder={`Paso ${index + 1}...`}
                className="w-full bg-transparent text-[14px] text-text outline-none"
              />
            </div>

            {/* Botón X para borrar el paso si el capacitador se equivoca */}
            <button
              type="button"
              onClick={() => handleDeleteStep(step.id)}
              className="text-text-subtle hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition-colors text-[14px]"
              title="Eliminar paso"
            >
              ✕
            </button>
          </div>
        ))}

        {/* Botón Dinámico para Añadir Nuevo Paso */}
        <button
          type="button"
          onClick={handleAddStep}
          className="w-full mt-2 flex items-center justify-center gap-2 py-2 px-4 rounded-xl border border-dashed border-blue-500/30 hover:border-blue-500 bg-blue-500/5 hover:bg-blue-500/10 text-blue-400 hover:text-blue-300 text-[13px] font-medium transition-all"
        >
          + Añadir Paso al Proceso
        </button>
      </div>
    </div>
  );
}
// ─── FIN: CÓDIGO AGREGADO POR JEANNY TOLE ──────────────────────

// ─── Block icon + label mapping ────────────────────────────────

const BLOCK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  paragraph: AlignLeft, heading: Type, list: List, image: ImageIcon, video: Video,
  callout: Lightbulb, quiz: HelpCircle, flashcard: CreditCard, accordion: AccIcon,
  tabs: Layers, code: Code, quote: Quote, divider: Minus, columns: Columns,
  timeline: Clock, comparison: Table,
};

const BLOCK_LABELS: Record<string, string> = {
  paragraph: 'Párrafo', heading: 'Encabezado', list: 'Lista', image: 'Imagen',
  video: 'Video', callout: 'Callout', quiz: 'Quiz', flashcard: 'Flashcard',
  accordion: 'Acordeón', tabs: 'Tabs', timeline: 'Timeline', comparison: 'Comparación',
  code: 'Código', quote: 'Cita', divider: 'Divisor', columns: 'Columnas',
};

// ─── Single block row ──────────────────────────────────────────

function BlockRow({
  item,
  lang,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  showMenu,
  onAddAfter,
  mediaContext,
}: {
  item: BlockWithId;
  lang: Lang;
  onUpdate: (data: ContentBlock) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  showMenu: boolean;
  onAddAfter: () => void;
  mediaContext?: MediaContext;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const Icon = BLOCK_ICONS[item.data.type] ?? AlignLeft;

  const renderEditor = () => {
    const b = item.data;
    switch (b.type) {
      case 'paragraph':   return <ParagraphEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'heading':     return <HeadingEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'list':        return <ListEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'callout':     return <CalloutEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'image':       return <ImageEditor block={b} onChange={onUpdate} mediaContext={mediaContext} />;
      case 'video':       return <VideoEditor block={b} onChange={onUpdate} mediaContext={mediaContext} />;
      case 'quiz':        return <QuizEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'flashcard':   return <FlashcardEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'accordion':   return <AccordionEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'tabs':        return <TabsEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'timeline':    return <TimelineEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'comparison':  return <ComparisonEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'columns':     return <ColumnsEditor block={b} onChange={onUpdate} lang={lang} />;
      case 'code':        return <CodeEditorBlock block={b} onChange={onUpdate} />;
      case 'quote':       return <QuoteEditorBlock block={b} onChange={onUpdate} lang={lang} />;
      case 'divider':     return <div className="h-px w-full bg-glass-border/20 my-1" />;
      case 'game-sort':   return <SortGameEditor block={b} onChange={onUpdate} lang={lang} />;
    }
  };

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      <div className={cn(
        'flex gap-3 rounded-2xl border transition-colors duration-150 px-4 py-4',
        isDragging ? 'border-neon-green/20 glass-md' : 'border-transparent hover:border-glass-border/12 hover:glass',
      )}>
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="shrink-0 flex flex-col items-center gap-1 pt-0.5 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical className="h-4 w-4 text-text-subtle" />
        </div>

        {/* Block icon + type label */}
        <div className="shrink-0 flex flex-col items-center gap-1 mt-0.5">
          <div className="h-7 w-7 rounded-lg glass flex items-center justify-center">
            <Icon className="h-3.5 w-3.5 text-text-muted" />
          </div>
          <span className="text-[9px] uppercase tracking-wide text-text-subtle whitespace-nowrap">
            {BLOCK_LABELS[item.data.type] ?? item.data.type}
          </span>
        </div>

        {/* Editor */}
        <div className="flex-1 min-w-0">
          {renderEditor()}
        </div>

        {/* Actions */}
        <div className="shrink-0 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pt-0.5">
          <button onClick={onMoveUp} className="h-6 w-6 rounded-lg flex items-center justify-center text-text-subtle hover:text-text hover:bg-glass transition-colors">
            <ChevronUp className="h-3 w-3" />
          </button>
          <button onClick={onMoveDown} className="h-6 w-6 rounded-lg flex items-center justify-center text-text-subtle hover:text-text hover:bg-glass transition-colors">
            <ChevronDown className="h-3 w-3" />
          </button>
          <button onClick={onDelete} className="h-6 w-6 rounded-lg flex items-center justify-center text-text-subtle hover:text-red-400 hover:bg-red-400/8 transition-colors">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Add block below trigger */}
      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-10 flex justify-center w-full opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onAddAfter}
          className="h-6 px-3 glass rounded-full text-[11px] text-text-subtle hover:text-neon-green hover:border-neon-green/20 border border-transparent flex items-center gap-1 transition-colors"
        >
          <Plus className="h-3 w-3" /> bloque
        </button>
      </div>
    </div>
  );
}

// ─── Main BlockEditor ──────────────────────────────────────────

interface BlockEditorProps {
  blocks: BlockWithId[];
  onChange: (blocks: BlockWithId[]) => void;
  activeLang: Lang;
  mediaContext?: MediaContext;
}

let blockSeq = 0;
function newId() { return `block-${++blockSeq}-${Date.now()}`; }

export function BlockEditor({ blocks, onChange, activeLang, mediaContext }: BlockEditorProps) {
  const [menuAfterIndex, setMenuAfterIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = blocks.findIndex((b) => b.id === active.id);
    const newIdx = blocks.findIndex((b) => b.id === over.id);
    onChange(arrayMove(blocks, oldIdx, newIdx));
  }, [blocks, onChange]);

  const insertBlock = (type: BlockType, afterIndex: number) => {
    const newBlock: BlockWithId = { id: newId(), data: emptyBlock(type) };
    const next = [...blocks];
    next.splice(afterIndex + 1, 0, newBlock);
    onChange(next);
  };

  const updateBlock = (id: string, data: ContentBlock) => {
    onChange(blocks.map((b) => (b.id === id ? { ...b, data } : b)));
  };

  const deleteBlock = (id: string) => {
    onChange(blocks.filter((b) => b.id !== id));
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx + dir < 0 || idx + dir >= blocks.length) return;
    onChange(arrayMove(blocks, idx, idx + dir));
  };

  return (
    <div className="space-y-2">
      {/* Lang tabs */}
      <div className="flex gap-1 mb-4">
        {LANGS.map((l) => (
          <span
            key={l}
            className={cn(
              'px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide',
              activeLang === l
                ? 'bg-neon-green/12 text-neon-green border border-neon-green/20'
                : 'text-text-subtle',
            )}
          >
            {LANG_LABELS[l]}
          </span>
        ))}
        <span className="text-[11px] text-text-subtle ml-2 self-center">
          Editando: {LANG_LABELS[activeLang]}
        </span>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.length === 0 && (
            <div className="text-center py-12 text-text-subtle text-[13px]">
              <p>Sin bloques aún.</p>
              <button
                onClick={() => setMenuAfterIndex(-1)}
                className="mt-3 inline-flex items-center gap-1.5 text-neon-green hover:brightness-110 transition-all text-[13px]"
              >
                <Plus className="h-4 w-4" /> Añadir primer bloque
              </button>
            </div>
          )}

          {blocks.map((item, i) => (
            <div key={item.id} className="relative">
              <BlockRow
                item={item}
                lang={activeLang}
                onUpdate={(data) => updateBlock(item.id, data)}
                onDelete={() => deleteBlock(item.id)}
                onMoveUp={() => moveBlock(item.id, -1)}
                onMoveDown={() => moveBlock(item.id, 1)}
                showMenu={menuAfterIndex === i}
                onAddAfter={() => setMenuAfterIndex(i)}
                mediaContext={mediaContext}
              />

              {/* Insert menu for this position */}
              <AnimatePresence>
                {menuAfterIndex === i && (
                  <div ref={menuRef} className="absolute left-12 z-50 mt-2">
                    <BlockInsertMenu
                      onSelect={(type) => {
                        insertBlock(type, i);
                        setMenuAfterIndex(null);
                      }}
                      onClose={() => setMenuAfterIndex(null)}
                    />
                  </div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </SortableContext>
      </DndContext>

      {/* Insert menu at top when no blocks */}
      <AnimatePresence>
        {menuAfterIndex === -1 && (
          <div className="relative z-50">
            <BlockInsertMenu
              onSelect={(type) => {
                insertBlock(type, -1);
                setMenuAfterIndex(null);
              }}
              onClose={() => setMenuAfterIndex(null)}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Add block at end */}
      {blocks.length > 0 && (
        <div className="pt-2 flex justify-center">
          <button
            onClick={() => setMenuAfterIndex(blocks.length - 1)}
            className="h-9 px-5 glass rounded-full text-[12px] text-text-subtle hover:text-neon-green border border-transparent hover:border-neon-green/20 flex items-center gap-2 transition-all duration-200"
          >
            <Plus className="h-3.5 w-3.5" /> Añadir bloque
          </button>
        </div>
      )}
    </div>
  );
}
