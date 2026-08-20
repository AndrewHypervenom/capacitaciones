import { useEffect, useMemo, useRef, useState } from 'react'
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
  Users,
  FlaskConical,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '@/lib/supabase'
import { toast } from '@/stores/toastStore'
import type { Campaign } from '@/types/database'
import { useAuth } from '@/hooks/useAuth'
import { GlassCard } from '@/components/ui/GlassCard'
import { SaveDock } from '@/admin/components/SaveDock'
import { useUndoHistory } from '@/hooks/useUndoHistory'
import { FadeIn } from '@/components/ui/motion'
import { GradientHeading } from '@/components/ui/GradientHeading'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { Tooltip } from '@/components/ui/Tooltip'
import { Button } from '@/components/ui/Button'
import { CampaignWizard } from '@/admin/components/CampaignWizard'
import { ShareCampaignModal } from '@/admin/components/ShareCampaignModal'
import {
  getAccessibleCampaigns,
  invalidateTestCampaigns,
  isTestCampaign,
} from '@/services/campaigns.service'
import { TestBadge } from '@/admin/components/TestModeSwitch'
import { useTestMode } from '@/stores/testModeStore'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/cn'

interface CampaignWithModules extends Campaign {
  moduleCount?: number
}

export default function CampaignList() {
  const { isAdminOrCapacitador, isSuperAdmin, campaignId, user } = useAuth()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [campaigns, setCampaigns] = useState<CampaignWithModules[]>([])
  /** Lo que hay en la base: contra esto se cuenta lo que está sin guardar. */
  const [savedCampaigns, setSavedCampaigns] = useState<CampaignWithModules[]>([])
  const [loading, setLoading] = useState(true)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [sharing, setSharing] = useState<CampaignWithModules | null>(null)
  /** La campaña que acaba de nacer es de prueba: al cerrar el asistente hay
      que recargar, porque el alcance del panel entero cambió. */
  const bornTestRef = useRef(false)
  const testModeOn = useTestMode((st) => st.enabled)
  const setTestMode = useTestMode((st) => st.setEnabled)

  useEffect(() => {
    async function load() {
      // Superadmin: todas. Capacitador: su campaña casa + donde colabora.
      // Se traen TODAS (incluidas las de prueba) y se esconden al pintar: así
      // encender el Modo pruebas revela en el acto las que ya estaban marcadas,
      // sin recargar la página y sin perder lo que haya sin guardar.
      const data = await getAccessibleCampaigns({
        isSuperAdmin,
        homeCampaignId: campaignId,
        userId: user?.id ?? null,
        includeTest: isSuperAdmin,
      }).catch(() => null)
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
      setSavedCampaigns(withCounts)
      setLoading(false)
      if (withCounts.length === 1) setExpanded(withCounts[0].id)
    }
    load()
  }, [isSuperAdmin, campaignId, user?.id])

  /* ── Editar es borrador ──
     Activar una campaña o cambiarle el nombre escribía en la base al instante.
     Ahora se acumula en la barra del pie (igual que en los editores) y se
     guarda de una vez con Ctrl+S. */
  const handleToggleActive = (c: CampaignWithModules) => {
    setCampaigns((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, is_active: !c.is_active } : x)),
    )
  }

  /* Marcar una campaña como entorno de pruebas: su contenido y su gente dejan
     de contar para los capacitadores reales y para reportes/Excel. Solo el
     superadmin. Al marcar la primera se enciende el Modo pruebas: de lo
     contrario la campaña desaparecería de su propia lista al guardar y
     parecería un error. */
  const handleToggleTest = async (c: CampaignWithModules) => {
    const turningOn = !isTestCampaign(c)
    if (turningOn) {
      const ok = await confirm({
        title: t('admin.campaigns.mark_test_title', { name: c.name }),
        description: t('admin.campaigns.mark_test_desc'),
        // Sin esto el botón sale en rojo y diciendo "Eliminar", que es lo que
        // trae el diálogo por defecto. Aquí no se borra nada y se puede
        // deshacer quitando la marca: el botón tiene que decir lo que hace.
        confirmLabel: t('admin.campaigns.mark_test_confirm'),
        tone: 'default',
      })
      if (!ok) return
      // El Modo pruebas NO se enciende aquí. Encenderlo a mitad del borrador
      // dejaba el panel a medias: esta pantalla cambiaba de alcance pero el
      // resto (el selector de campaña, /admin/users, los tableros) seguía con
      // los datos que trajo con el modo apagado. Se enciende al GUARDAR, junto
      // con una recarga completa: ahí ya no hay nada que perder.
    }
    setCampaigns((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, is_test: turningOn } : x)),
    )
  }

  const handleSaveName = (id: string) => {
    if (!editName.trim()) return
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, name: editName.trim() } : c)))
    setEditingId(null)
  }

  // Deshacer (Ctrl+Z) de lo que se edita aquí: sin esto, la barra ofrecía un
  // botón Deshacer apagado justo cuando había algo sin guardar.
  const { undo, canUndo } = useUndoHistory({
    state: campaigns,
    apply: setCampaigns,
    enabled: !loading,
  })

  /**
   * Lo que se pinta. Con el Modo pruebas apagado las campañas marcadas no
   * existen para el superadmin; al encenderlo aparecen todas de una, porque ya
   * están cargadas. El filtro es solo de pantalla: `campaigns` conserva la
   * lista completa para que guardar y deshacer sigan viendo lo mismo.
   *
   * SOLO al superadmin se le esconden: es el único que ve todas las campañas.
   * A un capacitador de pruebas hay que mostrarle las suyas, que son de prueba
   * — filtrarle también lo dejaría con la lista vacía. Es la misma regla de
   * `shouldHideTestData`, escrita aquí para que reaccione al interruptor.
   */
  const visibleCampaigns = useMemo(() => {
    if (!isSuperAdmin || testModeOn) return campaigns
    // Se juzga por lo GUARDADO, no por el borrador: la campaña que acabas de
    // marcar sigue a la vista hasta que guardes. Si se escondiera al instante,
    // desaparecería bajo el cursor y parecería que se borró.
    const saved = new Map(savedCampaigns.map((c) => [c.id, c]))
    return campaigns.filter((c) => !isTestCampaign(saved.get(c.id) ?? c))
  }, [campaigns, savedCampaigns, testModeOn, isSuperAdmin])

  const dirtyCampaigns = campaigns.filter((c) => {
    const before = savedCampaigns.find((x) => x.id === c.id)
    return (
      before &&
      (before.name !== c.name ||
        before.is_active !== c.is_active ||
        isTestCampaign(before) !== isTestCampaign(c))
    )
  })

  const saveCampaigns = async (): Promise<boolean> => {
    // Se leen antes de tocar nada: después de `setSavedCampaigns` ya no hay
    // con qué comparar.
    const marksChanged = dirtyCampaigns.some((c) => {
      const before = savedCampaigns.find((x) => x.id === c.id)
      return before && isTestCampaign(before) !== isTestCampaign(c)
    })
    const nowHasTest = campaigns.some(isTestCampaign)

    try {
      for (const c of dirtyCampaigns) {
        const { error } = await supabase
          .from('campaigns')
          .update({
            name: c.name,
            is_active: c.is_active,
            // Solo el superadmin puede mover esta marca; para el resto va el
            // valor que ya tenía, así el update no la toca.
            ...(isSuperAdmin ? { is_test: isTestCampaign(c) } : {}),
          })
          .eq('id', c.id)
        if (error) throw error
      }
      // La lista de campañas de prueba está cacheada: acaba de cambiar.
      invalidateTestCampaigns()
      setSavedCampaigns(campaigns)

      // Cambiar una marca de prueba cambia el ALCANCE de todo el panel: qué
      // campañas existen, qué gente cuenta, qué entra en KPIs y Excel. Media
      // docena de pantallas ya trajo sus datos con el alcance anterior, y
      // dejarlas así es justo el hueco que se ve como "faltan campañas".
      // Guardado ya no hay nada que perder, así que se recarga entero.
      if (isSuperAdmin && marksChanged) {
        if (nowHasTest && !testModeOn) setTestMode(true)
        toast.success(t('admin.campaigns.scope_reload'))
        setTimeout(() => window.location.reload(), 900)
        return true
      }

      toast.success(t('admin.campaigns.saved', { defaultValue: 'Campañas guardadas' }))
      return true
    } catch {
      toast.error(t('admin.campaigns.save_error', { defaultValue: 'No se pudieron guardar las campañas.' }))
      return false
    }
  }

  const handleDelete = async (c: CampaignWithModules) => {
    const ok = await confirm({
      title: t('confirm.delete_campaign_title'),
      description: t('confirm.delete_campaign_desc', { name: c.name }),
    })
    if (!ok) return
    const id = c.id
    setDeletingId(id)

    /** `force` limpia el histórico huérfano; solo se manda tras el segundo sí. */
    const callDelete = async (force = false) => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-campaign`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ campaignId: id, force }),
        },
      )
      return { res, json: await res.json() }
    }

    const listar = (rows?: { label: string; count: number }[]) =>
      rows?.map((b) => `${b.count} ${b.label}`).join(', ')

    try {
      let { res, json } = await callDelete()

      // Solo queda rastro huérfano: no hay pantalla desde donde limpiarlo, así
      // que lo borramos nosotros — pero con el sí explícito del superadmin.
      if (res.status === 409 && json.historyOnly) {
        const purge = await confirm({
          title: t('admin.campaigns.delete_history_title', {
            defaultValue: 'Queda histórico de «{{name}}»',
            name: c.name,
          }),
          description: t('admin.campaigns.delete_history_desc', {
            defaultValue:
              'El contenido ya no existe, pero siguen ahí: {{detalle}}. Al eliminar la campaña se borran también, y no se pueden recuperar.',
            detalle: listar(json.history),
          }),
        })
        if (!purge) return
        ;({ res, json } = await callDelete(true))
      }

      if (!res.ok) {
        // 409 = todavía cuelga contenido de la campaña. Decimos qué, no "error 500".
        if (res.status === 409) {
          toast.error(
            t('admin.campaigns.delete_blocked', {
              defaultValue: 'No se puede eliminar «{{name}}»',
              name: c.name,
            }),
            t('admin.campaigns.delete_blocked_desc', {
              defaultValue: 'Todavía tiene: {{detalle}}. Muévelo o elimínalo primero.',
              detalle: listar(json.blockers) ?? (json.detail as string | undefined),
            }),
          )
          return
        }
        throw new Error(json.error ?? t('admin.campaigns.delete_error'))
      }
      setCampaigns((prev) => prev.filter((c) => c.id !== id))
      setSavedCampaigns((prev) => prev.filter((c) => c.id !== id))
      if (expanded === id) setExpanded(null)
    } catch (err) {
      toast.error(
        t('admin.campaigns.delete_error'),
        err instanceof Error ? err.message : undefined,
      )
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
      ) : visibleCampaigns.length === 0 ? (
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
        <FadeIn className="space-y-3" y={14}>
          {visibleCampaigns.map((c) => (
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
                            className="h-10 w-10 flex items-center justify-center rounded-lg text-neon-green hover:bg-neon-green/10 transition-colors"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:bg-glass/8 transition-colors"
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
                          {isTestCampaign(c) && <TestBadge />}
                          <span className="text-[11px] text-text-subtle">
                            {c.moduleCount} módulos
                          </span>
                        </div>
                      )}
                      <div className="text-[11px] text-text-subtle font-mono mt-0.5">{c.slug}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 sm:shrink-0 flex-wrap">
                    {/* Renombrar/activar: cualquier miembro (dueño o colaborador). El
                        RLS campaigns_collab_update lo permite. Borrar sigue en superadmin. */}
                    {isAdminOrCapacitador && editingId !== c.id && (
                      <>
                        <button
                          onClick={() => { setEditingId(c.id); setEditName(c.name) }}
                          title={i18n.t('admin.campaigns.edit_name')}
                          className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {/* Vive pegado al matraz de "prueba" y son cosas
                            distintas: inactiva = cerrada, prueba = aislada.
                            El tooltip lo dice para que no se confundan. */}
                        <Tooltip
                          maxWidth={280}
                          label={c.is_active ? t('admin.campaigns.toggle_deactivate') : t('admin.campaigns.toggle_activate')}
                        >
                          <button
                            onClick={() => handleToggleActive(c)}
                            aria-label={c.is_active ? t('admin.campaigns.toggle_deactivate') : t('admin.campaigns.toggle_activate')}
                            className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-text hover:bg-glass/8 transition-colors"
                          >
                            {c.is_active ? (
                              <ToggleRight className="h-4 w-4 text-neon-green" />
                            ) : (
                              <ToggleLeft className="h-4 w-4" />
                            )}
                          </button>
                        </Tooltip>
                      </>
                    )}
                    {isSuperAdmin && editingId !== c.id && (
                      <Tooltip
                        maxWidth={280}
                        label={
                          isTestCampaign(c)
                            ? t('admin.campaigns.unmark_test')
                            : t('admin.campaigns.mark_test')
                        }
                      >
                        <button
                          onClick={() => handleToggleTest(c)}
                          aria-label={
                            isTestCampaign(c)
                              ? t('admin.campaigns.unmark_test')
                              : t('admin.campaigns.mark_test')
                          }
                          className={cn(
                            'h-10 w-10 flex items-center justify-center rounded-lg transition-colors',
                            isTestCampaign(c)
                              ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
                              : 'text-text-muted hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10',
                          )}
                        >
                          <FlaskConical className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    )}
                    {isSuperAdmin && editingId !== c.id && (
                      <button
                        onClick={() => handleDelete(c)}
                        disabled={deletingId === c.id}
                        title={i18n.t('admin.campaigns.delete_campaign')}
                        className="h-10 w-10 flex items-center justify-center rounded-lg text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
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

                          <button
                            onClick={() => setSharing(c)}
                            className={cn(
                              'flex items-center gap-3 p-4 rounded-xl transition-all duration-200 text-left w-full',
                              'glass hover:border-neon-green/25 hover:bg-glass/6',
                            )}
                          >
                            <div className="h-9 w-9 rounded-lg bg-neon-green/10 flex items-center justify-center shrink-0 ring-1 ring-neon-green/15">
                              <Users className="h-4 w-4 text-neon-green" />
                            </div>
                            <div>
                              <div className="text-[14px] font-medium text-text">{t('admin.campaigns.share.card_title')}</div>
                              <div className="text-[12px] text-text-muted">
                                {t('admin.campaigns.share.card_desc')}
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </GlassCard>
            </motion.div>
          ))}
        </FadeIn>
      )}

      {/* Asistente de creación */}
      <CampaignWizard
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false)
          // Nacer una campaña de prueba mete al panel en el entorno de pruebas
          // (lo hace el propio asistente). El resto del sitio —el selector de
          // campaña, los tableros— trajo sus datos con el alcance de antes, así
          // que se recarga al cerrar: dentro del asistente no se puede, se
          // llevaría por delante el paso de invitar colaboradores.
          if (bornTestRef.current) {
            bornTestRef.current = false
            toast.success(t('admin.campaigns.scope_reload'))
            setTimeout(() => window.location.reload(), 900)
          }
        }}
        onCreated={(campaign) => {
          setCampaigns((prev) => [...prev, campaign])
          setSavedCampaigns((prev) => [...prev, campaign])
          setExpanded(campaign.id)
          if (isTestCampaign(campaign)) bornTestRef.current = true
        }}
      />

      {/* Compartir campaña con colaboradores */}
      {sharing && (
        <ShareCampaignModal
          campaign={{ id: sharing.id, name: sharing.name }}
          onClose={() => setSharing(null)}
        />
      )}

      <SaveDock
        pending={
          dirtyCampaigns.length > 0
            ? [{ id: 'campaigns', label: t('admin.campaigns.title', { defaultValue: 'Campañas' }) }]
            : []
        }
        onSave={saveCampaigns}
        onUndo={undo}
        canUndo={canUndo}
      />
    </div>
  )
}
