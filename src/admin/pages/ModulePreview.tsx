import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Eye,
  Loader2,
} from 'lucide-react'
import { getModuleWithSectionsRaw, mapVideoMarkersFromDb, type DbModuleWithSections } from '@/services/modules.service'
import { Callout } from '@/components/modules/Callout'
import { KnowledgeCheck } from '@/components/modules/KnowledgeCheck'
import { SectionLayout } from '@/components/modules/SectionLayout'
import { InteractiveVideoModule } from '@/components/modules/InteractiveVideoModule'
import { cn } from '@/lib/cn'
import type { CalloutKind, ModuleSection, SectionStyle } from '@/data/modules'

type Lang = 'es' | 'en' | 'pt'

const LANG_LABELS: Record<Lang, string> = { es: 'Español', en: 'English', pt: 'Português' }

export default function ModulePreview() {
  const { moduleId } = useParams<{ moduleId: string }>()
  const [mod, setMod] = useState<DbModuleWithSections | null>(null)
  const [loading, setLoading] = useState(true)
  const [lang, setLang] = useState<Lang>('es')
  const [activeSection, setActiveSection] = useState(0)

  useEffect(() => {
    if (!moduleId) return
    getModuleWithSectionsRaw(moduleId)
      .then((data) => { setMod(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [moduleId])

  const get = (row: Record<string, string | null> | undefined, field: string): string => {
    if (!row) return ''
    return (row[`${field}_${lang}`] as string | null) ?? (row[`${field}_es`] as string | null) ?? ''
  }

  const getArr = (mod: DbModuleWithSections, field: string): string[] => {
    const val = (mod as unknown as Record<string, string[] | null>)[`${field}_${lang}`]
      ?? (mod as unknown as Record<string, string[]>)[`${field}_es`]
      ?? []
    return val
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center gap-2 text-text-muted text-[14px]">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    )
  }

  if (!mod) {
    return (
      <div className="p-8 text-red-400 text-[14px]">
        No se encontró el módulo.
      </div>
    )
  }

  const title = mod[`title_${lang}` as keyof DbModuleWithSections] as string || mod.title_es
  const subtitle = (mod[`subtitle_${lang}` as keyof DbModuleWithSections] as string | null) || mod.subtitle_es || ''
  const objectives = getArr(mod, 'objectives')
  const keyTakeaways = getArr(mod, 'key_takeaways')
  const totalQuizzes = mod.module_sections.filter(s => !!s.section_quizzes?.[0]).length
  const quizIndexMap = (() => {
    let count = 0
    return mod.module_sections.map(s => (s.section_quizzes?.[0] ? count++ : -1))
  })()

  return (
    <div className="min-h-screen bg-bg">
      {/* Preview banner */}
      <div
        className="sticky top-0 z-50 flex items-center justify-between px-6 py-2.5 text-[12px] font-medium"
        style={{ background: 'rgba(96,165,250,0.12)', borderBottom: '1px solid rgba(96,165,250,0.2)' }}
      >
        <div className="flex items-center gap-2 text-blue-300">
          <Eye className="h-3.5 w-3.5" />
          Vista previa — así verá el aprendiz este módulo
        </div>
        <div className="flex items-center gap-3">
          {/* Selector de idioma */}
          <div className="flex gap-1 p-0.5 rounded-lg bg-blue-400/10">
            {(['es', 'en', 'pt'] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-[11px] uppercase font-medium transition-colors',
                  lang === l ? 'bg-blue-400/20 text-blue-200' : 'text-blue-400/60 hover:text-blue-300',
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <Link
            to={`/admin/modules/${moduleId}`}
            className="flex items-center gap-1 text-blue-300 hover:text-blue-100 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Volver al editor
          </Link>
        </div>
      </div>

      {/* Module content — same layout as ModulePage */}
      <div className="mx-auto max-w-5xl px-5 pt-10 pb-24">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-2 mb-4 text-[12px] text-text-subtle">
            <span className="uppercase tracking-wider">
              Módulo · {mod.duration_min} min
            </span>
          </div>
          <h1 className="text-[36px] md:text-[44px] font-semibold tracking-tight leading-[1.05] mb-4 text-balance text-text">
            {title}
          </h1>
          {subtitle && (
            <p className="text-text-muted text-[18px] max-w-2xl leading-relaxed">{subtitle}</p>
          )}
        </div>

        {/* Objectives */}
        {objectives.length > 0 && (
          <div className="mb-14 rounded-2xl bg-subtle border border-line p-7">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[11px] uppercase tracking-wider text-text-subtle font-medium">
                Lo que aprenderás
              </span>
            </div>
            <ul className="space-y-3">
              {objectives.map((o, i) => (
                <li key={i} className="flex items-start gap-3 text-[15px] text-text leading-relaxed">
                  <span className="mt-2 inline-block h-1.5 w-1.5 rounded-full bg-brand-green shrink-0" />
                  <span>{o}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Sections layout */}
        <div className="grid md:grid-cols-[200px_1fr] gap-12">
          {/* Sidebar index */}
          {mod.module_sections.length > 1 && (
            <aside className="md:sticky md:top-20 self-start">
              <div className="text-[11px] uppercase tracking-wider text-text-subtle mb-4">
                Contenido
              </div>
              <ul className="space-y-1">
                {mod.module_sections.map((s, i) => (
                  <li key={i}>
                    <button
                      onClick={() => {
                        setActiveSection(i)
                        document.getElementById(`preview-section-${i}`)?.scrollIntoView({
                          behavior: 'smooth',
                          block: 'start',
                        })
                      }}
                      className={cn(
                        'w-full text-left pl-4 pr-2 py-2 text-[13px] transition-colors border-l-2',
                        activeSection === i
                          ? 'border-brand-green text-text font-medium'
                          : 'border-transparent text-text-muted hover:text-text',
                      )}
                    >
                      <span className="text-text-subtle mr-2 tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {(get(s as unknown as Record<string, string | null>, 'heading') || s.heading_es).slice(0, 40)}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}

          {/* Sections */}
          <article className={cn('space-y-16', mod.module_sections.length <= 1 && 'col-span-full')}>
            {mod.module_sections.map((s, i) => {
              const heading = (s[`heading_${lang}` as keyof typeof s] as string | null) || s.heading_es
              const bodyArr: string[] = (s[`body_${lang}` as keyof typeof s] as string[] | null) || s.body_es || []
              const calloutText = s.callout_es
                ? ((s[`callout_${lang}` as keyof typeof s] as string | null) || s.callout_es)
                : null
              const sectionStyle = (s.section_style as SectionStyle | null) ?? 'default'
              const isSideBySide = sectionStyle === 'side-by-side' && !!(s.media_type && s.media_url)

              return (
                <section
                  key={i}
                  id={`preview-section-${i}`}
                  className="scroll-mt-28"
                  onMouseEnter={() => setActiveSection(i)}
                >
                  <div className="text-[11px] uppercase tracking-wider text-text-subtle mb-3 tabular-nums">
                    {String(i + 1).padStart(2, '0')} / {String(mod.module_sections.length).padStart(2, '0')}
                  </div>

                  {(() => {
                    // ── Video Interactivo ──────────────────────────────
                    if (sectionStyle === 'video-interactive') {
                      const videoSection: ModuleSection = {
                        heading: {
                          es: s.heading_es,
                          en: s.heading_en ?? s.heading_es,
                          pt: s.heading_pt ?? s.heading_es,
                        },
                        body: { es: [], en: [], pt: [] },
                        style: 'video-interactive',
                        media: s.media_url
                          ? { type: 'video', url: s.media_url }
                          : undefined,
                        videoMarkers: mapVideoMarkersFromDb(s.video_markers),
                      }
                      return <InteractiveVideoModule section={videoSection} language={lang} />
                    }

                    const mediaFigure = s.media_type && s.media_url ? (
                      <figure className={cn('rounded-2xl overflow-hidden border border-line', !isSideBySide && 'mt-8')}>
                        {s.media_type === 'image' && (
                          <img
                            src={s.media_url}
                            alt={get(s as unknown as Record<string, string | null>, 'media_caption') ?? ''}
                            loading="lazy"
                            className="w-full max-h-[480px] object-cover block"
                          />
                        )}
                        {s.media_type === 'youtube' && (
                          <div className="relative w-full bg-black" style={{ paddingTop: '56.25%' }}>
                            <iframe
                              src={`https://www.youtube.com/embed/${s.media_url}?rel=0&modestbranding=1`}
                              title="Video"
                              loading="lazy"
                              allowFullScreen
                              className="absolute inset-0 w-full h-full border-0"
                            />
                          </div>
                        )}
                        {s.media_type === 'video' && (
                          <video src={s.media_url} controls preload="metadata" className="w-full max-h-[480px] block bg-black" />
                        )}
                        {get(s as unknown as Record<string, string | null>, 'media_caption') && (
                          <figcaption className="px-5 py-3 text-[12.5px] text-text-subtle border-t border-line bg-subtle">
                            {get(s as unknown as Record<string, string | null>, 'media_caption')}
                          </figcaption>
                        )}
                      </figure>
                    ) : null

                    const calloutEl = s.callout_kind && calloutText ? (
                      <Callout kind={s.callout_kind as CalloutKind} text={calloutText} animate={false} />
                    ) : null

                    const dbQuiz = s.section_quizzes?.[0] ?? null
                    const quizIdx = quizIndexMap[i]
                    const quizEl = dbQuiz ? (
                      <KnowledgeCheck
                        moduleId={mod.id}
                        sectionIdx={i}
                        quiz={{
                          question: { es: dbQuiz.question_es, en: dbQuiz.question_en ?? dbQuiz.question_es, pt: dbQuiz.question_pt ?? dbQuiz.question_es },
                          options: { es: dbQuiz.options_es, en: dbQuiz.options_en ?? dbQuiz.options_es, pt: dbQuiz.options_pt ?? dbQuiz.options_es },
                          correct: dbQuiz.correct_index,
                          explanation: {
                            es: dbQuiz.explanation_es ?? '',
                            en: dbQuiz.explanation_en ?? dbQuiz.explanation_es ?? '',
                            pt: dbQuiz.explanation_pt ?? dbQuiz.explanation_es ?? '',
                          },
                        }}
                        language={lang}
                        quizIndex={quizIdx >= 0 ? quizIdx : undefined}
                        totalQuizzes={totalQuizzes}
                      />
                    ) : null

                    const textContent = (
                      <>
                        <h2 className={cn(
                          'font-semibold tracking-tight mb-6 leading-tight text-text',
                          sectionStyle === 'immersive' ? 'text-display-md' : 'text-[28px] md:text-[32px]',
                        )}>
                          {heading}
                        </h2>
                        <div className="space-y-5 text-[16px] text-text/90 leading-relaxed max-w-[72ch]">
                          {bodyArr.map((p, j) => <p key={j}>{p}</p>)}
                        </div>
                      </>
                    )

                    if (isSideBySide) {
                      return (
                        <>
                          <SectionLayout style="side-by-side" hasMedia={true}>
                            <div>{textContent}</div>
                            {mediaFigure}
                          </SectionLayout>
                          {calloutEl}
                          {quizEl}
                        </>
                      )
                    }

                    return (
                      <SectionLayout style={sectionStyle} hasMedia={!!s.media_url}>
                        {textContent}
                        {mediaFigure}
                        {calloutEl}
                        {quizEl}
                      </SectionLayout>
                    )
                  })()}

                  {/* Separador */}
                  {i < mod.module_sections.length - 1 && (
                    <div className="mt-16 border-t border-line/50" />
                  )}
                </section>
              )
            })}

            {/* Key takeaways */}
            {keyTakeaways.length > 0 && (
              <div className="rounded-2xl bg-subtle border border-line p-7">
                <div className="text-[11px] uppercase tracking-wider text-text-subtle font-medium mb-4">
                  Lo que te llevas
                </div>
                <ul className="space-y-3">
                  {keyTakeaways.map((k, i) => (
                    <li key={i} className="flex items-start gap-3 text-[15px] leading-relaxed text-text">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-brand-green shrink-0 inline-block" />
                      <span>{k}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Empty state */}
            {mod.module_sections.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line p-12 text-center">
                <p className="text-text-muted text-[14px]">
                  Este módulo no tiene secciones todavía.
                </p>
                <Link
                  to={`/admin/modules/${moduleId}`}
                  className="text-blue-400 text-[13px] mt-2 inline-block hover:underline"
                >
                  Ir al editor →
                </Link>
              </div>
            )}
          </article>
        </div>
      </div>

      {/* Language note */}
      <div className="fixed bottom-4 right-4">
        <div
          className="px-3 py-1.5 rounded-lg text-[11px] text-blue-300"
          style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.2)' }}
        >
          Idioma: {LANG_LABELS[lang]}
        </div>
      </div>
    </div>
  )
}
