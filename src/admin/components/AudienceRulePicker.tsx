import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Loader2, MapPin, Users, Building2, Layers, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fold } from '@/lib/normalize'
import { COUNTRIES, OPERATION_COUNTRIES } from '@/lib/countries'
import { GlassCard } from '@/components/ui/GlassCard'
import { Tooltip } from '@/components/ui/Tooltip'
import { getOrganizations, getOrgUnits } from '@/services/org.service'
import {
  countAudience, ruleIsEmpty, getAudiencePopulation, matchesAudience,
  type AudienceRule, type AudiencePerson,
} from '@/services/audiences.service'
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

/**
 * ¿La audiencia está DECIDIDA lo bastante como para publicar?
 *
 * El asistente guía PAÍS → ÁREA → CR porque va de lo general a lo particular: así
 * el número de CR que hay que mirar baja de ochenta y ocho a los de ese país y
 * esa área. Pero **solo el primer paso es obligatorio**, y los otros dos son
 * formas de ESTRECHAR, no requisitos:
 *
 *   «Toda la organización»              → listo. Habilidades blandas, Avanza +.
 *   Colombia                             → listo. Todo el país.
 *   Colombia + Talento Humano            → listo, más estrecho.
 *   Colombia + Talento Humano + CLARO    → listo, más estrecho todavía.
 *   Nada                                 → NO. No le llegaría a nadie.
 *
 * Exigir los tres ejes obligaba a inventarse un área y un CR para un curso que
 * va a toda la compañía — y una audiencia inventada para pasar un candado es
 * peor que no tener candado: acaba llegando a quien no debe.
 *
 * Lo único que se bloquea es la regla VACÍA, que no le llega a nadie y hace que
 * el curso parezca roto. Misma decisión que toma `audience_matches()` en la base,
 * que falla cerrado a propósito.
 */
