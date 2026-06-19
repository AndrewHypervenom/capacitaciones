import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface FilterDropdownOption {
  value: string
  label: string
}

interface FilterDropdownProps {
  value: string
  onChange: (value: string) => void
  options: FilterDropdownOption[]
  placeholder?: string
  className?: string
  compact?: boolean
}

interface PanelPos { top: number; left: number; width: number; openUp: boolean }

export function FilterDropdown({ value, onChange, options, placeholder, className, compact }: FilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<PanelPos>({ top: 0, left: 0, width: 0, openUp: false })

  const measure = useCallback(() => {
    const btn = btnRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const openUp = spaceBelow < 200 && r.top > spaceBelow
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

  return (
    <div className={cn('relative w-full', className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          'flex items-center justify-between w-full bg-bg text-text border border-line hover:bg-subtle transition-colors',
          compact
            ? 'gap-1.5 px-2.5 py-1 rounded-lg text-[12px]'
            : 'gap-2 min-h-[44px] px-3.5 py-1.5 rounded-xl text-[13px]',
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder ?? ''}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed max-h-64 overflow-y-auto rounded-xl border border-line bg-surface text-text shadow-xl py-1"
          style={{
            top: pos.openUp ? undefined : pos.top,
            bottom: pos.openUp ? window.innerHeight - pos.top + 6 : undefined,
            left: pos.left,
            width: 'max-content',
            minWidth: pos.width,
            maxWidth: 320,
            zIndex: 9999,
          }}
        >
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={cn(
                'w-full text-left px-3.5 py-2 text-[13px] transition-colors hover:bg-subtle',
                opt.value === value ? 'text-text font-medium bg-subtle' : 'text-text-muted',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
