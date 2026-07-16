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
  | 'comparison'
  | 'game-sort'
  | 'game-classify' // 🌟 Agregado el nuevo tipo de juego
  | 'cards'
  | 'stat'
  | 'hotspot';

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

// Marcadores de video interactivo (capítulos / quiz). Se guardan en forma "raw"
// (campos por idioma planos) igual que en la BD; el runtime los mapea a la forma
// anidada con `mapVideoMarkersFromDb`. Viven aquí (types) para poder embeberlos en
// el bloque de video sin acoplar con la capa de servicios; `modules.service` los
// re-exporta para conservar sus imports existentes.
export interface VideoQuestionRaw {
  id: string;
  question_es: string;
  question_en: string;
  question_pt: string;
  options_es: string[];
  options_en: string[];
  options_pt: string[];
  correct: number;
  explanation_es: string;
  explanation_en: string;
  explanation_pt: string;
}

export interface VideoMarkerRaw {
  id: string;
  timeSeconds: number;
  type: 'chapter' | 'quiz';
  title_es: string;
  title_en: string;
  title_pt: string;
  questions?: VideoQuestionRaw[];
}

export interface VideoBlock {
  type: 'video';
  kind: 'youtube' | 'vimeo' | 'upload' | 'interactive';
  url: string;
  caption?: ML;
  /** Capítulos/quiz opcionales DENTRO del video (video interactivo inline). Si
   *  hay al menos uno, el aprendiz ve el reproductor interactivo con compuertas. */
  markers?: VideoMarkerRaw[];
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

export interface GameSortStep {
  id: string;
  text: ML;
}

export interface GameSortProcess {
  id: string;
  title?: ML;
  steps: GameSortStep[];
  feedback_correct?: ML;
  feedback_wrong?: ML;
}

// ✨ LIMPIEZA: Interfaz de ordenar pasos restaurada a su estado óptimo y sin código muerto
export interface GameSortBlock {
  id?: string;
  type: 'game-sort';
  title: ML;
  instructions: ML;
  processes: GameSortProcess[];
  steps?: GameSortStep[];
}

// ─── Estructuras internas del Juego de Clasificación ──────────────────

export interface ClassifyCategory {
  id: string;
  name: ML;           // Ej: Clonación, Phishing, Fraude Interno
  color?: string;     // Para los bordes personalizados punteados de tus tarjetas
}

export interface ClassifyCase {
  id: string;
  text: ML;               // El enunciado o situación del cliente
  correctCategoryId: string; // El id de la categoría correspondiente
}

export interface GameClassifyBlock {
  id?: string;
  type: 'game-classify';
  title: ML;
  instructions: ML;
  categories: ClassifyCategory[];
  cases: ClassifyCase[];
}

export interface CardItem {
  icon?: string;
  title: ML;
  text: ML;
}

export interface CardsBlock {
  type: 'cards';
  columns?: 2 | 3;
  items: CardItem[];
}

export interface StatItem {
  /** Valor destacado, p. ej. "82%", "3", "+1.2k". El prefijo numérico se anima. */
  value: string;
  label: ML;
  icon?: string;
}

export interface StatBlock {
  type: 'stat';
  items: StatItem[];
}

export interface HotspotPoint {
  /** Posición en porcentaje (0–100) sobre la imagen. */
  x: number;
  y: number;
  title: ML;
  text: ML;
}

export interface HotspotImageBlock {
  type: 'hotspot';
  url: string;
  caption?: ML;
  points: HotspotPoint[];
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
  | ComparisonBlock
  | GameSortBlock
  | GameClassifyBlock // 🌟 Registrado aquí en la unión
  | CardsBlock
  | StatBlock
  | HotspotImageBlock;

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
    
    // ✨ LIMPIEZA: Fábrica restaurada y limpia sin métricas obsoletas
    case 'game-sort':
      return {
        type,
        title: emptyML(),
        instructions: emptyML(),
        processes: [{ id: 'process-1', steps: [] }]
      };

    // 🌟 NUEVA FÁBRICA: Inicializa el juego con las 4 categorías clave de tu mockup de fraudes
    case 'game-classify':
      return {
        type,
        title: emptyML(),
        instructions: emptyML(),
        categories: [
          { id: 'cat-clonacion', name: { es: 'CLONACIÓN', en: 'CLONING', pt: '' }, color: 'purple' },
          { id: 'cat-phishing',  name: { es: 'PHISHING', en: 'PHISHING', pt: '' }, color: 'pink' },
          { id: 'cat-interno',   name: { es: 'FRAUDE INTERNO', en: 'INTERNAL FRAUD', pt: '' }, color: 'red' },
          { id: 'cat-identidad', name: { es: 'USURPACIÓN DE IDENTIDAD', en: 'IDENTITY THEFT', pt: '' }, color: 'orange' }
        ],
        cases: [
          { id: 'case-1', text: { es: 'Ejemplo de caso operativo para clasificar', en: '', pt: '' }, correctCategoryId: 'cat-clonacion' }
        ]
      };
    case 'cards':
      return { type, columns: 2, items: [{ icon: '✨', title: emptyML(), text: emptyML() }] };
    case 'stat':
      return { type, items: [{ value: '', label: emptyML() }] };
    case 'hotspot':
      return { type, url: '', points: [] };
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
  { type: 'callout',     label: 'Callout',        description: 'Caja de tip, advertencia, etc.',   icon: '💡',   group: 'interactive' },
  { type: 'quiz',        label: 'Quiz',           description: 'Pregunta de opción múltiple',      icon: '✓',   group: 'interactive' },
  { type: 'flashcard',   label: 'Flashcards',     description: 'Tarjetas con flip 3D',             icon: '🃏',   group: 'interactive' },
  { type: 'accordion',   label: 'Acordeón',       description: 'Secciones colapsables',            icon: '▾',   group: 'interactive' },
  { type: 'tabs',        label: 'Tabs',           description: 'Contenido en pestañas',            icon: '⊟',   group: 'interactive' },
  { type: 'timeline',    label: 'Timeline',       description: 'Lista de eventos en el tiempo',    icon: '⊙',   group: 'interactive' },
  { type: 'comparison',  label: 'Comparación',    description: 'Tabla comparativa',                icon: '⊘',   group: 'interactive' },
  { type: 'game-sort',   label: 'Ordenar Pasos',  description: 'Juego de arrastrar en orden',      icon: '↕',   group: 'interactive' },
  
  // 🌟 AGREGADO AL MENÚ VISUAL: Registrado para que el administrador pueda crearlo con un botón
  { type: 'game-classify', label: 'Clasificar Casos', description: 'Juego de arrastrar casos a contenedores', icon: '⊞', group: 'interactive' },
  { type: 'cards',       label: 'Tarjetas',       description: 'Grid de tarjetas con ícono',       icon: '▦',   group: 'layout' },
  { type: 'stat',        label: 'Datos',          description: 'Métricas con números destacados',  icon: '📊',  group: 'interactive' },
  { type: 'hotspot',     label: 'Imagen interactiva', description: 'Imagen con puntos clicables',  icon: '📍',  group: 'media' },
];
