import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Globe2, ClipboardCheck, ArrowRight, Map, Star, MessageSquare, GaugeCircle, PhoneCall, HeartHandshake, Phone, LayoutGrid } from 'lucide-react'
import FeedbackPanel from './FeedbackPanel'
import { TrainerFeedbackPanel } from './TrainerFeedbackPanel'
import SimulationFeedbackPanel from './SimulationFeedbackPanel'
import { tint } from './progress/ProgressChrome'
import { cn } from '@/lib/cn'

type ProgressView = 'worlds' | 'modules' | 'simulations'

// Vista unificada de "Progreso": primero se elige qué progreso ver (Mundos o
// Módulos) y solo entonces se monta el panel correspondiente — así no se
// consulta ningún dato antes de la selección. La elección vive en la URL
// (?view=worlds|modules) para que atrás/adelante y los deep-links funcionen.
export default function ProgressHub() {
  const [searchParams, setSearchParams] = useSearchParams()

  const raw = searchParams.get('view')
  const view: ProgressView | null =
    raw === 'worlds' || raw === 'modules' || raw === 'simulations' ? raw : null

  const select = useCallback((v: ProgressView) => {
    const next = new URLSearchParams(searchParams)
    next.set('view', v)
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const goBack = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('view')
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  if (view === 'worlds') {
    return (
      <div>
        <ViewTabs current="worlds" onSelect={select} onBack={goBack} />
        <FeedbackPanel />
      </div>
    )
  }

  if (view === 'modules') {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
        <ViewTabs current="modules" onSelect={select} onBack={goBack} />
        <div className="flex-1 overflow-hidden">
          <TrainerFeedbackPanel />
        </div>
      </div>
    )
  }

  if (view === 'simulations') {
    return (
      <div>
        <ViewTabs current="simulations" onSelect={select} onBack={goBack} />
        <SimulationFeedbackPanel />
      </div>
    )
  }

  return <ProgressChooser onSelect={select} />
}

/* ── Pestañas superiores: saltar directo entre las 3 vistas ── */

const VIEW_TABS: Array<{ key: ProgressView; icon: typeof Globe2; labelKey: string; fallback: string; accent: string }> = [
  { key: 'modules', icon: ClipboardCheck, labelKey: 'admin.progress_hub.modules_tab', fallback: 'Módulos', accent: 'rgb(var(--brand-magenta))' },
  { key: 'worlds', icon: Globe2, labelKey: 'admin.progress_hub.worlds_tab', fallback: 'Mundos', accent: 'rgb(var(--brand-green))' },
  { key: 'simulations', icon: PhoneCall, labelKey: 'admin.progress_hub.sim_tab', fallback: 'Simulaciones', accent: 'rgb(var(--brand-cyan, 6 182 212))' },
]

function ViewTabs({ current, onSelect, onBack }: { current: ProgressView; onSelect: (v: ProgressView) => void; onBack: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 sm:gap-3 px-3 sm:px-6 py-2.5 border-b border-line bg-bg/85 backdrop-blur shrink-0">
      <button
        onClick={onBack}
        title={t('admin.progress_hub.back', 'Cambiar vista')}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line text-text-muted hover:text-text hover:border-[rgb(var(--brand-green))]/40 transition-colors"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
      <div className="flex items-center gap-1 rounded-2xl border border-line bg-subtle/50 p-1 overflow-x-auto">
        {VIEW_TABS.map((tab) => {
          const active = tab.key === current
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => !active && onSelect(tab.key)}
              className={cn(
                'inline-flex items-center gap-2 rounded-xl px-3 sm:px-4 py-1.5 text-[12.5px] font-semibold whitespace-nowrap transition-all',
                active ? 'bg-surface shadow-sm text-text' : 'text-text-muted hover:text-text',
              )}
              style={active ? { color: tab.accent } : undefined}
            >
              <Icon className="h-4 w-4" style={active ? { color: tab.accent } : undefined} />
              {t(tab.labelKey, tab.fallback)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Selector inicial: dos tarjetas grandes, sin datos cargados ── */

function ProgressChooser({ onSelect }: { onSelect: (v: ProgressView) => void }) {
  const { t } = useTranslation()

  const cards: Array<{
    key: ProgressView
    title: string
    desc: string
    Icon: typeof Globe2
    accent: string // color base rgb() para glow/acento
    bullets: Array<{ Icon: typeof Star; text: string }>
  }> = [
    {
      key: 'modules',
      title: t('admin.progress_hub.modules_title', 'Progreso de Módulos'),
      desc: t('admin.progress_hub.modules_desc', 'Entregas de actividades de los módulos pendientes de revisión, con detalle de respuestas y retroalimentación.'),
      Icon: ClipboardCheck,
      accent: 'rgb(var(--brand-magenta))',
      bullets: [
        { Icon: ClipboardCheck, text: t('admin.progress_hub.modules_b1', 'Quizzes, juegos y videos entregados') },
        { Icon: GaugeCircle, text: t('admin.progress_hub.modules_b2', 'Nota y tiempo activo por módulo') },
        { Icon: MessageSquare, text: t('admin.progress_hub.modules_b3', 'Enviar retroalimentación al aprendiz') },
      ],
    },
    {
      key: 'worlds',
      title: t('admin.progress_hub.worlds_title', 'Progreso de Mundos'),
      desc: t('admin.progress_hub.worlds_desc', 'Avance de los aprendices en los mundos gamificados: niveles completados, estrellas y estado de riesgo.'),
      Icon: Globe2,
      accent: 'rgb(var(--brand-green))',
      bullets: [
        { Icon: Map, text: t('admin.progress_hub.worlds_b1', 'Niveles y mundos completados') },
        { Icon: Star, text: t('admin.progress_hub.worlds_b2', 'Estrellas y desempeño promedio') },
        { Icon: GaugeCircle, text: t('admin.progress_hub.worlds_b3', 'Aprendices en riesgo de un vistazo') },
      ],
    },
    {
      key: 'simulations',
      title: t('admin.progress_hub.sim_title', 'Progreso de Simulaciones'),
      desc: t('admin.progress_hub.sim_desc', 'Desempeño en los simuladores de práctica: puntaje, empatía, checklist y resolución de la llamada.'),
      Icon: PhoneCall,
      accent: 'rgb(var(--brand-cyan, 6 182 212))',
      bullets: [
        { Icon: Phone, text: t('admin.progress_hub.sim_b1', 'Intentos y escenarios practicados') },
        { Icon: HeartHandshake, text: t('admin.progress_hub.sim_b2', 'Empatía, checklist y puntaje promedio') },
        { Icon: GaugeCircle, text: t('admin.progress_hub.sim_b3', 'Tasa de resolución y feedback de IA') },
      ],
    },
  ]

  return (
    <div className="relative min-h-[calc(100vh-3.5rem)] md:min-h-screen overflow-hidden flex items-center justify-center p-4 sm:p-8">
      {/* Orbes de fondo, muy sutiles, con los colores corporativos */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-32 -left-32 h-96 w-96 rounded-full blur-3xl opacity-[0.10]"
          style={{ background: 'rgb(var(--brand-green))' }}
        />
        <div
          className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full blur-3xl opacity-[0.08]"
          style={{ background: 'rgb(var(--brand-magenta))' }}
        />
      </div>

      <div className="relative w-full max-w-5xl">
        {/* Encabezado */}
        <div className="animate-rise text-center mb-8 sm:mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 mb-4 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'rgb(var(--brand-green))' }} />
            {t('admin.progress_hub.badge', 'Personas · Progreso')}
          </div>
          <h1 className="text-[24px] sm:text-[32px] font-bold text-text tracking-tight mb-2">
            {t('admin.progress_hub.title', '¿Qué progreso quieres revisar?')}
          </h1>
          <p className="text-[13px] sm:text-[14px] text-text-muted max-w-xl mx-auto">
            {t('admin.progress_hub.subtitle', 'Elige una vista para cargar los datos. Puedes cambiar de vista en cualquier momento.')}
          </p>
        </div>

        {/* Tarjetas (entrada 100% CSS → nunca se quedan invisibles) */}
        <div className="rise-stagger grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {cards.map((card, i) => (
            <button
              key={card.key}
              onClick={() => onSelect(card.key)}
              className="group relative flex flex-col text-left rounded-3xl border border-line bg-surface p-6 sm:p-7 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-offset-2 transition-[transform,box-shadow] duration-300 hover:-translate-y-2 active:scale-[0.985] hover:shadow-card-hover"
            >
              {/* Barra de acento superior */}
              <div aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${card.accent}, transparent)` }} />
              {/* Glow que se intensifica al pasar el mouse */}
              <div aria-hidden className="absolute -top-20 -right-20 h-48 w-48 rounded-full blur-3xl opacity-[0.08] group-hover:opacity-20 transition-opacity duration-500" style={{ background: card.accent }} />
              {/* Borde acentuado al hover */}
              <div aria-hidden className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" style={{ boxShadow: `inset 0 0 0 1.5px ${tint(card.accent, 45)}` }} />

              {/* Número de orden (refuerza el flujo Módulos → Mundos → Simulaciones) */}
              <span
                className="absolute top-5 right-5 grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold tabular-nums"
                style={{ background: tint(card.accent, 12), color: card.accent }}
              >
                {i + 1}
              </span>

              <div className="relative flex flex-col flex-1">
                <div
                  className="h-14 w-14 rounded-2xl flex items-center justify-center mb-5 text-white shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3"
                  style={{ background: `linear-gradient(135deg, ${card.accent}, color-mix(in srgb, ${card.accent} 72%, #000))`, boxShadow: `0 10px 26px -10px ${tint(card.accent, 60)}` }}
                >
                  <card.Icon className="h-7 w-7" />
                </div>

                <h2 className="text-[17px] sm:text-[19px] font-bold text-text mb-1.5 tracking-tight">{card.title}</h2>
                <p className="text-[12.5px] sm:text-[13px] text-text-muted leading-relaxed mb-5">{card.desc}</p>

                <ul className="space-y-2 mb-6">
                  {card.bullets.map((b, j) => (
                    <li key={j} className="flex items-center gap-2.5 text-[12px] text-text-muted">
                      <span className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0" style={{ background: tint(card.accent, 10), color: card.accent }}>
                        <b.Icon className="h-3 w-3" />
                      </span>
                      {b.text}
                    </li>
                  ))}
                </ul>

                <span className="mt-auto inline-flex items-center gap-2 text-[13px] font-semibold" style={{ color: card.accent }}>
                  {t('admin.progress_hub.open', 'Ver progreso')}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Nota de privacidad de datos: nada se consulta hasta elegir */}
        <p className="animate-rise text-center text-[11px] text-text-subtle mt-8">
          {t('admin.progress_hub.hint', 'Los datos se cargan únicamente al seleccionar una vista.')}
        </p>
      </div>
    </div>
  )
}
