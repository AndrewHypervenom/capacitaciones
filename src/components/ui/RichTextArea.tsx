import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bold, Italic, Heading, List, Eye, Pencil, Check,
  AlignVerticalSpaceAround, ArrowUpToLine, ArrowDownToLine, MoveVertical,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, WrapText, Maximize2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { RichText, parseAttrs, withAttrs, type Spacing, type Align, type Width, type TextAttrs } from './RichText'
import { Tooltip } from './Tooltip'
import { marksAtSelection, toggleInlineMark, type MarkName, type Marks } from '@/lib/inlineMarkdown'

/**
 * Editor de texto enriquecido con barra de formato (negrita, cursiva, título,
 * lista), controles de espacio (margen arriba/abajo en cualquier bloque, incl.
 * títulos), interlineado por campo y vista previa animada.
 *
 * Guarda Markdown ligero en el mismo campo. El interlineado se persiste como un
 * marcador invisible al inicio, por eso trabajamos sobre el "cuerpo" sin marcador
 * y reserializamos en cada cambio. Menús y tooltips se renderizan en portales
 * para que ninguna tarjeta con overflow los recorte.
 */
export function RichTextArea({
  value,
  onChange,
  rows = 5,
  placeholder,
  className,
  showSpacing = true,
  showWidth = false,
  inlineOnly = false,
}: {
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
  className?: string
  /**
   * Muestra el control de interlineado. Se apaga en campos cuyo guardado
   * transforma el texto (p. ej. el cuerpo de sección, que se parte en un array
   * de párrafos): ahí el marcador invisible no sobreviviría y se vería literal.
   */
  showSpacing?: boolean
  /**
   * Ofrece "ancho completo". Solo tiene sentido donde la vista final limita el
   * ancho de lectura (hoy: el bloque de párrafo del módulo, `max-w-[68ch]`).
   */
  showWidth?: boolean
  /**
   * Oculta título y lista. Para campos cortos cuya vista final solo entiende
   * formato en línea (citas, tarjetas, hitos): ahí un `# ` o un `- ` se vería
   * literal, así que mejor no ofrecerlos.
   */
  inlineOnly?: boolean
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)
  // Marcas de lo que está seleccionado ahora mismo: encienden los botones para
  // que se vea de un vistazo si el texto ya está en negrita o cursiva.
  const [active, setActive] = useState<Marks>({ b: false, i: false })

  const { attrs, body } = parseAttrs(value)
  const emit = (nextBody: string, nextAttrs: TextAttrs = attrs) => onChange(withAttrs(nextAttrs, nextBody))

  const syncActive = (source?: string) => {
    const el = ref.current
    if (!el) return
    setActive(marksAtSelection(source ?? body, el.selectionStart, el.selectionEnd))
  }

  const restoreCursor = (from: number, to: number, source?: string) => {
    requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(from, to)
      syncActive(source)
    })
  }

  /**
   * Alterna negrita/cursiva sobre lo seleccionado: si ya lo está, se quita; si
   * no, se pone (y convive con la otra marca). Solo afecta a la selección, sin
   * arrastrar palabras vecinas, y al terminar la deja seleccionada igual que
   * antes para poder encadenar negrita + cursiva.
   */
  const toggle = (mark: MarkName) => {
    const el = ref.current
    if (!el) return
    const next = toggleInlineMark(
      body,
      el.selectionStart,
      el.selectionEnd,
      mark,
      t('common.rich.sample_bold', { defaultValue: 'texto' }),
    )
    emit(next.value)
    restoreCursor(next.start, next.end, next.value)
  }

  /** Antepone un prefijo (# , - ) al inicio de la línea actual. */
  const prefixLine = (prefix: string) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const lineStart = body.lastIndexOf('\n', start - 1) + 1
    const already = body.slice(lineStart).startsWith(prefix)
    if (!already) emit(body.slice(0, lineStart) + prefix + body.slice(lineStart))
    const delta = already ? 0 : prefix.length
    restoreCursor(start + delta, start + delta)
  }

  /** Inserta un renglón en blanco arriba o abajo de la línea/título actual → margen. */
  const addMargin = (where: 'above' | 'below') => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    if (where === 'above') {
      const lineStart = body.lastIndexOf('\n', start - 1) + 1
      emit(body.slice(0, lineStart) + '\n' + body.slice(lineStart))
      restoreCursor(start + 1, start + 1)
    } else {
      let lineEnd = body.indexOf('\n', start)
      if (lineEnd === -1) lineEnd = body.length
      emit(body.slice(0, lineEnd) + '\n' + body.slice(lineEnd))
      restoreCursor(start, start)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === 'b') { e.preventDefault(); toggle('b') }
    else if (k === 'i') { e.preventDefault(); toggle('i') }
  }

  const btnCls =
    'flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-glass/10 hover:text-text transition-colors'
  const activeCls = 'bg-primary/12 text-primary hover:bg-primary/15 hover:text-primary'

  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden focus-within:border-primary/50 transition-colors">
      <div className="flex items-center gap-0.5 border-b border-line px-1.5 py-1">
        <ToolBtn
          className={cn(btnCls, active.b && activeCls)}
          pressed={active.b}
          label={t('common.rich.bold', { defaultValue: 'Negrita' })}
          onClick={() => toggle('b')}
          tip={<Tip title={t('common.rich.bold', { defaultValue: 'Negrita' })} hint={active.b ? t('common.rich.bold_off_hint', { defaultValue: 'Clic de nuevo para quitarla' }) : t('common.rich.bold_hint', { defaultValue: 'Resalta lo importante' })} keys="Ctrl B" />}
        >
          <Bold className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          className={cn(btnCls, active.i && activeCls)}
          pressed={active.i}
          label={t('common.rich.italic', { defaultValue: 'Cursiva' })}
          onClick={() => toggle('i')}
          tip={<Tip title={t('common.rich.italic', { defaultValue: 'Cursiva' })} hint={active.i ? t('common.rich.italic_off_hint', { defaultValue: 'Clic de nuevo para quitarla' }) : t('common.rich.italic_hint', { defaultValue: 'Da énfasis sutil' })} keys="Ctrl I" />}
        >
          <Italic className="h-4 w-4" />
        </ToolBtn>
        {!inlineOnly && (
          <>
            <ToolBtn
              className={btnCls}
              label={t('common.rich.heading', { defaultValue: 'Título' })}
              onClick={() => prefixLine('# ')}
              tip={<Tip title={t('common.rich.heading', { defaultValue: 'Título' })} hint={t('common.rich.heading_hint', { defaultValue: 'Separa secciones del texto' })} />}
            >
              <Heading className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              className={btnCls}
              label={t('common.rich.list', { defaultValue: 'Lista' })}
              onClick={() => prefixLine('- ')}
              tip={<Tip title={t('common.rich.list', { defaultValue: 'Lista' })} hint={t('common.rich.list_hint', { defaultValue: 'Enumera puntos con viñetas' })} />}
            >
              <List className="h-4 w-4" />
            </ToolBtn>
          </>
        )}

        <span className="mx-1 h-5 w-px bg-line" aria-hidden />

        <SpaceMenu btnCls={btnCls} onAdd={addMargin} />
        {showSpacing && (
          <>
            <SpacingMenu value={attrs.spacing} onSelect={(s) => emit(body, { ...attrs, spacing: s })} btnCls={btnCls} />
            <AlignMenu
              align={attrs.align}
              width={attrs.width}
              showWidth={showWidth}
              onAlign={(a) => emit(body, { ...attrs, align: a })}
              onWidth={(w) => emit(body, { ...attrs, width: w })}
              btnCls={btnCls}
            />
          </>
        )}

        <div className="ml-auto">
          <Tooltip label={<Tip title={preview ? t('common.rich.edit', { defaultValue: 'Editar' }) : t('common.rich.preview', { defaultValue: 'Vista previa' })} hint={preview ? t('common.rich.edit_hint', { defaultValue: 'Volver a escribir' }) : t('common.rich.preview_hint', { defaultValue: 'Míralo como el aprendiz' })} />}>
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              onClick={() => setPreview((p) => !p)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[12px] font-medium transition-colors',
                preview ? 'bg-primary/10 text-primary' : 'text-text-muted hover:bg-glass/10 hover:text-text',
              )}
            >
              {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {preview ? t('common.rich.edit', { defaultValue: 'Editar' }) : t('common.rich.preview', { defaultValue: 'Vista previa' })}
            </motion.button>
          </Tooltip>
        </div>
      </div>

      <div className="relative">
        <AnimatePresence initial={false} mode="wait">
          {preview ? (
            <motion.div
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="px-3.5 py-3 text-[14px] text-text"
              style={{ minHeight: `${rows * 1.6 + 1.5}rem` }}
            >
              {body.trim() ? (
                <RichText text={value} />
              ) : (
                <span className="text-text-subtle">{t('common.rich.empty_preview', { defaultValue: 'Nada que previsualizar todavía.' })}</span>
              )}
            </motion.div>
          ) : (
            <motion.textarea
              key="editor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              ref={ref}
              value={body}
              onChange={(e) => { emit(e.target.value); syncActive(e.target.value) }}
              onKeyDown={onKeyDown}
              onSelect={() => syncActive()}
              onBlur={() => setActive({ b: false, i: false })}
              rows={rows}
              placeholder={placeholder}
              className={cn(
                'block w-full resize-y bg-transparent px-3.5 py-3 text-[14px] text-text outline-none placeholder:text-text-subtle',
                className,
              )}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ── Menú: margen arriba/abajo (aplica a cualquier bloque, incluidos títulos) ── */
function SpaceMenu({ btnCls, onAdd }: { btnCls: string; onAdd: (where: 'above' | 'below') => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  const items = [
    { id: 'above' as const, icon: ArrowUpToLine, label: t('common.rich.margin_above', { defaultValue: 'Espacio arriba' }) },
    { id: 'below' as const, icon: ArrowDownToLine, label: t('common.rich.margin_below', { defaultValue: 'Espacio abajo' }) },
  ]

  return (
    <>
      <Tooltip label={<Tip title={t('common.rich.space', { defaultValue: 'Espaciado' })} hint={t('common.rich.space_hint', { defaultValue: 'Da aire arriba o abajo del texto' })} />}>
        <motion.button
          ref={anchorRef}
          type="button"
          aria-label={t('common.rich.space', { defaultValue: 'Espaciado' })}
          whileTap={{ scale: 0.9 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(btnCls, open && 'bg-glass/10 text-text')}
        >
          <MoveVertical className="h-4 w-4" />
        </motion.button>
      </Tooltip>

      <PortalMenu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={216}>
        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
          {t('common.rich.space', { defaultValue: 'Espaciado' })}
        </div>
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            onClick={() => onAdd(it.id)}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[13px] font-medium text-text hover:bg-glass/8 transition-colors"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-glass/10 text-text-muted">
              <it.icon className="h-4 w-4" />
            </span>
            <span className="flex-1">{it.label}</span>
          </button>
        ))}
        <div className="px-2 pt-1 pb-0.5 text-[10.5px] text-text-subtle">
          {t('common.rich.space_repeat_hint', { defaultValue: 'Repite para más espacio.' })}
        </div>
      </PortalMenu>
    </>
  )
}

/* ── Menú: alineación y ancho ────────────────────────────────────────────
 * "Automático" hereda del contenedor: hay secciones (estilo "feature") que
 * centran todo su contenido a propósito, y ese sigue siendo el comportamiento
 * por defecto. Elegir una alineación explícita la impone sobre la sección. */
function AlignMenu({
  align, width, showWidth, onAlign, onWidth, btnCls,
}: {
  align?: Align
  width: Width
  showWidth: boolean
  onAlign: (a: Align | undefined) => void
  onWidth: (w: Width) => void
  btnCls: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  const options: { id: Align | undefined; icon: typeof AlignLeft; label: string }[] = [
    { id: undefined, icon: WrapText, label: t('common.rich.align_auto', { defaultValue: 'Automático' }) },
    { id: 'left', icon: AlignLeft, label: t('common.rich.align_left', { defaultValue: 'Izquierda' }) },
    { id: 'center', icon: AlignCenter, label: t('common.rich.align_center', { defaultValue: 'Centro' }) },
    { id: 'right', icon: AlignRight, label: t('common.rich.align_right', { defaultValue: 'Derecha' }) },
    { id: 'justify', icon: AlignJustify, label: t('common.rich.align_justify', { defaultValue: 'Justificado' }) },
  ]

  const CurrentIcon = options.find((o) => o.id === align)?.icon ?? WrapText

  return (
    <>
      <Tooltip label={<Tip title={t('common.rich.align', { defaultValue: 'Alineación' })} hint={t('common.rich.align_hint', { defaultValue: 'Izquierda, centro, justificado o ancho completo' })} />}>
        <motion.button
          ref={anchorRef}
          type="button"
          aria-label={t('common.rich.align', { defaultValue: 'Alineación' })}
          whileTap={{ scale: 0.9 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(btnCls, (open || align || width === 'full') && 'bg-glass/10 text-text')}
        >
          <CurrentIcon className="h-4 w-4" />
        </motion.button>
      </Tooltip>

      <PortalMenu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={224}>
        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
          {t('common.rich.align', { defaultValue: 'Alineación' })}
        </div>
        {options.map((o) => {
          const active = o.id === align
          return (
            <button
              key={o.id ?? 'auto'}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => { onAlign(o.id); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                active ? 'bg-primary/10 text-primary' : 'text-text hover:bg-glass/8',
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                <o.icon className="h-4 w-4" />
              </span>
              <span className="flex-1 text-[13px] font-medium">{o.label}</span>
              {active && <Check className="h-4 w-4" />}
            </button>
          )
        })}

        {showWidth && (
          <>
            <div className="my-1 h-px bg-line" aria-hidden />
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              {t('common.rich.width', { defaultValue: 'Ancho' })}
            </div>
            {([
              { id: 'normal' as const, icon: WrapText, label: t('common.rich.width_reading', { defaultValue: 'Ancho de lectura' }), hint: t('common.rich.width_reading_hint', { defaultValue: 'Renglones cortos, más fáciles de leer' }) },
              { id: 'full' as const, icon: Maximize2, label: t('common.rich.width_full', { defaultValue: 'Ancho completo' }), hint: t('common.rich.width_full_hint', { defaultValue: 'Aprovecha todo el espacio disponible' }) },
            ]).map((o) => {
              const active = o.id === width
              return (
                <button
                  key={o.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => { onWidth(o.id); setOpen(false) }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                    active ? 'bg-primary/10 text-primary' : 'text-text hover:bg-glass/8',
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                    <o.icon className="h-4 w-4" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-[13px] font-medium">{o.label}</span>
                    <span className="block text-[10.5px] text-text-subtle">{o.hint}</span>
                  </span>
                  {active && <Check className="mt-0.5 h-4 w-4" />}
                </button>
              )
            })}
          </>
        )}
      </PortalMenu>
    </>
  )
}

/* ── Menú: interlineado, con líneas de muestra que ilustran cada opción ── */
function SpacingMenu({ value, onSelect, btnCls }: { value: Spacing; onSelect: (s: Spacing) => void; btnCls: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  const options: { id: Spacing; label: string; gap: number }[] = [
    { id: 'compact', label: t('common.rich.lh_compact', { defaultValue: 'Compacto' }), gap: 2 },
    { id: 'normal', label: t('common.rich.lh_normal', { defaultValue: 'Normal' }), gap: 4 },
    { id: 'amplio', label: t('common.rich.lh_wide', { defaultValue: 'Amplio' }), gap: 6 },
  ]

  return (
    <>
      <Tooltip label={<Tip title={t('common.rich.line_spacing', { defaultValue: 'Interlineado' })} hint={t('common.rich.line_spacing_hint', { defaultValue: 'Ajusta la altura entre renglones' })} />}>
        <motion.button
          ref={anchorRef}
          type="button"
          aria-label={t('common.rich.line_spacing', { defaultValue: 'Interlineado' })}
          whileTap={{ scale: 0.9 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(btnCls, open && 'bg-glass/10 text-text')}
        >
          <AlignVerticalSpaceAround className="h-4 w-4" />
        </motion.button>
      </Tooltip>

      <PortalMenu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={208}>
        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
          {t('common.rich.line_spacing', { defaultValue: 'Interlineado' })}
        </div>
        {options.map((o) => {
          const active = o.id === value
          return (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => { onSelect(o.id); setOpen(false) }}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                active ? 'bg-primary/10 text-primary' : 'text-text hover:bg-glass/8',
              )}
            >
              <span className="flex h-6 w-6 shrink-0 flex-col justify-center" style={{ gap: o.gap }} aria-hidden>
                <span className="h-0.5 w-full rounded-full bg-current opacity-70" />
                <span className="h-0.5 w-full rounded-full bg-current opacity-70" />
                <span className="h-0.5 w-full rounded-full bg-current opacity-70" />
              </span>
              <span className="flex-1 text-[13px] font-medium">{o.label}</span>
              {active && <Check className="h-4 w-4" />}
            </button>
          )
        })}
      </PortalMenu>
    </>
  )
}

/* ── Popover en portal: se ancla al botón y jamás lo recorta una tarjeta ── */
function PortalMenu({
  anchorRef, open, onClose, width, children,
}: {
  anchorRef: RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  width: number
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect()
      if (!r) return
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8)
      setCoords({ left, top: r.bottom + 6 })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, anchorRef, onClose])

  return createPortal(
    <AnimatePresence>
      {open && coords && (
        <motion.div
          ref={panelRef}
          role="menu"
          initial={{ opacity: 0, y: -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          style={{ position: 'fixed', left: coords.left, top: coords.top, width, zIndex: 9998, transformOrigin: 'top left' }}
          className="rounded-xl border border-line bg-surface p-1.5 shadow-xl shadow-black/20"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/* ── Contenido de tooltip: título + pista + atajo ── */
function Tip({ title, hint, keys }: { title: string; hint?: string; keys?: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span>{title}</span>
        {keys && (
          <kbd className="rounded border border-[rgb(var(--bg))]/30 px-1 py-px text-[9.5px] font-semibold tracking-wide opacity-70">
            {keys}
          </kbd>
        )}
      </span>
      {hint && <span className="text-[10.5px] font-normal opacity-70">{hint}</span>}
    </span>
  )
}

function ToolBtn({ tip, label, onClick, className, pressed, children }: { tip: ReactNode; label: string; onClick: () => void; className: string; pressed?: boolean; children: ReactNode }) {
  return (
    <Tooltip label={tip}>
      <motion.button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        whileTap={{ scale: 0.9 }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={className}
      >
        {children}
      </motion.button>
    </Tooltip>
  )
}
