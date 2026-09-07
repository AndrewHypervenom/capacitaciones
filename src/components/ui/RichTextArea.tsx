import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bold, Italic, Heading, List, Eye, Pencil, Check,
  AlignVerticalSpaceAround, ArrowUpToLine, ArrowDownToLine, MoveVertical,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, WrapText, Maximize2,
  Link2, Link2Off,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import {
  RichText, parseAttrs, withAttrs, parseLineAlign, withLineAlign,
  type Spacing, type Align, type Width, type TextAttrs,
} from './RichText'
import { Tooltip } from './Tooltip'
import {
  applyLink, marksAtSelection, normalizeHref, removeLink, toggleInlineMark,
  type LinkMark, type MarkName, type Marks,
} from '@/lib/inlineMarkdown'

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
  const [linkOpen, setLinkOpen] = useState(false)
  // Alineación del renglón donde está el cursor (undefined = automático).
  const [lineAlign, setLineAlign] = useState<Align | undefined>(undefined)

  const { attrs, body } = parseAttrs(value)
  const emit = (nextBody: string, nextAttrs: TextAttrs = attrs) => onChange(withAttrs(nextAttrs, nextBody))

  const syncActive = (source?: string) => {
    const el = ref.current
    if (!el) return
    const src = source ?? body
    setActive(marksAtSelection(src, el.selectionStart, el.selectionEnd))
    // Y la alineación del renglón donde está el cursor: el menú tiene que
    // enseñar la del renglón que se va a mover, no la del campo.
    const start = src.lastIndexOf('\n', el.selectionStart - 1) + 1
    let end = src.indexOf('\n', el.selectionStart)
    if (end === -1) end = src.length
    setLineAlign(parseLineAlign(src.slice(start, end)).align)
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

  /**
   * Pone o cambia el enlace de lo seleccionado. La selección se toma de `sel`
   * (la que había al abrir el diálogo) porque para entonces el foco ya vive en
   * los campos del popover y el textarea la habría perdido.
   */
  const setLink = (link: LinkMark, sel: { start: number; end: number }) => {
    const next = applyLink(
      body, sel.start, sel.end, link,
      t('common.rich.sample_link', { defaultValue: 'enlace' }),
    )
    emit(next.value)
    restoreCursor(next.start, next.end, next.value)
  }

  const clearLink = (sel: { start: number; end: number }) => {
    const next = removeLink(body, sel.start, sel.end)
    emit(next.value)
    restoreCursor(next.start, next.end, next.value)
  }

  /**
   * Alinea los renglones que toca la selección (o el del cursor si no hay
   * selección). Es lo que permite tener el título centrado y la lista de abajo
   * a la izquierda dentro del mismo campo — y, al ir pegada a su párrafo, es la
   * única alineación que sobrevive en los campos que se guardan partidos.
   *
   * Con varios renglones seleccionados se alinean todos de una: una lista de
   * seis puntos no se arregla entrando seis veces al menú.
   */
  const alignLine = (a: Align | undefined) => {
    const el = ref.current
    if (!el) return
    const from = body.lastIndexOf('\n', el.selectionStart - 1) + 1
    let to = body.indexOf('\n', Math.max(el.selectionEnd, el.selectionStart))
    if (to === -1) to = body.length

    const next = body
      .slice(from, to)
      .split('\n')
      // Los renglones en blanco no se tocan: separan párrafos y un marcador
      // suelto ahí no alinea nada.
      .map((line) => (line.trim() ? withLineAlign(line, a) : line))
      .join('\n')

    emit(body.slice(0, from) + next + body.slice(to))
    // Se deja seleccionado el mismo texto, ya alineado.
    restoreCursor(from, from + next.length)
  }

  /**
   * Antepone un prefijo (# , - ) al inicio de la línea actual, DESPUÉS del
   * marcador de alineación si lo hay: `{{al:left}}- Punto`. Al revés el
   * marcador quedaría dentro del texto de la viñeta y se vería literal.
   */
  const prefixLine = (prefix: string) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const lineStart = body.lastIndexOf('\n', start - 1) + 1
    const marker = body.slice(lineStart).match(/^\{\{al:(?:left|center|right|justify)\}\}/)?.[0] ?? ''
    const at = lineStart + marker.length
    const already = body.slice(at).startsWith(prefix)
    if (!already) emit(body.slice(0, at) + prefix + body.slice(at))
    const delta = already ? 0 : prefix.length
    restoreCursor(Math.max(at, start + delta), Math.max(at, start + delta))
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
    else if (k === 'k') { e.preventDefault(); setLinkOpen(true) }
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
        <LinkMenu
          open={linkOpen}
          setOpen={setLinkOpen}
          current={active.link}
          selectionRef={ref}
          onApply={setLink}
          onRemove={clearLink}
          btnCls={btnCls}
          activeCls={activeCls}
        />
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
          <SpacingMenu value={attrs.spacing} onSelect={(s) => emit(body, { ...attrs, spacing: s })} btnCls={btnCls} />
        )}
        {/* La alineación NO depende de `showSpacing`: es por renglón, así que
            viaja pegada a su párrafo y sobrevive a los campos que se guardan
            partidos (el cuerpo de sección). Ahí es justo donde hacía falta. */}
        <AlignMenu
          align={lineAlign}
          fieldAlign={attrs.align}
          width={attrs.width}
          showWidth={showWidth && showSpacing}
          onAlign={alignLine}
          onWidth={(w) => emit(body, { ...attrs, width: w })}
          btnCls={btnCls}
        />

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

