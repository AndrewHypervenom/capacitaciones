import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Loader2, MapPin, Users, Building2, Layers } from 'lucide-react'
import { cn } from '@/lib/cn'
import { COUNTRIES, OPERATION_COUNTRIES } from '@/lib/countries'
import { GlassCard } from '@/components/ui/GlassCard'
import { getOrganizations, getOrgUnits } from '@/services/org.service'
import { countAudience, ruleIsEmpty, type AudienceRule } from '@/services/audiences.service'
import type { OrgUnit } from '@/types/database'

/**
 * «¿A quién le llega este curso?» — la regla de audiencia.
 *
 * Reemplaza a «elige campañas» por una regla sobre lo que la persona ES:
 * su país, su operación y su área. La diferencia práctica es que quien entra
 * mañana a un área recibe el curso solo, y quien sale deja de verlo, sin que
 * nadie mantenga listas.
 *
 * La semántica hay que enseñarla, no esconderla, porque es lo que la gente se
 * equivoca al leer:
 *   · Dentro de un eje se SUMA:  Colombia o México.
 *   · Entre ejes se CRUZA:       Colombia Y Talento Humano.
 *   · Un eje sin nada no restringe.
 * Por eso la tarjeta de abajo lee la regla en voz alta —"Colombia y México ·
 * Área: Talento Humano"— y dice a cuánta gente real le llega. Un número
 * concreto antes de guardar es lo único que evita publicar creyendo que va a
 * un área y descubrir que fue a toda la compañía.
 *
 * El eje de país enseña solo donde hay operación (CO/MX/AR). La lista larga es
 * para la ficha de la persona; aquí veintitrés banderas para elegir entre tres
 * solo estorban.
 *
 * Degradación: sin unidades en el catálogo, los ejes de operación y área no se
 * pintan. Un selector vacío no ayuda; parece que la función está rota.
 */

/** Deja la regla comparable: mismo contenido, misma cadena. */
export function normalizeRule(r: AudienceRule) {
  return {
    everyone: r.everyone,
    countries: [...r.countries].sort(),
    operationIds: [...r.operationIds].sort(),
    areaIds: [...r.areaIds].sort(),
    isMandatory: r.isMandatory,
  }
}

interface Props {
  value: AudienceRule
  onChange: (next: AudienceRule) => void
  disabled?: boolean
}

