import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { highlightRanges, prepareText, smartSearch, type PreparedText } from '@/lib/smartSearch'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** Optional accent color (hex/rgb). Shows a swatch in the menu and tints the
   *  trigger when `tinted` is set — used to preserve semantic color coding
   *  (roles, step types, etc.). */
  color?: string
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
  /** Smaller paddings/typography for inline/toolbar usage. */
  compact?: boolean
  disabled?: boolean
  /** When true, the trigger takes the selected option's `color` as a tint. */
  tinted?: boolean
  /** Optional leading icon rendered inside the trigger. */
  leadingIcon?: ReactNode
  id?: string
  name?: string
  'aria-label'?: string
  /**
   * Buscador arriba del menú. Sin indicarlo sale solo cuando la lista tiene
   * SEARCH_MIN_OPTIONS opciones o más; `true` lo fuerza y `false` lo quita.
   */
  searchable?: boolean
  searchPlaceholder?: string
}

/**
 * Desde cuántas opciones sale el buscador solo. Por debajo (Sí/No, A-Z/Z-A,
 * los 3 países) un campo de texto estorba más de lo que ayuda: se ve todo de un
 * vistazo, y aun así se puede saltar a una opción tecleando su inicial.
 */
export const SEARCH_MIN_OPTIONS = 6

/** Pinta en negrita lo que casó con la búsqueda. */
export function HighlightedLabel({ label, prepared, query }: { label: string; prepared: PreparedText; query: string }) {
  const ranges = query ? highlightRanges(prepared, query) : []
  if (ranges.length === 0) return <>{label}</>
  const parts: ReactNode[] = []
  let at = 0
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(label.slice(at, a))
    parts.push(<mark key={i} className="bg-transparent font-semibold text-text">{label.slice(a, b)}</mark>)
    at = b
  })
  if (at < label.length) parts.push(label.slice(at))
  return <>{parts}</>
}

/** Alto ideal del menú (16rem, como el max-h-64 de antes). */
const PANEL_MAX_H = 256

interface PanelPos {
  top: number
  left: number
  width: number
  openUp: boolean
  /** Alto máximo real disponible: el panel nunca se sale de la ventana. */
  maxH: number
}