export function audienceReadyToPublish(r: AudienceRule): boolean {
  return !ruleIsEmpty(r)
}

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

  /* El censo de aprendices, para poder escribir al lado de cada opción a cuánta
   * gente lleva. Es la diferencia entre elegir un CR de una lista de ochenta y
   * ocho nombres y elegirlo sabiendo que tiene noventa y seis personas. */
  const [censo, setCenso] = useState<AudiencePerson[]>([])
  useEffect(() => {
    if (!orgId) return
    let alive = true
    getAudiencePopulation(orgId)
      .then((p) => { if (alive) setCenso(p) })
      .catch(() => { if (alive) setCenso([]) })
    return () => { alive = false }
  }, [orgId])

  /**
   * A cuánta gente llevaría cada opción **con lo ya elegido en los pasos de
   * arriba**: los CR se cuentan dentro del país y el área marcados, no sobre toda
   * la compañía. Ese es el número que convierte el paso 3 en una decisión en vez
   * de una lista.
   */
  const cuentaPara = useMemo(() => {
    const contar = (previa: Partial<AudienceRule>, eje: keyof AudienceRule, id: string) => {
      const regla: AudienceRule = {
        everyone: false,
        countries: [], operationIds: [], areaIds: [],
        isMandatory: value.isMandatory,
        ...previa,
        [eje]: [id],
      } as AudienceRule
      return censo.filter((p) => matchesAudience(regla, p)).length
    }
    return {
      pais: (code: string) => contar({}, 'countries', code),
      area: (id: string) => contar({ countries: value.countries }, 'areaIds', id),
      cr: (id: string) =>
        contar({ countries: value.countries, areaIds: value.areaIds }, 'operationIds', id),
    }
  }, [censo, value.countries, value.areaIds, value.isMandatory])

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
    /* MISMO ORDEN Y MISMO NOMBRE QUE LOS PASOS. Antes esta frase decía
     * "Operación" mientras el paso de arriba decía "CR", y listaba la operación
     * antes que el área. Dos nombres para la misma cosa a cuatro centímetros uno
     * del otro es exactamente lo que hace dudar de si son dos cosas. */
    if (value.areaIds.length) {
      partes.push(
        t('admin.courses.aud_area', 'Área') + ': ' +
        value.areaIds.map((id) => units.find((u) => u.id === id)?.name ?? '—').join(' o '),
      )
    }
    if (value.operationIds.length) {
      partes.push(
        'CR: ' +
        value.operationIds.map((id) => units.find((u) => u.id === id)?.name ?? '—').join(' o '),
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
          {/* PAIS -> AREA -> CR, en ese orden y numerados. Cada paso se abre
              cuando el anterior tiene algo marcado: primero donde, luego que
              tipo de gente, y solo entonces que CR. Elegir CR de primero
              obligaba a mirar ochenta y ocho nombres sin ningun criterio.
              Los pasos 2 y 3 dicen OPCIONAL porque lo son: estrechan la
              audiencia, no la completan. Un curso para todo Colombia — o para
              toda la compania — esta terminado en el paso 1. */}
          <Eje
            paso={1}
            icon={MapPin}
            titulo={t('admin.courses.aud_country', 'País')}
            ayuda={t('admin.courses.aud_country_help', 'Sin ninguno marcado, no restringe por país.')}
            opciones={paises.map((c) => ({
              id: c.code,
              label: `${c.flag} ${c.name}`.trim(),
              n: cuentaPara.pais(c.code),
            }))}
            seleccion={value.countries}
            onToggle={(id) => toggle('countries', id)}
            disabled={disabled}
          />
          {areas.length > 0 && (
            <Eje
              paso={2}
              icon={Layers}
              titulo={t('admin.courses.aud_area', 'Área')}
              ayuda={t('admin.courses.aud_area_help', 'Sin ninguna marcada, no restringe por área.')}
              opciones={areas.map((u) => ({ id: u.id, label: u.name, n: cuentaPara.area(u.id) }))}
              filtrarVacios
              seleccion={value.areaIds}
              onToggle={(id) => toggle('areaIds', id)}
              disabled={disabled}
              opcional
              esperando={value.countries.length === 0}
              esperandoTexto={t('admin.courses.aud_wait_country', 'Elige primero el país.')}
            />
          )}
          {operations.length > 0 && (
            <Eje
              paso={3}
              icon={Building2}
              titulo="CR"
              pista={t('admin.units.cr_equals_operation')}
              ayuda={t('admin.courses.aud_operation_help', 'Sin ninguna marcada, no restringe por operación.')}
              opciones={operations.map((u) => ({ id: u.id, label: u.name, n: cuentaPara.cr(u.id) }))}
              seleccion={value.operationIds}
              onToggle={(id) => toggle('operationIds', id)}
              disabled={disabled}
              opcional
              buscable
              /* Al marcar un área, aquí quedan solo los CR de esa área. Es el
                 embudo que pidió el usuario, y con ochenta y ocho CR es la
                 diferencia entre elegir y rebuscar. */
              filtrarVacios
              /* Espera al PAÍS, no al área. El área es opcional, y encadenar un paso
                 obligatorio detrás de uno opcional dejaba sin poder hacer el caso
                 más natural de todos: un curso para un CR entero, sin importar el
                 área. Pedía marcar un área que nadie quería. */
              esperando={value.countries.length === 0}
              esperandoTexto={t('admin.courses.aud_wait_country', 'Elige primero el país.')}
            />
          )}

          {/* La semántica, escrita. Es lo único de esta pantalla que no se puede
              deducir mirando: que dentro de un paso se suma y entre pasos se
              cruza. Vivía solo en un comentario del código, donde no la lee quien
              tiene que entenderla. */}
          <p className="rounded-xl border border-line bg-subtle/60 px-3 py-2 text-[12px] text-text-muted">
            <span className="font-medium text-text">{t('admin.courses.aud_how_title')}</span>{' '}
            {t('admin.courses.aud_how_body')}
          </p>
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
  paso, icon: Icon, titulo, pista, ayuda, opciones, seleccion, onToggle, disabled,
  opcional, buscable, filtrarVacios, esperando, esperandoTexto,
}: {
  paso: number
  icon: React.ComponentType<{ className?: string }>
  titulo: string
  /** Equivalencia que no todo el mundo tiene por que saber (CR = operación). */
  pista?: string
  ayuda: string
  /** `n` = a cuánta gente lleva esa opción con lo ya elegido en los pasos de arriba. */
  opciones: { id: string; label: string; n?: number }[]
  seleccion: string[]
  onToggle: (id: string) => void
  disabled?: boolean
  /** Estrecha la audiencia, no la completa: se puede publicar sin tocarlo. */
  opcional?: boolean
  /** Con decenas de opciones, una rejilla de píldoras deja de ser elegible. */
  buscable?: boolean
  /**
   * Esconde las opciones a las que no llega nadie **con lo ya elegido arriba**:
   * al marcar un área, el paso del CR se queda solo con los CR de esa área.
   * Es lo que convierte tres listas independientes en un embudo.
   */
  filtrarVacios?: boolean
  /** El paso anterior todavía no tiene nada: este se atenua y no se toca. */
  esperando?: boolean
  esperandoTexto?: string
}) {
  const { t } = useTranslation()
  const apagado = disabled || esperando
  const [busca, setBusca] = useState('')
  const [verTodos, setVerTodos] = useState(false)

  /* Las opciones a las que llega alguien. Lo ya marcado nunca se esconde,
   * aunque se quede en cero al estrechar por arriba: ver desaparecer algo que
   * uno acaba de elegir es la peor forma de enterarse. */
  const conGente = useMemo(
    () => opciones.filter((o) => (o.n ?? 1) > 0 || seleccion.includes(o.id)),
    [opciones, seleccion],
  )

  /* LA RED DE SEGURIDAD. Si al filtrar no queda NADA, no se filtra: se enseña
   * todo con una nota. Hoy nadie tiene área ni CR asignados — eso llega con la
   * carga de la base maestra — así que filtrar dejaría el paso en blanco y
   * parecería una pantalla rota en vez de un dato que falta. */
  const filtrando = Boolean(filtrarVacios) && !verTodos && conGente.length > 0
  const sinDatos = Boolean(filtrarVacios) && conGente.length === 0
  const ocultos = opciones.length - conGente.length

  /* Las que tienen gente primero. Con ochenta y ocho CR, el orden alfabético
   * entierra los que de verdad se usan entre los que no tienen a nadie. Lo
   * marcado se queda arriba del todo para no perderlo de vista al buscar. */
  const lista = useMemo(() => {
    const q = fold(busca)
    return (filtrando ? conGente : opciones)
      .filter((o) => !q || fold(o.label).includes(q) || seleccion.includes(o.id))
      .sort((a, b) => {
        const sa = seleccion.includes(a.id) ? 1 : 0
        const sb = seleccion.includes(b.id) ? 1 : 0
        if (sa !== sb) return sb - sa
        if (a.n !== undefined && b.n !== undefined && a.n !== b.n) return b.n - a.n
        return a.label.localeCompare(b.label, 'es')
      })
  }, [opciones, conGente, filtrando, seleccion, busca])

  return (
    <div className={cn(esperando && 'opacity-55')}>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text mb-0.5">
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
            seleccion.length > 0
              ? 'bg-primary/15 text-primary'
              : 'border border-line text-text-subtle',
          )}
        >
          {paso}
        </span>
        <Icon className="h-4 w-4 text-text-muted" />
        {titulo}
        {pista && (
          <Tooltip label={pista} maxWidth={280}>
            <span className="flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-line text-[8px] font-bold text-text-subtle">
              ?
            </span>
          </Tooltip>
        )}
        {seleccion.length > 0 && (
          <span className="text-[11px] font-normal text-text-subtle tabular-nums">
            {seleccion.length}
          </span>
        )}
        {opcional && seleccion.length === 0 && (
          <span className="text-[11px] font-normal uppercase tracking-wider text-text-subtle">
            {t('admin.courses.aud_optional', 'opcional')}
          </span>
        )}
      </h3>
      <p className="text-[12px] text-text-muted mb-2">
        {esperando ? esperandoTexto : ayuda}
      </p>

      {buscable && !apagado && (filtrando ? conGente : opciones).length > 12 && (
        <div className="relative mb-2 max-w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t('admin.courses.aud_search', 'Buscar entre {{n}}…', {
              n: (filtrando ? conGente : opciones).length,
            })}
            className="h-9 w-full rounded-full border border-line bg-subtle pl-9 pr-3 text-[12px] text-text outline-none"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {lista.map((o) => {
          const on = seleccion.includes(o.id)
          // Sin gente hoy no se esconde: esconderlo deja al capacitador buscando
          // un CR que existe. Se atenua, que dice lo mismo sin hacerle perder
          // el rato — y puede querer dejarlo listo para cuando entre gente.
          const vacio = o.n === 0 && !on
          return (
            <button
              key={o.id}
              type="button"
              disabled={apagado}
              onClick={() => onToggle(o.id)}
              className={cn(
                'flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors',
                on
                  ? 'border-primary/50 bg-primary/10 text-text'
                  : 'border-line text-text-muted hover:border-primary/30 hover:text-text',
                vacio && 'opacity-45',
                apagado && 'opacity-60 cursor-not-allowed',
              )}
            >
              {o.label}
              {o.n !== undefined && (
                <span className="text-[11px] tabular-nums text-text-subtle">{o.n}</span>
              )}
            </button>
          )
        })}
        {lista.length === 0 && (
          <p className="text-[12px] text-text-subtle">
            {t('admin.courses.aud_no_match', 'Nada coincide con la búsqueda.')}
          </p>
        )}
      </div>

      {/* Decir SIEMPRE por qué la lista tiene el largo que tiene. Una lista que
          se acorta sola sin explicarse es indistinguible de una que falla. */}
      {!apagado && filtrando && ocultos > 0 && (
        <button
          type="button"
          onClick={() => setVerTodos(true)}
          className="mt-1.5 text-[11px] text-text-subtle underline-offset-2 hover:text-text hover:underline"
        >
          {t('admin.courses.aud_hidden_empty', '{{n}} sin gente, ocultos · ver todos', { n: ocultos })}
        </button>
      )}
      {!apagado && verTodos && ocultos > 0 && (
        <button
          type="button"
          onClick={() => setVerTodos(false)}
          className="mt-1.5 text-[11px] text-text-subtle underline-offset-2 hover:text-text hover:underline"
        >
          {t('admin.courses.aud_hide_empty', 'Ocultar los que no tienen gente')}
        </button>
      )}
      {!apagado && sinDatos && (
        <p className="mt-1.5 text-[11px] text-amber-500">
          {t('admin.courses.aud_nobody_classified', 'Todavía nadie está clasificado aquí, así que se muestran todos. Se acortará solo cuando se cargue la base de Talento Humano.')}
        </p>
      )}
    </div>
  )
}
