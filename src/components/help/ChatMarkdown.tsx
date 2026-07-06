import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'

/**
 * Renderizador de Markdown ligero para las respuestas del asistente.
 * Soporta: párrafos, listas (- / *), **negrita**, `código`, y enlaces [txt](url).
 * Los enlaces internos (que empiezan con "/") se convierten en navegación del
 * router y cierran el chat al hacer clic.
 */
export function ChatMarkdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const blocks = parseBlocks(text)
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed">
      {blocks.map((b, i) =>
        b.type === 'ul' ? (
          <ul key={i} className="space-y-1 pl-1">
            {b.items.map((item, j) => (
              <li key={j} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-neon-green" />
                <span>{renderInline(item, onNavigate)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>{renderInline(b.text, onNavigate)}</p>
        ),
      )}
    </div>
  )
}

type Block = { type: 'p'; text: string } | { type: 'ul'; items: string[] }

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let list: string[] = []

  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = [] }
  }
  const flushList = () => {
    if (list.length) { blocks.push({ type: 'ul', items: list }); list = [] }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const listMatch = line.match(/^\s*[-*]\s+(.*)$/) || line.match(/^\s*\d+\.\s+(.*)$/)
    if (listMatch) {
      flushPara()
      list.push(listMatch[1])
    } else if (line.trim() === '') {
      flushPara(); flushList()
    } else {
      flushList()
      para.push(line.replace(/^#+\s*/, '')) // ignora encabezados markdown
    }
  }
  flushPara(); flushList()
  return blocks
}

// Parser inline: **negrita**, `código`, [texto](url)
function renderInline(text: string, onNavigate?: () => void): ReactNode[] {
  const tokens: ReactNode[] = []
  const regex = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(`([^`]+)`)/g
  let last = 0
  let key = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) tokens.push(<Fragment key={key++}>{text.slice(last, match.index)}</Fragment>)

    if (match[1]) {
      // enlace
      const label = match[2]
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
  if (last < text.length) tokens.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return tokens
}
