import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen, Check, ChevronDown, FolderOpen, GripVertical, Layers,
  Loader2, Search, Sparkles, X,
} from 'lucide-react'
import i18n from '@/i18n'
import { supabase } from '@/lib/supabase'
import { backdropDismiss } from '@/lib/backdropDismiss'
import { cn } from '@/lib/cn'
import { useAuth } from '@/hooks/useAuth'
import { getAccessibleCampaigns } from '@/services/campaigns.service'
import { NeonBadge } from '@/components/ui/NeonBadge'
import { AiCreditsNotice } from '@/components/ui/AiCreditsNotice'
import type { WorldGenOptions } from '@/services/worlds.service'

/** Módulo elegido; la forma que consume `generateBulkModuleRegions`. */
export interface PickedModule {
  id: string
  title_es: string
  icon: string | null
}

interface ModuleRow extends PickedModule {
  course_id: string | null
  campaign_id: string
  course_sort_order: number
  sections: number
}

interface CourseRow {
  id: string
  title_es: string
  campaign_id: string | null
}

interface Props {
  /** Módulos que ya tienen región en el mundo: no se pueden volver a elegir. */
  excludeModuleIds?: string[]
  /** Texto del botón de confirmación (recibe {count}). */
  submitLabel?: (count: number) => string
  /** Aviso extra bajo el encabezado (p. ej. el nombre del mundo destino). */
  subtitle?: string
  onClose: () => void
  onConfirm: (modules: PickedModule[], opts: WorldGenOptions) => void
}

const DEFAULT_PER_SECTION = 3
/** Un módulo sin secciones no tiene texto del cual generar sin inventar. */
const isEmpty = (m: ModuleRow) => m.sections === 0

/**
 * Selector de módulos de CUALQUIER curso accesible (campañas propias +
 * compartidas) para armar un mundo: cada módulo elegido se convierte en una
 * región completa, generada por IA desde el contenido de ese módulo.
 *
 * Antes esto solo era posible con los módulos del curso enlazado al mundo
 * (`WorldDetail` filtraba `modules.course_id = world.course_id`), así que no
 * había forma de mezclar contenido de varios cursos en un mismo mundo.
 *
 * El orden de selección define el orden de las regiones en el mapa.
 */
