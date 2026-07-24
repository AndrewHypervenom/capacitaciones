import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Languages,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react'
import { GenerationProgress, ASSIST_STEPS } from '@/admin/components/GenerationProgress'
import { moduleAiAssist, type CacheUsage } from '@/services/ai.service'
import type { VideoMarkerRaw } from '@/services/modules.service'
import { Button } from '@/components/ui/Button'
import { AiCreditsNotice, AiCreditsDot } from '@/components/ui/AiCreditsNotice'
import { cn } from '@/lib/cn'
import i18n from '@/i18n'

type Lang = 'es' | 'en' | 'pt'

const LANG_LABELS: Record<Lang, string> = { es: 'ES', en: 'EN', pt: 'PT' }
const LANG_NAMES: Record<Lang, string> = { es: 'Español', en: 'English', pt: 'Português' }

const FIELD_LABELS: Record<string, string> = {
  heading: 'Título',
  body: 'Cuerpo',
  callout: 'Destacado',
  title: 'Título',
  subtitle: 'Subtítulo',
  objectives: 'Objetivos',
  key_takeaways: 'Puntos clave',
}

export interface ModuleAIPanelProps {
  type: 'section' | 'meta'
  content: Record<string, Record<Lang, string>>
  activeLang: Lang
  moduleTitle?: string
  markers?: VideoMarkerRaw[]
  onApplyTranslation: (lang: Lang, fields: Record<string, string>) => void
  onApplyImprovement: (lang: Lang, fields: Record<string, string>, changes: string[]) => void
  onApplyMarkerTranslation?: (lang: Lang, updatedMarkers: VideoMarkerRaw[]) => void
  onCacheUsage?: (usage: CacheUsage) => void
}

function detectSourceLang(content: Record<string, Record<Lang, string>>): Lang {
  const scores: Record<Lang, number> = { es: 0, en: 0, pt: 0 }
  for (const fieldVals of Object.values(content)) {
    for (const lang of ['es', 'en', 'pt'] as Lang[]) {
      scores[lang] += fieldVals[lang]?.trim().length ?? 0
    }
  }
  return (['es', 'en', 'pt'] as Lang[]).reduce(
    (best, l) => scores[l] > scores[best] ? l : best, 'es' as Lang,
  )
}

function getMissingLangs(content: Record<string, Record<Lang, string>>, sourceLang: Lang): Lang[] {
  return (['es', 'en', 'pt'] as Lang[]).filter(l => {
    if (l === sourceLang) return false
    return !Object.values(content).some(v => v[l]?.trim())
  })
}

function TranslationCard({
  lang, fields, applied, onApply,
}: {
  lang: Lang
  fields: Record<string, string>
  applied: boolean
  onApply: () => void
}) {
  const entries = Object.entries(fields).filter(([, v]) => v?.trim())

  return (
    <div className={cn(
      'rounded-xl border p-3 space-y-2 transition-all',
      applied
        ? 'border-brand-green/30 bg-brand-green/5'
        : 'border-glass-border/20 bg-glass/4',
    )}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text">{LANG_NAMES[lang]}</span>
        {applied ? (
          <span className="flex items-center gap-1 text-[10px] text-brand-green font-medium">
            <CheckCircle2 className="h-3 w-3" /> {i18n.t('admin.modules.ai_panel.applied')}
          </span>
        ) : (
          <Button size="sm" onClick={onApply}>{i18n.t('admin.modules.ai_panel.apply')}</Button>
        )}
      </div>
      {entries.slice(0, 2).map(([k, v]) => (
        <div key={k}>
          <div className="text-[10px] text-text-subtle mb-0.5">{i18n.t(`admin.modules.ai_panel.field.${k}`, FIELD_LABELS[k] ?? k)}</div>
          <p className="text-[11px] text-text-muted leading-snug line-clamp-2">
            {v.slice(0, 150)}{v.length > 150 ? '…' : ''}
          </p>
        </div>
      ))}
      {entries.length > 2 && (
        <p className="text-[10px] text-text-subtle">+{entries.length - 2} campos más</p>
      )}
    </div>
  )
}

