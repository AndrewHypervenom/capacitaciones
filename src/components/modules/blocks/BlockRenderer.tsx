import { motion } from 'framer-motion';
import type { ContentBlock, GameClassifyBlock } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { Callout } from '@/components/modules/Callout';
import { KnowledgeCheck } from '@/components/modules/KnowledgeCheck';
import { FlashcardBlockRenderer } from './FlashcardBlock';
import { AccordionBlockRenderer } from './AccordionBlock';
import { TabsBlockRenderer } from './TabsBlock';
import { TimelineBlockRenderer } from './TimelineBlock';
import { CodeBlockRenderer } from './CodeBlock';
import { ComparisonBlockRenderer } from './ComparisonBlock';
import SortGameBlock from './SortGameBlock';
import { ClassifyGameBlockRenderer } from './ClassifyGameBlock';
import { CardsBlockRenderer } from './CardsBlock';
import { StatBlockRenderer } from './StatBlock';
import { HotspotImageBlockRenderer } from './HotspotImageBlock';
import { cn } from '@/lib/cn';


interface CustomBaseBlock {
  type: string;
  [key: string]: unknown;
}
interface Props {
  block: ContentBlock;
  language: Language;
  moduleId?: string;
  sectionId?: string;
  blockIndex?: number;
  noAnimate?: boolean;
  userId?: string;
  campaignId?: string;
  onGameScore?: (score: number, total: number) => void;
}
function BlockContent({ block, language, userId, moduleId, sectionId, blockIndex, campaignId, onGameScore }: Omit<Props, 'noAnimate'>) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className="text-[16px] leading-[1.8] text-text/92 max-w-[68ch]">
          {block.text[language] || block.text.es}
        </p>
      );

    case 'heading':
      return block.level === 2 ? (
        <h2 className="font-bold tracking-[-0.03em] leading-tight text-[clamp(1.4rem,2.2vw+0.5rem,1.9rem)] text-text">
          {block.text[language] || block.text.es}
        </h2>
      ) : (
        <h3 className="font-semibold tracking-tight leading-tight text-[1.1rem] text-text">
          {block.text[language] || block.text.es}
        </h3>
      );

    case 'list': {
      const items = block.items.map((item) => item[language] || item.es).filter(Boolean);
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={cn(
          'space-y-2 text-[15.5px] text-text-muted leading-relaxed',
          block.ordered ? 'list-decimal list-inside' : 'list-none',
        )}>
          {items.map((item, i) => (
            <li key={i} className="group/li flex items-start gap-2.5 transition-transform duration-200 hover:translate-x-0.5">
              {!block.ordered && (
                <span className="mt-2.5 h-1.5 w-1.5 rounded-full bg-neon-green shrink-0 transition-transform duration-200 group-hover/li:scale-150" />
              )}
              <span>{item}</span>
            </li>
          ))}
        </Tag>
      );
    }

    case 'image':
      return (
        <figure className={cn(
          'rounded-2xl overflow-hidden border border-line',
          block.size === 'sm' && 'max-w-xs',
          block.size === 'md' && 'max-w-2xl',
          block.size === 'lg' && 'max-w-4xl',
          block.align === 'center' && 'mx-auto',
          block.align === 'right' && 'ml-auto',
          block.shadow && 'shadow-2xl shadow-black/12',
        )}>
          <img
            src={block.url}
            alt={block.caption?.[language] || block.caption?.es || ''}
            loading="lazy"
            className="w-full object-cover block"
          />
          {block.caption?.[language] && (
            <figcaption className="px-5 py-3 text-[12.5px] text-text-subtle border-t border-line bg-subtle">
              {block.caption[language]}
            </figcaption>
          )}
        </figure>
      );

    case 'video':
      if (block.kind === 'youtube') {
        return (
          <div className="rounded-2xl overflow-hidden border border-line relative bg-black" style={{ paddingTop: '56.25%' }}>
            <iframe
              src={`https://www.youtube.com/embed/${block.url}?rel=0&modestbranding=1`}
              title={block.caption?.[language] || 'Video'}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full border-0"
            />
          </div>
        );
      }
      return (
        <video
          src={block.url}
          controls
          preload="metadata"
          playsInline
          className="w-full rounded-2xl border border-line block bg-black"
        />
      );

    case 'callout':
      return <Callout kind={block.kind} text={block.text[language] || block.text.es} />;

   case 'quiz':
      if (!moduleId) return null;
      return (
        <KnowledgeCheck
          moduleId={moduleId}
          sectionIdx={blockIndex ?? 0}
          sectionId={sectionId}
          userId={userId}
          campaignId={campaignId}
          quiz={{
            question: block.question,
            options: {
              es: block.options.map((o) => o.text.es),
              en: block.options.map((o) => o.text.en),
              pt: block.options.map((o) => o.text.pt),
            },
            correct: block.correct,
            explanation: block.explanation,
          }}
          language={language}
        />
      );

    case 'flashcard':
      return <FlashcardBlockRenderer block={block} language={language} />;

    case 'accordion':
      return <AccordionBlockRenderer block={block} language={language} />;

    case 'tabs':
      return <TabsBlockRenderer block={block} language={language} />;

    case 'code':
      return <CodeBlockRenderer block={block} />;

    case 'quote':
      return (
        <blockquote className="border-l-2 border-neon-green/40 pl-5 py-1">
          <p className="text-[16px] italic text-text/80 leading-relaxed">
            "{block.text[language] || block.text.es}"
          </p>
          {block.author && (
            <cite className="mt-2 block text-[12.5px] text-text-subtle not-italic">
              — {block.author[language] || block.author.es}
            </cite>
          )}
        </blockquote>
      );

    case 'divider':
      return <div className="h-px w-full bg-gradient-to-r from-transparent via-glass-border/20 to-transparent" />;

    case 'columns':
      return (
        <div className={cn(
          'grid gap-y-8 gap-x-10',
          block.columns.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2',
        )}>
          {block.columns.map((col, i) => (
            <div key={i} className="space-y-5 min-w-0 px-5 py-4 rounded-xl bg-glass/10 border border-glass-border/8">
              {col.blocks.map((b, j) => (
                <BlockRenderer key={j} block={b} language={language} moduleId={moduleId} blockIndex={j} noAnimate userId={userId} campaignId={campaignId} onGameScore={onGameScore} sectionId={sectionId}/>
              ))}
            </div>
          ))}
        </div>
      );

    case 'timeline':
      return <TimelineBlockRenderer block={block} language={language} />;

    case 'comparison':
      return <ComparisonBlockRenderer block={block} language={language} />;

    case 'game-sort':
      return (
        <SortGameBlock
          block={block}
          language={language}
          userId={userId}
          campaignId={campaignId}
          moduleId={moduleId}
          sectionId={sectionId}
          onScoreChange={onGameScore}
        />
      );

    case 'game-classify':
      return (
        <ClassifyGameBlockRenderer
          block={block as GameClassifyBlock}
          language={language}
          userId={userId}
          campaignId={campaignId}
          moduleId={moduleId}
          sectionId={sectionId}
          onScoreChange={onGameScore}
        />
      );
    case 'cards':
      return <CardsBlockRenderer block={block} language={language} />;

    case 'stat':
      return <StatBlockRenderer block={block} language={language} />;

    case 'hotspot':
      return <HotspotImageBlockRenderer block={block} language={language} />;

    default:
      return null;
  }
}

