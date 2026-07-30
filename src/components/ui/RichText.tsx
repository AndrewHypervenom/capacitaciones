import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { parseInline, plainInline, type InlineNode } from '@/lib/inlineMarkdown'

/**
 * Renderizador de Markdown ligero para textos editables del sitio
 * (descripciones de cursos, etc.). Comparte la sintaxis del asistente pero sin
 * enlaces ni navegación: pensado para texto de marketing.
 *
 * Soporta:
 *  - Títulos con `#` (una línea que empieza con # → subtítulo)
 *  - Párrafos separados por renglón en blanco
 *  - Espacio vertical: cada renglón en blanco extra (dos o más Enter seguidos)
 *    agrega más aire arriba, abajo o entre los textos
 *  - Listas con viñeta (- / * / •)
 *  - **negrita** y *cursiva*
 *
 * Es tolerante a fallos: asteriscos sueltos se limpian en vez de mostrarse.
 */
export function RichText({
  text,
  className,
  baseLeading,
  baseMaxWidth,
}: {
  text: string
  className?: string
  /**
   * Interlineado propio del contexto (p. ej. `leading-[1.8]` del cuerpo de un
   * módulo). Se usa mientras el autor no elija un interlineado explícito, así
   * el texto sigue viéndose igual que antes de tener formato enriquecido.
   */
  baseLeading?: string
  /**
   * Ancho de lectura propio del contexto (p. ej. `max-w-[68ch]` del cuerpo de
   * un módulo). Se aplica salvo que el autor elija "ancho completo"; por eso lo
   * decide RichText y no el `className` del que llama.
   */
  baseMaxWidth?: string
}) {
  const { attrs, body } = parseAttrs(text)
  const blocks = parseBlocks(body)
  if (!blocks.length) return null
  return (
    <div className={cn(
      'space-y-2',
      attrs.spacing === 'normal' && baseLeading ? baseLeading : leadingClass(attrs.spacing),
      attrs.align && ALIGN_CLASS[attrs.align],
      attrs.width === 'normal' && baseMaxWidth,
      className,
    )}>
      {blocks.map((b, i) => {
        if (b.type === 'spacer') {
          return <div key={i} aria-hidden style={{ height: `${b.size * 0.7}rem` }} />
        }
        if (b.type === 'h') {
          return (
            <p key={i} className="text-[15px] font-bold tracking-tight text-text">
              {renderInline(b.text)}
            </p>
          )
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="space-y-1 pl-1">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0 flex-1">{renderInline(item)}</span>
                </li>
              ))}
            </ul>
          )
        }
        // `whitespace-pre-line`: cada salto de línea simple se respeta tal cual
        // se escribió (WYSIWYG), y los renglones en blanco separan párrafos.
        return <p key={i} className="whitespace-pre-line">{renderInline(b.text)}</p>
      })}
    </div>
  )
}

/**
 * Renderiza SOLO el formato en línea (**negrita**, *cursiva*) sin envolver en
 * bloques ni imponer estilos. Para textos que ya viven dentro de su propio
 * `<p>`/contenedor con estilos propios: párrafos del cuerpo de un módulo,
 * callouts, explicaciones de quiz, etc. Así se gana negrita sin alterar el
 * tamaño, color ni interlineado existentes.
 */
export function RichTextInline({ text }: { text: string | null | undefined }) {
  if (!text) return null
  // Defensivo: si algún marcador de presentación se coló, no debe verse.
  const { body } = parseAttrs(text)
  return <>{renderInline(body)}</>
}

/* ── Presentación por campo ──────────────────────────────────────────────
 * Interlineado, alineación y ancho se guardan como marcadores invisibles al
 * inicio del texto: `{{lh:amplio}}{{al:justify}}{{w:full}}`. Los valores por
 * defecto (normal / heredar / ancho de lectura) NO escriben marcador, así el
 * contenido existente queda intacto. Todas las vistas pasan por RichText,
 * RichTextInline o stripMarkdown, que los retiran. */
export type Spacing = 'compact' | 'normal' | 'amplio'
/** `undefined` = hereda del contenedor (p. ej. secciones "feature" centradas). */
export type Align = 'left' | 'center' | 'right' | 'justify'
export type Width = 'normal' | 'full'
export type TextAttrs = { spacing: Spacing; align?: Align; width: Width }

const DEFAULT_ATTRS: TextAttrs = { spacing: 'normal', width: 'normal' }

const ATTR_RE = /^\{\{(lh|al|w):([a-z]+)\}\}/
const ALIGN_CLASS: Record<Align, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
}

function leadingClass(s: Spacing): string {
  return s === 'compact' ? 'leading-snug' : s === 'amplio' ? 'leading-loose' : 'leading-relaxed'
}