function ImprovementCard({
  improved, changes, sourceLang, onApply, onDiscard, onRegenerate,
}: {
  improved: Record<string, string>
  changes: string[]
  sourceLang: Lang
  onApply: () => void
  onDiscard: () => void
  onRegenerate: () => void
}) {
  const firstEntry = Object.entries(improved).find(([, v]) => v?.trim())

  return (
    <div className="rounded-xl border border-brand-violet/20 bg-brand-violet/4 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-brand-green" />
          <span className="text-xs font-medium text-text">
            {i18n.t('admin.modules.ai_panel.improved_content')} · {LANG_NAMES[sourceLang]}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRegenerate}
            className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text transition-colors"
          >
            <RotateCcw className="h-3 w-3" /> {i18n.t('admin.modules.ai_panel.regenerate')}
          </button>
          <button
            onClick={onDiscard}
            className="text-text-muted hover:text-danger transition-colors p-0.5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {changes.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-text-subtle uppercase tracking-wide mb-1.5">
            {i18n.t('admin.modules.ai_panel.changes_made')}
          </div>
          <ul className="space-y-1">
            {changes.map((c, i) => (
              <li key={i} className="text-[11px] text-text-muted flex items-start gap-1.5">
                <span className="text-brand-violet shrink-0 mt-0.5">·</span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {firstEntry && (
        <div>
          <div className="text-[10px] text-text-subtle mb-0.5">{i18n.t(`admin.modules.ai_panel.field.${firstEntry[0]}`, FIELD_LABELS[firstEntry[0]] ?? firstEntry[0])}</div>
          <p className="text-[11px] text-text-muted leading-snug line-clamp-3">
            {firstEntry[1].slice(0, 180)}{firstEntry[1].length > 180 ? '…' : ''}
          </p>
        </div>
      )}

      <Button size="sm" onClick={onApply} className="w-full justify-center">
        {i18n.t('admin.modules.ai_panel.apply_improvements')}
      </Button>
    </div>
  )
}

const MKR = '__mkr_'

export function ModuleAIPanel({
  type, content, activeLang, moduleTitle, markers, onApplyTranslation, onApplyImprovement, onApplyMarkerTranslation, onCacheUsage,
}: ModuleAIPanelProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentAction, setCurrentAction] = useState<'translate' | 'improve' | null>(null)
  const [translationResult, setTranslationResult] = useState<Record<string, Record<string, string>> | null>(null)
  const [improvementResult, setImprovementResult] = useState<{ improved: Record<string, string>; changes: string[] } | null>(null)
  const [appliedLangs, setAppliedLangs] = useState<Set<Lang>>(new Set())

  const sourceLang = detectSourceLang(content)
  const missingLangs = getMissingLangs(content, sourceLang)
  const targetLangs: Lang[] = missingLangs.length > 0
    ? missingLangs
    : (['es', 'en', 'pt'] as Lang[]).filter(l => l !== sourceLang)

  // improve usa el tab activo; translate usa el idioma detectado automáticamente
  const improveLang = activeLang
  const hasContentInActive = Object.values(content).some(v => v[improveLang]?.trim())
  const hasContent = Object.values(content).some(v => v[sourceLang]?.trim())
  if (!hasContent) return null

  const buildFields = (lang: Lang) => {
    const sectionFields = Object.fromEntries(Object.entries(content).map(([k, v]) => [k, v[lang] ?? '']))
    if (!markers?.length) return sectionFields
    const markerFields: Record<string, string> = {}
    markers.forEach((m, i) => {
      const title = (m as unknown as Record<string, string>)[`title_${lang}`] || ''
      if (title) markerFields[`${MKR}${i}_title`] = title
      if (m.type === 'quiz' && m.questions) {
        m.questions.forEach((q, qi) => {
          const qText = (q as unknown as Record<string, string>)[`question_${lang}`] || ''
          if (qText) markerFields[`${MKR}${i}_q${qi}`] = qText
          ;((q as unknown as Record<string, string[]>)[`options_${lang}`] ?? []).forEach((opt, oi) => {
            if (opt) markerFields[`${MKR}${i}_q${qi}_o${oi}`] = opt
          })
          const exp = (q as unknown as Record<string, string>)[`explanation_${lang}`] || ''
          if (exp) markerFields[`${MKR}${i}_q${qi}_exp`] = exp
        })
      }
    })
    return { ...sectionFields, ...markerFields }
  }

  const runAction = async (a: 'translate' | 'improve') => {
    setLoading(true)
    setError(null)
    setCurrentAction(a)
    setTranslationResult(null)
    setImprovementResult(null)
    setAppliedLangs(new Set())
    const lang = a === 'improve' ? improveLang : sourceLang
    try {
      const res = await moduleAiAssist({
        action: a,
        contentType: type,
        sourceLang: lang,
        targetLangs: a === 'translate' ? targetLangs : undefined,
        fields: buildFields(lang),
        moduleTitle,
      })
      onCacheUsage?.(res.usage)
      if (a === 'translate') {
        setTranslationResult(res.data as Record<string, Record<string, string>>)
      } else {
        const d = res.data as { improved: Record<string, string>; changes: string[] }
        setImprovementResult({ improved: d.improved, changes: d.changes ?? [] })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleApplyTranslation = (lang: Lang) => {
    if (!translationResult?.[lang]) return
    const allFields = translationResult[lang] as Record<string, string>

    // Campos de sección
    const sectionFields = Object.fromEntries(
      Object.entries(allFields).filter(([k]) => !k.startsWith(MKR))
    )
    onApplyTranslation(lang, sectionFields)

    // Campos de marcadores
    if (markers?.length && onApplyMarkerTranslation) {
      const titleLang = `title_${lang}` as 'title_es' | 'title_en' | 'title_pt'
      const updated = markers.map((m, i) => {
        const next: VideoMarkerRaw = { ...m }
        const titleVal = allFields[`${MKR}${i}_title`]
        if (titleVal) next[titleLang] = titleVal
        if (m.type === 'quiz' && m.questions) {
          const qLang = `question_${lang}` as keyof VideoMarkerRaw
          const optsLang = `options_${lang}` as keyof VideoMarkerRaw
          const expLang = `explanation_${lang}` as keyof VideoMarkerRaw
          next.questions = m.questions.map((q, qi) => {
            const updatedQ = { ...q }
            const qVal = allFields[`${MKR}${i}_q${qi}`]
            if (qVal) (updatedQ as Record<string, unknown>)[qLang as string] = qVal
            const expVal = allFields[`${MKR}${i}_q${qi}_exp`]
            if (expVal) (updatedQ as Record<string, unknown>)[expLang as string] = expVal
            const opts = [...(((q as unknown as Record<string, string[]>)[`options_${lang}`]) ?? ['', '', '', ''])]
            opts.forEach((_, oi) => {
              const oVal = allFields[`${MKR}${i}_q${qi}_o${oi}`]
              if (oVal) opts[oi] = oVal
            })
            ;(updatedQ as Record<string, unknown>)[optsLang as string] = opts
            return updatedQ
          })
        }
        return next
      })
      onApplyMarkerTranslation(lang, updated)
    }

    setAppliedLangs(prev => new Set([...prev, lang]))
  }

  const handleApplyImprovement = () => {
    if (!improvementResult) return
    onApplyImprovement(improveLang, improvementResult.improved, improvementResult.changes)
    setImprovementResult(null)
    setCurrentAction(null)
  }

  const translateLabel = i18n.t('admin.modules.ai_panel.translate_to', { langs: targetLangs.map(l => LANG_LABELS[l]).join(' + ') })

  return (
    <div className={cn(
      'rounded-2xl border transition-all overflow-hidden',
      open
        ? 'bg-brand-violet/4 border-brand-violet/20'
        : 'bg-glass/4 border-glass-border/10 hover:border-glass-border/20',
    )}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left"
      >
        <span className="relative shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-brand-violet" />
          <AiCreditsDot className="absolute -top-1 -right-1" />
        </span>
        <span className="text-xs font-medium text-text flex-1">{i18n.t('admin.modules.ai_panel.assistant')}</span>
        <span className="text-[10px] text-text-subtle px-1.5 py-0.5 rounded bg-glass/8 border border-glass-border/10">
          {LANG_NAMES[sourceLang]}
        </span>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-text-muted" />
          : <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        }
      </button>

      {open && (
        <div className="px-4 pb-4 pt-3 border-t border-glass-border/10 space-y-3">
          <AiCreditsNotice />
          {error && (
            <div className="flex items-start gap-2 text-xs text-danger p-2.5 rounded-xl bg-danger/8 border border-danger/20">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <GenerationProgress
            steps={ASSIST_STEPS}
            active={loading}
            title={currentAction === 'translate' ? i18n.t('admin.modules.ai_panel.translating') : i18n.t('admin.modules.ai_panel.improving')}
          />

          {!loading && !translationResult && !improvementResult && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => runAction('translate')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-glass-border/20 glass hover:border-brand-violet/30 hover:bg-brand-violet/5 text-text-muted hover:text-text transition-all"
              >
                <Languages className="h-3.5 w-3.5" />
                {translateLabel}
              </button>
              <button
                onClick={() => runAction('improve')}
                disabled={!hasContentInActive}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-glass-border/20 glass hover:border-brand-violet/30 hover:bg-brand-violet/5 text-text-muted hover:text-text transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Wand2 className="h-3.5 w-3.5" />
                {i18n.t('admin.modules.ai_panel.improve_in', { lang: LANG_NAMES[improveLang] })}
              </button>
            </div>
          )}

          {translationResult && !loading && (
            <div className="space-y-2">
              {targetLangs.map(lang => (
                <TranslationCard
                  key={lang}
                  lang={lang}
                  fields={(translationResult[lang] ?? {}) as Record<string, string>}
                  applied={appliedLangs.has(lang)}
                  onApply={() => handleApplyTranslation(lang)}
                />
              ))}
              <button
                onClick={() => runAction('translate')}
                className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text transition-colors pt-1"
              >
                <RotateCcw className="h-3 w-3" /> {i18n.t('admin.modules.ai_panel.regenerate_translation')}
              </button>
            </div>
          )}

          {improvementResult && !loading && (
            <ImprovementCard
              improved={improvementResult.improved}
              changes={improvementResult.changes}
              sourceLang={sourceLang}
              onApply={handleApplyImprovement}
              onDiscard={() => { setImprovementResult(null); setCurrentAction(null) }}
              onRegenerate={() => runAction('improve')}
            />
          )}
        </div>
      )}
    </div>
  )
}