/**
 * Componente de select unificado del sitio: bonito, temado (claro/oscuro),
 * responsive (target táctil ≥44px por defecto) y accesible por teclado.
 * Renderiza el panel en un portal para evitar recortes por overflow y usa
 * posicionamiento fijo que se reubica al hacer scroll/resize.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  compact,
  disabled,
  tinted,
  leadingIcon,
  id,
  name,
  'aria-label': ariaLabel,
  searchable,
  searchPlaceholder,
}: SelectProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [query, setQuery] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const showSearch = searchable ?? options.length >= SEARCH_MIN_OPTIONS
  const prepared = useMemo(() => options.map(o => prepareText(o.label)), [options])
  const q = showSearch ? query.trim() : ''
  const result = useMemo(() => smartSearch(options, prepared, q), [options, prepared, q])
  // Sin aciertos, los parecidos por error de dedo ocupan su lugar.
  const suggesting = !!q && result.hits.length === 0 && result.suggestions.length > 0
  const visible = suggesting ? result.suggestions : result.hits
  const preparedOf = (opt: SelectOption) => prepared[options.indexOf(opt)]

  useEffect(() => {
    if (open && showSearch) searchRef.current?.focus()
  }, [open, showSearch])

  // Con flechas en una lista larga, la opción activa no se sale de la vista.
  useEffect(() => {
    if (!open || activeIdx < 0) return
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIdx])
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0, width: 0, openUp: false, maxH: PANEL_MAX_H })

  const measure = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    // Hueco real arriba y abajo, ya descontados el respiro del panel (6px) y
    // el margen con el borde de la ventana (12px).
    const below = window.innerHeight - r.bottom - 18
    const above = r.top - 18
    // Se abre hacia arriba solo si abajo no cabe y arriba hay más sitio: en la
    // última fila de una tabla el menú ya no se queda cortado contra el borde.
    const openUp = below < Math.min(PANEL_MAX_H, above)
    const maxH = Math.max(120, Math.min(PANEL_MAX_H, openUp ? above : below))
    // El panel se mide para no desbordar por la derecha (última columna).
    const panelW = panelRef.current?.offsetWidth ?? r.width
    const left = Math.max(12, Math.min(r.left, window.innerWidth - panelW - 12))
    setPos({ top: openUp ? r.top : r.bottom + 6, left, width: r.width, openUp, maxH })
  }, [])

  useLayoutEffect(() => {
    if (open) measure()
  }, [open, measure])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, measure])

  const selected = options.find(o => o.value === value)

  const commit = (v: string) => {
    onChange(v)
    setOpen(false)
    btnRef.current?.focus()
  }

  const openAt = (idx: number, initialQuery = '') => {
    setQuery(initialQuery)
    setOpen(true)
    setActiveIdx(idx)
  }

  /** Primera opción habilitada cuya palabra inicial empieza por `ch`. */
  const jumpTo = (ch: string) => {
    const c = prepareText(ch).folded
    return options.findIndex((o, i) => !o.disabled && prepared[i].words[0]?.startsWith(c))
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' '
    if (!open && printable) {
      // Escribir sobre el select cerrado ya es buscar, como en uno nativo.
      e.preventDefault()
      if (showSearch) openAt(0, e.key)
      else openAt(Math.max(0, jumpTo(e.key)))
      return
    }
    if (open && printable && !showSearch) {
      const idx = jumpTo(e.key)
      if (idx >= 0) setActiveIdx(idx)
      return
    }
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openAt(Math.max(0, options.findIndex(o => o.value === value)))
      }
      return
    }
    if (!visible.length && e.key !== 'Escape') return
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      btnRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => {
        let n = i
        do { n = (n + 1) % visible.length } while (visible[n]?.disabled && n !== i)
        return n
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => {
        let n = i
        do { n = (n - 1 + visible.length) % visible.length } while (visible[n]?.disabled && n !== i)
        return n
      })
    } else if (e.key === 'Enter' || (e.key === ' ' && !showSearch)) {
      // Con buscador, el espacio se escribe: "IBM UPS" lleva uno.
      e.preventDefault()
      const opt = visible[activeIdx]
      if (opt && !opt.disabled) commit(opt.value)
    }
  }

  const tint = tinted ? selected?.color : undefined

  return (
    <div className={cn('relative w-full', className)}>
      <button
        ref={btnRef}
        type="button"
        id={id}
        name={name}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(Math.max(0, options.findIndex(o => o.value === value))))}
        onKeyDown={onKeyDown}
        className={cn(
          'flex items-center justify-between w-full border transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          tint ? '' : 'bg-bg text-text border-line hover:bg-subtle',
          compact
            ? 'gap-1.5 px-2.5 py-1 rounded-lg text-[12px] min-h-[32px]'
            : 'gap-2 min-h-[44px] px-3.5 py-1.5 rounded-xl text-[13px]',
        )}
        style={tint ? { background: `${tint}15`, color: tint, borderColor: `${tint}30` } : undefined}
      >
        <span className="flex items-center gap-2 min-w-0">
          {leadingIcon}
          {!tinted && selected?.color && (
            <span
              className="h-2.5 w-2.5 rounded-full shrink-0"
              style={{ background: selected.color }}
            />
          )}
          <span className={cn('truncate', !selected && 'text-text-subtle')}>
            {selected?.label ?? placeholder ?? ''}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform',
            tint ? '' : 'text-text-muted',
            open && 'rotate-180',
          )}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            className="fixed overflow-y-auto rounded-xl border border-line bg-surface text-text shadow-xl py-1"
            style={{
              top: pos.openUp ? undefined : pos.top,
              bottom: pos.openUp ? window.innerHeight - pos.top + 6 : undefined,
              left: pos.left,
              // Con buscador, ancho fijo: si siguiera al contenido, el panel
              // se encogería y ensancharía con cada letra.
              width: showSearch ? Math.min(360, Math.max(pos.width, 260), window.innerWidth - 24) : 'max-content',
              minWidth: pos.width,
              maxWidth: Math.min(360, window.innerWidth - 24),
              maxHeight: pos.maxH,
              zIndex: 9999,
            }}
          >
            {showSearch && (
              <div className="sticky top-0 z-10 bg-surface px-2 pb-1">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setActiveIdx(0) }}
                    onKeyDown={onKeyDown}
                    placeholder={searchPlaceholder ?? t('common.select_search', 'Buscar…')}
                    aria-label={searchPlaceholder ?? t('common.select_search', 'Buscar…')}
                    className="w-full rounded-lg border border-line bg-bg py-1.5 pl-8 pr-2.5 text-[13px] text-text outline-none focus:border-primary"
                  />
                </div>
              </div>
            )}
            {suggesting && (
              <div className="px-3.5 pt-1.5 pb-1 text-[11.5px] text-text-subtle">
                {t('common.select_did_you_mean', '¿Quisiste decir…?')}
              </div>
            )}
            {showSearch && q && visible.length === 0 && (
              <div className="px-3.5 py-2 text-[12.5px] text-text-subtle">
                {t('common.select_no_results', { query: q, defaultValue: 'Nada coincide con «{{query}}»' })}
              </div>
            )}
            {visible.map((opt, idx) => {
              const isSelected = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  data-idx={idx}
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => !opt.disabled && commit(opt.value)}
                  className={cn(
                    'flex items-center gap-2 w-full text-left px-3.5 py-2 text-[13px] transition-colors',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    idx === activeIdx && !opt.disabled && 'bg-subtle',
                    isSelected ? 'text-text font-medium' : 'text-text-muted',
                  )}
                >
                  {opt.color && (
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: opt.color }}
                    />
                  )}
                  <span className="truncate flex-1">
                    {suggesting ? opt.label : <HighlightedLabel label={opt.label} prepared={preparedOf(opt)} query={q} />}
                  </span>
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-brand-green" />}
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}

export default Select
