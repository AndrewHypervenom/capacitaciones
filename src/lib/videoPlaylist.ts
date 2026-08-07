/**
 * Lee un módulo y devuelve su lista de videos.
 *
 * Un módulo puede traer videos por dos caminos que en la pantalla se ven igual
 * pero por dentro no se parecen: la sección de estilo `video-interactive` (el
 * video ES la sección) y el bloque `video` dentro de una sección normal (puede
 * haber varios, mezclados con texto). Aquí se aplanan los dos en una sola lista
 * ordenada, que es lo que necesita el modo cine para poner los videos al lado
 * del reproductor y encadenarlos.
 *
 * También decide si el módulo ENTERO es de video, que es cuando vale la pena
 * cambiar de vista. Ante la duda dice que no: la vista normal siempre sabe
 * pintar cualquier módulo, la de cine no.
 */

import type { ContentBlock, VideoBlock } from '@/types/blocks'
import type { LearningModule, ModuleSection, VideoMarker } from '@/data/modules'
import type { Language } from '@/stores/userStore'
import { mapVideoMarkersFromDb } from '@/services/modules.service'
import { extractYouTubeId } from '@/lib/youtube'
import { extractVimeoId } from '@/lib/vimeo'

export interface PlaylistItem {
  /** Identidad estable del video dentro del módulo (sirve de clave de React y de progreso). */
  key: string
  sectionId?: string
  sectionIndex: number
  /** Índice del bloque cuando el video vive dentro de una sección normal. */
  blockIndex?: number
  title: string
  /** Texto de apoyo de la sección: se muestra bajo el reproductor. */
  description: string[]
  /** Sección (real o armada) que recibe el reproductor. */
  section: ModuleSection
  markers: VideoMarker[]
  /** Cuántas verificaciones trae el video: se anuncia en la lista lateral. */
  quizCount: number
}

/**
 * Bloques que pueden acompañar a un video sin sacar al módulo del modo cine.
 * Son los que se pueden leer al lado del reproductor; cualquier otro (un juego,
 * un quiz suelto, un PDF) pide la vista normal, con su propio espacio.
 */
const COMPANION_BLOCKS = new Set(['paragraph', 'heading', 'list', 'callout', 'quote', 'divider'])

/**
 * Sección sintética para un video que vive dentro de un bloque.
 *
 * El `heading` NO es un título: es la clave de progreso del reproductor
 * (`vb:sección:bloque`). Va así para que dos videos de la misma sección no se
 * pisen la posición guardada. El título de verdad se pasa aparte.
 */
export function inlineVideoSection(block: VideoBlock, sectionId: string | undefined, blockIndex: number): ModuleSection {
  const isYT = block.kind === 'youtube'
  const isVM = block.kind === 'vimeo'
  // Defensivo: contenido antiguo pudo guardar la URL completa en vez del id.
  const url = isYT
    ? (extractYouTubeId(block.url) ?? block.url)
    : isVM
      ? (extractVimeoId(block.url) ?? block.url)
      : block.url

  return {
    id: sectionId,
    heading: { es: `vb:${sectionId ?? ''}:${blockIndex}`, en: '', pt: '' },
    body: { es: [], en: [], pt: [] },
    style: 'video-interactive',
    media: { type: isYT ? 'youtube' : isVM ? 'vimeo' : 'video', url },
    videoMarkers: mapVideoMarkersFromDb(block.markers),
  } as ModuleSection
}

export function buildVideoPlaylist(module: LearningModule, language: Language): PlaylistItem[] {
  const items: PlaylistItem[] = []
  const sections = (module.sections ?? []) as ModuleSection[]

  sections.forEach((s, i) => {
    const heading = s.heading?.[language] || s.heading?.es || ''
    const paragraphs = (s.body?.[language] ?? s.body?.es ?? []).filter(Boolean)

    if (s.style === 'video-interactive' && s.media?.url) {
      items.push({
        key: s.id ?? `s${i}`,
        sectionId: s.id,
        sectionIndex: i,
        title: heading,
        description: paragraphs,
        section: s,
        markers: s.videoMarkers ?? [],
        quizCount: (s.videoMarkers ?? []).filter((m) => m.type === 'quiz').length,
      })
      return
    }

    const blocks = (s.blocks ?? []) as ContentBlock[]
    // Los párrafos sueltos de la sección acompañan al primer video que aparezca.
    const text = blocks
      .filter((b): b is Extract<ContentBlock, { type: 'paragraph' }> => b.type === 'paragraph')
      .map((b) => b.text[language] || b.text.es)
      .filter(Boolean)

    blocks.forEach((b, bi) => {
      if (b.type !== 'video' || !b.url) return
      const markers = mapVideoMarkersFromDb(b.markers)
      const caption = b.caption?.[language] || b.caption?.es || ''
      items.push({
        key: `${s.id ?? `s${i}`}:b${bi}`,
        sectionId: s.id,
        sectionIndex: i,
        blockIndex: bi,
        // Con un solo video la sección le presta su título; con varios, cada uno
        // se distingue por su pie de video (y si no tiene, por su número).
        title: caption || heading || '',
        description: text,
        section: inlineVideoSection(b, s.id, bi),
        markers,
        quizCount: markers.filter((m) => m.type === 'quiz').length,
      })
    })
  })

  // Un título vacío deja la lista lateral coja: se numera como último recurso.
  return items.map((it, i) => ({ ...it, title: it.title || `Video ${i + 1}` }))
}

/**
 * ¿Este módulo es "solo videos"? Se exige que cada sección aporte al menos un
 * video y que no haya nada más que texto de apoyo. Con un solo video no se
 * cambia de vista: la lista lateral de un elemento no aporta nada.
 */
export function isVideoOnlyModule(module: LearningModule, language: Language): boolean {
  const sections = (module.sections ?? []) as ModuleSection[]
  if (sections.length === 0) return false

  for (const s of sections) {
    // Un quiz de sección necesita el ancho de la vista normal.
    if (s.quiz) return false

    if (s.style === 'video-interactive') {
      if (!s.media?.url) return false
      continue
    }

    const blocks = (s.blocks ?? []) as ContentBlock[]
    if (blocks.length === 0) return false
    let hasVideo = false
    for (const b of blocks) {
      if (b.type === 'video') { hasVideo = true; continue }
      if (!COMPANION_BLOCKS.has(b.type)) return false
    }
    if (!hasVideo) return false
    // Una imagen o un medio de sección al lado del reproductor sobra.
    if (s.media && s.media.type !== 'video') return false
  }

  return buildVideoPlaylist(module, language).length >= 2
}
