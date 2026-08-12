import { useTranslation } from 'react-i18next'
import { Wifi, WifiLow, WifiZero, WifiOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Tooltip } from '@/components/ui/Tooltip'
import type { ConnectionQuality, ConnLevel } from '@/hooks/useConnectionQuality'

/**
 * Semáforo de conexión del reproductor.
 *
 * Responde la pregunta que todo el mundo se hace cuando un video se traba:
 * "¿es mi internet o es la página?". Verde = la descarga va bien, así que si
 * algo falla no es la red. Ámbar = va justo. Rojo = se está quedando sin datos.
 * El globo explica con números por qué lo decimos.
 *
 * El color nunca va solo: cada nivel trae además su propio ícono (antena llena,
 * media, vacía o tachada). Sobre un video oscuro, y para quien no distingue
 * verde de rojo, un simple cambio de tinte no dice nada.
 */

const ICON: Record<ConnLevel, typeof Wifi> = {
  good: Wifi,
  fair: WifiLow,
  poor: WifiZero,
  offline: WifiOff,
}

/** Tinte del ícono. El halo (`drop-shadow`) lo despega del video de fondo:
 *  un verde plano sobre una escena clara se pierde. */
const TONE: Record<ConnLevel, string> = {
  good: 'text-neon-green hover:text-neon-green/80 drop-shadow-[0_0_5px_rgba(16,212,81,0.55)]',
  fair: 'text-amber-400 hover:text-amber-300 drop-shadow-[0_0_5px_rgba(251,191,36,0.55)]',
  poor: 'text-red-500 hover:text-red-400 drop-shadow-[0_0_5px_rgba(239,68,68,0.6)]',
  offline: 'text-red-500 hover:text-red-400 drop-shadow-[0_0_5px_rgba(239,68,68,0.6)]',
}

/** Punto de color que encabeza el globo, para que el veredicto se lea también ahí. */
const DOT: Record<ConnLevel, string> = {
  good: 'bg-neon-green',
  fair: 'bg-amber-400',
  poor: 'bg-red-500',
  offline: 'bg-red-500',
}

export function ConnectionBadge({
  quality,
  className,
  size = 'sm',
}: {
  quality: ConnectionQuality
  className?: string
  /** `md` para el reproductor a pantalla completa, donde todo crece. */
  size?: 'sm' | 'md'
}) {
  const { t } = useTranslation()
  const { level, bufferAhead, stalls, downlink, effectiveType, measured } = quality

  // Sin datos del reproductor y sin Network Information API (Safari, Firefox)
  // no tenemos nada que afirmar. Antes que pintar un "todo bien" que no hemos
  // medido, no pintamos nada — salvo que el navegador diga que no hay red.
  if (!measured && downlink === null && effectiveType === null && level !== 'offline') return null

  const Icon = ICON[level]

  const detail: string[] = []
  if (measured && bufferAhead !== null) {
    detail.push(t('video.conn.buffer', { s: Math.round(bufferAhead) }))
    detail.push(t('video.conn.stalls', { n: stalls }))
  }
  if (downlink !== null) detail.push(t('video.conn.speed', { mbps: downlink }))
  if (effectiveType) detail.push(t('video.conn.network', { type: effectiveType.toUpperCase() }))
  if (!measured) detail.push(t('video.conn.embed_note'))

  const label = (
    <div className="space-y-1.5">
      <p className="flex items-center gap-2 text-[12.5px] font-semibold">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[level])} />
        {t(`video.conn.${level}_title`)}
      </p>
      <p className="text-[11.5px] opacity-80 leading-snug">{t(`video.conn.${level}_hint`)}</p>
      {detail.length > 0 && (
        <ul className="pt-1 space-y-0.5 text-[11px] opacity-65 border-t border-current/15">
          {detail.map((d) => <li key={d}>{d}</li>)}
        </ul>
      )}
    </div>
  )

  return (
    <Tooltip label={label} anchor="element" variant="panel" maxWidth={260} className="shrink-0">
      <span
        role="status"
        // En táctil no hay "pasar por encima": el Tooltip abre con pulsación
        // larga, y `tabIndex` deja llegar también por teclado.
        tabIndex={0}
        aria-label={`${t('video.conn.aria')}: ${t(`video.conn.${level}_title`)}`}
        className={cn(
          'inline-flex items-center justify-center transition-colors cursor-help',
          TONE[level],
          className,
        )}
      >
        <Icon
          className={cn(
            size === 'md' ? 'h-5 w-5' : 'h-4 w-4',
            // Solo el estado malo late: es el único que pide que lo mires.
            level === 'poor' || level === 'offline' ? 'animate-pulse' : '',
          )}
        />
      </span>
    </Tooltip>
  )
}
