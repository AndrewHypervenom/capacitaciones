import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderOpen, Users, Upload, BookOpen, ArrowRight, Eye, Target, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

interface Stats {
  campaigns: number
  modules: number
  scenarios: number
  users: number
}

export default function AdminDashboard() {
  const { isSuperAdmin, campaignId } = useAuth()
  const { t } = useTranslation()
  const [stats, setStats] = useState<Stats>({ campaigns: 0, modules: 0, scenarios: 0, users: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [camps, mods, scens, users] = await Promise.all([
        isSuperAdmin
          ? supabase.from('campaigns').select('id', { count: 'exact', head: true })
          : supabase.from('campaigns').select('id', { count: 'exact', head: true }).eq('id', campaignId ?? ''),
        isSuperAdmin
          ? supabase.from('modules').select('id', { count: 'exact', head: true })
          : supabase.from('modules').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId ?? ''),
        isSuperAdmin
          ? supabase.from('scenarios').select('id', { count: 'exact', head: true })
          : supabase.from('scenarios').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId ?? ''),
        // El capacitador solo cuenta las personas de su campaña y nunca a superadmins.
        isSuperAdmin
          ? supabase.from('profiles').select('id', { count: 'exact', head: true })
          : supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId ?? '').neq('role', 'superadmin'),
      ])
      setStats({
        campaigns: camps.count ?? 0,
        modules: mods.count ?? 0,
        scenarios: scens.count ?? 0,
        users: users.count ?? 0,
      })
      setLoading(false)
    }
    load()
  }, [isSuperAdmin, campaignId])

  const statCards = [
    { label: t('admin.dashboard.stat_campaigns'), value: stats.campaigns, icon: FolderOpen, to: '/admin/campaigns', color: '#00C228' },
    { label: t('admin.dashboard.stat_modules'), value: stats.modules, icon: BookOpen, to: '/admin/modules', color: '#00C228' },
    { label: t('admin.dashboard.stat_users'), value: stats.users, icon: Users, to: '/admin/users', color: '#E11D74' },
  ]

  const quickActions = [
    {
      to: '/admin/modules',
      icon: BookOpen,
      iconColor: '#00C228',
      iconBg: 'rgba(0,194,40,0.10)',
      title: 'Módulos de aprendizaje',
      desc: 'Ver, editar y previsualizar los manuales cargados en la plataforma',
      cta: 'Ver módulos',
    },
    {
      to: '/admin/import',
      icon: Upload,
      iconColor: '#00C228',
      iconBg: 'rgba(0,194,40,0.08)',
      title: 'Importar contenido',
      desc: 'Subir un archivo Word, Excel o PDF para agregar o actualizar módulos',
      cta: 'Importar',
    },
    {
      to: '/admin/campaigns',
      icon: FolderOpen,
      iconColor: '#f59e0b',
      iconBg: 'rgba(245,158,11,0.10)',
      title: 'Campañas',
      desc: 'Gestionar las campañas de capacitación y su contenido asociado',
      cta: 'Ver campañas',
    },
    {
      to: '/admin/users',
      icon: Users,
      iconColor: '#E11D74',
      iconBg: 'rgba(225,29,116,0.10)',
      title: 'Usuarios',
      desc: 'Administrar roles, asignar campañas y controlar accesos',
      cta: 'Ver usuarios',
    },
    {
      to: '/admin/missions',
      icon: Target,
      iconColor: '#00C228',
      iconBg: 'rgba(0,194,40,0.10)',
      title: 'Learning Missions',
      desc: 'Completa simulaciones interactivas y gana XP por campaña',
      cta: 'Ver misiones',
    },
    {
      to: '/admin/worlds',
      icon: Trophy,
      iconColor: '#00C228',
      iconBg: 'rgba(0,194,40,0.10)',
      title: 'Mundos',
      desc: 'Mundos gamificados con regiones, niveles y quizzes por campaña',
      cta: 'Ver mundos',
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
        <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-8 sm:mb-10">
          {statCards.map((c) => (
            <Link
              key={c.label}
              to={c.to}
              className="rounded-2xl p-3 sm:p-5 transition-all hover:scale-[1.02] bg-surface border border-line"
            >
              <c.icon className="h-4 w-4 sm:h-5 sm:w-5 mb-2 sm:mb-3" style={{ color: c.color }} />
              <div className="text-[20px] sm:text-[28px] font-semibold text-text tabular-nums">{c.value}</div>
              <div className="text-[10px] sm:text-[12px] text-text-muted mt-1 leading-tight">{c.label}</div>
            </Link>
          ))}
        </div>
      )}

      {/* Acceso rápido a módulos cargados */}
      {stats.modules > 0 && (
        <div
          className="rounded-2xl p-4 sm:p-5 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          style={{ background: 'rgba(0,194,40,0.06)', border: '1px solid rgba(0,194,40,0.15)' }}
        >
          <div className="flex items-center gap-3">
            <Eye className="h-5 w-5 shrink-0" style={{ color: '#00C228' }} />
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-text">
                {stats.modules} módulo{stats.modules !== 1 ? 's' : ''} cargado{stats.modules !== 1 ? 's' : ''}
              </div>
              <div className="text-[12px] text-text-muted leading-relaxed">
                Podés ver cómo se verían en el sitio desde la sección de módulos
              </div>
            </div>
          </div>
          <Link
            to="/admin/modules"
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors self-start sm:shrink-0 min-h-[44px]"
            style={{ color: '#00C228', border: '1px solid rgba(0,194,40,0.25)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            Ver módulos <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Quick actions grid */}
      {/* Ocultas del panel principal a pedido de Isa - siguen disponibles en el menú lateral */}
      <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
        {quickActions.filter((a) => a.to !== '/admin/missions' && a.to !== '/admin/arena').map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="group rounded-2xl p-4 sm:p-5 flex items-start gap-3 sm:gap-4 transition-all hover:scale-[1.01] bg-surface border border-line"
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
          </Link>
        ))}
      </div>
    </div>
  )
}