export function WorldModulePickerModal({
  excludeModuleIds = [],
  submitLabel,
  subtitle,
  onClose,
  onConfirm,
}: Props) {
  const { isSuperAdmin, campaignId, user, loading: authLoading } = useAuth()

  const [loading, setLoading] = useState(true)
  const [courses, setCourses] = useState<CourseRow[]>([])
  const [modules, setModules] = useState<ModuleRow[]>([])
  const [campaignNames, setCampaignNames] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // Orden de selección = orden de las regiones.
  const [picked, setPicked] = useState<string[]>([])

  // Config de generación, una sola para todas las regiones.
  const [levels, setLevels] = useState<number | ''>(3)
  const [sections, setSections] = useState<number | ''>(2)
  const [perSection, setPerSection] = useState<number | ''>(DEFAULT_PER_SECTION)
  const [minScore, setMinScore] = useState<number | ''>(80)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (authLoading) return
    let active = true
    void (async () => {
      const camps = await getAccessibleCampaigns({
        isSuperAdmin,
        homeCampaignId: campaignId,
        userId: user?.id ?? null,
      }).catch(() => [])
      if (!active) return
      const ids = camps.map((c) => c.id)
      setCampaignNames(Object.fromEntries(camps.map((c) => [c.id, c.name])))

      // El superadmin ve todo; el capacitador, lo de sus campañas (casa +
      // colaboraciones). La RLS ya lo acota, el filtro evita traer de más.
      let courseQ = supabase.from('courses').select('id, title_es, campaign_id').order('title_es')
      let moduleQ = supabase
        .from('modules')
        .select('id, title_es, icon, course_id, campaign_id, course_sort_order, module_sections(id)')
        .order('course_sort_order')
      if (!isSuperAdmin) {
        if (ids.length === 0) { setLoading(false); return }
        courseQ = courseQ.in('campaign_id', ids)
        moduleQ = moduleQ.in('campaign_id', ids)
      }
      const [{ data: cRows }, { data: mRows }] = await Promise.all([courseQ, moduleQ])
      if (!active) return
      setCourses((cRows ?? []) as CourseRow[])
      setModules(
        (mRows ?? []).map((r) => {
          const row = r as Record<string, unknown>
          return {
            id: row.id as string,
            title_es: (row.title_es as string) ?? '',
            icon: (row.icon as string | null) ?? null,
            course_id: (row.course_id as string | null) ?? null,
            campaign_id: row.campaign_id as string,
            course_sort_order: (row.course_sort_order as number) ?? 0,
            sections: ((row.module_sections as unknown[]) ?? []).length,
          }
        }),
      )
      setLoading(false)
    })()
    return () => { active = false }
  }, [authLoading, isSuperAdmin, campaignId, user?.id])

  const excluded = useMemo(() => new Set(excludeModuleIds), [excludeModuleIds])
  const multiCampaign = Object.keys(campaignNames).length > 1

  /** Módulos agrupados por curso, filtrados por la búsqueda. */
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const byCourse = new Map<string, ModuleRow[]>()
    for (const m of modules) {
      if (excluded.has(m.id)) continue
      if (q && !m.title_es.toLowerCase().includes(q)) continue
      const key = m.course_id ?? '__none__'
      const list = byCourse.get(key)
      if (list) list.push(m)
      else byCourse.set(key, [m])
    }
    const out: { key: string; title: string; campaignId: string | null; mods: ModuleRow[] }[] = []
    for (const c of courses) {
      const mods = byCourse.get(c.id)
      if (mods?.length) out.push({ key: c.id, title: c.title_es, campaignId: c.campaign_id, mods })
    }
    const loose = byCourse.get('__none__')
    if (loose?.length) {
      out.push({
        key: '__none__',
        title: i18n.t('admin.worlds.picker_no_course', { defaultValue: 'Módulos sueltos (biblioteca)' }),
        campaignId: null,
        mods: loose,
      })
    }
    return out
  }, [modules, courses, excluded, search])

  const pickedModules = useMemo(
    () => picked.map((id) => modules.find((m) => m.id === id)).filter(Boolean) as ModuleRow[],
    [picked, modules],
  )

  const toggle = (m: ModuleRow) => {
    if (isEmpty(m)) return
    setPicked((prev) => (prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]))
  }

  /** Marca/desmarca el curso entero (solo módulos con contenido). */
  const toggleCourse = (mods: ModuleRow[]) => {
    const usable = mods.filter((m) => !isEmpty(m))
    const allIn = usable.length > 0 && usable.every((m) => picked.includes(m.id))
    setPicked((prev) =>
      allIn
        ? prev.filter((id) => !usable.some((m) => m.id === id))
        : [...prev, ...usable.filter((m) => !prev.includes(m.id)).map((m) => m.id)],
    )
  }

  const move = (index: number, dir: -1 | 1) => {
    setPicked((prev) => {
      const next = [...prev]
      const j = index + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  const submit = () => {
    if (pickedModules.length === 0) return
    const per = perSection === '' ? DEFAULT_PER_SECTION : Number(perSection)
    onConfirm(
      pickedModules.map((m) => ({ id: m.id, title_es: m.title_es, icon: m.icon })),
      {
        levelCount: levels === '' ? 3 : Number(levels),
        questionsPerLevel: (sections === '' ? 2 : Number(sections)) * per,
        sectionSize: per,
        minScorePct: minScore === '' ? 80 : Number(minScore),
      },
    )
  }

  const numInput = 'w-full px-3 py-2.5 rounded-xl text-[13px] bg-bg border border-line text-text focus:outline-none focus:border-[#8B5CF6]/50 min-h-[44px]'

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[130] flex items-center justify-center p-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        role="dialog" aria-modal="true"
        aria-label={i18n.t('admin.worlds.picker_title', { defaultValue: 'Elegir módulos' })}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" {...backdropDismiss(onClose)} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-3xl"
        >
          <div className="relative flex max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-glass-lg">
            {/* ── Header ── */}
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h3 className="flex items-center gap-2 text-[16px] font-semibold text-text">
                  <Layers className="h-4 w-4 text-text-muted" />
                  {i18n.t('admin.worlds.picker_title', { defaultValue: 'Elegir módulos' })}
                </h3>
                <p className="mt-0.5 text-[12px] text-text-muted">
                  {subtitle ?? i18n.t('admin.worlds.picker_subtitle', {
                    defaultValue: 'Cada módulo que elijas se convierte en una región completa, generada desde su contenido. Puedes mezclar módulos de distintos cursos.',
                  })}
                </p>
              </div>
              <button
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-glass/6 hover:text-text"
                aria-label={i18n.t('common.close', { defaultValue: 'Cerrar' })}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* ── Buscador ── */}
            <div className="border-b border-line px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={i18n.t('admin.worlds.picker_search', { defaultValue: 'Buscar módulo por nombre…' })}
                  className="h-11 w-full rounded-xl border border-line bg-bg pl-9 pr-3 text-[13px] text-text outline-none transition-colors placeholder:text-text-subtle focus:border-brand-green/50"
                />
              </div>
            </div>

            {/* ── Cuerpo: cursos → módulos ── */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {i18n.t('common.loading', { defaultValue: 'Cargando…' })}
                </div>
              ) : groups.length === 0 ? (
                <div className="py-12 text-center">
                  <FolderOpen className="mx-auto mb-2 h-8 w-8 text-text-subtle" />
                  <p className="text-[13px] text-text-muted">
                    {search.trim()
                      ? i18n.t('admin.worlds.picker_empty_search', { defaultValue: 'Ningún módulo coincide con la búsqueda.' })
                      : i18n.t('admin.worlds.picker_empty', { defaultValue: 'No hay módulos disponibles en tus campañas.' })}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {groups.map((g) => {
                    const usable = g.mods.filter((m) => !isEmpty(m))
                    const allIn = usable.length > 0 && usable.every((m) => picked.includes(m.id))
                    const someIn = usable.some((m) => picked.includes(m.id))
                    const isOpen = !collapsed[g.key]
                    return (
                      <div key={g.key} className="overflow-hidden rounded-2xl border border-line">
                        {/* Cabecera del curso */}
                        <div className="flex items-center gap-2 bg-glass/[0.04] px-3 py-2.5">
                          <button
                            onClick={() => setCollapsed((p) => ({ ...p, [g.key]: isOpen }))}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            <ChevronDown className={cn('h-4 w-4 shrink-0 text-text-subtle transition-transform', !isOpen && '-rotate-90')} />
                            <BookOpen className="h-4 w-4 shrink-0 text-text-muted" />
                            <span className="truncate text-[13.5px] font-semibold text-text">{g.title}</span>
                            <span className="shrink-0 text-[11px] text-text-subtle">
                              {i18n.t('admin.worlds.picker_group_count', { count: g.mods.length, defaultValue: `${g.mods.length} módulo(s)` })}
                            </span>
                            {multiCampaign && g.campaignId && campaignNames[g.campaignId] && (
                              <NeonBadge color="cyan">{campaignNames[g.campaignId]}</NeonBadge>
                            )}
                          </button>
                          {usable.length > 0 && (
                            <button
                              onClick={() => toggleCourse(g.mods)}
                              className={cn(
                                'shrink-0 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors',
                                allIn
                                  ? 'border-brand-green/40 bg-brand-green/10 text-brand-green'
                                  : 'border-line text-text-muted hover:text-text',
                              )}
                            >
                              {allIn
                                ? i18n.t('admin.worlds.picker_unselect_all', { defaultValue: 'Quitar todos' })
                                : someIn
                                  ? i18n.t('admin.worlds.picker_select_rest', { defaultValue: 'Elegir el resto' })
                                  : i18n.t('admin.worlds.picker_select_all', { defaultValue: 'Elegir todos' })}
                            </button>
                          )}
                        </div>

                        {/* Módulos del curso */}
                        {isOpen && (
                          <ul className="divide-y divide-line/60">
                            {g.mods.map((m) => {
                              const on = picked.includes(m.id)
                              const empty = isEmpty(m)
                              const order = picked.indexOf(m.id) + 1
                              return (
                                <li key={m.id}>
                                  <button
                                    onClick={() => toggle(m)}
                                    disabled={empty}
                                    title={empty
                                      ? i18n.t('admin.worlds.picker_empty_module_hint', { defaultValue: 'Este módulo no tiene contenido: la IA no puede generar preguntas sin inventar.' })
                                      : undefined}
                                    className={cn(
                                      'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                                      empty ? 'cursor-not-allowed opacity-45' : 'hover:bg-glass/[0.05]',
                                      on && 'bg-brand-green/[0.06]',
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold transition-colors',
                                        on
                                          ? 'border-brand-green/50 bg-brand-green/15 text-brand-green'
                                          : 'border-line text-transparent',
                                      )}
                                    >
                                      {on ? order : <Check className="h-3.5 w-3.5" />}
                                    </span>
                                    <span className="text-[15px]">{m.icon || '📘'}</span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-[13.5px] text-text">{m.title_es}</span>
                                      <span className="block text-[11px] text-text-subtle">
                                        {empty
                                          ? i18n.t('admin.worlds.picker_no_content', { defaultValue: 'Sin contenido' })
                                          : i18n.t('admin.worlds.picker_sections', { count: m.sections, defaultValue: `${m.sections} sección(es)` })}
                                      </span>
                                    </span>
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Seleccionados (orden de las regiones) ── */}
            {pickedModules.length > 0 && (
              <div className="border-t border-line px-5 py-3">
                <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  <GripVertical className="h-3.5 w-3.5" />
                  {i18n.t('admin.worlds.picker_order', { count: pickedModules.length, defaultValue: `Orden de las regiones (${pickedModules.length})` })}
                </div>
                <ul className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  {pickedModules.map((m, i) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-1 rounded-lg border border-brand-green/30 bg-brand-green/10 py-1 pl-2 pr-1 text-[11.5px] text-text"
                    >
                      <span className="font-bold text-brand-green">{i + 1}</span>
                      <span className="max-w-[16ch] truncate">{m.title_es}</span>
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="px-0.5 text-text-subtle hover:text-text disabled:opacity-25"
                        aria-label={i18n.t('common.move_up', { defaultValue: 'Subir' })}
                      >↑</button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === pickedModules.length - 1}
                        className="px-0.5 text-text-subtle hover:text-text disabled:opacity-25"
                        aria-label={i18n.t('common.move_down', { defaultValue: 'Bajar' })}
                      >↓</button>
                      <button
                        onClick={() => setPicked((p) => p.filter((x) => x !== m.id))}
                        className="rounded p-0.5 text-text-subtle hover:text-danger"
                        aria-label={i18n.t('common.remove', { defaultValue: 'Quitar' })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Config de generación (una para todas las regiones) ── */}
            <div className="border-t border-line px-5 py-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-text-muted">{i18n.t('admin.worlds.gen_levels_label')}</label>
                  <input type="number" min={1} max={10} value={levels} className={numInput}
                    onChange={(e) => setLevels(e.target.value === '' ? '' : Math.max(1, Math.min(10, Number(e.target.value))))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-text-muted">{i18n.t('admin.worlds.gen_sections_label')}</label>
                  <input type="number" min={1} max={5} value={sections} className={numInput}
                    onChange={(e) => setSections(e.target.value === '' ? '' : Math.max(1, Math.min(5, Number(e.target.value))))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-text-muted">{i18n.t('admin.worlds.gen_per_section_label', { defaultValue: 'Preg./sección' })}</label>
                  <input type="number" min={1} max={5} value={perSection} className={numInput}
                    onChange={(e) => setPerSection(e.target.value === '' ? '' : Math.max(1, Math.min(5, Number(e.target.value))))} />
                </div>
                <div>
                  <label className="mb-1.5 block text-[12px] font-medium text-text-muted">{i18n.t('admin.worlds.gen_min_score_label', { defaultValue: 'Puntaje mín. %' })}</label>
                  <input type="number" min={0} max={100} value={minScore} className={numInput}
                    onChange={(e) => setMinScore(e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))))} />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-text-muted opacity-70">
                {i18n.t('admin.worlds.gen_sections_hint', {
                  total: (sections === '' ? 2 : Number(sections)) * (perSection === '' ? DEFAULT_PER_SECTION : Number(perSection)),
                })}
              </p>
            </div>

            {/* ── Footer ── */}
            <div className="border-t border-line px-5 py-4">
              <AiCreditsNotice className="mb-3" />
              <div className="flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-line px-4 py-2 text-[13px] text-text-muted transition-colors hover:text-text"
              >
                {i18n.t('common.cancel')}
              </button>
              <button
                onClick={submit}
                disabled={pickedModules.length === 0}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-40"
                style={{ background: 'rgba(139,92,246,0.16)', color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.30)' }}
              >
                <Sparkles className="h-4 w-4" />
                {submitLabel
                  ? submitLabel(pickedModules.length)
                  : i18n.t('admin.worlds.picker_submit', {
                      count: pickedModules.length,
                      defaultValue: `Generar ${pickedModules.length} región(es)`,
                    })}
              </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
