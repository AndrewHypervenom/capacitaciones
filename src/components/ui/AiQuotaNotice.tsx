import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'
import { getAiQuota, type AiQuota } from '@/services/aiQuota.service'

/**
 * "Te quedan 7 de 10 operaciones hoy."
 *
 * Va junto a cualquier botón que dispare IA, para que el capacitador vea el cupo
 * ANTES de arrancar y no se estrelle a mitad de camino. No aparece para quien no
 * tiene tope (superadmin o excepción "sin límite") ni para aprendices.
 *
 * Se refresca al montar y cada vez que termina una operación (evento global).
 */
export const AI_QUOTA_CHANGED_EVENT = 'ai_quota_changed'

export function AiQuotaNotice({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { isAdminOrCapacitador } = useAuth()
  const [quota, setQuota] = useState<AiQuota | null>(null)

  useEffect(() => {
    if (!isAdminOrCapacitador) return
    let alive = true
    const load = () => { getAiQuota().then((q) => alive && setQuota(q)).catch(() => {}) }
    load()
    window.addEventListener(AI_QUOTA_CHANGED_EVENT, load)
    return () => { alive = false; window.removeEventListener(AI_QUOTA_CHANGED_EVENT, load) }
  }, [isAdminOrCapacitador])

  if (!isAdminOrCapacitador || !quota || quota.unlimited) return null

  const left = quota.remaining ?? 0
  const limit = quota.limit ?? 0
  const pct = limit > 0 ? Math.max(0, Math.min(100, (left / limit) * 100)) : 0
  const low = left <= 2

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5',
        left === 0
          ? 'border-amber-500/30 bg-amber-500/[0.08]'
          : 'border-line bg-glass/4',
        className,
      )}
    >
      <Gauge className={cn('h-4 w-4 shrink-0', low ? 'text-amber-500' : 'text-text-subtle')} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-[11.5px] font-medium', low ? 'text-amber-500' : 'text-text-muted')}>
          {left === 0 ? t('admin.ai_limits.none_left') : t('admin.ai_limits.left', { left, limit })}
        </p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-glass/10">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', low ? 'bg-amber-500' : 'bg-brand-green')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}
