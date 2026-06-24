import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ToggleLeft,
  ToggleRight,
  Pencil,
  Check,
  X,
  FolderOpen,
  Trash2,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import type { Campaign } from '@/types/database'
import { useAuth } from '@/hooks/useAuth'
import { GlassCard } from '@/components/ui/GlassCard'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Button } from '@/components/ui/Button'
import { CampaignWizard } from '@/admin/components/CampaignWizard'
import { cn } from '@/lib/cn'

interface CampaignWithModules extends Campaign {
  moduleCount?: number
}

export default function CampaignList() {
  const { isAdmin, isAdminOrCapacitador, isSuperAdmin } = useAuth()
  const { t } = useTranslation()
  const [campaigns, setCampaigns] = useState<CampaignWithModules[]>([])
  const [loading, setLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<CampaignWithModules | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('campaigns')
        .select('*')
        .order('created_at')
      if (!data) { setLoading(false); return }

      const withCounts = await Promise.all(
        data.map(async (c) => {
          const { count } = await supabase
            .from('modules')
            .select('id', { count: 'exact', head: true })
            .eq('campaign_id', c.id)
          return { ...c, moduleCount: count ?? 0 }
        }),
      )
      setCampaigns(withCounts)
      setLoading(false)
      if (withCounts.length === 1) setExpanded(withCounts[0].id)
    }
    load()
  }, [])

  const handleToggleActive = async (c: CampaignWithModules) => {
    await supabase.from('campaigns').update({ is_active: !c.is_active }).eq('id', c.id)
    setCampaigns((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, is_active: !c.is_active } : x)),
    )
  }

  const handleSaveName = async (id: string) => {
    if (!editName.trim()) return
    await supabase.from('campaigns').update({ name: editName.trim() }).eq('id', id)
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, name: editName.trim() } : c)))
    setEditingId(null)
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    setConfirmDelete(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-campaign`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ campaignId: id }),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al eliminar la campaña')
      setCampaigns((prev) => prev.filter((c) => c.id !== id))
      if (expanded === id) setExpanded(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al eliminar la campaña')
    } finally {
      setDeletingId(null)
    }
  }

  const toggleExpand = (id: string) =>
    setExpanded((prev) => (prev === id ? null : id))

  return (
    <div className="p-4 sm:p-8">
      {/* Encabezado */}
      <div className="relative mb-6 sm:mb-10">
        <div
          className="absolute -top-8 right-0 h-40 w-72 rounded-full pointer-events-none"
          aria-hidden
          style={{
            background: 'radial-gradient(ellipse at center, rgb(var(--neon-green) / 0.04) 0%, transparent 70%)',
          }}
        />
        <div className="relative flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <p className="text-[11px] text-text-subtle uppercase tracking-wider mb-3">
              Admin / Campañas
            </p>
            <GradientHeading as="h1" variant="white" size="headline">
              {t('admin.campaigns.title')}
            </GradientHeading>
            <p className="text-text-muted text-[13px] mt-1">{t('admin.campaigns.subtitle')}</p>
          </div>
          {isAdminOrCapacitador && (
            <Button variant="neon" onClick={() => setWizardOpen(true)} className="shrink-0">
              <Plus className="h-4 w-4" />
              Nueva campaña
            </Button>
          )}
        </div>
      </div>

      {/* Esqueleto de carga */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-20 rounded-2xl animate-pulse glass" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        /* Estado vacío */
        <GlassCard intensity="subtle" padding="none" rounded="3xl" className="text-center p-6 sm:p-10 md:p-12">
          <div className="h-20 w-20 rounded-3xl glass border-glass-border/10 mx-auto mb-4 flex items-center justify-center">
            <FolderOpen className="h-8 w-8 text-text-muted" />
          </div>
          <GradientHeading as="h3" variant="white" size="title" className="mb-2">
            Sin campañas
          </GradientHeading>
          <p className="text-text-muted text-[14px] mb-6">
            Crea la primera campaña para comenzar a agregar módulos y aprendices.
          </p>
          {isAdminOrCapacitador && (
            <Button variant="neon" onClick={() => setWizardOpen(true)}>
              <Plus className="h-4 w-4" /> Nueva campaña
            </Button>
          )}
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <motion.div
              key={c.id}
              layout
              className="overflow-hidden"
            >
              <GlassCard
                intensity={expanded === c.id ? 'default' : 'subtle'}
                rounded="2xl"
                className="transition-all duration-300"
              >
                {/* Fila de encabezado de campaña */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-3 sm:px-5 py-3 sm:py-4">
                  <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                    {/* Avatar */}
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-neon-violet/20 to-neon-green/10 border border-glass-border/10 flex items-center justify-center shrink-0 text-[13px] font-bold text-text">
                      {c.name.charAt(0).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      {editingId === c.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveName(c.id)}
                            autoFocus
                            className="rounded-lg px-3 py-1.5 text-[14px] text-text bg-glass/5 border border-glass-border/10 focus:border-neon-green/30 outline-none font-medium min-h-[44px]"
                          />
                          <button
                            onClick={() => handleSaveName(c.id)}
                            className="h-9 w-9 flex items-center justify-center rounded-lg text-neon-green hover:bg-neon-green/10 transition-colors"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:bg-glass/8 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[15px] font-semibold text-text">{c.name}</span>
                          <NeonBadge color={c.is_active ? 'green' : 'neutral'} dot={c.is_active}>
                            {c.is_active ? 'activa' : 'inactiva'}
                          </NeonBadge>
                          <span className="text-[11px] text-text-subtle">
                            {c.moduleCount} módulos
                          </span>
                        </div>
                      )}
                      <div className="text-[11px] text-text-subtle font-mono mt-0.5">{c.slug}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 sm:shrink-0 flex-wrap">
                    {isAdmin && editingId !== c.id && (
                      <>
                        <button
                          onClick={() => { setEditingId(c.id); setEditName(c.name) }}
                          title="Editar nombre"
                          className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(c)}
                          title={c.is_active ? 'Desactivar campaña' : 'Activar campaña'}
                          className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                        >
                          {c.is_active ? (
                            <ToggleRight className="h-4 w-4 text-neon-green" />
                          ) : (
                            <ToggleLeft className="h-4 w-4" />
                          )}
                        </button>
                      </>
                    )}
                    {isSuperAdmin && editingId !== c.id && (
                      <button
                        onClick={() => setConfirmDelete(c)}
                        disabled={deletingId === c.id}
                        title="Eliminar campaña"
                        className="h-9 w-9 flex items-center justify-center rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      >
                        {deletingId === c.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => toggleExpand(c.id)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[13px] text-text-muted hover:text-text hover:bg-glass/8 transition-colors min-h-[44px]"
                    >
                      Gestionar
                      {expanded === c.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Panel expandido */}
                <AnimatePresence initial={false}>
                  {expanded === c.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-glass-border/8 px-3 sm:px-5 py-3 sm:py-4">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <Link
                            to="/admin/modules"
                            className={cn(
                              'flex items-center gap-3 p-4 rounded-xl transition-all duration-200',
                              'glass hover:border-glass-border/20 hover:bg-glass/6',
                            )}
                          >
                            <div className="h-9 w-9 rounded-lg bg-glass/8 flex items-center justify-center shrink-0 ring-1 ring-glass-border/8">
                              <BookOpen className="h-4 w-4 text-text-muted" />
                            </div>
                            <div>
                              <div className="text-[14px] font-medium text-text">
                                {c.moduleCount} módulos
                              </div>
                              <div className="text-[12px] text-text-muted">
                                Ver y editar el contenido
                              </div>
                            </div>
                          </Link>

                          <Link
                            to="/admin/import"
                            className={cn(
                              'flex items-center gap-3 p-4 rounded-xl transition-all duration-200',
                              'glass hover:border-neon-green/25 hover:bg-glass/6',
                            )}
                          >
                            <div className="h-9 w-9 rounded-lg bg-neon-green/10 flex items-center justify-center shrink-0 ring-1 ring-neon-green/15">
                              <Plus className="h-4 w-4 text-neon-green" />
                            </div>
                            <div>
                              <div className="text-[14px] font-medium text-text">Importar contenido</div>
                              <div className="text-[12px] text-text-muted">
                                Subir un archivo Word o Excel
                              </div>
                            </div>
                          </Link>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      )}

      {/* Asistente de creación */}
      <CampaignWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(campaign) => {
          setCampaigns((prev) => [...prev, campaign])
          setExpanded(campaign.id)
        }}
      />

      {/* Confirmación de eliminación */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setConfirmDelete(null)}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-md"
            >
              <GlassCard intensity="default" rounded="2xl" className="p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <div className="h-11 w-11 rounded-xl bg-red-500/10 ring-1 ring-red-500/20 flex items-center justify-center shrink-0">
                    <AlertTriangle className="h-5 w-5 text-red-400" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[16px] font-semibold text-text">Eliminar campaña</h3>
                    <p className="text-[13px] text-text-muted mt-1.5 leading-relaxed">
                      Vas a eliminar <span className="font-semibold text-text">{confirmDelete.name}</span> y
                      todo su contenido (módulos, escenarios, mundos y el progreso de los aprendices).
                      Los usuarios no se eliminan, solo quedan sin campaña asignada.
                    </p>
                    <p className="text-[12px] text-red-400 mt-2">Esta acción no se puede deshacer.</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                    Cancelar
                  </Button>
                  <button
                    onClick={() => handleDelete(confirmDelete.id)}
                    className="h-9 px-4 rounded-full text-[13px] font-medium text-white bg-red-600 hover:bg-red-700 transition-colors inline-flex items-center gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar campaña
                  </button>
                </div>
              </GlassCard>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
