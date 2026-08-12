import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

/* ────────────────────────────────────────────────────────────────────────────
   Campo numérico que SÍ se deja escribir.

   El patrón `value={n}` + `onChange={Math.max(min, Math.min(max, Number(v)))}`
   parece inocente y es insoportable de usar: al borrar el contenido para poner
   otro número, `Number('')` da 0 y el campo salta al mínimo, así que nunca
   puedes vaciarlo y teclear "35" — te obliga a seleccionar y sobrescribir.

   Aquí el borrador es texto libre mientras escribes:
   · se propaga hacia arriba solo cuando el número ya es válido y está en rango,
   · el recorte a [min, max] ocurre al SALIR del campo (o con Enter),
   · si lo dejas vacío, vuelve al último valor bueno en vez de inventarse un 0.
   ──────────────────────────────────────────────────────────────────────────── */

export function NumberField({
  value,
  onChange,
  onCommit,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  disabled,
  className,
  'aria-label': ariaLabel,
  id,
}: {
  value: number
  onChange: (n: number) => void
  /** Se llama al salir del campo con el valor ya recortado (para persistir). */
  onCommit?: (n: number) => void
  min?: number
  max?: number
  disabled?: boolean
  /**
   * Reemplaza el aspecto por defecto (no se mezcla con él: sin tailwind-merge,
   * dos `px-*` en la misma clase pelean y gana el que esté después en la hoja).
   */
  className?: string
  'aria-label'?: string
  id?: string
}) {
  const [draft, setDraft] = useState(() => String(value))
  const focused = useRef(false)

  // Sincroniza con el valor de fuera (reset del formulario, guardado) sin
  // pisar lo que se está tecleando.
  useEffect(() => {
    if (focused.current && Number(draft) === value) return
    setDraft(String(value))
    // `draft` a propósito fuera de las dependencias: solo interesa el valor externo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const commit = () => {
    const n = Number(draft)
    const next =
      draft.trim() === '' || !Number.isFinite(n)
        ? value
        : Math.max(min, Math.min(max, Math.round(n)))
    setDraft(String(next))
    if (next !== value) onChange(next)
    onCommit?.(next)
  }

  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        const n = Number(raw)
        if (raw.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n))
      }}
      onBlur={() => {
        focused.current = false
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className={cn(
        className ??
          'w-full rounded-xl border border-line bg-surface px-3 py-2 text-[14px] tabular-nums text-text outline-none transition-colors focus:border-primary',
        'disabled:opacity-50',
      )}
    />
  )
}
