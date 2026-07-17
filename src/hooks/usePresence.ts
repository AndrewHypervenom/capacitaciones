import { useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import {
  usePresenceStore,
  peersForResource,
  viewKeyForRoute,
  type PresenceActivity,
  type PresenceResourceType,
  type Peer,
} from '@/stores/presenceStore'

/**
 * Declara que estoy editando un recurso mientras el componente esté montado y
 * devuelve la lista de compañeros que lo tienen abierto EN UN EDITOR ahora mismo
 * (los que solo lo están viendo no cuentan como riesgo de pisarse).
 *
 * Uso en un editor:
 *   const coeditors = useEditingPresence({ type: 'module', id, title, detail })
 *
 * `detail` es la sub-ubicación exacta (sección abierta, pestaña…) y puede
 * cambiar en cada render sin reconectar nada.
 */
export function useEditingPresence(
  activity: PresenceActivity | null,
): Peer[] {
  return useResourcePresence(activity, 'edit')
}

/**
 * Igual que `useEditingPresence` pero para pantallas de consumo (el aprendiz
 * estudiando un módulo, una vista previa). Publica dónde está exactamente sin
 * disparar el aviso de coedición de los editores.
 */
export function useViewingPresence(activity: PresenceActivity | null): Peer[] {
  return useResourcePresence(activity, 'view')
}

function useResourcePresence(
  activity: PresenceActivity | null,
  mode: 'edit' | 'view',
): Peer[] {
  const setActivity = usePresenceStore((s) => s.setActivity)
  const patchActivity = usePresenceStore((s) => s.patchActivity)
  const peers = usePresenceStore((s) => s.peers)

  // Estabilizamos las dependencias primitivas para no re-emitir de más.
  const type = activity?.type
  const id = activity?.id
  const title = activity?.title
  const detail = activity?.detail
  const campaignId = activity?.campaignId

  // El título, el detalle y la campaña NO entran como dependencias: llegan tarde
  // (aparecen cuando termina de cargar el recurso) y cambian seguido (la sección
  // abierta). Si dispararan este efecto, cada cambio limpiaría la actividad y la
  // volvería a poner — una ráfaga de emisiones que tumba el canal de Realtime y
  // hace desaparecer a la persona de la lista. Aquí solo entra o sale del
  // recurso; lo demás se parcha abajo.
  const latest = useRef({ title, detail, campaignId })
  latest.current = { title, detail, campaignId }

  useEffect(() => {
    if (!type || !id) return
    setActivity({
      type,
      id,
      title: latest.current.title ?? '',
      detail: latest.current.detail,
      campaignId: latest.current.campaignId,
      mode,
    })
    return () => setActivity(null)
  }, [type, id, mode, setActivity])

  useEffect(() => {
    if (!type || !id) return
    patchActivity({ title: title ?? '', detail, campaignId })
  }, [type, id, title, detail, campaignId, patchActivity])

  return useMemo(
    () => (type && id ? peersForResource(peers, type, id, mode) : []),
    [peers, type, id, mode],
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

/**
 * Compañeros que están en LA MISMA vista que yo, sea cual sea (la lista de
 * módulos, personas, la bitácora…). Se comparan por vista y no por ruta exacta
 * para que "/admin/modules/A" y "/admin/modules/B" no cuenten como el mismo
 * sitio, pero "/admin/users" sí agrupe a todos los que están en Personas.
 */
export function usePeersInMyView(): Peer[] {
  const peers = usePresenceStore((s) => s.peers)
  const location = useLocation()
  const myView = viewKeyForRoute(location.pathname)
  return useMemo(
    () => peers.filter((p) => viewKeyForRoute(p.route ?? '') === myView),
    [peers, myView],
  )
}
