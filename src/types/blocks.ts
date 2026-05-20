import type { Language } from '@/stores/userStore';

// ─── Block type registry ────────────────────────────────────────

export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'image'
  | 'video'
  | 'callout'
  | 'quiz'
  | 'flashcard'
  | 'accordion'
  | 'tabs'
  | 'code'
  | 'quote'
  | 'divider'
  | 'columns'
  | 'timeline'
  | 'comparison';

// ─── Shared primitives ─────────────────────────────────────────

export type ML = Record<Language, string>;
export type MLList = Record<Language, string[]>;

// ─── Block data shapes ─────────────────────────────────────────

export interface ParagraphBlock {
  type: 'paragraph';
  text: ML;
}

export interface HeadingBlock {
  type: 'heading';
  level: 2 | 3;
  text: ML;
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: ML[];
}

export interface ImageBlock {
  type: 'image';
  url: string;
  caption?: ML;
  size?: 'sm' | 'md' | 'lg' | 'full';
  align?: 'left' | 'center' | 'right';
  shadow?: boolean;
}

export interface VideoBlock {
  type: 'video';
  kind: 'youtube' | 'upload' | 'interactive';
  url: string;
  caption?: ML;
}

export interface CalloutBlock {
  type: 'callout';
  kind: 'tip' | 'important' | 'warning' | 'success' | 'quote' | 'note';
  text: ML;
}

export interface QuizOption {
  text: ML;
}

export interface QuizBlock {
  type: 'quiz';
  question: ML;
  options: QuizOption[];
  correct: number;
  explanation: ML;
}

export interface FlashcardItem {
  front: ML;
  back: ML;
}

export interface FlashcardBlock {
  type: 'flashcard';
  cards: FlashcardItem[];
}

export interface AccordionItem {
  question: ML;
  answer: ML;
}

export interface AccordionBlock {
  type: 'accordion';
  items: AccordionItem[];
}

export interface TabItem {
  label: ML;
  content: ML;
}

export interface TabsBlock {
  type: 'tabs';
  tabs: TabItem[];
}

export interface CodeBlock {
  type: 'code';
  language: string;
  code: string;
  caption?: string;
}

export interface QuoteBlock {
  type: 'quote';
  text: ML;
  author?: ML;
}

export interface DividerBlock {
  type: 'divider';
}

export interface ColumnItem {
  blocks: ContentBlock[];
}

export interface ColumnsBlock {
  type: 'columns';
  columns: ColumnItem[];
}

export interface TimelineItem {
  label: ML;
  description: ML;
  icon?: string;
}

export interface TimelineBlock {
  type: 'timeline';
  items: TimelineItem[];
}

export interface ComparisonColumn {
  header: ML;
  rows: ML[];
  highlight?: boolean;
}

export interface ComparisonBlock {
  type: 'comparison';
  headers: ML[];
  rows: ML[][];
}

// ─── Union type ─────────────────────────────────────────────────

export type ContentBlock =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | ImageBlock
  | VideoBlock
  | CalloutBlock
  | QuizBlock
  | FlashcardBlock
  | AccordionBlock
  | TabsBlock
  | CodeBlock
  | QuoteBlock
  | DividerBlock
  | ColumnsBlock
  | TimelineBlock
  | ComparisonBlock;

// ─── Block with runtime ID (for editor) ────────────────────────

export interface BlockWithId {
  id: string;
  data: ContentBlock;
}

// ─── Empty block factories ──────────────────────────────────────

const emptyML = (): ML => ({ es: '', en: '', pt: '' });
const emptyMLList = (): MLList => ({ es: [], en: [], pt: [] });

export function emptyBlock(type: BlockType): ContentBlock {
  switch (type) {
    case 'paragraph':
      return { type, text: emptyML() };
    case 'heading':
      return { type, level: 2, text: emptyML() };
    case 'list':
      return { type, ordered: false, items: [emptyML()] };
    case 'image':
      return { type, url: '', size: 'full', align: 'center' };
    case 'video':
      return { type, kind: 'youtube', url: '' };
    case 'callout':
      return { type, kind: 'tip', text: emptyML() };
    case 'quiz':
      return {
        type,
        question: emptyML(),
        options: [{ text: emptyML() }, { text: emptyML() }, { text: emptyML() }, { text: emptyML() }],
        correct: 0,
        explanation: emptyML(),
      };
    case 'flashcard':
      return { type, cards: [{ front: emptyML(), back: emptyML() }] };
    case 'accordion':
      return { type, items: [{ question: emptyML(), answer: emptyML() }] };
    case 'tabs':
      return { type, tabs: [{ label: emptyML(), content: emptyML() }] };
    case 'code':
      return { type, language: 'javascript', code: '' };
    case 'quote':
      return { type, text: emptyML() };
    case 'divider':
      return { type };
    case 'columns':
      return { type, columns: [{ blocks: [] }, { blocks: [] }] };
    case 'timeline':
      return { type, items: [{ label: emptyML(), description: emptyML() }] };
    case 'comparison':
      return { type, headers: [emptyML(), emptyML()], rows: [[emptyML(), emptyML()]] };
  }
}

// ─── Block metadata for the insert menu ────────────────────────

export interface BlockMeta {
  type: BlockType;
  label: string;
  description: string;
  icon: string;
  group: 'text' | 'media' | 'interactive' | 'layout';
}

export const BLOCK_REGISTRY: BlockMeta[] = [
  { type: 'paragraph',   label: 'Párrafo',       description: 'Bloque de texto libre',           icon: '¶',   group: 'text' },
  { type: 'heading',     label: 'Título',         description: 'Encabezado H2 o H3',              icon: 'H',   group: 'text' },
  { type: 'list',        label: 'Lista',          description: 'Lista bullet o numerada',          icon: '≡',   group: 'text' },
  { type: 'quote',       label: 'Cita',           description: 'Blockquote con autor',             icon: '"',   group: 'text' },
  { type: 'code',        label: 'Fragmento',      description: 'Texto técnico con resaltado y copiado', icon: '</>',  group: 'text' },
  { type: 'divider',     label: 'Separador',      description: 'Línea divisoria',                  icon: '—',   group: 'layout' },
  { type: 'columns',     label: 'Columnas',       description: 'Layout de 2 o 3 columnas',         icon: '⊞',   group: 'layout' },
  { type: 'image',       label: 'Imagen',         description: 'Imagen con caption y alineación',  icon: '🖼',   group: 'media' },
  { type: 'video',       label: 'Video',          description: 'YouTube, upload o interactivo',    icon: '▶',   group: 'media' },
  { type: 'callout',     label: 'Callout',        description: 'Caja de tip, advertencia, etc.',   icon: '💡',  group: 'interactive' },
  { type: 'quiz',        label: 'Quiz',           description: 'Pregunta de opción múltiple',      icon: '✓',   group: 'interactive' },
  { type: 'flashcard',   label: 'Flashcards',     description: 'Tarjetas con flip 3D',             icon: '🃏',  group: 'interactive' },
  { type: 'accordion',   label: 'Acordeón',       description: 'Secciones colapsables',            icon: '▾',   group: 'interactive' },
  { type: 'tabs',        label: 'Tabs',           description: 'Contenido en pestañas',            icon: '⊟',   group: 'interactive' },
  { type: 'timeline',    label: 'Timeline',       description: 'Lista de eventos en el tiempo',    icon: '⊙',   group: 'interactive' },
  { type: 'comparison',  label: 'Comparación',    description: 'Tabla comparativa',                icon: '⊘',   group: 'interactive' },
];