/** Separa los marcadores de presentación del cuerpo del texto. */
export function parseAttrs(text: string | null | undefined): { attrs: TextAttrs; body: string } {
  let raw = (text ?? '').replace(/^\s+(?=\{\{(?:lh|al|w):)/, '')
  const attrs: TextAttrs = { ...DEFAULT_ATTRS }
  for (;;) {
    const m = raw.match(ATTR_RE)
    if (!m) break
    const [, key, value] = m
    if (key === 'lh' && (value === 'compact' || value === 'amplio')) attrs.spacing = value
    if (key === 'al' && value in ALIGN_CLASS) attrs.align = value as Align
    if (key === 'w' && value === 'full') attrs.width = 'full'
    raw = raw.slice(m[0].length)
  }
  return { attrs, body: raw.replace(/^\r?\n/, '') }
}

/** Reescribe el texto con sus marcadores (omite los que están en su valor por defecto). */
export function withAttrs(attrs: TextAttrs, body: string): string {
  if (!body.trim()) return body
  let head = ''
  if (attrs.spacing !== 'normal') head += `{{lh:${attrs.spacing}}}`
  if (attrs.align) head += `{{al:${attrs.align}}}`
  if (attrs.width === 'full') head += '{{w:full}}'
  return head ? `${head}\n${body}` : body
}

type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'spacer'; size: number }

function parseBlocks(text: string): Block[] {
  const lines = (text || '').replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let ul: string[] = []
  // Cuenta renglones en blanco seguidos: el 1º separa párrafos (aire normal),
  // los siguientes agregan espacio vertical extra de forma intuitiva.
  let blankRun = 0

  // Une con salto de línea (no con espacio): así un Enter simple se ve como
  // salto de línea en el sitio, igual que en el editor.
  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'p', text: para.join('\n') }); para = [] }
  }
  const flushUl = () => {
    if (ul.length) { blocks.push({ type: 'ul', items: ul }); ul = [] }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/)
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)

    if (line.trim() === '') {
      flushPara(); flushUl()
      blankRun++
      continue
    }

    // Espaciador al retomar contenido tras renglones vacíos:
    //  - En los bordes (arriba del 1er bloque): cada renglón vacío cuenta → así
    //    el "espacio arriba" se ve.
    //  - Entre bloques: el 1º solo separa párrafos; a partir del 2º hay espacio
    //    extra proporcional.
    if (blankRun > 0) {
      const leading = blocks.length === 0
      const size = leading ? blankRun : blankRun >= 2 ? blankRun - 1 : 0
      if (size > 0) blocks.push({ type: 'spacer', size: Math.min(size, 8) })
    }
    blankRun = 0

    if (heading) {
      flushPara(); flushUl()
      blocks.push({ type: 'h', text: heading[1] })
    } else if (bullet) {
      flushPara()
      ul.push(bullet[1])
    } else {
      flushUl()
      para.push(line)
    }
  }
  flushPara(); flushUl()
  // Espacio abajo: renglones vacíos al final también se ven.
  if (blankRun > 0 && blocks.length) {
    blocks.push({ type: 'spacer', size: Math.min(blankRun, 8) })
  }
  return blocks
}

/**
 * Formato en línea: **negrita**, *cursiva* y ***ambas***, anidables entre sí
 * (`**negrita con *cursiva* dentro**`). El parser vive en lib/inlineMarkdown
 * para que el editor y esta vista entiendan exactamente lo mismo.
 */
function renderInline(text: string): ReactNode[] {
  const toNodes = (nodes: InlineNode[]): ReactNode[] =>
    nodes.map((n, i) => {
      if (n.type === 'text') return <Fragment key={i}>{n.value}</Fragment>
      if (n.type === 'strong') return <strong key={i} className="font-bold text-text">{toNodes(n.children)}</strong>
      return <em key={i} className="italic">{toNodes(n.children)}</em>
    })
  return toNodes(parseInline(text))
}

/**
 * Convierte el markdown ligero a texto plano legible (para tarjetas con recorte
 * de líneas, buscadores, etc.). No renderiza formato: solo lo elimina.
 */
export function stripMarkdown(text: string | null | undefined): string {
  if (!text) return ''
  const withoutBlocks = parseAttrs(text.replace(/\r/g, '')).body  // marcadores de presentación
    .replace(/^\s*#{1,6}\s+/gm, '')   // títulos
    .replace(/^\s*[-*•]\s+/gm, '')    // viñetas
  return plainInline(withoutBlocks)   // negrita/cursiva (y asteriscos sueltos)
    .replace(/\n{2,}/g, ' · ')         // saltos dobles → separador visible
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
