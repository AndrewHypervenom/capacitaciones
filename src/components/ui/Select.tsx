import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/cn'

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
}

interface PanelPos {
  top: number
  left: number
  width: number
  openUp: boolean
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
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0, width: 0, openUp: false })

  const measure = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = spaceBelow < 220 && r.top > spaceBelow
    setPos({
      top: openUp ? r.top : r.bottom + 6,
      left: r.left,
      width: r.width,
      openUp,
    })
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

  const openAt = (idx: number) => {
    setOpen(true)
    setActiveIdx(idx)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openAt(Math.max(0, options.findIndex(o => o.value === value)))
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      btnRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => {
        let n = i
        do { n = (n + 1) % options.length } while (options[n]?.disabled && n !== i)
        return n
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => {
        let n = i
        do { n = (n - 1 + options.length) % options.length } while (options[n]?.disabled && n !== i)
        return n
      })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const opt = options[activeIdx]
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
            className="fixed max-h-64 overflow-y-auto rounded-xl border border-line bg-surface text-text shadow-xl py-1"
            style={{
              top: pos.openUp ? undefined : pos.top,
              bottom: pos.openUp ? window.innerHeight - pos.top + 6 : undefined,
              left: pos.left,
              width: 'max-content',
              minWidth: pos.width,
              maxWidth: Math.min(360, window.innerWidth - 24),
              zIndex: 9999,
            }}
          >
            {options.map((opt, idx) => {
              const isSelected = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
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
                  <span className="truncate flex-1">{opt.label}</span>
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
