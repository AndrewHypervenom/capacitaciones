import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Globe2, ClipboardCheck, ArrowRight, ArrowLeft, Map, Star, MessageSquare, GaugeCircle } from 'lucide-react'
import FeedbackPanel from './FeedbackPanel'
import { TrainerFeedbackPanel } from './TrainerFeedbackPanel'

type ProgressView = 'worlds' | 'modules'

// Vista unificada de "Progreso": primero se elige qué progreso ver (Mundos o
// Módulos) y solo entonces se monta el panel correspondiente — así no se
// consulta ningún dato antes de la selección. La elección vive en la URL
// (?view=worlds|modules) para que atrás/adelante y los deep-links funcionen.
export default function ProgressHub() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()

  const raw = searchParams.get('view')
  const view: ProgressView | null = raw === 'worlds' || raw === 'modules' ? raw : null

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
        <HubBackBar onBack={goBack} label={t('admin.progress_hub.worlds_title', 'Progreso de Mundos')} />
        <FeedbackPanel />
      </div>
    )
  }

  if (view === 'modules') {
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
        <HubBackBar onBack={goBack} label={t('admin.progress_hub.modules_title', 'Progreso de Módulos')} />
        <div className="flex-1 overflow-hidden">
          <TrainerFeedbackPanel />
        </div>
      </div>
    )
  }

  return <ProgressChooser onSelect={select} />
}

/* ── Barra superior con "volver al selector" ── */

function HubBackBar({ onBack, label }: { onBack: () => void; label: string }) {
  const { t } = useTranslation()
  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 px-4 sm:px-8 py-2.5 border-b border-line bg-bg/85 backdrop-blur shrink-0">
      <button
        onClick={onBack}
        className="group inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-text-muted hover:text-text hover:border-[rgb(var(--brand-green))]/40 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
        {t('admin.progress_hub.back', 'Cambiar vista')}
      </button>
      <span className="text-[12px] text-text-muted truncate">
        {t('admin.progress_hub.viewing', 'Estás viendo')}: <span className="text-text font-semibold">{label}</span>
      </span>
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

      <div className="relative w-full max-w-4xl">
        {/* Encabezado */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-8 sm:mb-12"
        >
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
        </motion.div>

        {/* Tarjetas */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          {cards.map((card, i) => (
            <motion.button
              key={card.key}
              onClick={() => onSelect(card.key)}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.12 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -6 }}
              whileTap={{ scale: 0.985 }}
              className="group relative text-left rounded-3xl border border-line bg-surface p-6 sm:p-7 overflow-hidden outline-none focus-visible:ring-2 transition-shadow duration-300"
              style={{ ['--accent' as string]: card.accent }}
            >
              {/* Glow superior que se intensifica al pasar el mouse */}
              <div
                aria-hidden
                className="absolute -top-20 -right-20 h-48 w-48 rounded-full blur-3xl opacity-[0.07] group-hover:opacity-[0.16] transition-opacity duration-500"
                style={{ background: card.accent }}
              />
              {/* Borde acentuado al hover */}
              <div
                aria-hidden
                className="absolute inset-0 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                style={{ boxShadow: `inset 0 0 0 1.5px ${card.accent.replace(')', ' / 0.45)')}` }}
              />

              <div className="relative">
                <div
                  className="h-14 w-14 rounded-2xl flex items-center justify-center mb-5 border transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3"
                  style={{
                    background: card.accent.replace(')', ' / 0.10)'),
                    borderColor: card.accent.replace(')', ' / 0.25)'),
                  }}
                >
                  <card.Icon className="h-7 w-7" style={{ color: card.accent }} />
                </div>

                <h2 className="text-[17px] sm:text-[19px] font-bold text-text mb-1.5">{card.title}</h2>
                <p className="text-[12.5px] sm:text-[13px] text-text-muted leading-relaxed mb-5">{card.desc}</p>

                <ul className="space-y-2 mb-6">
                  {card.bullets.map((b, j) => (
                    <li key={j} className="flex items-center gap-2.5 text-[12px] text-text-muted">
                      <span
                        className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0 border"
                        style={{
                          background: card.accent.replace(')', ' / 0.08)'),
                          borderColor: card.accent.replace(')', ' / 0.18)'),
                        }}
                      >
                        <b.Icon className="h-3 w-3" style={{ color: card.accent }} />
                      </span>
                      {b.text}
                    </li>
                  ))}
                </ul>

                <span
                  className="inline-flex items-center gap-2 text-[13px] font-semibold transition-colors"
                  style={{ color: card.accent }}
                >
                  {t('admin.progress_hub.open', 'Ver progreso')}
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                </span>
              </div>
            </motion.button>
          ))}
        </div>

        {/* Nota de privacidad de datos: nada se consulta hasta elegir */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="text-center text-[11px] text-text-subtle mt-8"
        >
          {t('admin.progress_hub.hint', 'Los datos se cargan únicamente al seleccionar una vista.')}
        </motion.p>
      </div>
    </div>
  )
}
