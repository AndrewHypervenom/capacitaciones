import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Snail, Square, Volume2 } from 'lucide-react';
import type { ModuleVocabulary, VocabTerm } from '@/types/blocks';
import type { Language } from '@/stores/userStore';
import { normalizePronLang, speak, stopSpeaking } from '@/lib/speech';
import { ipaToReadable } from '@/lib/ipaReadable';
import { cn } from '@/lib/cn';

/** Hover con intención: pasar de largo sobre un párrafo no abre nada. */
const OPEN_DELAY = 260;
/** Margen para cruzar de la palabra a la tarjeta sin que se cierre. */
const CLOSE_DELAY = 180;
/** Si acabas de ver una tarjeta, la siguiente palabra abre al instante. */
const GRACE = 450;
const GAP = 10;
/** Nombres de los resaltados en `CSS.highlights` (estilos en globals.css). */
const HL = 'lang-lens';
const HL_ACTIVE = 'lang-lens-active';

// Donde no se busca: campos que se escriben, código y lo que pida saltarse.
const SKIP = 'input, textarea, select, [contenteditable="true"], code, pre, script, style, [data-lens-skip]';
// Donde un clic ya hace otra cosa (elegir una respuesta, abrir un enlace):
// ahí el clic no pronuncia, para no mezclar dos acciones en un gesto.
const INTERACTIVE = 'button, a, label, summary, [role="button"], [role="tab"], [role="option"]';

const LETTER = '[\\p{L}\\p{M}\\p{N}]';

interface Hit {
  range: Range;
  term: VocabTerm;
}

// El `Highlight` de CSS no está en todos los navegadores (ni en los tipos de
// todas las versiones de TS): sin él la lupa sigue funcionando, solo que las
// palabras no se ven subrayadas hasta pasar por encima.
type HighlightRegistry = { set: (k: string, v: unknown) => void; delete: (k: string) => void };
function highlights(): { registry: HighlightRegistry; make: (ranges: Range[]) => unknown } | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  const Ctor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!css?.highlights || !Ctor) return null;
  return { registry: css.highlights, make: (ranges) => new Ctor(...ranges) };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const key = (s: string) => s.trim().toLowerCase().normalize('NFC');

function pick(v: VocabTerm['meaning'], lang: Language): string {
  if (!v) return '';
  return v[lang]?.trim() || v.es?.trim() || v.en?.trim() || v.pt?.trim() || '';
}

function readRate(): number {
  try {
    const v = Number(localStorage.getItem('pronunciation-rate'));
    return v >= 0.5 && v <= 1.5 ? v : 1;
  } catch {
    return 1;
  }
}

