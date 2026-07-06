import { supabase } from '@/lib/supabase'

export interface HelpChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Envía la conversación al Edge Function `help-chat` y devuelve la respuesta del
 * asistente. El servidor arma el contexto (rol, progreso, catálogo de módulos) a
 * partir del usuario autenticado, así que aquí solo mandamos los mensajes.
 */
export async function sendHelpMessage(opts: {
  messages: HelpChatMessage[]
  page?: string
  lang?: 'es' | 'en' | 'pt'
}): Promise<{ reply: string }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('No autenticado')

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/help-chat`,
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

  // El servidor devuelve 429 cuando el usuario agotó su cuota diaria de IA.
  if (response.status === 429) {
    throw new Error('AI_DAILY_LIMIT')
  }

  const result = await response.json()
  if (!response.ok || result.error) {
    throw new Error(result.error ?? 'Error en el asistente')
  }

  return { reply: result.reply as string }
}
