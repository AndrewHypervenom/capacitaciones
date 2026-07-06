import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { todayKey } from '@/components/help/config'

export interface HelpMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** true mientras el asistente "escribe" (aún sin contenido). */
  pending?: boolean
  error?: boolean
  /** La respuesta vino de la base de conocimiento local (sin IA). */
  faq?: boolean
  /** No hubo coincidencia local: mensaje de "reformula / mira estos temas". */
  noMatch?: boolean
  /** Aviso del sistema (p. ej. límite diario alcanzado): sin badge ni escalar. */
  notice?: boolean
  /** Pregunta original del usuario (para poder escalar a la IA una respuesta local). */
  question?: string
  /** Ya se escaló esta respuesta local a la IA (oculta el botón de escalar). */
  escalated?: boolean
}

interface HelpChatState {
  isOpen: boolean
  messages: HelpMessage[]
  loading: boolean
  /** id incremental simple (evita depender de Date.now/uuid en render). */
  seq: number
  /** Contador diario de consultas a la IA (para el tope por navegador). */
  aiUsage: { day: string; count: number }
  open: () => void
  close: () => void
  toggle: () => void
  nextId: () => string
  addMessage: (m: HelpMessage) => void
  updateMessage: (id: string, patch: Partial<HelpMessage>) => void
  setLoading: (v: boolean) => void
  clear: () => void
  /** Consultas a la IA usadas hoy (0 si cambió el día). */
  aiUsedToday: () => number
  /** Registra una consulta a la IA usada. */
  recordAiUse: () => void
  /** Marca la cuota como agotada (al recibir 429 del servidor). */
  markAiExhausted: () => void
}

export const useHelpChatStore = create<HelpChatState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      messages: [],
      loading: false,
      seq: 0,
      aiUsage: { day: '', count: 0 },
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      nextId: () => {
        const id = `m${get().seq + 1}`
        set((s) => ({ seq: s.seq + 1 }))
        return id
      },
      addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
      updateMessage: (id, patch) =>
        set((s) => ({
          messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        })),
      setLoading: (v) => set({ loading: v }),
      clear: () => set({ messages: [] }),
      aiUsedToday: () => {
        const { aiUsage } = get()
        return aiUsage.day === todayKey() ? aiUsage.count : 0
      },
      recordAiUse: () =>
        set((s) => {
          const day = todayKey()
          const base = s.aiUsage.day === day ? s.aiUsage.count : 0
          return { aiUsage: { day, count: base + 1 } }
        }),
      // Fuerza la cuota agotada (al recibir 429). 9999 supera cualquier tope.
      markAiExhausted: () => set({ aiUsage: { day: todayKey(), count: 9999 } }),
    }),
    {
      name: 'learningai.help',
      // Persistimos el historial (acotado), la secuencia y la cuota de IA del día.
      partialize: (s) => ({ messages: s.messages.slice(-30), seq: s.seq, aiUsage: s.aiUsage }),
    },
  ),
)
