import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Upload, UserCheck, UserPlus, UserMinus, Clock, FileSpreadsheet, MapPin, Building2, Layers, ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { readAllPages } from '@/services/readAllPages'
import { getSyncRuns, type HrSyncRun } from '@/services/hrSync.service'
import { countryLabelWithFlag } from '@/lib/countries'
import { FadeIn } from '@/components/ui/motion'

interface Person {
  id: string
  country: string | null
  operation_id: string | null
  area_id: string | null
  created_at: string
  is_active: boolean | null
  onboarded: boolean | null
}

interface Row { key: string; label: string; count: number; missing?: boolean }

/** Meses que se muestran en «Altas por mes». */
const MONTHS = 6
/** Filas por reparto antes de agrupar el resto en «Otros». */
const TOP = 8

/**
 * Inicio de Recursos Humanos: un resumen de la GENTE, no de la formación.
 * RH carga la base de Talento Humano cada mes o quincena para dar de alta a
 * los que llegan; lo que le sirve ver es cuántos hay, quién llegó, quién aún
 * no ha entrado y cómo se reparten por país, CR y área (incluidos los que
 * vienen sin el dato, que es lo que hay que corregir en la próxima base).
 * Avance, notas y certificados no son suyos y no aparecen.
 */
export default function RhDashboard() {
  const { t, i18n } = useTranslation()
  const [people, setPeople] = useState<Person[] | null>(null)
  const [unitName, setUnitName] = useState<Map<string, string>>(new Map())
  const [runs, setRuns] = useState<HrSyncRun[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([
      readAllPages<Person>((from, to) =>
        supabase
          .from('profiles')
          .select('id, country, operation_id, area_id, created_at, is_active, onboarded')
          .eq('role', 'learner')
          .eq('is_client', false)
          .order('id')
          .range(from, to),
      ),
      supabase.from('org_units').select('id, name'),
      getSyncRuns(5).catch(() => [] as HrSyncRun[]),
    ])
      .then(([p, u, r]) => {
        if (!alive) return
        setPeople(p.data)
        setUnitName(new Map(((u.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])))
        setRuns(r)
      })
      .catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [])

  const summary = useMemo(() => {
    if (!people) return null
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    // Sin la columna `is_active` todos cuentan como activos (null ≠ de baja).
    const active = people.filter((p) => p.is_active !== false)

    // Altas por mes: los últimos MONTHS meses, el actual incluido.
    const months: { key: string; label: string; count: number }[] = []
    for (let i = MONTHS - 1; i >= 0; i--) {
      const d = new Date(monthStart.getFullYear(), monthStart.getMonth() - i, 1)
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleDateString(i18n.language, { month: 'short' }),
        count: 0,
      })
    }
    const byMonth = new Map(months.map((m) => [m.key, m]))
    for (const p of people) {
      const d = new Date(p.created_at)
      const m = byMonth.get(`${d.getFullYear()}-${d.getMonth()}`)
      if (m) m.count++
    }

    // Reparto de la gente activa. «Sin dato» va siempre al final y resaltado.
    const spread = (pick: (p: Person) => string | null, name: (k: string) => string, missingLabel: string): Row[] => {
      const counts = new Map<string, number>()
      let missing = 0
      for (const p of active) {
        const k = pick(p)
        if (!k) { missing++; continue }
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
      const rows: Row[] = sorted.slice(0, TOP).map(([k, count]) => ({ key: k, label: name(k), count }))
      const rest = sorted.slice(TOP).reduce((n, [, c]) => n + c, 0)
      if (rest > 0) rows.push({ key: '__rest', label: t('admin.rh_home.others', { count: sorted.length - TOP }), count: rest })
      if (missing > 0) rows.push({ key: '__missing', label: missingLabel, count: missing, missing: true })
      return rows
    }
    const unit = (k: string) => unitName.get(k) ?? '—'

    return {
      active: active.length,
      newThisMonth: people.filter((p) => new Date(p.created_at) >= monthStart).length,
      notEntered: active.filter((p) => p.onboarded === false).length,
      inactive: people.length - active.length,
      months,
      byCountry: spread((p) => p.country, (k) => countryLabelWithFlag(k) ?? k, t('admin.rh_home.no_country')),
      byCr: spread((p) => p.operation_id, unit, t('admin.rh_home.no_cr')),
      byArea: spread((p) => p.area_id, unit, t('admin.rh_home.no_area')),
    }
  }, [people, unitName, t, i18n.language])

  const fmt = (n: number) => n.toLocaleString(i18n.language)
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })

  const kpis = summary
    ? [
        { key: 'active', label: t('admin.rh_home.stat_active'), value: summary.active, icon: UserCheck, color: '#10D451' },
        { key: 'new', label: t('admin.rh_home.stat_new_month'), value: summary.newThisMonth, icon: UserPlus, color: '#B33D9E' },
        { key: 'pending', label: t('admin.rh_home.stat_not_entered'), value: summary.notEntered, icon: Clock, color: '#d97706', hint: t('admin.rh_home.stat_not_entered_hint') },
        { key: 'inactive', label: t('admin.rh_home.stat_inactive'), value: summary.inactive, icon: UserMinus, color: '#64748b' },
      ]
    : []
  const maxMonth = summary ? Math.max(1, ...summary.months.map((m) => m.count)) : 1

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">{t('admin.rh_home.title')}</h1>
      <p className="text-text-muted text-[13px] mb-6 sm:mb-8">{t('admin.rh_home.subtitle')}</p>

      {/* La única acción del rol, arriba y grande. Abre el asistente directo en
          la lista de personas (?th=1), sin un clic de peaje. */}
      <FadeIn
        className="rounded-2xl p-4 sm:p-6 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
        y={12}
        style={{ background: 'rgba(16,212,81,0.07)', border: '1px solid rgba(16,212,81,0.22)' }}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(16,212,81,0.14)' }}>
            <FileSpreadsheet className="h-5 w-5" style={{ color: '#10D451' }} />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-text">{t('admin.rh_home.upload_title')}</div>
            <div className="text-[12.5px] text-text-muted leading-relaxed mt-0.5">{t('admin.rh_home.upload_desc')}</div>
          </div>
        </div>
        <Link
          to="/admin/users?th=1"
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-black self-start sm:shrink-0 min-h-[44px]"
          style={{ background: '#10D451' }}
        >
          <Upload className="h-4 w-4" />
          {t('admin.hr.button_rh')}
        </Link>
      </FadeIn>

      {failed ? (
        <p className="rounded-2xl border border-line bg-surface p-5 text-[13px] text-text-muted">{t('admin.rh_home.load_error')}</p>
      ) : !summary ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-2xl animate-pulse bg-subtle" />)}
          </div>
          <div className="h-56 rounded-2xl animate-pulse bg-subtle" />
        </div>
      ) : (
        <>
          {/* Cifras */}
          <FadeIn className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-6" y={12}>
            {kpis.map((c) => (
              <div key={c.key} className="rounded-2xl p-3 sm:p-5 bg-surface border border-line">
                <c.icon className="h-4 w-4 sm:h-5 sm:w-5 mb-2 sm:mb-3" style={{ color: c.color }} />
                <div className="text-[20px] sm:text-[28px] font-semibold text-text tabular-nums">{fmt(c.value)}</div>
                <div className="text-[11px] sm:text-[12px] text-text-muted mt-1 leading-tight">{c.label}</div>
                {c.hint && <div className="text-[10.5px] text-text-subtle mt-0.5 leading-tight">{c.hint}</div>}
              </div>
            ))}
          </FadeIn>

          {/* Altas por mes + últimas cargas */}
          <FadeIn className="grid lg:grid-cols-2 gap-3 sm:gap-4 mb-6" y={14}>
            <section className="rounded-2xl bg-surface border border-line p-4 sm:p-5">
              <h2 className="text-[14px] font-semibold text-text">{t('admin.rh_home.by_month_title')}</h2>
              <p className="text-[12px] text-text-muted mb-4">{t('admin.rh_home.by_month_desc')}</p>
              <div className="flex items-end gap-2 sm:gap-3 h-36">
                {summary.months.map((m) => (
                  <div key={m.key} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full min-w-0">
                    <span className="text-[11px] font-semibold text-text tabular-nums">{m.count}</span>
                    <div
                      className={m.count ? 'w-full max-w-[44px] rounded-t-md' : 'w-full max-w-[44px] rounded-t-md bg-subtle'}
                      style={{ height: `${Math.max(4, (m.count / maxMonth) * 100)}%`, background: m.count ? '#10D451' : undefined }}
                    />
                    <span className="text-[11px] text-text-muted capitalize truncate">{m.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl bg-surface border border-line p-4 sm:p-5">
              <h2 className="text-[14px] font-semibold text-text">{t('admin.rh_home.runs_title')}</h2>
              <p className="text-[12px] text-text-muted mb-3">{t('admin.rh_home.runs_desc')}</p>
              {runs.length === 0 ? (
                <p className="text-[13px] text-text-subtle py-6 text-center">{t('admin.rh_home.no_uploads')}</p>
              ) : (
                <ul className="divide-y divide-line">
                  {runs.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="text-[13px] text-text truncate">{r.file_name || t('admin.rh_home.run_no_file')}</div>
                        <div className="text-[11.5px] text-text-muted truncate">
                          {fmtDate(r.created_at)}{r.actor_name ? ` · ${r.actor_name}` : ''}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-lg px-2 py-1 text-[11.5px] font-semibold tabular-nums" style={{ background: 'rgba(16,212,81,0.12)', color: '#16a34a' }}>
                        {t('admin.rh_home.run_created', { count: r.created_count })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </FadeIn>

          {/* Reparto de la gente activa */}
          <FadeIn className="grid lg:grid-cols-3 gap-3 sm:gap-4" y={16}>
            <Spread title={t('admin.rh_home.by_country')} icon={MapPin} rows={summary.byCountry} total={summary.active} fmt={fmt} />
            <Spread title={t('admin.rh_home.by_cr')} icon={Building2} rows={summary.byCr} total={summary.active} fmt={fmt} />
            <Spread title={t('admin.rh_home.by_area')} icon={Layers} rows={summary.byArea} total={summary.active} fmt={fmt} />
          </FadeIn>

          <div className="mt-6 flex justify-end">
            <Link to="/admin/users" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-text-muted hover:text-text transition-colors">
              {t('admin.rh_home.see_people')} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

function Spread({ title, icon: Icon, rows, total, fmt }: {
  title: string
  icon: typeof MapPin
  rows: Row[]
  total: number
  fmt: (n: number) => string
}) {
  return (
    <section className="rounded-2xl bg-surface border border-line p-4 sm:p-5 min-w-0">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text mb-3">
        <Icon className="h-4 w-4 text-text-muted" /> {title}
      </h2>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const pct = total ? (r.count / total) * 100 : 0
          return (
            <li key={r.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
                <span className={r.missing ? 'truncate font-medium text-amber-500' : 'truncate text-text'}>{r.label}</span>
                <span className="shrink-0 tabular-nums text-text-muted">{fmt(r.count)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-subtle overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, pct)}%`, background: r.missing ? '#f59e0b' : '#B33D9E' }} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
