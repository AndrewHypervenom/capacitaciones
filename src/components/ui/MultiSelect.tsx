import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { SelectOption } from '@/components/ui/Select'

export interface MultiSelectProps {
  values: string[]
  onChange: (values: string[]) => void
  options: SelectOption[]
  /** Texto del trigger cuando no hay nada seleccionado. */
  placeholder?: string
  /** Resumen cuando hay más de una selección: recibe el total. */
  summary?: (count: number) => string
  className?: string
  compact?: boolean
  disabled?: boolean
  'aria-label'?: string
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
 * Select de selección múltiple, hermano de ui/Select: mismo look, portal para no
 * recortarse por overflow, temado claro/oscuro y navegable por teclado.
 *
 * A diferencia de Select, el panel NO se cierra al elegir: se marcan varias y se
 * cierra al hacer clic fuera o con Escape.
 */
export function MultiSelect({
  values,
  onChange,
  options,
  placeholder,
  summary,
  className,
  compact,
  disabled,
  'aria-label': ariaLabel,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
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

  const toggle = (value: string) => {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value])
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
        setActiveIdx(0)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      btnRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => {
        let n = i
        do { n = (n + 1) % options.length } while (options[n]?.disabled && n !== i)
        return n
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => {
        let n = i
        do { n = (n - 1 + options.length) % options.length } while (options[n]?.disabled && n !== i)
        return n
      })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const opt = options[activeIdx]
      if (opt && !opt.disabled) toggle(opt.value)
    }
  }

  const selectedLabels = options.filter((o) => values.includes(o.value)).map((o) => o.label)
  const label =
    selectedLabels.length === 0
      ? placeholder ?? ''
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : summary?.(selectedLabels.length) ?? selectedLabels.join(', ')

  return (
    <div className={cn('relative w-full', className)}>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : (setOpen(true), setActiveIdx(0)))}
        onKeyDown={onKeyDown}
        className={cn(
          'flex items-center justify-between w-full border transition-colors',
          'bg-bg text-text border-line hover:bg-subtle',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          compact
            ? 'gap-1.5 px-2.5 py-1 rounded-lg text-[12px] min-h-[32px]'
            : 'gap-2 min-h-[44px] px-3.5 py-1.5 rounded-xl text-[13px]',
        )}
      >
        <span className={cn('truncate', selectedLabels.length === 0 && 'text-text-subtle')}>
          {label}
        </span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 shrink-0 text-text-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-multiselectable
            className="fixed overflow-y-auto rounded-xl border border-line bg-surface text-text shadow-xl py-1"
            style={{
              top: pos.openUp ? undefined : pos.top,
              bottom: pos.openUp ? window.innerHeight - pos.top + 6 : undefined,
              left: pos.left,
              width: 'max-content',
              minWidth: pos.width,
              maxWidth: Math.min(360, window.innerWidth - 24),
              maxHeight: pos.maxH,
              zIndex: 9999,
            }}
          >
            {options.map((opt, idx) => {
              const isSelected = values.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => !opt.disabled && toggle(opt.value)}
                  className={cn(
                    'flex items-center gap-2 w-full text-left px-3.5 py-2 text-[13px] transition-colors',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    idx === activeIdx && !opt.disabled && 'bg-subtle',
                    isSelected ? 'text-text font-medium' : 'text-text-muted',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      isSelected ? 'border-transparent bg-brand-green' : 'border-line',
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3 text-black" />}
                  </span>
                  <span className="truncate flex-1">{opt.label}</span>
                </button>
              )
            })}
            {options.length === 0 && (
              <div className="px-3.5 py-2 text-[13px] text-text-subtle">—</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

export default MultiSelect
