import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderOpen, Users, Upload, BookOpen, ArrowRight, Eye } from 'lucide-react'
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
<<<<<<< HEAD
  const { isSuperAdmin, campaignId } = useAuth()
=======
  const { isAdmin, campaignId } = useAuth()
>>>>>>> origin/main
  const { t } = useTranslation()
  const [stats, setStats] = useState<Stats>({ campaigns: 0, modules: 0, scenarios: 0, users: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [camps, mods, scens, users] = await Promise.all([
        supabase.from('campaigns').select('id', { count: 'exact', head: true }),
<<<<<<< HEAD
        isSuperAdmin
          ? supabase.from('modules').select('id', { count: 'exact', head: true })
          : supabase.from('modules').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId ?? ''),
        isSuperAdmin
=======
        isAdmin
          ? supabase.from('modules').select('id', { count: 'exact', head: true })
          : supabase.from('modules').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId ?? ''),
        isAdmin
>>>>>>> origin/main
          ? supabase.from('scenarios').select('id', { count: 'exact', head: true })
          : supabase.from('scenarios').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId ?? ''),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
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
<<<<<<< HEAD
  }, [isSuperAdmin, campaignId])
=======
  }, [isAdmin, campaignId])
>>>>>>> origin/main

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
      desc: 'Subir un archivo Word o Excel para agregar o actualizar módulos',
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
  ]

  return (
    <div className="p-8">
      <h1 className="text-[24px] font-bold text-text mb-1">{t('admin.dashboard.title')}</h1>
      <p className="text-text-muted text-[13px] mb-8">{t('admin.dashboard.subtitle')}</p>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-3 gap-4 mb-10">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 rounded-2xl animate-pulse bg-subtle" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4 mb-10">
          {statCards.map((c) => (
            <Link
              key={c.label}
              to={c.to}
              className="rounded-2xl p-5 transition-all hover:scale-[1.02] bg-surface border border-line"
            >
              <c.icon className="h-5 w-5 mb-3" style={{ color: c.color }} />
              <div className="text-[28px] font-semibold text-text tabular-nums">{c.value}</div>
              <div className="text-[12px] text-text-muted mt-1">{c.label}</div>
            </Link>
          ))}
        </div>
      )}

      {/* Acceso rápido a módulos cargados */}
      {stats.modules > 0 && (
        <div
          className="rounded-2xl p-5 mb-6 flex items-center justify-between"
          style={{ background: 'rgba(0,194,40,0.06)', border: '1px solid rgba(0,194,40,0.15)' }}
        >
          <div className="flex items-center gap-3">
            <Eye className="h-5 w-5" style={{ color: '#00C228' }} />
            <div>
              <div className="text-[14px] font-medium text-text">
                {stats.modules} módulo{stats.modules !== 1 ? 's' : ''} cargado{stats.modules !== 1 ? 's' : ''}
              </div>
              <div className="text-[12px] text-text-muted">
                Podés ver cómo se verían en el sitio desde la sección de módulos
              </div>
            </div>
          </div>
          <Link
            to="/admin/modules"
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-medium transition-colors shrink-0"
            style={{ color: '#00C228', border: '1px solid rgba(0,194,40,0.25)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,194,40,0.08)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            Ver módulos <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Quick actions grid */}
      <div className="grid md:grid-cols-2 gap-4">
        {quickActions.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="group rounded-2xl p-5 flex items-start gap-4 transition-all hover:scale-[1.01] bg-surface border border-line"
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
