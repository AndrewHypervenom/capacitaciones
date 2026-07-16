import { useEffect, useMemo } from 'react'
import {
  usePresenceStore,
  peersForResource,
  type PresenceActivity,
  type PresenceResourceType,
  type Peer,
} from '@/stores/presenceStore'

/**
 * Declara que estoy editando un recurso mientras el componente esté montado y
 * devuelve la lista de compañeros que están en ESE mismo recurso ahora mismo.
 *
 * Uso en un editor:
 *   const coeditors = useEditingPresence({ type: 'module', id, title })
 */
export function useEditingPresence(
  activity: PresenceActivity | null,
): Peer[] {
  const setActivity = usePresenceStore((s) => s.setActivity)
  const peers = usePresenceStore((s) => s.peers)

  // Estabilizamos las dependencias primitivas para no re-emitir de más.
  const type = activity?.type
  const id = activity?.id
  const title = activity?.title

  useEffect(() => {
    if (!type || !id) return
    setActivity({ type, id, title: title ?? '' })
    return () => setActivity(null)
  }, [type, id, title, setActivity])

  return useMemo(
    () => (type && id ? peersForResource(peers, type, id) : []),
    [peers, type, id],
  )
}

/** Solo lectura: quién está en un recurso (para pintar avatares en listas). */
export function usePeersForResource(
  type: PresenceResourceType,
  id: string,
): Peer[] {
  const peers = usePresenceStore((s) => s.peers)
  return useMemo(() => peersForResource(peers, type, id), [peers, type, id])
}

/** Todos los compañeros presentes en el espacio de trabajo (excluye al propio). */
export function useWorkspacePeers(): Peer[] {
  return usePresenceStore((s) => s.peers)
}
