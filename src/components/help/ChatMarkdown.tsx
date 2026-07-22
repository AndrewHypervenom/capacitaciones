import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'

/**
 * Renderizador de Markdown ligero para las respuestas del asistente.
 * Soporta: subtítulos (#), párrafos, listas con viñeta (- / *), listas numeradas
 * (1. 2. 3.), **negrita**, `código` y enlaces [txt](url).
 * Los enlaces internos (que empiezan con "/") se convierten en navegación del
 * router y cierran el chat al hacer clic.
 *
 * Es tolerante a fallos: cualquier asterisco suelto (negrita mal cerrada por la
 * IA) se limpia en vez de mostrarse literal.
 */
export function ChatMarkdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const blocks = parseBlocks(text)
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed">
      {blocks.map((b, i) => {
        if (b.type === 'h') {
          return (
            <p key={i} className="pt-0.5 text-[13.5px] font-semibold text-text">
              {renderInline(b.text, onNavigate)}
            </p>
          )
        }
        if (b.type === 'ol') {
          return (
            <ol key={i} className="space-y-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neon-green/15 text-[11px] font-semibold text-neon-green">
                    {j + 1}
                  </span>
                  <span className="min-w-0 flex-1 pt-0.5">{renderInline(item, onNavigate)}</span>
                </li>
              ))}
            </ol>
          )
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="space-y-1 pl-1">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-neon-green" />
                  <span className="min-w-0 flex-1">{renderInline(item, onNavigate)}</span>
                </li>
              ))}
            </ul>
          )
        }
        return <p key={i}>{renderInline(b.text, onNavigate)}</p>
      })}
    </div>
  )
}

type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let ul: string[] = []
  let ol: string[] = []

  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = [] }
  }
  const flushUl = () => {
    if (ul.length) { blocks.push({ type: 'ul', items: ul }); ul = [] }
  }
  const flushOl = () => {
    if (ol.length) { blocks.push({ type: 'ol', items: ol }); ol = [] }
  }
  const flushLists = () => { flushUl(); flushOl() }

  // Una línea en blanco no corta la lista de inmediato: puede ser una lista
  // "suelta" (ítems separados por un renglón vacío). Se difiere el corte y se
  // decide al ver la línea siguiente.
  let pendingBlank = false

  for (const raw of lines) {
    const line = raw.trimEnd()
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)

    if (line.trim() === '') {
      pendingBlank = true
      continue
    }

    if (heading) {
      flushPara(); flushLists()
      blocks.push({ type: 'h', text: heading[1] })
    } else if (ordered) {
      // Otro ítem numerado: si ya hay lista ordenada activa, continúa la misma
      // (misma numeración) aunque haya habido un renglón vacío entre medio.
      flushPara(); flushUl()
      ol.push(ordered[1])
    } else if (bullet) {
      flushPara(); flushOl()
      ul.push(bullet[1])
    } else if (!pendingBlank && ol.length) {
      // Continuación del paso (descripción en la línea de abajo, sin renglón vacío).
      ol[ol.length - 1] += ' ' + line.trim()
    } else if (!pendingBlank && ul.length) {
      ul[ul.length - 1] += ' ' + line.trim()
    } else {
      // Renglón vacío + texto normal ⇒ terminó la lista/párrafo previo.
      flushPara(); flushLists()
      para.push(line)
    }
    pendingBlank = false
  }
  flushPara(); flushLists()
  return blocks
}

/** Quita asteriscos sueltos (negrita mal cerrada) sin tocar el resto del texto. */
function stripStrayStars(s: string): string {
  return s.replace(/\*+/g, '')
}

// Parser inline: **negrita**, `código`, [texto](url). Cualquier `*` que sobre se
// limpia para que la IA nunca deje asteriscos a la vista.
function renderInline(text: string, onNavigate?: () => void): ReactNode[] {
  const tokens: ReactNode[] = []
  // Colapsa ***x*** → **x** para que la negrita-cursiva no deje strays.
  const src = text.replace(/\*\*\*([^*]+)\*\*\*/g, '**$1**')
  const regex = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)/g
  let last = 0
  let key = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(src)) !== null) {
    if (match.index > last) {
      tokens.push(<Fragment key={key++}>{stripStrayStars(src.slice(last, match.index))}</Fragment>)
    }

    if (match[1]) {
      // enlace: el texto visible nunca debería ser la ruta, pero por las dudas
      // limpiamos asteriscos del label.
      const label = stripStrayStars(match[2])
      const url = match[3]
      if (url.startsWith('/')) {
        tokens.push(
          <Link
            key={key++}
            to={url}
            onClick={onNavigate}
            className="inline-flex items-center gap-0.5 font-medium text-neon-green underline decoration-neon-green/30 underline-offset-2 hover:decoration-neon-green"
          >
            {label}
          </Link>,
        )
      } else {
        tokens.push(
          <a
            key={key++}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-neon-cyan underline underline-offset-2"
          >
            {label}
            <ArrowUpRight className="h-3 w-3" />
          </a>,
        )
      }
    } else if (match[4]) {
      tokens.push(<strong key={key++} className="font-semibold text-text">{match[5]}</strong>)
    } else if (match[6]) {
      tokens.push(
        <code key={key++} className="rounded bg-subtle px-1 py-0.5 text-[12px] font-mono text-text">
          {match[7]}
        </code>,
      )
    }
    last = regex.lastIndex
  }
  if (last < src.length) tokens.push(<Fragment key={key++}>{stripStrayStars(src.slice(last))}</Fragment>)
  return tokens
}
