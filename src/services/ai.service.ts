import { supabase } from '@/lib/supabase'
import type { ContentBlock } from '@/types/blocks'

export interface CacheUsage {
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  input_tokens: number
  output_tokens: number
}

export interface GeneratedDialogueMeta {
  title_es: string; title_en: string; title_pt: string
  summary_es: string; summary_en: string; summary_pt: string
  country: 'CO' | 'MX' | 'AR'
  difficulty: 1 | 2 | 3
  customer_name: string; customer_phone: string
  customer_reason_es: string; customer_reason_en: string; customer_reason_pt: string
  avatar_seed: number; max_turns: number
  empathy_keywords: string[]
  checklist_items: unknown[]
}

export interface GeneratedChoiceMeta {
  title_es: string; title_en: string; title_pt: string
  description: string; client_name: string; client_company: string
  objective: string; level: 'basico' | 'medio' | 'avanzado'
}

export interface GeneratedDialogue {
  metadata: GeneratedDialogueMeta
  start_node_id: string
  nodes: Record<string, unknown>
}

export interface GeneratedChoice {
  metadata: GeneratedChoiceMeta
  start_node_id: string
  nodes: Record<string, unknown>
}

export type GeneratedScenario = GeneratedDialogue | GeneratedChoice

export interface GeneratedModuleMeta {
  slug: string
  title_es: string; title_en: string; title_pt: string
  subtitle_es: string; subtitle_en: string; subtitle_pt: string
  icon: string
  duration_min: number
  objectives_es: string[]; objectives_en: string[]; objectives_pt: string[]
  key_takeaways_es: string[]; key_takeaways_en: string[]; key_takeaways_pt: string[]
}

/**
 * Bloque tal como lo emite la IA: idéntico a `ContentBlock` del sitio, salvo que las
 * imágenes referencian `image_index` (la URL real se resuelve al guardar el módulo).
 */
export type GeneratedBlock =
  | Exclude<ContentBlock, { type: 'image' }>
  | { type: 'image'; image_index: number; caption?: { es: string; en: string; pt: string } }

export interface GeneratedModuleSection {
  heading_es: string; heading_en: string; heading_pt: string
  /** Estilo visual de la sección (default/immersive/spotlight/feature). */
  section_style?: GeneratedSectionStyle
  /** Contenido dinámico de la sección (párrafos, listas, quiz, flashcards, etc.). */
  blocks: GeneratedBlock[]
}

export interface GeneratedModule {
  metadata: GeneratedModuleMeta
  sections: GeneratedModuleSection[]
}

export async function generateSimulation(opts: {
  type: 'dialogue' | 'choice'
  description: string
  moduleContext?: string
}): Promise<{ data: GeneratedScenario; usage: CacheUsage }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-simulation`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(opts),
    },
  )

  const result = await response.json()
  if (!response.ok || result.error) {
    throw new Error(result.error ?? 'Error generando simulación')
  }

  return { data: result.data as GeneratedScenario, usage: result.usage as CacheUsage }
}

export interface DocImage {
  mediaType: string
  dataBase64: string
}

/** Contexto del documento compartido por las llamadas de generación (se cachea en el servidor). */
export interface DocContext {
  documentText?: string
  images?: DocImage[]
  contextImages?: DocImage[]
}

export type GeneratedSectionStyle = 'default' | 'immersive' | 'spotlight' | 'feature'

/** Esquema de un módulo: metadata + títulos de sección, sin el contenido de los bloques. */
export interface ModuleOutline {
  metadata: GeneratedModuleMeta
  sections: {
    heading_es: string; heading_en: string; heading_pt: string
    section_style?: GeneratedSectionStyle
  }[]
}

async function postGenerateModule(
  body: Record<string, unknown>,
): Promise<{ data: unknown; usage: CacheUsage }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-module`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    },
  )

  const result = await response.json()
  if (!response.ok || result.error) {
    throw new Error(result.error ?? 'Error generando módulo')
  }
  return { data: result.data, usage: result.usage as CacheUsage }
}

export async function generateModule(opts: {
  description: string
} & DocContext): Promise<{ data: GeneratedModule; usage: CacheUsage }> {
  const { data, usage } = await postGenerateModule({ ...opts })
  return { data: data as GeneratedModule, usage }
}

/** Paso 1 (a prueba de límites): genera solo el esquema del módulo. */
export async function generateModuleOutline(opts: {
  description: string
} & DocContext): Promise<{ data: ModuleOutline; usage: CacheUsage }> {
  const { data, usage } = await postGenerateModule({ mode: 'outline', ...opts })
  return { data: data as ModuleOutline, usage }
}

/** Paso 2 (a prueba de límites): genera los bloques de UNA sección. */
export async function generateModuleSection(opts: {
  description: string
  moduleTitle: string
  moduleSubtitle?: string
  objectives?: string[]
  sectionHeading: string
  sectionIndex: number
  totalSections: number
  allHeadings: string[]
} & DocContext): Promise<{ data: { blocks: GeneratedBlock[] }; usage: CacheUsage }> {
  const { data, usage } = await postGenerateModule({ mode: 'section', ...opts })
  const blocks = (data as { blocks?: GeneratedBlock[] })?.blocks ?? []
  return { data: { blocks }, usage }
}

export interface ProposedModule {
  title_es: string
  focus_es: string
  topics: string[]
}

export async function analyzeDocument(opts: {
  documentText: string
  instructions?: string
  campaignName?: string
  images?: DocImage[]
  contextImages?: DocImage[]
}): Promise<{ data: { modules: ProposedModule[] }; usage: CacheUsage }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-document`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(opts),
    },
  )

  const result = await response.json()
  if (!response.ok || result.error) {
    throw new Error(result.error ?? 'Error analizando el documento')
  }

  return {
    data: { modules: (result.data?.modules ?? []) as ProposedModule[] },
    usage: result.usage as CacheUsage,
  }
}

export interface AssistRequest {
  action: 'translate' | 'improve'
  contentType: 'section' | 'meta'
  sourceLang: string
  targetLangs?: string[]
  fields: Record<string, string>
  moduleTitle?: string
}

export async function moduleAiAssist(opts: AssistRequest): Promise<{ data: Record<string, unknown>; usage: CacheUsage }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/module-ai-assist`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(opts),
    },
  )

  const result = await response.json()
  if (!response.ok || result.error) {
    throw new Error(result.error ?? 'Error procesando contenido')
  }

  return { data: result.data, usage: result.usage as CacheUsage }
}

/** Obtiene las secciones del módulo y construye el contexto de texto para el prompt de IA. */
export async function getModuleContextText(moduleId: string): Promise<string> {
  const { data, error } = await supabase
    .from('module_sections')
    .select('heading_es, body_es')
    .eq('module_id', moduleId)
    .order('sort_order')

  if (error) throw error

  return (data ?? [])
    .map((s) => {
      const lines = [`## ${s.heading_es}`]
      if (Array.isArray(s.body_es)) lines.push(...(s.body_es as string[]))
      return lines.join('\n')
    })
    .join('\n\n')
}
