import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getActiveOrgId, getAllOrgUnits } from '@/services/org.service'
import type { AudienceRule } from '@/services/audiences.service'
import type { OrgUnit } from '@/types/database'
import { FilterDropdown } from '@/admin/components/FilterDropdown'
import { EMPTY_AUDIENCE, reachesFilter } from '@/admin/components/courseReach'
import { OPERATION_COUNTRIES } from '@/lib/countries'
import { fold } from '@/lib/normalize'

export type ContentStatusFilter = 'all' | 'published' | 'draft'

/**
 * Buscador + país / área / CR + estado: la MISMA barra en Cursos y Módulos.
 * País, área y CR responden «¿qué le llega a alguien de…?» con la semántica de
 * la regla del curso (ver `reachesFilter`): un curso solo por país sigue
 * saliendo al elegir un CR de ese país, porque le llega. Lo que no cuelga de
 * ningún curso no le llega a nadie por regla y se esconde con esos filtros.
 */
export function useContentFilters() {
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('')
  const [area, setArea] = useState('')
  const [cr, setCr] = useState('')
  const [status, setStatus] = useState<ContentStatusFilter>('all')
  /** El catálogo de CR y áreas (archivados incluidos: también ponen nombre). */
  const [units, setUnits] = useState<OrgUnit[]>([])

  useEffect(() => {
    let alive = true
    getActiveOrgId().then((id) => (id ? getAllOrgUnits(id) : []))
      .then((list) => { if (alive) setUnits(list) })
      .catch(() => { if (alive) setUnits([]) })
    return () => { alive = false }
  }, [])

  const reachOn = !!(country || area || cr)
  const active = !!(search.trim() || reachOn || status !== 'all')

  const clear = () => {
    setSearch(''); setCountry(''); setArea(''); setCr(''); setStatus('all')
  }

  const q = useMemo(() => fold(search), [search])

  /**
   * ¿Pasa los filtros? `texts` son los textos donde buscar (título propio y,
   * en Módulos, el del curso); `rule` es la regla del curso del que cuelga,
   * `null` si no cuelga de ninguno.
   */
  const matches = (item: { texts: string[]; isPublished: boolean; rule: AudienceRule | null | undefined }) => {
    if (status !== 'all' && (status === 'published') !== item.isPublished) return false
    if (q && !item.texts.some((s) => fold(s).includes(q))) return false
    return reachesFilter(item.rule ?? EMPTY_AUDIENCE, { country, area, cr })
  }

  return {
    search, setSearch, country, setCountry, area, setArea, cr, setCr, status, setStatus,
    units, reachOn, active, clear, matches,
  }
}

export type ContentFilters = ReturnType<typeof useContentFilters>

export function ContentFilterBar({ filters, searchPlaceholder }: {
  filters: ContentFilters
  searchPlaceholder: string
}) {
  const { t } = useTranslation()
  const f = filters
  return (
    <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
      <div className="relative sm:col-span-2 lg:col-span-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
        <input
          value={f.search}
          onChange={(e) => f.setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="min-h-[44px] w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-[14px] text-text outline-none focus:border-primary"
        />
      </div>
      <FilterDropdown
        value={f.country}
        onChange={f.setCountry}
        options={[
          { value: '', label: t('admin.courses.reach_any_country') },
          ...OPERATION_COUNTRIES.map((c) => ({ value: c.code, label: `${c.flag} ${c.name}` })),
        ]}
      />
      <FilterDropdown
        value={f.area}
        onChange={f.setArea}
        searchable
        options={[
          { value: '', label: t('admin.courses.reach_any_area') },
          ...f.units.filter((u) => u.kind === 'area').map((u) => ({ value: u.id, label: u.name })),
        ]}
      />
      <FilterDropdown
        value={f.cr}
        onChange={f.setCr}
        searchable
        options={[
          { value: '', label: t('admin.courses.reach_any_cr') },
          ...f.units.filter((u) => u.kind === 'operation').map((u) => ({ value: u.id, label: u.name })),
        ]}
      />
      <FilterDropdown
        value={f.status}
        onChange={(v) => f.setStatus(v as ContentStatusFilter)}
        options={[
          { value: 'all', label: t('admin.courses.reach_status_all') },
          { value: 'published', label: t('admin.courses.published') },
          { value: 'draft', label: t('admin.courses.draft') },
        ]}
      />
    </div>
  )
}
