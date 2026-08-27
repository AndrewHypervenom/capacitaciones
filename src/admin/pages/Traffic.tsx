import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import {
  Activity, Users, Clock, Eye, MousePointerClick, Radio, Loader2,
  TrendingUp, TrendingDown, Minus, Building2, Database, Pencil, Trophy, HelpCircle,
} from 'lucide-react'
import i18n from '@/i18n'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { useWorkspacePeers } from '@/hooks/usePresence'
import { usePresenceStore, shortName } from '@/stores/presenceStore'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import {
  summarizeLivePeers, fetchTrafficHistory, EMPTY_HISTORY,
  type TrafficHistory, type ConcurrencyPoint,
} from '@/services/traffic.service'
import { smoothLine } from '@/lib/smoothLine'
import { Select } from '@/components/ui/Select'
import { Avatar } from '@/components/ui/Avatar'
import { Tooltip } from '@/components/ui/Tooltip'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { FadeIn, Stagger, StaggerItem } from '@/components/ui/motion'
import { cn } from '@/lib/cn'

// ─── Rangos ──────────────────────────────────────────────────────────
// El tamaño de la franja va pegado al rango. "Hoy" va en franjas de 5 minutos
// (288 puntos como mucho), que es el detalle con el que se ve de verdad quién
// coincidió con quién. Los rangos largos suben de franja a propósito: 5 min
// sobre 90 días serían 26 mil puntos viajando para pintar mil píxeles.
type Preset = 'today' | '7d' | '30d' | '90d'

const PRESETS: { key: Preset; labelKey: string; bucket: number }[] = [
  { key: 'today', labelKey: 'admin.traffic.preset_today', bucket: 5 },
  { key: '7d',    labelKey: 'admin.traffic.preset_7d',    bucket: 60 },
  { key: '30d',   labelKey: 'admin.traffic.preset_30d',   bucket: 360 },
  { key: '90d',   labelKey: 'admin.traffic.preset_90d',   bucket: 1440 },
]

function rangeFor(preset: Preset): { from: string; to: string } {
  const now = new Date()
  const start = new Date(now)
  switch (preset) {
    case 'today': start.setHours(0, 0, 0, 0); break
    case '7d':    start.setDate(now.getDate() - 6);  start.setHours(0, 0, 0, 0); break
    case '30d':   start.setDate(now.getDate() - 29); start.setHours(0, 0, 0, 0); break
    case '90d':   start.setDate(now.getDate() - 89); start.setHours(0, 0, 0, 0); break
  }
  return { from: start.toISOString(), to: now.toISOString() }
}

// ─── Formateo ────────────────────────────────────────────────────────
const fmtInt = (n: number) => Math.round(n).toLocaleString(i18n.language)