function contains(r: DOMRect, x: number, y: number, pad = 2) {
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

/**
 * «Lupa de idioma» de los cursos de idiomas. Envuelve el contenido del módulo
 * y hace que cualquier palabra o expresión de su vocabulario —en un párrafo,
 * un título, una tarjeta, una tabla, una práctica— se pueda consultar: se ve
 * subrayada, y al pasar por encima sale una tarjeta de diccionario con su
 * pronunciación (normal y lenta), el AFI y lo que significa.
 *
 * No toca el árbol de React: las palabras se encuentran en el DOM ya pintado y
 * se marcan con la API de resaltado de CSS (Range + Highlight). Envolverlas en
 * elementos obligaría a meter la lupa dentro de cada tipo de bloque, y React
 * pelearía con cualquier nodo que se le insertara por fuera.
 */
export function LanguageLens({
  vocabulary, language, children, className,
}: {
  vocabulary: ModuleVocabulary | null | undefined;
  language: Language;
  children: ReactNode;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hitsByEl = useRef(new Map<Element, Hit[]>());
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef(0);
  const lastShownAt = useRef(0);
  const [open, setOpen] = useState<{ hit: Hit; rect: DOMRect } | null>(null);
  // Copias en ref para los manejadores de eventos del documento (sin re-suscribir).
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);
  // Qué está sonando. Vive aquí y no en la tarjeta: un clic sobre una palabra
  // con la tarjeta cerrada la abre Y la pronuncia en el mismo gesto.
  const [playing, setPlaying] = useState<'normal' | 'slow' | null>(null);
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  const turn = useRef(0);

  const lang = normalizePronLang(vocabulary?.lang ?? '');
  const terms = vocabulary?.terms;

  // Un solo patrón con todas las entradas, las más largas primero: «Bom dia»
  // gana a «dia» cuando aparecen juntas. Los límites son de letra Unicode (\b
  // de JS no entiende «á» ni «ç»).
  const matcher = useMemo(() => {
    if (!terms?.length) return null;
    const byKey = new Map<string, VocabTerm>();
    for (const t of terms) if (t.text?.trim() && !byKey.has(key(t.text))) byKey.set(key(t.text), t);
    if (!byKey.size) return null;
    const alts = [...byKey.values()]
      .map((t) => t.text.trim())
      .sort((a, b) => b.length - a.length)
      .map((t) => escapeRe(t).replace(/\s+/g, '\\s+'));
    return {
      re: new RegExp(`(?<!${LETTER})(?:${alts.join('|')})(?!${LETTER})`, 'giu'),
      find: (s: string) => byKey.get(key(s.replace(/\s+/g, ' '))),
    };
  }, [terms]);

  const clearTimers = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };

  const close = useCallback(() => {
    clearTimers();
    if (openRef.current) lastShownAt.current = Date.now();
    setOpen(null);
  }, []);

  // ── Encontrar las palabras en lo que está pintado ──
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !matcher) return;
    const hl = highlights();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scan = () => {
      const map = new Map<Element, Hit[]>();
      const ranges: Range[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          const p = n.parentElement;
          if (!p || !n.nodeValue?.trim() || p.closest(SKIP)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const text = n.nodeValue ?? '';
        for (const m of text.matchAll(matcher.re)) {
          const term = matcher.find(m[0]);
          if (!term) continue;
          const range = document.createRange();
          range.setStart(n, m.index ?? 0);
          range.setEnd(n, (m.index ?? 0) + m[0].length);
          const el = n.parentElement!;
          const list = map.get(el);
          if (list) list.push({ range, term });
          else map.set(el, [{ range, term }]);
          ranges.push(range);
        }
      }
      hitsByEl.current = map;
      hl?.registry.set(HL, hl.make(ranges));
    };

    scan();
    // Pestañas, acordeones, tarjetas que se voltean: el contenido cambia sin
    // que cambie el módulo, así que se vuelve a buscar (con calma, agrupado).
    const obs = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(scan, 250);
    });
    obs.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      obs.disconnect();
      if (timer) clearTimeout(timer);
      hl?.registry.delete(HL);
      hl?.registry.delete(HL_ACTIVE);
      hitsByEl.current = new Map();
    };
  }, [matcher]);

  // La palabra abierta se ilumina entera mientras su tarjeta está a la vista.
  useEffect(() => {
    const hl = highlights();
    if (!hl) return;
    if (open) hl.registry.set(HL_ACTIVE, hl.make([open.hit.range]));
    else hl.registry.delete(HL_ACTIVE);
  }, [open]);

  /** La palabra del vocabulario que está justo bajo el puntero, si hay una. */
  const hitAt = (target: EventTarget | null, x: number, y: number): { hit: Hit; rect: DOMRect } | null => {
    if (!(target instanceof Element)) return null;
    const list = hitsByEl.current.get(target);
    if (!list) return null;
    for (const hit of list) {
      if (!hit.range.startContainer.isConnected) continue;
      // Una expresión puede partirse en dos renglones: vale el trozo que se toca.
      for (const r of hit.range.getClientRects()) {
        if (contains(r, x, y)) return { hit, rect: r };
      }
    }
    return null;
  };

  const say = (text: string, mode: 'normal' | 'slow', toggle = true) => {
    if (toggle && playingRef.current === mode) {
      turn.current++;
      stopSpeaking();
      setPlaying(null);
      return;
    }
    const mine = ++turn.current;
    setPlaying(mode);
    void speak(text, lang, {
      rate: mode === 'slow' ? 0.6 : readRate(),
      onEnd: () => { if (turn.current === mine) setPlaying(null); },
    });
  };

  const show = (found: { hit: Hit; rect: DOMRect }) => {
    clearTimers();
    // Otra palabra: el botón encendido era de la anterior.
    if (openRef.current?.hit.range !== found.hit.range) { turn.current++; setPlaying(null); }
    setOpen(found);
  };

  // La tarjeta vive en un portal, pero en React sus eventos suben hasta aquí:
  // moverse dentro de ella es seguir "encima", no alejarse de la palabra.
  const inCard = (t: EventTarget | null) => t instanceof Node && !!cardRef.current?.contains(t);

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || !matcher) return;
    if (inCard(e.target)) {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      return;
    }
    const { clientX: x, clientY: y, target } = e;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const found = hitAt(target, x, y);
      const cur = openRef.current;
      if (found) {
        if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
        if (cur?.hit.range === found.hit.range) return;
        if (openTimer.current) clearTimeout(openTimer.current);
        const warm = !!cur || Date.now() - lastShownAt.current < GRACE;
        if (warm) { show(found); return; }
        openTimer.current = setTimeout(() => { openTimer.current = null; show(found); }, OPEN_DELAY);
        return;
      }
      if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
      if (cur && !closeTimer.current) closeTimer.current = setTimeout(() => { closeTimer.current = null; close(); }, CLOSE_DELAY);
    });
  };

  const onPointerLeave = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (openRef.current && !closeTimer.current) {
      closeTimer.current = setTimeout(() => { closeTimer.current = null; close(); }, CLOSE_DELAY);
    }
  };

  // Clic (o toque) sobre una palabra: se oye ya y queda su tarjeta abierta.
  // En táctil es la única forma de abrirla: ahí no hay «pasar por encima».
  const onClick = (e: React.MouseEvent) => {
    if (!matcher || inCard(e.target) || (e.target as Element).closest?.(INTERACTIVE)) return;
    const found = hitAt(e.target, e.clientX, e.clientY);
    if (!found) return;
    show(found);
    say(found.hit.range.toString(), 'normal', false);
  };

  useEffect(() => () => { clearTimers(); if (frame.current) cancelAnimationFrame(frame.current); stopSpeaking(); }, []);

  // Escape, clic fuera y scroll la cierran: una tarjeta fija sobre una página
  // que se movió señala a una palabra que ya no está ahí.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: PointerEvent) => {
      if (inCard(e.target)) return;
      // Tocar otra palabra la cambia (lo resuelve el clic); tocar fuera, cierra.
      if (!hitAt(e.target, e.clientX, e.clientY)) close();
    };
    const onScroll = (e: Event) => { if (!inCard(e.target)) close(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  return (
    <div
      ref={rootRef}
      className={className}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={onClick}
    >
      {children}
      {matcher && createPortal(
        <AnimatePresence>
          {open && (
            <WordCard
              key="lens-card"
              ref={cardRef}
              term={open.hit.term}
              word={open.hit.range.toString()}
              anchor={open.rect}
              lang={lang}
              language={language}
              playing={playing}
              onSay={(mode) => say(open.hit.range.toString(), mode)}
              onPointerEnter={() => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } }}
              onPointerLeave={onPointerLeave}
            />
          )}
        </AnimatePresence>,
        document.fullscreenElement ?? document.body,
      )}
    </div>
  );
}

