import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Upload, Users, UserCheck, UserPlus, UserMinus, BarChart3, ArrowRight, FileSpreadsheet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { getSyncRuns, type HrSyncRun } from '@/services/hrSync.service'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { FadeIn } from '@/components/ui/motion'

const MotionLink = motion(Link)

interface RhStats {
  active: number | null
  newThisMonth: number | null
  inactive: number | null
}

/** Cuenta aprendices de planta (sin clientes) con un filtro extra. `null` si la base no deja leer. */
async function countPeople(
  extra: (q: ReturnType<typeof base>) => ReturnType<typeof base>,
): Promise<number | null> {
  const { count, error } = await extra(base())
  return error ? null : (count ?? 0)
}
function base() {
  return supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'learner')
    .eq('is_client', false)
}

/**
 * Inicio de Recursos Humanos. Su trabajo en el sitio es uno solo —cargar la
 * base de Talento Humano cada mes o quincena para dar de alta a los que
 * llegan— y lo demás es LEER: cuánta gente hay y cómo va su formación. Por eso
 * no reusa el tablero del staff, que invita a crear módulos, CR y mundos.
 */
export default function RhDashboard() {
  const { t, i18n } = useTranslation()
  const reduce = useReducedMotion()
  const [stats, setStats] = useState<RhStats>({ active: null, newThisMonth: null, inactive: null })
  const [lastRun, setLastRun] = useState<HrSyncRun | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    Promise.all([
      // Sin la columna `is_active` todos cuentan como activos (null ≠ de baja).
      countPeople((q) => q.or('is_active.is.null,is_active.eq.true')),
      countPeople((q) => q.gte('created_at', monthStart.toISOString())),
      countPeople((q) => q.eq('is_active', false)),
      getSyncRuns(1).then((r) => r[0] ?? null).catch(() => null),
    ]).then(([active, newThisMonth, inactive, run]) => {
      if (!alive) return
      setStats({ active, newThisMonth, inactive })
      setLastRun(run)
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString(i18n.language))
  const statCards = [
    { key: 'active', label: t('admin.rh_home.stat_active'), value: fmt(stats.active), icon: UserCheck, color: '#10D451' },
    { key: 'new', label: t('admin.rh_home.stat_new_month'), value: fmt(stats.newThisMonth), icon: UserPlus, color: '#B33D9E' },
    { key: 'inactive', label: t('admin.rh_home.stat_inactive'), value: fmt(stats.inactive), icon: UserMinus, color: '#64748b' },
  ]

  const links = [
    {
      to: '/admin/users',
      icon: Users,
      color: '#B33D9E',
      title: t('admin.rh_home.people_title'),
      desc: t('admin.rh_home.people_desc'),
    },
    {
      to: '/admin/progress',
      icon: BarChart3,
      color: '#10D451',
      title: t('admin.rh_home.stats_title'),
      desc: t('admin.rh_home.stats_desc'),
    },
  ]

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
            <div className="text-[12px] text-text-subtle mt-1.5">
              {loading
                ? '…'
                : lastRun
                  ? t('admin.rh_home.last_upload', {
                      date: new Date(lastRun.created_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }),
                      count: lastRun.created_count,
                    })
                  : t('admin.rh_home.no_uploads')}
            </div>
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

      {/* Cifras de solo lectura */}
      {loading ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-8 sm:mb-10">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 sm:h-24 rounded-2xl animate-pulse bg-subtle" />
          ))}
        </div>
      ) : (
        <FadeIn className="grid grid-cols-3 gap-2 sm:gap-4 mb-8 sm:mb-10" y={12}>
          {statCards.map((c) => (
            <div key={c.key} className="rounded-2xl p-3 sm:p-5 bg-surface border border-line">
              <c.icon className="h-4 w-4 sm:h-5 sm:w-5 mb-2 sm:mb-3" style={{ color: c.color }} />
              <div className="text-[20px] sm:text-[28px] font-semibold text-text tabular-nums">{c.value}</div>
              <div className="text-[10px] sm:text-[12px] text-text-muted mt-1 leading-tight">{c.label}</div>
            </div>
          ))}
        </FadeIn>
      )}

      <FadeIn className="grid sm:grid-cols-2 gap-3 sm:gap-4" y={16}>
        {links.map((a) => (
          <MotionLink
            key={a.to}
            to={a.to}
            whileHover={reduce ? undefined : { y: -4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            className="group rounded-2xl p-4 sm:p-5 flex items-start gap-3 sm:gap-4 transition-[border-color,box-shadow] duration-300 ease-apple hover:border-primary hover:shadow-card-hover bg-surface border border-line"
          >
            <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `color-mix(in srgb, ${a.color} 12%, transparent)` }}>
              <a.icon className="h-5 w-5" style={{ color: a.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-text mb-1">{a.title}</div>
              <div className="text-[12px] text-text-muted leading-relaxed">{a.desc}</div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-muted shrink-0 mt-0.5 group-hover:translate-x-0.5 transition-transform" />
          </MotionLink>
        ))}
      </FadeIn>
    </div>
  )
}