/** Duración legible: 45s · 12m · 3h 20m. Nunca "0.05 horas". */
function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function fmtBucket(iso: string, preset: Preset): string {
  const d = new Date(iso)
  if (preset === 'today') {
    return d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  }
  // En 7 días las franjas son de una hora: sin la hora, doce puntos seguidos
  // dirían todos "27 ago" y la lectura del puntero no serviría de nada.
  if (preset === '7d') {
    return d.toLocaleString(i18n.language, {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  }
  return d.toLocaleDateString(i18n.language, { day: '2-digit', month: 'short' })
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(i18n.language, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

const ROLE_COLOR: Record<string, string> = {
  superadmin: '#f59e0b',
  capacitador: '#B33D9E',
  learner: '#10D451',
}

export default function Traffic() {
  const { t } = useTranslation()
  const { isSuperAdmin } = useAuth()
  const profile = useAuthStore((s) => s.profile)

  // ── En vivo: se recalcula solo cuando cambia la presencia. Cero consultas.
  const peers = useWorkspacePeers()
  const viewCampaignId = usePresenceStore((s) => s.viewCampaignId)
  const live = useMemo(
    () => summarizeLivePeers(peers, profile ? {
      role: profile.role,
      campaignId: viewCampaignId ?? profile.campaign_id,
      route: '/admin/traffic',
    } : null),
    [peers, profile, viewCampaignId],
  )

  // ── Histórico
  const [preset, setPreset] = useState<Preset>('7d')
  const [campaignId, setCampaignId] = useState<string>('all')
  const [role, setRole] = useState<string>('all')
  const [history, setHistory] = useState<TrafficHistory>(EMPTY_HISTORY)
  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])
  // Contador que fuerza la recarga. En "Hoy" la franja en curso se está
  // llenando ahora mismo: sin esto el pico del momento queda congelado en
  // pantalla hasta que alguien toque un filtro.
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (preset !== 'today') return
    const id = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [preset])

  useEffect(() => {
    if (!profile) return
    getAccessibleCampaigns({
      isSuperAdmin: true,
      homeCampaignId: profile.campaign_id ?? null,
      userId: profile.id,
    })
      .then((cs) => setCampaigns(cs.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => { /* el filtro se queda en "todas" */ })
  }, [profile])

  useEffect(() => {
    let alive = true
    // El refresco automático no debe parpadear la pantalla entera: solo la
    // primera carga de cada combinación de filtros muestra el spinner.
    if (tick === 0) setLoading(true)
    const { from, to } = rangeFor(preset)
    const bucket = PRESETS.find((p) => p.key === preset)!.bucket
    fetchTrafficHistory({
      from, to, bucketMinutes: bucket,
      campaignId: campaignId === 'all' ? null : campaignId,
      role: role === 'all' ? null : role,
    })
      .then((d) => { if (alive) setHistory(d) })
      .catch((e) => { console.error('[traffic]', e); if (alive) setHistory(EMPTY_HISTORY) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [preset, campaignId, role, tick])

  // La ruta ya lo bloquea; esto es el segundo cerrojo por si alguien llega
  // aquí desde un enlace viejo.
  if (!isSuperAdmin) return null

  const o = history.overview
  const usersDelta = o.prevUsers > 0
    ? ((o.users - o.prevUsers) / o.prevUsers) * 100
    : null

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">{t('admin.traffic.title')}</h1>
        <p className="text-[13px] text-text-muted">{t('admin.traffic.subtitle')}</p>
      </div>

      {/* ══ AHORA MISMO ══════════════════════════════════════════════ */}
      <FadeIn as="section" className="mb-8" y={12}>
        <div className="flex items-center gap-2 mb-3">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[rgb(var(--brand-green))] opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[rgb(var(--brand-green))]" />
          </span>
          <h2 className="text-[11px] uppercase tracking-wider text-text-muted">{t('admin.traffic.live_title')}</h2>
          <Hint text={t('admin.traffic.live_title_hint')} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Contador grande */}
          <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6 flex flex-col justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[rgb(var(--brand-green))]/10 text-[rgb(var(--brand-green))]">
                <Radio className="h-4 w-4" />
              </span>
              <span className="text-[11px] uppercase tracking-wider text-text-muted">{t('admin.traffic.live_online')}</span>
              <Hint text={t('admin.traffic.live_online_hint')} />
            </div>
            <div className="mt-3 flex items-end gap-3">
              <span className="text-5xl font-bold tabular-nums text-text leading-none">
                <AnimatedNumber value={live.total} format={(n) => fmtInt(n)} />
              </span>
              {live.idle > 0 && (
                <Tooltip label={t('admin.traffic.live_idle_hint')}>
                  <span className="mb-1 text-[12px] text-text-subtle tabular-nums">
                    {t('admin.traffic.live_idle', { n: live.idle })}
                  </span>
                </Tooltip>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {live.byRole.map((r) => (
                <Tooltip
                  key={r.key}
                  label={t('admin.traffic.live_role_hint', {
                    n: r.count,
                    role: t(`roles.${r.key}`, r.key),
                  })}
                >
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium tabular-nums"
                    style={{
                      background: `${ROLE_COLOR[r.key] ?? '#64748b'}1a`,
                      color: ROLE_COLOR[r.key] ?? '#64748b',
                    }}
                  >
                    {t(`roles.${r.key}`, r.key)} · {r.count}
                  </span>
                </Tooltip>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-text-subtle leading-snug">
              {t('admin.traffic.live_note')}
            </p>
          </div>

          {/* Dónde está la gente */}
          <LiveList
            title={t('admin.traffic.live_by_view')}
            icon={Eye}
            rows={live.byView.map((v) => ({ label: t(v.key, t('presence.views.somewhere')), count: v.count }))}
            total={live.total}
            empty={t('admin.traffic.live_empty')}
            hint={t('admin.traffic.live_by_view_hint')}
          />

          {/* Quién está editando: el dato que evita que dos se pisen */}
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center gap-2 mb-3">
              <Pencil className="h-3.5 w-3.5 text-text-muted" />
              <h3 className="text-[11px] uppercase tracking-wider text-text-muted">{t('admin.traffic.live_editing')}</h3>
              <Hint text={t('admin.traffic.live_editing_hint')} />
            </div>
            {live.editing.length === 0 ? (
              <p className="text-[13px] text-text-muted py-6 text-center">{t('admin.traffic.live_editing_none')}</p>
            ) : (
              <ul className="space-y-2.5">
                {live.editing.slice(0, 6).map((p) => (
                  <li key={p.user_id} className="flex items-center gap-2.5">
                    <Avatar src={p.avatar_url} name={p.name} size={28} />
                    <div className="min-w-0">
                      <div className="text-[13px] text-text truncate">{shortName(p.name)}</div>
                      <div className="text-[11.5px] text-text-muted truncate">
                        {t(`presence.kinds.${p.activity!.type}`, p.activity!.type)} · {p.activity!.title || '—'}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </FadeIn>

      {/* ══ HISTÓRICO ════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-3.5 w-3.5 text-text-muted" />
        <h2 className="text-[11px] uppercase tracking-wider text-text-muted">{t('admin.traffic.history_title')}</h2>
        <Hint text={t('admin.traffic.history_title_hint')} />
      </div>

      {history.notInstalled ? (
        <div className="rounded-2xl border border-dashed border-line p-6 sm:p-12 text-center">
          <Database className="h-7 w-7 text-text-subtle mx-auto mb-3" />
          <div className="text-[15px] font-medium text-text mb-1">{t('admin.traffic.not_installed_title')}</div>
          <div className="text-[13px] text-text-muted max-w-md mx-auto">{t('admin.traffic.not_installed_desc')}</div>
          <code className="mt-3 inline-block rounded-lg bg-subtle px-2.5 py-1 text-[12px] text-text-muted">
            supabase/sql/traffic_events.sql
          </code>
        </div>
      ) : (
        <>
          {/* Filtros */}
          <div className="flex flex-col gap-3 mb-5">
            <div className="flex flex-wrap items-center gap-2">
              <Hint text={t('admin.traffic.presets_hint')} />
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => { setPreset(p.key); setTick(0) }}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors',
                    preset === p.key
                      ? 'border-[rgb(var(--brand-green))] text-[rgb(var(--brand-green))] bg-[rgb(var(--brand-green))]/10'
                      : 'border-line text-text-muted hover:text-text hover:border-glass-border/30',
                  )}
                >
                  {t(p.labelKey)}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Select
                className="sm:w-auto sm:min-w-[220px]"
                value={campaignId}
                onChange={(v) => { setCampaignId(v); setTick(0) }}
                options={[
                  { value: 'all', label: t('admin.traffic.filter_all_campaigns') },
                  ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <Select
                className="sm:w-auto sm:min-w-[180px]"
                value={role}
                onChange={(v) => { setRole(v); setTick(0) }}
                options={[
                  { value: 'all', label: t('admin.traffic.filter_all_roles') },
                  { value: 'learner', label: t('roles.learner') },
                  { value: 'capacitador', label: t('roles.capacitador') },
                  { value: 'superadmin', label: t('roles.superadmin') },
                ]}
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 text-text-subtle animate-spin" />
            </div>
          ) : (
            <>
              {/* KPIs */}
              <Stagger as="section" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5" gap={0.06}>
                <Kpi icon={Users} color="#10D451" label={t('admin.traffic.kpi_users')} hint={t('admin.traffic.kpi_users_hint')}
                  value={<AnimatedNumber value={o.users} format={fmtInt} />}
                  delta={usersDelta}
                  footer={o.newUsers > 0 ? t('admin.traffic.kpi_new', { n: fmtInt(o.newUsers) }) : undefined} />
                <Kpi icon={MousePointerClick} color="#8b5cf6" label={t('admin.traffic.kpi_sessions')} hint={t('admin.traffic.kpi_sessions_hint')}
                  value={<AnimatedNumber value={o.sessions} format={fmtInt} />}
                  footer={t('admin.traffic.kpi_views', { n: fmtInt(o.views) })} />
                <Kpi icon={Clock} color="#06b6d4" label={t('admin.traffic.kpi_time')} hint={t('admin.traffic.kpi_time_hint')}
                  value={fmtDuration(o.activeMs)}
                  footer={t('admin.traffic.kpi_avg_session', { v: fmtDuration(o.avgSessionMs) })} />
                <Kpi icon={TrendingUp} color="#f59e0b" label={t('admin.traffic.kpi_peak')} hint={t('admin.traffic.kpi_peak_hint')}
                  value={<AnimatedNumber value={o.peakConcurrent ?? 0} format={fmtInt} />}
                  footer={o.peakAt ? fmtDateTime(o.peakAt) : undefined} />
              </Stagger>

              {/* Curva de concurrencia */}
              <FadeIn as="section" className="rounded-2xl border border-line bg-surface p-5 sm:p-6 mb-5" y={12}>
                <div className="mb-4">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[11px] uppercase tracking-wider text-text-muted">{t('admin.traffic.chart_title')}</h3>
                    <Hint text={t('admin.traffic.chart_title_hint')} />
                  </div>
                  <p className="mt-1 text-[12px] text-text-subtle">{t('admin.traffic.chart_hint')}</p>
                </div>
                {history.concurrency.length === 0 ? (
                  <div className="text-[13px] text-text-muted py-10 text-center">{t('admin.traffic.no_data')}</div>
                ) : (
                  <ConcurrencyChart points={history.concurrency} preset={preset} />
                )}
              </FadeIn>

              {/* Vistas + campañas */}
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
                <RankCard
                  title={t('admin.traffic.top_views')} icon={Eye}
                  empty={t('admin.traffic.no_data')}
                  hint={t('admin.traffic.top_views_hint')}
                  valueHint={t('admin.traffic.top_views_value_hint')}
                  rows={history.topViews.map((v) => ({
                    key: v.viewKey,
                    label: t(v.viewKey, t('presence.views.somewhere')),
                    sub: t('admin.traffic.view_sub', { users: fmtInt(v.users), avg: fmtDuration(v.avgMs) }),
                    value: fmtInt(v.views),
                    weight: v.views,
                  }))}
                />
                <RankCard
                  title={t('admin.traffic.by_campaign')} icon={Building2}
                  empty={t('admin.traffic.no_data')}
                  hint={t('admin.traffic.by_campaign_hint')}
                  valueHint={t('admin.traffic.by_campaign_value_hint')}
                  rows={history.byCampaign.map((c) => ({
                    key: c.campaignId ?? 'none',
                    label: c.campaignName ?? t('admin.traffic.no_campaign'),
                    sub: t('admin.traffic.campaign_sub', { views: fmtInt(c.views), time: fmtDuration(c.activeMs) }),
                    value: fmtInt(c.users),
                    weight: c.users,
                  }))}
                />
              </section>

              {/* Quién más usa el sitio */}
              <FadeIn as="section" className="rounded-2xl border border-line bg-surface overflow-hidden" y={12}>
                <div className="flex items-center gap-2 px-5 py-4 border-b border-line">
                  <Trophy className="h-3.5 w-3.5 text-text-muted" />
                  <h3 className="text-[11px] uppercase tracking-wider text-text-muted">{t('admin.traffic.top_users')}</h3>
                  <Hint text={t('admin.traffic.top_users_hint')} />
                </div>
                {history.topUsers.length === 0 ? (
                  <p className="text-[13px] text-text-muted py-10 text-center">{t('admin.traffic.no_data')}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {history.topUsers.map((u) => (
                      <li key={u.userId} className="flex items-center gap-3 px-5 py-3">
                        <Avatar src={u.avatarUrl} name={u.displayName} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] text-text truncate">{u.displayName ?? '—'}</div>
                          <div className="text-[11.5px] text-text-muted truncate">
                            {u.role ? t(`roles.${u.role}`, u.role) : '—'}
                            {u.campaignName ? ` · ${u.campaignName}` : ''}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <Tooltip label={t('admin.traffic.user_time_hint')}>
                            <div className="text-[13px] font-semibold tabular-nums text-text">{fmtDuration(u.activeMs)}</div>
                          </Tooltip>
                          <div className="text-[11px] text-text-subtle tabular-nums">
                            {t('admin.traffic.user_sub', { sessions: fmtInt(u.sessions), views: fmtInt(u.views) })}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </FadeIn>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─── Piezas ──────────────────────────────────────────────────────────
/**
 * Signo de interrogación con la explicación del rótulo que acompaña.
 *
 * Esta pantalla está llena de números que se parecen y miden cosas distintas
 * ("personas" vs "sesiones" vs "vistas", el pico simultáneo vs quién pasó por
 * ahí). Sin decir cuál es cuál, el panel se lee mal: por eso CADA rótulo lleva
 * el suyo. Se usa `ui/Tooltip`, nunca el atributo `title`.
 */
function Hint({ text }: { text: string }) {
  return (
    <Tooltip label={text} maxWidth={300}>
      <HelpCircle className="h-3 w-3 shrink-0 text-text-subtle transition-colors hover:text-text-muted" />
    </Tooltip>
  )
}

/** Rótulo de sección con su ayuda al lado. */
function SectionTitle({ icon: Icon, label, hint }: {
  icon?: React.ComponentType<{ className?: string }>
  label: string
  hint: string
}) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
      <h3 className="text-[11px] uppercase tracking-wider text-text-muted">{label}</h3>
      <Hint text={hint} />
    </div>
  )
}

function Kpi({ icon: Icon, label, value, color, delta, footer, hint }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: React.ReactNode
  color: string
  delta?: number | null
  footer?: string
  hint: string
}) {
  return (
    <StaggerItem className="rounded-2xl border border-line bg-surface p-4 sm:p-5 flex flex-col gap-2 transition-all duration-300 ease-apple hover:-translate-y-0.5 hover:shadow-card-hover">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}1a`, color }}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] sm:text-[11px] uppercase tracking-wider text-text-muted truncate">{label}</span>
        <Hint text={hint} />
      </div>
      <span className="text-2xl sm:text-3xl font-bold tabular-nums text-text">{value}</span>
      <div className="flex items-center gap-2 min-h-[16px]">
        {delta != null && <Delta pct={delta} />}
        {footer && <span className="text-[11px] text-text-subtle truncate">{footer}</span>}
      </div>
    </StaggerItem>
  )
}

/** Variación vs. el período anterior. Aquí subir es bueno (más gente usa el sitio). */
function Delta({ pct }: { pct: number }) {
  const { t } = useTranslation()
  const flat = Math.abs(pct) < 1
  const up = pct > 0
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown
  const color = flat ? 'text-text-subtle' : up ? 'text-emerald-500' : 'text-rose-500'
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums', color)}
      title={t('admin.traffic.vs_prev')}>
      <Icon className="h-3 w-3" />
      {flat ? '±0%' : `${up ? '+' : ''}${Math.round(pct)}%`}
    </span>
  )
}

/** Lista en vivo con barra proporcional (sin consultas: todo sale de la presencia). */
function LiveList({ title, icon: Icon, rows, total, empty, hint }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  rows: { label: string; count: number }[]
  total: number
  empty: string
  hint: string
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3">
        <SectionTitle icon={Icon} label={title} hint={hint} />
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-text-muted py-6 text-center">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.slice(0, 7).map((r) => (
            <li key={r.label}>
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
                <span className="text-text truncate">{r.label}</span>
                <Tooltip label={t('admin.traffic.live_view_count_hint', { n: r.count })}>
                  <span className="tabular-nums text-text-muted shrink-0">{r.count}</span>
                </Tooltip>
              </div>
              <div className="mt-1 h-1 rounded-full bg-subtle overflow-hidden">
                <div
                  className="h-full rounded-full bg-[rgb(var(--brand-green))]/70"
                  style={{ width: `${total > 0 ? (r.count / total) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Ranking con barra proporcional al mayor de la lista. */
function RankCard({ title, icon: Icon, rows, empty, hint, valueHint }: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  rows: { key: string; label: string; sub: string; value: string; weight: number }[]
  empty: string
  hint: string
  /** Qué mide el número grande de cada fila (en una lista son visitas, en la otra personas). */
  valueHint: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.weight))
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4">
        <SectionTitle icon={Icon} label={title} hint={hint} />
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-text-muted py-8 text-center">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-text truncate">{r.label}</span>
                <Tooltip label={valueHint}>
                  <span className="text-[13px] font-semibold tabular-nums text-text shrink-0">{r.value}</span>
                </Tooltip>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-subtle overflow-hidden">
                {/* Magenta corporativo directo: no hay token `brand-violet`. */}
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: '#B33D9E' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(r.weight / max) * 100}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <div className="mt-1 text-[11px] text-text-subtle">{r.sub}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Curva de concurrencia: personas distintas por cubo de tiempo. Área + línea
 * suave, con lectura al pasar el puntero. Mismo lenguaje visual que Uso de IA.
 */
function ConcurrencyChart({ points, preset }: { points: ConcurrencyPoint[]; preset: Preset }) {
  const { t } = useTranslation()
  const [hover, setHover] = useState<number | null>(null)
  const W = 1000, H = 160, padTop = 26, padBottom = 8
  const color = '#10D451'

  const { coords, line, area, max } = useMemo(() => {
    // Se pinta el PICO simultáneo, no las personas que pasaron: es la pregunta
    // que responde esta curva ("cuántos a la vez"). Las personas únicas de la
    // franja van en la lectura del puntero, siempre >= el pico.
    const vals = points.map((p) => p.peak)
    const mx = Math.max(1, ...vals)
    const n = points.length
    const xAt = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W)
    const yAt = (v: number) => H - padBottom - (v / mx) * (H - padTop - padBottom)
    const cs = points.map((p, i) => ({ x: xAt(i), y: yAt(p.peak) }))
    const ln = smoothLine(cs)
    const first = cs[0], last = cs[cs.length - 1]
    return { coords: cs, line: ln, area: `${ln} L ${last.x.toFixed(1)} ${H} L ${first.x.toFixed(1)} ${H} Z`, max: mx }
  }, [points])

  const hp = hover != null ? points[hover] : null
  const hc = hover != null ? coords[hover] : null
  const tipBelow = hc ? hc.y / H < 0.32 : false

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full h-52">
        <defs>
          <linearGradient id="traffic-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.16" />
            <stop offset="60%" stopColor={color} stopOpacity="0.04" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <clipPath id="traffic-clip">
            <motion.rect x="0" y="0" height={H} initial={{ width: 0 }} animate={{ width: W }} transition={{ duration: 0.7 }} />
          </clipPath>
        </defs>
        <g clipPath="url(#traffic-clip)">
          <path d={area} fill="url(#traffic-grad)" />
          <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"
            strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {hc && (
          <line x1={hc.x} y1={0} x2={hc.x} y2={H} stroke={color} strokeOpacity="0.3"
            strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        {/* Zonas de puntero: una por punto, invisibles. */}
        {coords.map((c, i) => (
          <rect
            key={i}
            x={i === 0 ? 0 : (c.x + coords[i - 1].x) / 2}
            y={0}
            width={
              coords.length === 1 ? W
                : i === coords.length - 1 ? W - (c.x + coords[i - 1].x) / 2
                : (coords[i + 1].x - (i === 0 ? 0 : coords[i - 1].x)) / 2
            }
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {/* Lectura del punto */}
      {hp && hc && (
        <div
          className="pointer-events-none absolute z-10 rounded-xl border border-line bg-surface px-3 py-2 shadow-card-hover"
          style={{
            left: `${(hc.x / W) * 100}%`,
            top: tipBelow ? `${(hc.y / H) * 100 + 8}%` : undefined,
            bottom: tipBelow ? undefined : `${100 - (hc.y / H) * 100 + 6}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="text-[11px] text-text-muted whitespace-nowrap">{fmtBucket(hp.bucket, preset)}</div>
          <div className="text-[13px] font-semibold tabular-nums text-text whitespace-nowrap">
            {t('admin.traffic.chart_peak', { n: fmtInt(hp.peak) })}
          </div>
          <div className="text-[11px] text-text-subtle whitespace-nowrap">
            {t('admin.traffic.chart_unique', { n: fmtInt(hp.users) })} · {fmtDuration(hp.activeMs)}
          </div>
        </div>
      )}

      {/* Ejes mínimos: extremos del rango y el techo de la escala. */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-text-subtle tabular-nums">
        <span>{points.length > 0 ? fmtBucket(points[0].bucket, preset) : ''}</span>
        <span>{t('admin.traffic.chart_max', { n: fmtInt(max) })}</span>
        <span>{points.length > 0 ? fmtBucket(points[points.length - 1].bucket, preset) : ''}</span>
      </div>
    </div>
  )
}
