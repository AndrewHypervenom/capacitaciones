import { Fragment, type ReactNode } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/cn'
import { parseInline, plainInline, sanitizeHref, type InlineNode } from '@/lib/inlineMarkdown'
import { Tooltip } from './Tooltip'

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
        // La alineación del renglón manda sobre la del campo (y sobre la que
        // hereda de la sección): es la más específica que eligió el autor.
        const lineAlign = b.align && ALIGN_CLASS[b.align]
        if (b.type === 'h') {
          return (
            <p key={i} className={cn('text-[15px] font-bold tracking-tight text-text', lineAlign)}>
              {renderInline(b.text)}
            </p>
          )
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className={cn('space-y-1 pl-1', lineAlign)}>
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
        return <p key={i} className={cn('whitespace-pre-line', lineAlign)}>{renderInline(b.text)}</p>
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
export function RichTextInline({
  text,
  inertLinks = false,
}: {
  text: string | null | undefined
  /**
   * Pinta los enlaces como texto (con su pista) pero sin navegar. Para textos
   * que viven DENTRO de algo clicable: una opción de respuesta es un botón, y
   * ahí un enlace de verdad se llevaría al aprendiz fuera del examen en mitad
   * del intento, o peor: elegiría la opción sin querer.
   */
  inertLinks?: boolean
}) {
  if (!text) return null
  // Defensivo: si algún marcador de presentación se coló, no debe verse.
  const { body } = parseAttrs(text)
  const { align, text: line } = parseLineAlign(body)
  // Sin alineación propia no se envuelve en nada: el texto sigue fluyendo
  // dentro del `<p>` de quien llama, exactamente como antes. Con alineación
  // hace falta un contenedor de bloque, porque `text-align` no lo puede aplicar
  // un tramo suelto de texto.
  if (!align) return <>{renderInline(line, inertLinks)}</>
  return <span className={cn('block', ALIGN_CLASS[align])}>{renderInline(line, inertLinks)}</span>
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

/**
 * Separa los marcadores de presentación del cuerpo del texto.
 *
 * Solo cuenta como marcador DE CAMPO el que va en su propio renglón — que es
 * exactamente como lo escribe `withAttrs`. Pegado al texto (`{{al:left}}Hola`)
 * es un marcador DE LÍNEA y lo resuelve `parseLineAlign`: así una alineación
 * por renglón no se confunde con la del campo entero.
 */
export function parseAttrs(text: string | null | undefined): { attrs: TextAttrs; body: string } {
  const raw = (text ?? '').replace(/^\s+(?=\{\{(?:lh|al|w):)/, '')
  const attrs: TextAttrs = { ...DEFAULT_ATTRS }
  let rest = raw
  for (;;) {
    const m = rest.match(ATTR_RE)
    if (!m) break
    const [, key, value] = m
    if (key === 'lh' && (value === 'compact' || value === 'amplio')) attrs.spacing = value
    if (key === 'al' && value in ALIGN_CLASS) attrs.align = value as Align
    if (key === 'w' && value === 'full') attrs.width = 'full'
    rest = rest.slice(m[0].length)
  }
  // Sin salto detrás no era del campo: se devuelve el texto intacto para que lo
  // lea el marcador de línea.
  if (rest !== raw && !/^\r?\n/.test(rest)) return { attrs: { ...DEFAULT_ATTRS }, body: raw }
  return { attrs, body: rest.replace(/^\r?\n/, '') }
}

/* ── Alineación por renglón ──────────────────────────────────────────────
 * `{{al:left}}Texto` alinea SOLO ese renglón (párrafo, título o lista). Es lo
 * que permite tener el título centrado y la lista de abajo a la izquierda
 * dentro del mismo campo, y —a diferencia del marcador de campo— sobrevive a
 * los campos que se guardan partidos en párrafos, porque viaja pegado a su
 * propio párrafo. */
const LINE_ALIGN_RE = /^\{\{al:(left|center|right|justify)\}\}/

/** Separa la alineación de renglón de su texto. */
export function parseLineAlign(line: string): { align?: Align; text: string } {
  const m = line.match(LINE_ALIGN_RE)
  if (!m) return { text: line }
  return { align: m[1] as Align, text: line.slice(m[0].length) }
}

/** Reescribe un renglón con su alineación (sin marcador si es "automático"). */
export function withLineAlign(line: string, align?: Align): string {
  const { text } = parseLineAlign(line)
  return align ? `{{al:${align}}}${text}` : text
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
  | { type: 'p'; text: string; align?: Align }
  | { type: 'h'; text: string; align?: Align }
  | { type: 'ul'; items: string[]; align?: Align }
  | { type: 'spacer'; size: number }

function parseBlocks(text: string): Block[] {
  const lines = (text || '').replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let ul: string[] = []
  // Alineación del bloque que se está juntando: la fija su PRIMER renglón, y
  // así una lista entera se alinea marcando solo su primera viñeta.
  let paraAlign: Align | undefined
  let ulAlign: Align | undefined
  // Cuenta renglones en blanco seguidos: el 1º separa párrafos (aire normal),
  // los siguientes agregan espacio vertical extra de forma intuitiva.
  let blankRun = 0

  // Une con salto de línea (no con espacio): así un Enter simple se ve como
  // salto de línea en el sitio, igual que en el editor.
  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'p', text: para.join('\n'), align: paraAlign }); para = []; paraAlign = undefined }
  }
  const flushUl = () => {
    if (ul.length) { blocks.push({ type: 'ul', items: ul, align: ulAlign }); ul = []; ulAlign = undefined }
  }

  for (const raw of lines) {
    // La alineación se lee ANTES de mirar si el renglón es título o viñeta: se
    // escribe `{{al:left}}- Punto`, no al revés.
    const { align, text: aligned } = parseLineAlign(raw.trimStart())
    const line = (align ? aligned : raw).trimEnd()
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
      blocks.push({ type: 'h', text: heading[1], align })
    } else if (bullet) {
      flushPara()
      // Una viñeta con alineación propia arranca lista nueva: si no, marcar la
      // tercera de una lista movería en silencio a las dos de arriba.
      if (ul.length && align && align !== ulAlign) flushUl()
      if (!ul.length) ulAlign = align
      ul.push(bullet[1])
    } else {
      flushUl()
      if (!para.length) paraAlign = align
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
 * Formato en línea: **negrita**, *cursiva*, ***ambas*** y enlaces
 * `[texto](destino "pista")`, anidables entre sí. El parser vive en
 * lib/inlineMarkdown para que el editor y esta vista entiendan lo mismo.
 */
function renderInline(text: string, inertLinks = false): ReactNode[] {
  const toNodes = (nodes: InlineNode[]): ReactNode[] =>
    nodes.map((n, i) => {
      if (n.type === 'text') return <Fragment key={i}>{n.value}</Fragment>
      if (n.type === 'strong') return <strong key={i} className="font-bold text-text">{toNodes(n.children)}</strong>
      if (n.type === 'em') return <em key={i} className="italic">{toNodes(n.children)}</em>
      return <InlineLink key={i} href={n.href} title={n.title} inert={inertLinks}>{toNodes(n.children)}</InlineLink>
    })
  return toNodes(parseInline(text))
}

/**
 * Enlace del texto enriquecido.
 *
 * - Un destino que no sea `http(s)`, `mailto`, `tel` o una ruta del propio sitio
 *   se degrada a texto plano: nunca se pinta un enlace que no se puede confiar,
 *   y tampoco se le muestra al aprendiz el markdown crudo.
 * - Rutas internas (`/courses/…`) navegan con el router: sin recarga completa y
 *   sin perder el estado de la sesión.
 * - Las externas abren en otra pestaña con `rel="noopener noreferrer"`, para no
 *   sacar a nadie a mitad de un módulo, y lo avisan con un ícono.
 * - La "pista" va en ui/Tooltip, nunca en `title`: el globo del navegador tarda
 *   un segundo, no se puede ver en táctil y no respeta el tema del sitio.
 */
function InlineLink({ href, title, children, inert = false }: { href: string; title?: string; children: ReactNode; inert?: boolean }) {
  const safe = sanitizeHref(href)
  const inRouter = useInRouterContext()
  if (!safe) return <>{children}</>

  const internal = safe.startsWith('/') || safe.startsWith('#')
  const cls =
    'font-medium text-primary underline decoration-primary/40 underline-offset-2 ' +
    'transition-colors hover:decoration-primary break-words'

  // Nada de `inline-flex` aquí: un enlace largo dentro de un párrafo tiene que
  // poder partirse entre renglones, y un contenedor flex nunca se parte. El
  // ícono va `inline`, fluyendo como una letra más.
  const anchor = inert ? (
    // Dentro de algo clicable: se ve como enlace y conserva la pista, pero el
    // clic pertenece al botón que lo contiene.
    <span className={cn(cls, 'decoration-dotted')}>{children}</span>
  ) : internal && inRouter ? (
    <Link to={safe} className={cls}>{children}</Link>
  ) : (
    <a
      href={safe}
      {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
      className={cls}
    >
      {children}
      {!internal && (
        <ExternalLink className="ml-1 inline h-3 w-3 shrink-0 -translate-y-px opacity-70" aria-hidden />
      )}
    </a>
  )

  if (!title) return anchor
  // `describedBy`: aquí el globo dice algo que el enlace NO dice, así que sí se
  // expone a lectores de pantalla. `!inline` deshace el `inline-flex` propio del
  // Tooltip, por lo mismo del salto de renglón.
  return (
    <Tooltip label={title} maxWidth={260} anchor="element" describedBy className="!inline">
      {anchor}
    </Tooltip>
  )
}

/**
 * Convierte el markdown ligero a texto plano legible (para tarjetas con recorte
 * de líneas, buscadores, etc.). No renderiza formato: solo lo elimina.
 */
export function stripMarkdown(text: string | null | undefined): string {
  if (!text) return ''
  const withoutBlocks = parseAttrs(text.replace(/\r/g, '')).body  // marcadores de presentación
    .replace(/^\s*\{\{al:(?:left|center|right|justify)\}\}/gm, '') // alineación por renglón
    .replace(/^\s*#{1,6}\s+/gm, '')   // títulos
    .replace(/^\s*[-*•]\s+/gm, '')    // viñetas
  return plainInline(withoutBlocks)   // negrita/cursiva (y asteriscos sueltos)
    .replace(/\n{2,}/g, ' · ')         // saltos dobles → separador visible
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
