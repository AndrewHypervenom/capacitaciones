import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { COUNTRIES } from '@/lib/countries'
import { rowText } from '@/lib/contentLang'
import { Tooltip } from '@/components/ui/Tooltip'
import { ruleIsEmpty } from '@/services/audiences.service'
import type { AdminCourse } from '@/services/courses.service'
import type { OrgUnit } from '@/types/database'
import { REACH_GROUPS, type CourseReach } from '@/admin/components/courseReach'

/**
 * «¿A dónde va cada curso?» en una sola pantalla.
 *
 * Las tarjetas dicen la regla de UNO en una pastilla recortada; para revisar si
 * el reparto está bien había que abrir curso por curso o correr SQL. Esto pone
 * todos en filas, agrupados por el tipo de regla, con país, área, CR y a cuánta
 * gente llega de verdad.
 *
 * Los filtros y los conteos viven en la página (`CourseList`): las tarjetas, el
 * aviso de arriba y esta tabla tienen que decir LO MISMO. Cuando cada pieza
 * contaba a su manera, el aviso decía «7 no le llegan a nadie» y la tabla «2».
 */

interface Props {
  /** Ya filtrados y ordenados por la página. */
  courses: AdminCourse[]
  reach: CourseReach
  units: OrgUnit[]
}

export function CourseReachTable({ courses, reach, units }: Props) {
  const { t } = useTranslation()
  const unitName = useMemo(() => new Map(units.map((u) => [u.id, u.name])), [units])

  const flags = (codes: string[]) =>
    codes.map((code) => COUNTRIES.find((x) => x.code === code)?.flag ?? code).join(' ')
  const names = (ids: string[]) => ids.map((id) => unitName.get(id) ?? '—').join(', ')

  if (courses.length === 0) {
    return <p className="py-10 text-center text-[13px] text-text-muted">{t('admin.courses.reach_empty')}</p>
  }

  const cols = 'lg:grid-cols-[minmax(0,2.2fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.3fr)_5.5rem_5.5rem_1.5rem]'

  return (
    <div className="space-y-6">
      {REACH_GROUPS.map((g) => {
        const list = courses.filter((c) => reach.get(c.id)?.group === g)
        if (list.length === 0) return null
        return (
          <section key={g}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
              <h3 className={cn('text-[15px] font-semibold', g === 'nobody' ? 'text-amber-500' : 'text-text')}>
                {t(`admin.courses.reach_group_${g}`)}
              </h3>
              <span className="text-[12px] tabular-nums text-text-subtle">{list.length}</span>
              <p className="w-full text-[12px] text-text-muted">{t(`admin.courses.reach_group_${g}_hint`)}</p>
            </div>

            <div className={cn('overflow-hidden rounded-2xl border', g === 'nobody' ? 'border-amber-500/40' : 'border-line')}>
              {/* Encabezado: solo en pantallas anchas; en el teléfono cada fila
                  lleva sus propias etiquetas. */}
              <div className={cn('hidden gap-3 border-b border-line bg-glass/8 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-text-subtle lg:grid', cols)}>
                <span>{t('admin.courses.reach_col_course')}</span>
                <span>{t('admin.courses.reach_col_country')}</span>
                <span>{t('admin.courses.reach_col_area')}</span>
                <span>CR</span>
                <span className="text-right">{t('admin.courses.reach_col_by_rule')}</span>
                <span className="text-right">{t('admin.courses.reach_col_by_hand')}</span>
                <span />
              </div>

              {list.map((course) => {
                const r = reach.get(course.id)!
                const { rule } = r
                const sinRegla = rule.everyone || ruleIsEmpty(rule)
                return (
                  <Link
                    key={course.id}
                    to={`/admin/courses/${course.id}?tab=assign`}
                    className={cn('group grid grid-cols-1 gap-1.5 border-b border-line px-4 py-3 last:border-b-0 transition-colors hover:bg-glass/8 lg:items-center lg:gap-3', cols)}
                  >
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-text [overflow-wrap:anywhere]">{rowText(course)}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                            course.is_published ? 'border-primary/30 text-primary' : 'border-line text-text-subtle',
                          )}
                        >
                          {course.is_published ? t('admin.courses.published') : t('admin.courses.draft')}
                        </span>
                        {rule.isMandatory && !ruleIsEmpty(rule) && (
                          <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                            {t('admin.courses.reach_mandatory')}
                          </span>
                        )}
                      </div>
                    </div>

                    <Cell label={t('admin.courses.reach_col_country')}>
                      {rule.everyone
                        ? t('admin.courses.reach_all_short')
                        : rule.countries.length
                          ? (
                            <Tooltip label={rule.countries.map((c) => COUNTRIES.find((x) => x.code === c)?.name ?? c).join(', ')}>
                              <span>{flags(rule.countries)}</span>
                            </Tooltip>
                          )
                          : '—'}
                    </Cell>
                    <Cell label={t('admin.courses.reach_col_area')}>
                      {rule.areaIds.length ? names(rule.areaIds) : sinRegla ? '—' : t('admin.courses.reach_all_areas')}
                    </Cell>
                    <Cell label="CR">
                      {rule.operationIds.length ? names(rule.operationIds) : sinRegla ? '—' : t('admin.courses.reach_all_crs')}
                    </Cell>
                    <Cell label={t('admin.courses.reach_col_by_rule')} num>
                      {r.byRule ?? '…'}
                    </Cell>
                    <Cell label={t('admin.courses.reach_col_by_hand')} num>
                      {r.byHand ?? '…'}
                    </Cell>
                    <ChevronRight className="hidden h-4 w-4 text-text-subtle transition-transform group-hover:translate-x-0.5 lg:block" />
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Cell({ label, num, children }: { label: string; num?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-baseline gap-2 text-[13px] text-text-muted lg:block', num && 'tabular-nums lg:text-right')}>
      <span className="w-24 shrink-0 text-[11px] text-text-subtle lg:hidden">{label}</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </div>
  )
}
