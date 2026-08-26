/**
 * Arrastrar y soltar archivos, igual en todo el sitio.
 *
 * Cada pantalla que pedía un documento traía su propio `onDragOver/onDragLeave`
 * escrito a mano, con dos defectos que se notaban al usarlo:
 *
 *  1. `onDragLeave` se dispara también al pasar por encima de un HIJO de la zona
 *     (el ícono, el texto), así que el resaltado parpadeaba mientras uno movía el
 *     archivo por dentro. Aquí se lleva un CONTADOR de entradas/salidas: solo se
 *     apaga cuando de verdad se salió del contenedor.
 *  2. Soltar un archivo que no era del tipo pedido no decía nada: el usuario veía
 *     que "no pasó nada". Ahora el propio `accept` decide, y lo rechazado se
 *     informa por `onReject` con el nombre del archivo.
 *
 * Además, soltar un archivo FUERA de la zona no debe abrirlo en la pestaña
 * (comportamiento por defecto del navegador, que se lleva la sesión por delante):
 * mientras el hook está montado, se anula ese arrastre a nivel de ventana.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  /** Lista tipo `accept` de <input type="file">: ".pdf,.docx" o "image/*". */
  accept?: string
  /** Se llama con los archivos aceptados. Uno solo salvo `multiple`. */
  onFiles: (files: File[]) => void
  /** Nombre del primer archivo descartado por no cumplir `accept`. */
  onReject?: (fileName: string) => void
  /** Por defecto se toma solo el primero. */
  multiple?: boolean
  disabled?: boolean
}

function matchesAccept(file: File, accept: string): boolean {
  const rules = accept.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean)
  if (!rules.length) return true
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule)
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1))
    return type === rule
  })
}

export function useFileDrop({ accept = '', onFiles, onReject, multiple = false, disabled = false }: Options) {
  const [dragging, setDragging] = useState(false)
  // Contador de entrar/salir: los hijos también emiten dragenter/dragleave.
  const depth = useRef(0)

  // Soltar por fuera de la zona no debe navegar a file:// y perder la pantalla.
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      // Solo arrastres de archivos; no estorbar al dnd-kit de las listas.
      if (!e.dataTransfer?.types?.includes('Files')) return
      e.preventDefault()
    }
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  const reset = useCallback(() => {
    depth.current = 0
    setDragging(false)
  }, [])

  const hasFiles = (e: React.DragEvent) => !!e.dataTransfer?.types?.includes('Files')

  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    depth.current += 1
    setDragging(true)
  }, [disabled])

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    // Cursor de "copiar" en vez del de "prohibido".
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    if (depth.current === 0) { depth.current = 1; setDragging(true) }
  }, [disabled])

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (disabled || !hasFiles(e)) return
    e.preventDefault()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }, [disabled])

  const onDrop = useCallback((e: React.DragEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    reset()
    const all = Array.from(e.dataTransfer?.files ?? [])
    if (!all.length) return
    const picked = multiple ? all : all.slice(0, 1)
    const ok = picked.filter((f) => matchesAccept(f, accept))
    if (!ok.length) {
      onReject?.(picked[0].name)
      return
    }
    onFiles(ok)
  }, [accept, disabled, multiple, onFiles, onReject, reset])

  return {
    /** `true` mientras hay un archivo encima de la zona. */
    dragging,
    /** Se esparce sobre el contenedor que actúa de zona de soltado. */
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