/** Extra spacing multiplier for block types that benefit from more breathing room */
function blockSpacing(type: ContentBlock['type']): string {
  switch (type) {
    case 'heading':      return 'mt-8 first:mt-0';
    case 'quiz':
    case 'flashcard':
    case 'accordion':
    case 'tabs':
    case 'timeline':
    case 'comparison':
    case 'cards':
    case 'stat':
    case 'hotspot':
    case 'columns':      return 'mt-8';
    case 'divider':      return 'my-6';
    case 'code':         return 'mt-6';
    case 'image':
    case 'video':        return 'mt-6';
    default:             return 'mt-5';
  }
}

export function BlockRenderer({ block, language, moduleId, blockIndex, noAnimate, userId, campaignId, onGameScore, sectionId }: Props) {

  // campaignId ya llega resuelto desde ModulePage → module.campaign_id.
  // No usamos fallback de UUID de ceros: si falta, avisamos y dejamos
  // que el juego no intente guardar nada (mejor que guardar basura).
  const idSeguro = campaignId;

  if (!idSeguro && process.env.NODE_ENV !== 'production') {
    console.warn('[BlockRenderer] campaignId vacío — el progreso del juego no se va a guardar en Supabase.');
  }

  const content = (
    <BlockContent
      block={block}
      language={language}
      moduleId={moduleId}
      blockIndex={blockIndex}
      userId={userId}
      campaignId={idSeguro}
      sectionId={sectionId}
      onGameScore={onGameScore}
    />
  );

  if (!content) return null;
  if (noAnimate) {return content;}

  const spacing = blockIndex === 0 ? '' : blockSpacing(block.type);

  return (
    <motion.div
      className={spacing}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      {content}
    </motion.div>
  );
}