// ─── Tarjeta ────────────────────────────────────────────────────

interface CardProps {
  term: VocabTerm;
  /** La palabra tal como está escrita en el texto (respeta mayúsculas). */
  word: string;
  anchor: DOMRect;
  lang: string;
  language: Language;
  playing: 'normal' | 'slow' | null;
  onSay: (mode: 'normal' | 'slow') => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

const WordCard = forwardRef<HTMLDivElement, CardProps>(function WordCard(
  { term, word, anchor, lang, language, playing, onSay, onPointerEnter, onPointerLeave },
  ref,
) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const inner = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const setRefs = (el: HTMLDivElement | null) => {
    inner.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (!size || size.w !== w || size.h !== h) setSize({ w, h });
  }, [size, word, term]);

  const w = size?.w ?? 0;
  const h = size?.h ?? 0;
  const below = anchor.top - GAP - h < 8;
  const left = Math.min(Math.max(anchor.left + anchor.width / 2 - w / 2, 8), window.innerWidth - w - 8);
  const top = below ? anchor.bottom + GAP : anchor.top - GAP - h;
  const ipa = term.ipa?.trim().replace(/^[/[]|[/\]]$/g, '');
  const meaning = pick(term.meaning, language);
  // Vocabulario generado antes de «Así suena»: se arma desde el AFI.
  const sounds = pick(term.sounds, language) || ipaToReadable(ipa, language);
  const kind = pick(term.kind, language);

