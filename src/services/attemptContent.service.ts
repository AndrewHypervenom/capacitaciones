import { supabase } from '@/lib/supabase'
import type { ContentBlock } from '@/types/blocks'

/**
 * Contenido original de la sección donde se hizo una entrega. Sirve para
 * reconstruir en el panel del capacitador QUÉ se preguntó, incluso en entregas
 * antiguas que solo guardaron contadores: el enunciado, los casos y el orden
 * correcto siguen viviendo en el módulo.
 *
 * Si el módulo se editó o el bloque se borró, simplemente no habrá nada que
 * reconstruir — quien llama debe seguir soportando ese caso.
 */
export interface SectionContent {
  blocks: ContentBlock[] | null
  /** Marcadores del video interactivo (incluye los quizzes por marcador). */
  markers: unknown
}

const cache = new Map<string, SectionContent | null>()

export async function getSectionContent(sectionId: string): Promise<SectionContent | null> {
  if (!sectionId) return null
  if (cache.has(sectionId)) return cache.get(sectionId) ?? null

  const { data, error } = await supabase
    .from('module_sections')
    .select('blocks_data, video_markers')
    .eq('id', sectionId)
    .maybeSingle()

  if (error || !data) {
    // Una sección borrada no es un fallo del panel: se cachea el vacío para no
    // volver a preguntar por ella en cada clic.
    cache.set(sectionId, null)
    return null
  }

  const content: SectionContent = {
    blocks: Array.isArray(data.blocks_data) ? (data.blocks_data as unknown as ContentBlock[]) : null,
    markers: data.video_markers ?? null,
  }
  cache.set(sectionId, content)
  return content
}
