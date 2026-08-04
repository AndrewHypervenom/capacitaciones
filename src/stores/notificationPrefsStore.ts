import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ─── Preferencias de aviso (por navegador, no por cuenta) ────────────────────
// Viven en localStorage a propósito: "silencia el sonido en la oficina abierta"
// es una decisión del EQUIPO donde estás, no de tu cuenta. Quien entra desde
// casa vuelve a tener sonido sin tener que acordarse de encenderlo.

export type NotificationVolume = 'soft' | 'normal' | 'loud'

/** Multiplicador de ganancia por nivel (ver notificationSound.ts). */
export const VOLUME_GAIN: Record<NotificationVolume, number> = {
  soft: 0.5,
  normal: 1,
  loud: 1.7,
}

interface NotificationPrefsState {
  /** Sonido al llegar cualquier aviso. */
  sound: boolean
  volume: NotificationVolume
  /** Aviso emergente cuando alguien escribe al chat de ayuda (solo superadmin). */
  helpAlerts: boolean
  /** Silencio temporal: epoch ms hasta el que no suena nada ("Silenciar 30 min"). */
  mutedUntil: number | null

  setSound: (on: boolean) => void
  setVolume: (v: NotificationVolume) => void
  setHelpAlerts: (on: boolean) => void
  /** Silencia por N minutos; 0 lo cancela. */
  muteFor: (minutes: number) => void
}

export const useNotificationPrefs = create<NotificationPrefsState>()(
  persist(
    (set) => ({
      sound: true,
      volume: 'normal',
      helpAlerts: true,
      mutedUntil: null,

      setSound: (on) => set({ sound: on }),
      setVolume: (volume) => set({ volume }),
      setHelpAlerts: (on) => set({ helpAlerts: on }),
      muteFor: (minutes) =>
        set({ mutedUntil: minutes > 0 ? Date.now() + minutes * 60_000 : null }),
    }),
    { name: 'learningai.notifPrefs' },
  ),
)

/** ¿Debe sonar ahora mismo? Junta el interruptor y el silencio temporal. */
export function soundEnabledNow(): boolean {
  const { sound, mutedUntil } = useNotificationPrefs.getState()
  if (!sound) return false
  return !mutedUntil || Date.now() >= mutedUntil
}

/** Minutos que quedan de silencio temporal (0 si no está silenciado). */
export function mutedMinutesLeft(mutedUntil: number | null): number {
  if (!mutedUntil) return 0
  return Math.max(0, Math.ceil((mutedUntil - Date.now()) / 60_000))
}
