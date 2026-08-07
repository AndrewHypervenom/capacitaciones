import { useEffect, useRef } from 'react'
import { installUnsavedWorkGuard, setUnsavedWork } from '@/lib/unsavedWork'

let nextId = 0

/**
 * Variante de `useUnsavedWork` para pantallas que YA saben si están sucias.
 *
 * ModuleEditor, por ejemplo, lleva su propio `isDirty` (se lo reportan los
 * formularios de cada sección) y lo usa para la presencia colaborativa. Volver a
 * deducirlo por huella de contenido sería trabajo duplicado y una segunda verdad
 * que puede discrepar de la primera.
 *
 * Solo publica ese estado en el registro global (lib/unsavedWork.ts), que es lo
 * que consultan el aviso de nueva versión y el de cerrar la pestaña.
 */
export function useUnsavedFlag(dirty: boolean, label: string): void {
  // Identidad estable de este editor dentro del registro global.
  const idRef = useRef<string | null>(null)
  if (idRef.current == null) idRef.current = `uf${nextId++}`

  const labelRef = useRef(label)
  useEffect(() => {
    labelRef.current = label
  })

  useEffect(() => {
    installUnsavedWorkGuard()
    const id = idRef.current!
    setUnsavedWork(id, dirty ? labelRef.current || '—' : null)
    // Al desmontar se limpia siempre: salir de la pantalla no puede dejar un
    // "sin guardar" fantasma que haga salir el aviso para siempre.
    return () => setUnsavedWork(id, null)
  }, [dirty, label])
}
