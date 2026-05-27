import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronRight, Eye, EyeOff, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  getModulesRaw,
  toggleModulePublished,
  deleteModule,
  type DbModuleRow,
} from '@/services/modules.service'
import type { Campaign } from '@/types/database'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

export default function ModuleList() {
  const { t } = useTranslation()
  const { campaignId: authCampaignId, isAdmin } = useAuth()

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(authCampaignId ?? '')
  const [selectedCampaignName, setSelectedCampaignName] = useState<string>('')
  const [modules, setModules] = useState<DbModuleRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    supabase
      .from('campaigns')
      .select('*')
      .order('name')
      .then(({ data }) => {
        setCampaigns(data ?? [])
        if (!selectedCampaignId && data?.[0]) {
          setSelectedCampaignId(data[0].id)
          setSelectedCampaignName(data[0].name)
        }
      })
  }, [isAdmin, selectedCampaignId])

  useEffect(() => {
    if (isAdmin || !authCampaignId) return
    supabase
      .from('campaigns')
      .select('name')
      .eq('id', authCampaignId)
      .single()
      .then(({ data }) => {
        if (data) setSelectedCampaignName(data.name)
      })
  }, [isAdmin, authCampaignId])

  useEffect(() => {
    if (!selectedCampaignId) return
    setLoading(true)
    setError(null)
    getModulesRaw(selectedCampaignId)
      .then(setModules)
      .catch(() => setError(t('admin.modules.error_load')))
      .finally(() => setLoading(false))
  }, [selectedCampaignId, t])

  const handleTogglePublished = async (mod: DbModuleRow) => {
    try {
      await toggleModulePublished(mod.id, !mod.is_published)
      setModules((prev) =>
        prev.map((m) => (m.id === mod.id ? { ...m, is_published: !mod.is_published } : m)),
      )
    } catch {
      setError(t('admin.modules.error_toggle'))
    }
  }

  const handleDelete = async (mod: DbModuleRow) => {
    if (!confirm(t('admin.modules.confirm_delete', { title: mod.title_es }))) return
    try {
      await deleteModule(mod.id)
      setModules((prev) => prev.filter((m) => m.id !== mod.id))
    } catch {
      setError(t('admin.modules.error_delete'))
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="relative mb-8">
        <div
          className="absolute -top-8 right-0 h-40 w-72 rounded-full pointer-events-none"
          aria-hidden
          style={{
            background: 'radial-gradient(ellipse at center, rgb(var(--neon-green) / 0.04) 0%, transparent 70%)',
          }}
        />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] text-text-subtle uppercase tracking-wider mb-3">
              Admin / Módulos
            </p>
            <GradientHeading as="h1" variant="white" size="headline">
              {t('admin.modules.title')}
            </GradientHeading>
            {selectedCampaignName && (
              <p className="text-text-muted text-[13px] mt-1">
                Campaña: <span className="font-medium text-text">{selectedCampaignName}</span>
              </p>
            )}
          </div>
          <Link to="/admin/modules/new">
            <Button variant="neon" size="sm" className="shrink-0 flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Nuevo módulo
            </Button>
          </Link>
        </div>
      </div>

      {/* Campaign selector (superadmin) */}
      {isAdmin && campaigns.length > 1 && (
        <div className="mb-6">
          <select
            value={selectedCampaignId}
            onChange={(e) => {
              setSelectedCampaignId(e.target.value)
              setSelectedCampaignName(
                campaigns.find((c) => c.id === e.target.value)?.name ?? '',
              )
            }}
            className="rounded-xl px-4 py-2.5 text-[14px] text-text bg-glass/5 border border-glass-border/10 focus:border-glass-border/25 outline-none"
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl px-4 py-3 text-[13px] text-danger glass border-danger/20">
          {error}
        </div>
      )}

      {/* Module list */}
      <div>
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-2xl animate-pulse glass" />
            ))}
          </div>
        ) : modules.length === 0 ? (
          <GlassCard intensity="subtle" padding="xl" rounded="3xl" className="text-center">
            <BookOpen className="h-10 w-10 text-text-muted mx-auto mb-3" />
            <p className="text-text-muted text-[14px] mb-2">{t('admin.modules.empty_title')}</p>
            <p className="text-text-subtle text-[12px] mb-6">{t('admin.modules.empty_hint')}</p>
            <Link to="/admin/modules/new">
              <Button variant="neon" size="sm" className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Crear primer módulo
              </Button>
            </Link>
          </GlassCard>
        ) : (
          <div className="space-y-3">
            {modules.map((mod, idx) => (
              <GlassCard
                key={mod.id}
                intensity="subtle"
                rounded="2xl"
                className={cn(
                  'group hover:border-glass-border/15 transition-all duration-200',
                  mod.is_published && 'hover:border-glass-border/15',
                )}
              >
                <div className="flex items-center gap-4 px-5 py-4">
                  {/* Número */}
                  <span className="text-[11px] font-mono text-text-subtle w-5 shrink-0 text-right">
                    {idx + 1}
                  </span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-semibold text-text truncate">
                        {mod.title_es}
                      </span>
                      <NeonBadge
                        color={mod.is_published ? 'green' : 'neutral'}
                        dot={mod.is_published}
                      >
                        {mod.is_published
                          ? t('admin.modules.published')
                          : t('admin.modules.draft')}
                      </NeonBadge>
                    </div>
                    <div className="text-[12px] text-text-subtle mt-0.5">
                      {mod.duration_min} min ·{' '}
                      {t('admin.modules.sections_count', {
                        n: mod.module_sections?.length ?? 0,
                      })}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                    <Link
                      to={`/admin/modules/${mod.id}/preview`}
                      title={t('admin.modules.preview')}
                      className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>

                    <button
                      onClick={() => handleTogglePublished(mod)}
                      title={
                        mod.is_published
                          ? t('admin.modules.unpublish')
                          : t('admin.modules.publish')
                      }
                      className="p-2 rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                    >
                      {mod.is_published ? (
                        <Eye className="h-4 w-4" />
                      ) : (
                        <EyeOff className="h-4 w-4" />
                      )}
                    </button>

                    <button
                      onClick={() => handleDelete(mod)}
                      title={t('admin.modules.delete')}
                      className="p-2 rounded-lg text-text-muted hover:text-danger hover:bg-danger/8 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>

                    <Link
                      to={`/admin/modules/${mod.id}`}
                      className="flex items-center gap-1 px-3 py-2 rounded-lg text-[13px] font-medium text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      {t('admin.modules.edit')}
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      {modules.length > 0 && (
        <p className="text-[11px] text-text-subtle mt-4 text-center">
          Usa el ícono <ExternalLink className="h-3 w-3 inline" /> para previsualizar cómo verá el aprendiz cada módulo
        </p>
      )}
    </div>
  )
}
