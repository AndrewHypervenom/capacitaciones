import { supabase } from '@/lib/supabase'

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

export interface GeneratedModuleSection {
  heading_es: string; heading_en: string; heading_pt: string
  body_es: string[]; body_en: string[]; body_pt: string[]
  section_style: string
  callout_kind: string | null
  callout_es: string | null; callout_en: string | null; callout_pt: string | null
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

export async function generateModule(opts: {
  description: string
  documentText?: string
}): Promise<{ data: GeneratedModule; usage: CacheUsage }> {
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
      body: JSON.stringify(opts),
    },
  )

  const result = await response.json()
  if (!response.ok || result.error) {
    throw new Error(result.error ?? 'Error generando módulo')
  }

  return { data: result.data as GeneratedModule, usage: result.usage as CacheUsage }
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
