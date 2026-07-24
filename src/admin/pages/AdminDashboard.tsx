import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FolderOpen, Users, Upload, BookOpen, ArrowRight, Eye, Target, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { useAuth } from '@/hooks/useAuth'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { FadeIn } from '@/components/ui/motion'

const MotionLink = motion(Link)

interface Stats {
  campaigns: number
  modules: number
  scenarios: number
  users: number
}

export default function AdminDashboard() {
  const { isSuperAdmin, campaignId, user } = useAuth()
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const [stats, setStats] = useState<Stats>({ campaigns: 0, modules: 0, scenarios: 0, users: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // El capacitador cuenta sobre TODAS sus campañas (casa + colaboraciones).
      const camps = await getAccessibleCampaigns({
        isSuperAdmin,
        homeCampaignId: campaignId,
        userId: user?.id ?? null,
      }).catch(() => [] as { id: string }[])
      const ids = camps.map((c) => c.id)
      // Sin campañas accesibles: nada que contar (evita filtros vacíos).
      const scope = ids.length ? ids : ['']

      const [modsCount, scensCount, usersCount] = await Promise.all([
        isSuperAdmin
          ? supabase.from('modules').select('id', { count: 'exact', head: true })
          : supabase.from('modules').select('id', { count: 'exact', head: true }).in('campaign_id', scope),
        isSuperAdmin
          ? supabase.from('scenarios').select('id', { count: 'exact', head: true })
          : supabase.from('scenarios').select('id', { count: 'exact', head: true }).in('campaign_id', scope),
        // El capacitador solo cuenta las personas de sus campañas y nunca a superadmins.
        isSuperAdmin
          ? supabase.from('profiles').select('id', { count: 'exact', head: true })
          : supabase.from('profiles').select('id', { count: 'exact', head: true }).in('campaign_id', scope).neq('role', 'superadmin'),
      ])
      setStats({
        campaigns: isSuperAdmin
          ? (await supabase.from('campaigns').select('id', { count: 'exact', head: true })).count ?? 0
          : ids.length,
        modules: modsCount.count ?? 0,
        scenarios: scensCount.count ?? 0,
        users: usersCount.count ?? 0,
      })
      setLoading(false)
    }
    load()
  }, [isSuperAdmin, campaignId, user?.id])

  const statCards = [
    { label: t('admin.dashboard.stat_campaigns'), value: stats.campaigns, icon: FolderOpen, to: '/admin/campaigns', color: '#10D451' },
    { label: t('admin.dashboard.stat_modules'), value: stats.modules, icon: BookOpen, to: '/admin/modules', color: '#10D451' },
    { label: t('admin.dashboard.stat_users'), value: stats.users, icon: Users, to: '/admin/users', color: '#B33D9E' },
  ]

  const quickActions = [
    {
      to: '/admin/modules',
      icon: BookOpen,
      iconColor: '#10D451',
      iconBg: 'rgba(16,212,81,0.10)',
      title: t('admin.dashboard.mod_title'),
      desc: t('admin.dashboard.mod_desc'),
      cta: t('admin.dashboard.mod_cta'),
    },
    {
      to: '/admin/import',
      icon: Upload,
      iconColor: '#10D451',
      iconBg: 'rgba(16,212,81,0.08)',
      title: t('admin.dashboard.import_title'),
      desc: t('admin.dashboard.import_desc'),
      cta: t('admin.dashboard.import_cta'),
    },
    {
      to: '/admin/campaigns',
      icon: FolderOpen,
      iconColor: '#f59e0b',
      iconBg: 'rgba(245,158,11,0.10)',
      title: t('admin.dashboard.camp_title'),
      desc: t('admin.dashboard.camp_desc'),
      cta: t('admin.dashboard.camp_cta'),
    },
    {
      to: '/admin/users',
      icon: Users,
      iconColor: '#B33D9E',
      iconBg: 'rgba(179,61,158,0.10)',
      title: t('admin.dashboard.users_title'),
      desc: t('admin.dashboard.users_desc'),
      cta: t('admin.dashboard.users_cta'),
    },
    {
      to: '/admin/missions',
      icon: Target,
      iconColor: '#10D451',
      iconBg: 'rgba(16,212,81,0.10)',
      title: t('admin.dashboard.missions_title'),
      desc: t('admin.dashboard.missions_desc'),
      cta: t('admin.dashboard.missions_cta'),
    },
    {
      to: '/admin/worlds',
      icon: Trophy,
      iconColor: '#10D451',
      iconBg: 'rgba(16,212,81,0.10)',
      title: t('admin.dashboard.worlds_title'),
      desc: t('admin.dashboard.worlds_desc'),
      cta: t('admin.dashboard.worlds_cta'),
    },
  ]

  return (
    <div className="p-4 sm:p-8">
      <h1 className="text-[20px] sm:text-[24px] font-bold text-text mb-1">
        {isSuperAdmin ? t('admin.dashboard.title') : t('admin.dashboard.title_capacitador')}
      </h1>
      <p className="text-text-muted text-[13px] mb-6 sm:mb-8">
        {isSuperAdmin ? t('admin.dashboard.subtitle') : t('admin.dashboard.subtitle_capacitador')}
      </p>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-8 sm:mb-10">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 sm:h-24 rounded-2xl animate-pulse bg-subtle" />
          ))}
        </div>
      ) : (
        <FadeIn className="grid grid-cols-3 gap-2 sm:gap-4 mb-8 sm:mb-10" y={12}>
          {statCards.map((c) => (
            <MotionLink
              key={c.to}
              to={c.to}
              whileHover={reduce ? undefined : { y: -4 }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
              className="rounded-2xl p-3 sm:p-5 transition-[border-color,box-shadow] duration-300 ease-apple hover:border-primary hover:shadow-card-hover bg-surface border border-line"
            >
              <c.icon className="h-4 w-4 sm:h-5 sm:w-5 mb-2 sm:mb-3" style={{ color: c.color }} />
              <div className="text-[20px] sm:text-[28px] font-semibold text-text tabular-nums">{c.value}</div>
              <div className="text-[10px] sm:text-[12px] text-text-muted mt-1 leading-tight">{c.label}</div>
            </MotionLink>
          ))}
        </FadeIn>
      )}

      {/* Acceso rápido a módulos cargados */}
      {stats.modules > 0 && (
        <div
          className="rounded-2xl p-4 sm:p-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          style={{ background: 'rgba(16,212,81,0.06)', border: '1px solid rgba(16,212,81,0.15)' }}
        >
          <div className="flex items-center gap-3">
            <Eye className="h-5 w-5 shrink-0" style={{ color: '#10D451' }} />
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-text">
                {stats.modules} módulo{stats.modules !== 1 ? 's' : ''} cargado{stats.modules !== 1 ? 's' : ''}
              </div>
              <div className="text-[12px] text-text-muted leading-relaxed">
                Puedes ver cómo se verían en el sitio desde la sección de módulos
              </div>
            </div>
          </div>
          <Link
            to="/admin/modules"
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors self-start sm:shrink-0 min-h-[44px]"
            style={{ color: '#10D451', border: '1px solid rgba(16,212,81,0.25)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(16,212,81,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            Ver módulos <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Quick actions grid */}
      {/* Ocultas del panel principal a pedido de Isa - siguen disponibles en el menú lateral */}
      <FadeIn className="grid sm:grid-cols-2 gap-3 sm:gap-4" y={16}>
        {quickActions.filter((a) => a.to !== '/admin/missions' && a.to !== '/admin/arena').map((a) => (
          <MotionLink
            key={a.to}
            to={a.to}
            whileHover={reduce ? undefined : { y: -4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            className="group rounded-2xl p-4 sm:p-5 flex items-start gap-3 sm:gap-4 transition-[border-color,box-shadow] duration-300 ease-apple hover:border-primary hover:shadow-card-hover bg-surface border border-line"
          >
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: a.iconBg }}
            >
              <a.icon className="h-5 w-5" style={{ color: a.iconColor }} />
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