/* ── Menú: enlace con pista ──────────────────────────────────────────────
 * Dos campos y ya: a dónde va y qué decir al pasar el mouse. La pista es
 * opcional a propósito — obligarla haría que nadie pusiera enlaces.
 *
 * La selección del textarea se congela al abrir: en cuanto se escribe en el
 * primer campo el foco ya no está en el texto, y aplicar el enlace "donde esté
 * el cursor" lo pondría en el sitio equivocado. */
function LinkMenu({
  open, setOpen, current, selectionRef, onApply, onRemove, btnCls, activeCls,
}: {
  open: boolean
  setOpen: (v: boolean) => void
  current?: LinkMark
  selectionRef: RefObject<HTMLTextAreaElement | null>
  onApply: (link: LinkMark, sel: { start: number; end: number }) => void
  onRemove: (sel: { start: number; end: number }) => void
  btnCls: string
  activeCls: string
}) {
  const { t } = useTranslation()
  const anchorRef = useRef<HTMLButtonElement>(null)
  const hrefRef = useRef<HTMLInputElement>(null)
  const sel = useRef({ start: 0, end: 0 })
  const [href, setHref] = useState('')
  const [title, setTitle] = useState('')
  // El enlace que había al abrir: `current` se apaga en cuanto el textarea
  // pierde el foco, y el diálogo tiene que seguir sabiendo si edita o crea.
  const [editing, setEditing] = useState(false)

  // La preparación vive en el efecto y no en el `onClick` para que Ctrl K y el
  // botón hagan exactamente lo mismo. `current` se lee aquí, cuando el textarea
  // todavía tiene el foco y sabe qué hay bajo el cursor.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      const el = selectionRef.current
      sel.current = { start: el?.selectionStart ?? 0, end: el?.selectionEnd ?? 0 }
      setHref(current?.href ?? '')
      setTitle(current?.title ?? '')
      setEditing(!!current)
      requestAnimationFrame(() => hrefRef.current?.select())
    }
    wasOpen.current = open
    // `current` a propósito fuera de las dependencias: solo importa su valor en
    // el instante en que el diálogo se abre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectionRef])

  const submit = () => {
    const clean = normalizeHref(href)
    if (!clean) return
    onApply({ href: clean, title: title.trim() || undefined }, sel.current)
    setOpen(false)
  }

  const label = t('common.rich.link', { defaultValue: 'Enlace' })

  return (
    <>
      <Tooltip label={<Tip title={label} hint={t('common.rich.link_hint', { defaultValue: 'Lleva a otra página, con una pista al pasar el mouse' })} keys="Ctrl K" />}>
        <motion.button
          ref={anchorRef}
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          whileTap={{ scale: 0.9 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(!open)}
          className={cn(btnCls, (current || open) && activeCls)}
        >
          <Link2 className="h-4 w-4" />
        </motion.button>
      </Tooltip>

      <PortalMenu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={288}>
        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
          {label}
        </div>
        <div className="space-y-2 px-2 pb-1 pt-0.5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-text-muted">
              {t('common.rich.link_url', { defaultValue: 'A dónde lleva' })}
            </span>
            <input
              ref={hrefRef}
              value={href}
              onChange={(e) => setHref(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit() }
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
              }}
              placeholder={t('common.rich.link_url_ph', { defaultValue: 'positivosmais.com  ·  /courses  ·  correo@…' })}
              className="w-full rounded-lg border border-line bg-subtle px-2.5 py-1.5 text-[12.5px] text-text outline-none placeholder:text-text-subtle focus:border-primary/50"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-text-muted">
              {t('common.rich.link_tip', { defaultValue: 'Pista al pasar el mouse' })}
              <span className="ml-1 font-normal text-text-subtle">
                {t('common.rich.optional', { defaultValue: '(opcional)' })}
              </span>
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit() }
                if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
              }}
              placeholder={t('common.rich.link_tip_ph', { defaultValue: 'Qué va a encontrar ahí' })}
              className="w-full rounded-lg border border-line bg-subtle px-2.5 py-1.5 text-[12.5px] text-text outline-none placeholder:text-text-subtle focus:border-primary/50"
            />
          </label>
        </div>
        <div className="flex items-center gap-1.5 px-2 pb-1 pt-1">
          <button
            type="button"
            onClick={submit}
            disabled={!href.trim()}
            className="flex-1 rounded-lg bg-primary/12 px-2.5 py-1.5 text-[12.5px] font-semibold text-primary transition-colors hover:bg-primary/18 disabled:opacity-40 disabled:hover:bg-primary/12"
          >
            {editing
              ? t('common.rich.link_update', { defaultValue: 'Actualizar' })
              : t('common.rich.link_apply', { defaultValue: 'Enlazar' })}
          </button>
          {editing && (
            <Tooltip label={t('common.rich.link_remove', { defaultValue: 'Quitar enlace' })}>
              <button
                type="button"
                aria-label={t('common.rich.link_remove', { defaultValue: 'Quitar enlace' })}
                onClick={() => { onRemove(sel.current); setOpen(false) }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-glass/10 hover:text-text"
              >
                <Link2Off className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>
      </PortalMenu>
    </>
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
  align, fieldAlign, width, showWidth, onAlign, onWidth, btnCls,
}: {
  /** Alineación del RENGLÓN donde está el cursor. */
  align?: Align
  /** La del campo entero, si el contenido viejo la trae: es lo que se hereda. */
  fieldAlign?: Align
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

  const CurrentIcon = options.find((o) => o.id === (align ?? fieldAlign))?.icon ?? WrapText

  return (
    <>
      <Tooltip label={<Tip title={t('common.rich.align', { defaultValue: 'Alineación' })} hint={t('common.rich.align_line_hint', { defaultValue: 'Alinea el renglón donde está el cursor' })} />}>
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
          {t('common.rich.align_this_line', { defaultValue: 'Alinear este renglón' })}
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
                'flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                active ? 'bg-primary/10 text-primary' : 'text-text hover:bg-glass/8',
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                <o.icon className="h-4 w-4" />
              </span>
              <span className="flex-1">
                <span className="block text-[13px] font-medium">{o.label}</span>
                {o.id === undefined && (
                  <span className="block text-[10.5px] text-text-subtle">
                    {fieldAlign
                      ? t('common.rich.align_auto_field', { defaultValue: 'Como el resto del campo' })
                      : t('common.rich.align_auto_hint', { defaultValue: 'Como lo ponga la sección' })}
                  </span>
                )}
              </span>
              {active && <Check className="mt-0.5 h-4 w-4" />}
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
