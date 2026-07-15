import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, UserPlus, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlassCard } from '@/components/ui/GlassCard'
import { useAuth } from '@/hooks/useAuth'
import { toast } from '@/stores/toastStore'
import { cn } from '@/lib/cn'
import type { CollaboratorProfile } from '@/types/database'
import {
  searchCampaignCandidates,
  addCollaborator,
  removeCollaborator,
} from '@/services/campaigns.service'

interface CollaboratorPickerProps {
  campaignId: string
  /** Notifica el número de colaboradores tras cada cambio. */
  onCountChange?: (n: number) => void
}

/**
 * Buscador + lista para agregar/quitar colaboradores (capacitadores) de una
 * campaña, en vivo. Se reutiliza en el modal "Compartir campaña" y en el paso
 * final del asistente de creación de campaña.
 */
export function CollaboratorPicker({ campaignId, onCountChange }: CollaboratorPickerProps) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [candidates, setCandidates] = useState<CollaboratorProfile[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = (q: string) => {
    setLoading(true)
    searchCampaignCandidates(campaignId, q)
      .then((list) => {
        setCandidates(list)
        onCountChange?.(list.filter((c) => c.is_collaborator).length)
      })
      .catch(() => toast.error(t('admin.campaigns.share.load_error')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(search), 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [search, campaignId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (c: CollaboratorProfile) => {
    setBusyId(c.id)
    try {
      if (c.is_collaborator) {
        await removeCollaborator(campaignId, c.id)
        toast.success(t('admin.campaigns.share.removed', { name: c.display_name || '' }))
      } else {
        await addCollaborator(campaignId, c.id, user?.id ?? null)
        toast.success(t('admin.campaigns.share.added', { name: c.display_name || '' }))
      }
      setCandidates((prev) => {
        const next = prev.map((x) =>
          x.id === c.id ? { ...x, is_collaborator: !x.is_collaborator } : x,
        )
        onCountChange?.(next.filter((x) => x.is_collaborator).length)
        return next
      })
    } catch {
      toast.error(t('admin.campaigns.share.save_error'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-subtle" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.campaigns.share.search_ph')}
          className="w-full rounded-xl border border-line bg-surface pl-9 pr-3 py-2.5 text-[14px] text-text outline-none focus:border-primary"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 text-text-subtle animate-spin" />
        </div>
      ) : candidates.length === 0 ? (
        <p className="text-[13px] text-text-muted py-8 text-center">
          {t('admin.campaigns.share.no_results')}
        </p>
      ) : (
        <div className="space-y-2">
          {candidates.map((c) => {
            const busy = busyId === c.id
            return (
              <GlassCard key={c.id} intensity="subtle" rounded="2xl" padding="none">
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[12px] font-bold uppercase text-primary overflow-hidden">
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      (c.display_name || c.email || '?').charAt(0)
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-text truncate">
                      {c.display_name || c.email || c.id.slice(0, 8)}
                    </div>
                    <div className="text-[11px] text-text-subtle truncate">
                      {c.job_title || c.email || ''}
                    </div>
                  </div>
                  <button
                    onClick={() => toggle(c)}
                    disabled={busy}
                    className={cn(
                      'shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors border disabled:opacity-50',
                      c.is_collaborator
                        ? 'border-neon-green/30 bg-neon-green/10 text-neon-green'
                        : 'border-line text-text-muted hover:text-text hover:border-glass-border/30',
                    )}
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : c.is_collaborator ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <UserPlus className="h-3.5 w-3.5" />
                    )}
                    {c.is_collaborator
                      ? t('admin.campaigns.share.collaborating')
                      : t('admin.campaigns.share.add')}
                  </button>
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}
    </div>
  )
}
