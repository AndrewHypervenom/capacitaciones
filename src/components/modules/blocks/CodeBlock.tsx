import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import type { CodeBlock } from '@/types/blocks';
import { cn } from '@/lib/cn';

interface Props {
  block: CodeBlock;
}

const KEYWORDS = new Set([
  'const','let','var','function','return','if','else','for','while','class',
  'import','export','from','default','async','await','new','this','typeof',
  'instanceof','try','catch','finally','throw','in','of','do','switch','case',
  'break','continue','void','delete','yield','extends','super','static',
  'null','undefined','true','false','type','interface','enum','declare',
  'abstract','readonly','implements','public','private','protected',
  // Python
  'def','pass','lambda','with','as','global','nonlocal','raise','except',
  'elif','not','and','or','is','del','print','self',
  // SQL
  'SELECT','FROM','WHERE','JOIN','ON','GROUP','BY','ORDER','HAVING',
  'INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE',
  'ALTER','DROP','INDEX','INNER','LEFT','RIGHT','OUTER','UNION','ALL',
  'DISTINCT','AS','LIMIT','OFFSET','AND','OR','NOT','NULL','IS',
]);

type Tok = { t: 'kw'|'str'|'cmt'|'num'|'fn'|'op'|'plain'; v: string };

function tokenize(code: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < code.length) {
    if ((code[i] === '/' && code[i + 1] === '/') || code[i] === '#') {
      const end = code.indexOf('\n', i);
      const v = end === -1 ? code.slice(i) : code.slice(i, end);
      toks.push({ t: 'cmt', v }); i += v.length; continue;
    }
    if (code[i] === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const v = end === -1 ? code.slice(i) : code.slice(i, end + 2);
      toks.push({ t: 'cmt', v }); i += v.length; continue;
    }
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const q = code[i]; let j = i + 1;
      while (j < code.length) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === q) { j++; break; }
        j++;
      }
      toks.push({ t: 'str', v: code.slice(i, j) }); i = j; continue;
    }
    if (/\d/.test(code[i]) && (i === 0 || /\W/.test(code[i - 1]))) {
      let j = i;
      while (j < code.length && /[\d.xXa-fA-F]/.test(code[j])) j++;
      toks.push({ t: 'num', v: code.slice(i, j) }); i = j; continue;
    }
    if (/[a-zA-Z_$]/.test(code[i])) {
      let j = i;
      while (j < code.length && /[\w$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      const isFn = code[j] === '(';
      const isKw = KEYWORDS.has(word) || KEYWORDS.has(word.toUpperCase());
      toks.push({ t: isKw ? 'kw' : isFn ? 'fn' : 'plain', v: word });
      i = j; continue;
    }
    toks.push({ t: 'plain', v: code[i] }); i++;
  }
  return toks;
}

const TOK_CLS: Record<string, string> = {
  kw:    'text-purple-400 font-semibold',
  str:   'text-amber-300',
  cmt:   'text-neon-green/35 italic',
  num:   'text-blue-400',
  fn:    'text-neon-green',
  op:    '',
  plain: '',
};

export function CodeBlockRenderer({ block }: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(block.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = block.code.split('\n');
  const showLineNumbers = lines.length > 1;

  return (
    <div className="rounded-2xl overflow-hidden border border-line bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neon-green/10 bg-neon-green/5">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
            <div className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
            <div className="h-2.5 w-2.5 rounded-full bg-neon-green/55" />
          </div>
          {block.language && (
            <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-md bg-neon-green/8 text-neon-green ring-1 ring-neon-green/15">
              {block.language}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className={cn(
            'flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-lg transition-all duration-200 outline-none',
            copied
              ? 'text-neon-green bg-neon-green/8'
              : 'text-text-muted hover:text-text bg-transparent hover:bg-glass/30',
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>

      {/* Code */}
      <div className="overflow-x-auto">
        <pre className="py-4 text-[13.5px] font-mono leading-[1.75]">
          {lines.map((line, lineIdx) => {
            const toks = tokenize(line);
            return (
              <div
                key={lineIdx}
                className="flex items-baseline hover:bg-glass/15 transition-colors duration-75"
              >
                {showLineNumbers && (
                  <span className="select-none w-12 shrink-0 text-right pr-4 pl-4 text-[11.5px] text-neon-green/20 border-r border-neon-green/10 mr-4">
                    {lineIdx + 1}
                  </span>
                )}
                <span className={cn('flex-1 pr-5', !showLineNumbers && 'pl-5')}>
                  {toks.length > 0
                    ? toks.map((tok, i) => (
                        <span key={i} className={TOK_CLS[tok.t] ?? ''}>{tok.v}</span>
                      ))
                    : ' '}
                </span>
              </div>
            );
          })}
        </pre>
      </div>

      {block.caption && (
        <div className="px-5 py-2.5 border-t border-line bg-glass/10 flex items-center gap-2 text-[12px] text-text-muted">
          <span className="text-neon-green/40">›</span>
          {block.caption}
        </div>
      )}
    </div>
  );
}
