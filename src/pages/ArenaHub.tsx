import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Trophy } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { FadeIn } from '@/components/ui/motion'
import { stripMarkdown } from '@/components/ui/RichText'

interface Quiz {
  id: string
  title: string
  description: string | null
  theme_icon: string
  theme_color: string
  theme_type: string
  xp_per_question: number
  status: 'draft' | 'published'
  steps: unknown[]
}

export default function ArenaHub() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { campaignId } = useAuth()
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let query = supabase
      .from('arena_quizzes')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false })

    if (campaignId) query = query.eq('campaign_id', campaignId)

    query.then(({ data, error }) => {
      if (error && error.code !== '42P01') console.error('arena_quizzes:', error)
      setQuizzes((data ?? []).map(q => ({ ...q, status: q.status as 'draft' | 'published', steps: Array.isArray(q.steps) ? q.steps : [] })))
      setLoading(false)
    })
  }, [campaignId])

  return (
    <>
      <style>{`
        @keyframes hub-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes skel { 0%,100% { opacity:.45; } 50% { opacity:.8; } }
        .ah-card { animation: hub-in .32s cubic-bezier(0.16,1,0.3,1) both; }
        .ah-card:nth-child(2) { animation-delay:.06s; }
        .ah-card:nth-child(3) { animation-delay:.12s; }
        .ah-card:nth-child(4) { animation-delay:.18s; }
        .ah-card:nth-child(5) { animation-delay:.24s; }
        .ah-skel { animation: skel 1.4s ease infinite; }
      `}</style>

      <div style={{ minHeight: '100vh', background: 'rgb(var(--bg))', fontFamily: 'inherit', overflowX: 'hidden' }}>
        {/* Back bar */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid rgb(var(--line))', background: 'rgb(var(--surface))' }}>
          <button
            onClick={() => navigate('/dashboard')}
            style={{ background: 'none', border: 'none', color: 'rgb(var(--text-muted))', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6, padding: 0, fontFamily: 'inherit' }}
          >
            {t('arena.back_dashboard')}
          </button>
        </div>

        <div style={{ maxWidth: 820, margin: '0 auto', padding: '44px 24px' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 36 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, background: 'rgb(var(--subtle))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.9rem',
              border: '1px solid rgb(var(--line))',
            }}>⚔️</div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.7rem', fontWeight: 700, color: 'rgb(var(--text))', lineHeight: 1.2 }}>{t('arena.title')}</h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.83rem', color: 'rgb(var(--text-muted))' }}>
                {t('arena.subtitle')}
              </p>
            </div>
          </div>

          {/* Skeleton */}
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px),1fr))', gap: 16 }}>
              {[...Array(3)].map((_, i) => (
                <div key={i} className="ah-skel" style={{ height: 180, borderRadius: 16, background: 'rgb(var(--subtle))' }} />
              ))}
            </div>
          ) : quizzes.length === 0 ? (
            /* Empty state */
            <div style={{
              textAlign: 'center', padding: '80px 24px',
              background: 'rgb(var(--surface))', borderRadius: 20,
              border: '1px dashed rgb(var(--line))',
            }}>
              <Trophy size={40} style={{ color: 'rgb(var(--text-subtle))', marginBottom: 16 }} />
              <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'rgb(var(--text))' }}>
                {t('arena.empty_title')}
              </h2>
              <p style={{ margin: '8px 0 0', fontSize: '0.83rem', color: 'rgb(var(--text-muted))' }}>
                {t('arena.empty_sub')}
              </p>
            </div>
          ) : (
            /* Cards grid */
            <FadeIn style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px),1fr))', gap: 16 }} y={16}>
              {quizzes.map(q => (
                <div
                  key={q.id}
                  className="ah-card"
                  style={{
                    background: 'rgb(var(--surface))',
                    border: '1px solid rgb(var(--line))',
                    borderRadius: 18, padding: '20px',
                    display: 'flex', flexDirection: 'column', gap: 14,
                    transition: 'transform .15s, box-shadow .15s',
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.transform = 'translateY(-2px)'
                    el.style.boxShadow = `0 8px 28px ${q.theme_color}22`
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.transform = ''
                    el.style.boxShadow = ''
                  }}
                >
                  {/* Top */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <div style={{
                      width: 52, height: 52, borderRadius: 14, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.75rem',
                      background: `${q.theme_color}18`,
                      border: `1px solid ${q.theme_color}28`,
                    }}>
                      {q.theme_icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'rgb(var(--text))', lineHeight: 1.3 }}>
                        {q.title}
                      </h3>
                      {q.description && (
                        <p style={{
                          margin: '5px 0 0', fontSize: '0.77rem', color: 'rgb(var(--text-muted))',
                          lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box',
                          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        }}>
                          {stripMarkdown(q.description)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Tags */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: '0.68rem', padding: '2px 10px', borderRadius: 20,
                      background: `${q.theme_color}14`, color: q.theme_color, fontWeight: 500,
                    }}>
                      {t(`themes.${q.theme_type}`, q.theme_type)}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: 'rgb(var(--text-muted))' }}>
                      {t('arena.questions', { count: q.steps.length })}
                    </span>
                    <span style={{ fontSize: '0.68rem', color: q.theme_color, fontWeight: 600 }}>
                      {t('arena.xp', { xp: q.steps.length * q.xp_per_question })}
                    </span>
                  </div>

                  {/* CTA */}
                  <button
                    onClick={() => navigate(`/arena/${q.id}`)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      padding: '11px 0',
                      background: `${q.theme_color}14`,
                      border: `1px solid ${q.theme_color}35`,
                      borderRadius: 12,
                      color: q.theme_color, fontSize: '0.85rem', fontWeight: 600,
                      cursor: 'pointer', transition: 'background .15s',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${q.theme_color}28` }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `${q.theme_color}14` }}
                  >
                    {t('arena.start_challenge')} <ChevronRight size={15} />
                  </button>
                </div>
              ))}
            </FadeIn>
          )}
        </div>
      </div>
    </>
  )
}