export function AudienceRulePicker({ value, onChange, disabled }: Props) {
  const { t } = useTranslation()
  const [orgId, setOrgId] = useState('')
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [reach, setReach] = useState<{ matched: number; total: number } | null>(null)
  const [counting, setCounting] = useState(false)

  useEffect(() => {
    let alive = true
    getOrganizations()
      .then((orgs) => {
        const id = orgs[0]?.id ?? ''
        if (!alive) return
        setOrgId(id)
        return id ? getOrgUnits(id) : []
      })
      .then((list) => { if (alive && list) setUnits(list) })
      .catch(() => { if (alive) setUnits([]) })
    return () => { alive = false }
  }, [])

  // El alcance se recalcula al soltar, no en cada tecla: es una consulta a
  // profiles y no hace falta que persiga al dedo.
  useEffect(() => {
    if (!orgId) return
    let alive = true
    setCounting(true)
    const id = window.setTimeout(() => {
      countAudience(orgId, value)
        .then((r) => { if (alive) { setReach(r); setCounting(false) } })
        .catch(() => { if (alive) { setReach(null); setCounting(false) } })
    }, 350)
    return () => { alive = false; window.clearTimeout(id) }
  }, [orgId, value])

  const operations = useMemo(() => units.filter((u) => u.kind === 'operation'), [units])
  const areas = useMemo(() => units.filter((u) => u.kind === 'area'), [units])

  // Solo los países donde hay operación. Si una regla vieja trae otro país, se
  // pinta igual: esconderlo haría desaparecer de la vista una condición que
  // sigue vigente, y nadie entendería por qué el curso no le llega a alguien.
  const paises = useMemo(() => {
    const extra = value.countries
      .filter((c) => !OPERATION_COUNTRIES.some((x) => x.code === c))
      .map((c) => COUNTRIES.find((x) => x.code === c) ?? { code: c, name: c, flag: '' })
    return [...OPERATION_COUNTRIES, ...extra]
  }, [value.countries])

  const toggle = (key: 'countries' | 'operationIds' | 'areaIds', id: string) => {
    if (disabled) return
    const cur = value[key]
    onChange({
      ...value,
      everyone: false,
      [key]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    })
  }

  /** La regla leída en palabras. Es la frase que evita el malentendido. */
  const frase = useMemo(() => {
    if (value.everyone) return t('admin.courses.aud_all', 'Toda la organización')
    const partes: string[] = []
    if (value.countries.length) {
      partes.push(
        value.countries
          .map((c) => COUNTRIES.find((x) => x.code === c)?.name ?? c)
          .join(' o '),
      )
    }
    if (value.operationIds.length) {
      partes.push(
        t('admin.courses.aud_operation', 'Operación') + ': ' +
        value.operationIds.map((id) => units.find((u) => u.id === id)?.name ?? '—').join(' o '),
      )
    }
    if (value.areaIds.length) {
      partes.push(
        t('admin.courses.aud_area', 'Área') + ': ' +
        value.areaIds.map((id) => units.find((u) => u.id === id)?.name ?? '—').join(' o '),
      )
    }
    return partes.join('  ·  ')
  }, [value, units, t])

  const vacia = ruleIsEmpty(value)

  return (
    <div className="space-y-4">
      {/* Toda la organización: el caso de las categorías de la casa */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange({ ...value, everyone: !value.everyone, countries: [], operationIds: [], areaIds: [] })}
        className={cn(
          'w-full text-left rounded-2xl border p-4 transition-colors',
          value.everyone
            ? 'border-primary/50 bg-primary/6 ring-1 ring-primary/30'
            : 'border-line hover:border-primary/30',
          disabled && 'opacity-60 cursor-not-allowed',
        )}
      >
        <div className="flex items-center gap-2 mb-1">
          <Globe className={cn('h-4 w-4', value.everyone ? 'text-primary' : 'text-text-muted')} />
          <span className="text-[13px] font-semibold text-text">
            {t('admin.courses.aud_everyone', 'Toda la organización')}
          </span>
        </div>
        <p className="text-[12px] text-text-muted leading-relaxed">
          {t('admin.courses.aud_everyone_desc', 'Se le asigna a todos los aprendices, sin condiciones. Es el caso de Avanza +, Sé y comparto o S+ Lidera.')}
        </p>
      </button>

      {!value.everyone && (
        <>
          <Eje
            icon={MapPin}
            titulo={t('admin.courses.aud_country', 'País')}
            ayuda={t('admin.courses.aud_country_help', 'Sin ninguno marcado, no restringe por país.')}
            opciones={paises.map((c) => ({ id: c.code, label: `${c.flag} ${c.name}`.trim() }))}
            seleccion={value.countries}
            onToggle={(id) => toggle('countries', id)}
            disabled={disabled}
          />
          {operations.length > 0 && (
            <Eje
              icon={Building2}
              titulo={t('admin.courses.aud_operation', 'Operación')}
              ayuda={t('admin.courses.aud_operation_help', 'Sin ninguna marcada, no restringe por operación.')}
              opciones={operations.map((u) => ({ id: u.id, label: u.name }))}
              seleccion={value.operationIds}
              onToggle={(id) => toggle('operationIds', id)}
              disabled={disabled}
            />
          )}
          {areas.length > 0 && (
            <Eje
              icon={Layers}
              titulo={t('admin.courses.aud_area', 'Área')}
              ayuda={t('admin.courses.aud_area_help', 'Sin ninguna marcada, no restringe por área.')}
              opciones={areas.map((u) => ({ id: u.id, label: u.name }))}
              seleccion={value.areaIds}
              onToggle={(id) => toggle('areaIds', id)}
              disabled={disabled}
            />
          )}
        </>
      )}

      {/* La regla en palabras + a cuánta gente le llega de verdad */}
      <GlassCard intensity="subtle" rounded="2xl" className="px-4 py-3.5">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text mb-1.5">
          <Users className="h-4 w-4 text-text-muted" />
          {t('admin.courses.aud_reach_title', 'A quién le llega')}
        </h3>
        {vacia ? (
          <p className="text-[12px] text-amber-500">
            {t('admin.courses.aud_empty', 'Todavía a nadie. Marca al menos un país, una operación o un área — o elige toda la organización.')}
          </p>
        ) : (
          <>
            <p className="text-[12px] text-text-muted mb-1.5">{frase}</p>
            <p className="text-[20px] font-bold tabular-nums text-text leading-none">
              {counting ? (
                <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
              ) : reach ? (
                t('admin.courses.aud_reach_people', '{{n}} de {{total}} aprendices', {
                  n: reach.matched, total: reach.total,
                })
              ) : '—'}
            </p>
            {reach?.matched === 0 && !counting && (
              <p className="text-[12px] text-amber-500 mt-1.5">
                {t('admin.courses.aud_reach_zero', 'Ahora mismo no hay nadie que cumpla la regla. Puede ser que falte clasificar a esa gente.')}
              </p>
            )}
          </>
        )}
      </GlassCard>
    </div>
  )
}

function Eje({
  icon: Icon, titulo, ayuda, opciones, seleccion, onToggle, disabled,
}: {
  icon: React.ComponentType<{ className?: string }>
  titulo: string
  ayuda: string
  opciones: { id: string; label: string }[]
  seleccion: string[]
  onToggle: (id: string) => void
  disabled?: boolean
}) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text mb-0.5">
        <Icon className="h-4 w-4 text-text-muted" />
        {titulo}
        {seleccion.length > 0 && (
          <span className="text-[11px] font-normal text-text-subtle tabular-nums">
            {seleccion.length}
          </span>
        )}
      </h3>
      <p className="text-[12px] text-text-muted mb-2">{ayuda}</p>
      <div className="flex flex-wrap gap-1.5">
        {opciones.map((o) => {
          const on = seleccion.includes(o.id)
          return (
            <button
              key={o.id}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(o.id)}
              className={cn(
                'min-h-[32px] px-3 rounded-full border text-[12px] transition-colors',
                on
                  ? 'border-primary/50 bg-primary/10 text-text'
                  : 'border-line text-text-muted hover:border-primary/30 hover:text-text',
                disabled && 'opacity-60 cursor-not-allowed',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