  return (
    <motion.div
      ref={setRefs}
      role="dialog"
      aria-label={word}
      onPointerEnter={onPointerEnter}
      onPointerLeave={(e) => { if (e.pointerType !== 'touch') onPointerLeave(); }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: below ? -4 : 4, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: below ? -4 : 4, scale: 0.97 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      style={{ position: 'fixed', left, top, zIndex: 9999, visibility: size ? 'visible' : 'hidden' }}
      className="w-[260px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl border border-line bg-surface text-left shadow-xl shadow-black/25"
    >
      <div className="px-4 pb-3 pt-3.5">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 break-words text-[19px] font-semibold leading-tight tracking-tight text-text" lang={lang}>
            {word}
          </p>
          {kind && (
            <span className="mt-0.5 shrink-0 rounded-full bg-neon-magenta/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neon-magenta">
              {kind}
            </span>
          )}
        </div>
        {/* Así suena primero (letras normales); el AFI queda debajo, más discreto. */}
        {sounds && (
          <p className="mt-1.5 text-[14px] leading-snug">
            <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
              {t('module.blocks.pronunciation.sounds_label')}
            </span>
            <span className="font-semibold tracking-wide text-neon-green">{sounds}</span>
          </p>
        )}
        {ipa && (
          <p className={cn('leading-snug', sounds ? 'mt-0.5 text-[11.5px]' : 'mt-1 text-[12.5px]')}>
            <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
              {t('module.blocks.pronunciation.ipa_label')}
            </span>
            <span className="font-mono text-text-subtle">/{ipa}/</span>
          </p>
        )}
        {meaning && (
          <div className="mt-2.5 border-t border-line/70 pt-2.5">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
              {t('module.blocks.pronunciation.word_meaning')}
            </span>
            <p className="text-[13px] leading-snug text-text-muted">{meaning}</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t border-line/70 bg-subtle/40 px-3 py-2">
        <button
          type="button"
          onClick={() => onSay('normal')}
          aria-pressed={playing === 'normal'}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-all active:scale-[0.97]',
            playing === 'normal' ? 'bg-neon-green text-black' : 'bg-neon-green/10 text-neon-green hover:bg-neon-green/20',
          )}
        >
          {playing === 'normal' ? <Square className="h-3 w-3 fill-current" /> : <Volume2 className="h-3.5 w-3.5" />}
          {t('module.blocks.pronunciation.listen')}
        </button>
        <button
          type="button"
          onClick={() => onSay('slow')}
          aria-pressed={playing === 'slow'}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-all active:scale-[0.97]',
            playing === 'slow' ? 'bg-text text-bg' : 'text-text-muted hover:bg-subtle hover:text-text',
          )}
        >
          {playing === 'slow' ? <Square className="h-3 w-3 fill-current" /> : <Snail className="h-3.5 w-3.5" />}
          {t('module.blocks.pronunciation.word_slow')}
        </button>
      </div>
    </motion.div>
  );
});
