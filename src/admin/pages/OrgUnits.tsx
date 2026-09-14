import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Building2, Layers, Loader2, Plus, RotateCcw, Search, Users } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fold } from '@/lib/normalize'
import { toast } from '@/stores/toastStore'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Tooltip } from '@/components/ui/Tooltip'
import { FadeIn } from '@/components/ui/motion'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { SaveDock } from '@/admin/components/SaveDock'
import { usePageDraft } from '@/admin/hooks/usePageDraft'
import {
  countCoursesByCategory, countPeopleByUnit, createOrgUnit, getAllOrgUnits,
  getOrganizations, renameOrgUnit, setOrgUnitActive,
} from '@/services/org.service'
import type { Organization, OrgUnit, OrgUnitKind } from '@/types/database'

/**
 * /admin/units — el catálogo cerrado de operaciones y áreas.
 *
 * Es la pieza de gobierno de la reestructura. Antes, quien necesitaba agrupar
 * gente creaba una campaña, y por eso terminaron conviviendo categorías de
 * formación, pilotos y equipos en la misma lista. Aquí las unidades las define
 * UNA sola persona (la RLS solo deja escribir al superadmin) y el resto elige
 * de la lista.
 *
 * El país no está aquí a propósito: ya vive en el perfil y su lista la da
 * `lib/countries.ts`. Tres ejes, dos tablas, ninguna duplicada.
 *
 * Sigue la convención del panel: renombrar es BORRADOR (se acumula en la barra
 * del pie y se guarda de una vez), mientras que crear y archivar son ÓRDENES y
 * se aplican al momento — igual que en Usuarios, donde editar el nombre espera
 * pero dar de baja no.
 */

/** Lo que el borrador edita: el nombre de cada unidad, por id. */
type NameDraft = Record<string, string>

/* La operación se llama CR (centro de resultados) porque así la nombra Talento
 * Humano en su base, y era absurdo que la misma cosa tuviera un nombre en la
 * nómina y otro aquí. La equivalencia va escrita en el tooltip de cada sitio
 * donde aparece la sigla: quien lleva años diciendo "operación" tiene que poder
 * reconocer su propio dato sin que nadie se lo explique. */
const KIND_LABEL: Record<OrgUnitKind, { one: string; many: string }> = {
  operation: { one: 'CR', many: 'CR' },
  area: { one: 'Área', many: 'Áreas' },
  category: { one: 'Categoría', many: 'Categorías' },
}

/** Qué clasifica cada catálogo. Las dos primeras son de gente; la tercera, de contenido. */
const KIND_HELP: Record<OrgUnitKind, string> = {
  operation: 'Clasifica PERSONAS. Es el CR de Talento Humano: los verdes vienen de la base maestra.',
  area: 'Clasifica PERSONAS. Sale de la nómina; es uno de los ejes para asignar formación.',
  category: 'Clasifica CURSOS: de qué trata cada uno. Es lo que el aprendiz ve y filtra.',
}

export default function OrgUnits() {
  const { t } = useTranslation()
  const confirm = useConfirm()

  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgId, setOrgId] = useState('')
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [counts, setCounts] = useState<{
    byOperation: Map<string, number>
    byArea: Map<string, number>
    unclassified: number
    total: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [kindTab, setKindTab] = useState<OrgUnitKind>('operation')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  /** Cuántos cursos usa cada categoría. Es el equivalente a "cuánta gente"
      del otro lado: sirve para avisar antes de archivar una que está en uso. */
  const [courseCounts, setCourseCounts] = useState<Map<string, number>>(new Map())

  /* ─── Carga ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    getOrganizations()
      .then((list) => {
        setOrgs(list)
        setOrgId((prev) => prev || list[0]?.id || '')
        if (list.length === 0) setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const reload = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    const [list, c, cc] = await Promise.all([
      getAllOrgUnits(orgId), countPeopleByUnit(orgId), countCoursesByCategory(),
    ])
    setUnits(list)
    setCounts(c)
    setCourseCounts(cc)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    void reload()
  }, [reload])

  /* ─── Borrador de nombres ───────────────────────────────────────────── */

  // La línea base: el nombre que hay en la base para cada unidad. Al recargar
  // se redefine sola y la barra del pie vuelve a cero.
  const savedNames = useMemo<NameDraft | null>(() => {
    if (loading) return null
    return Object.fromEntries(units.map((u) => [u.id, u.name]))
  }, [units, loading])

  const draft = usePageDraft<NameDraft>({
    id: 'org-units',
    saved: savedNames,
    enabled: !loading,
    // Un espacio al final no es un cambio: sin esto la barra diría "1 cambio
    // sin guardar" nada más tocar y salir de un campo.
    fingerprint: (v) =>
      JSON.stringify(Object.fromEntries(Object.entries(v).map(([k, name]) => [k, name.trim()]))),
    onSave: async (value) => {
      const changed = units.filter((u) => (value[u.id] ?? '').trim() !== u.name)
      const empty = changed.find((u) => !(value[u.id] ?? '').trim())
      if (empty) {
        toast.error(t('admin.units.name_required', 'Una unidad no puede quedarse sin nombre.'))
        return false
      }
      try {
        for (const u of changed) await renameOrgUnit(u.id, (value[u.id] ?? '').trim())
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
        return false
      }
      toast.success(
        t('admin.units.renamed', '{{count}} unidad renombrada', { count: changed.length }),
      )
      await reload()
      return true
    },
  })

  const nameOf = (u: OrgUnit) => draft.value?.[u.id] ?? u.name
  const setName = (id: string, name: string) =>
    draft.set((prev) => ({ ...prev, [id]: name }))

  /* ─── Órdenes: crear y archivar ─────────────────────────────────────── */

  const create = async () => {
    const name = newName.trim()
    if (!name || !orgId) return
    setCreating(true)
    try {
      await createOrgUnit({ orgId, kind: kindTab, name })
      setNewName('')
      toast.success(t('admin.units.created', 'Unidad creada'))
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const toggleArchive = async (u: OrgUnit) => {
    const usados =
      u.kind === 'operation' ? (counts?.byOperation.get(u.id) ?? 0)
      : u.kind === 'area' ? (counts?.byArea.get(u.id) ?? 0)
      : (courseCounts.get(u.id) ?? 0)
    if (u.is_active) {
      const ok = await confirm({
        title: t('admin.units.archive_title', 'Archivar “{{name}}”', { name: u.name }),
        // Archivar con gente dentro no rompe nada, pero hay que decirlo: esa
        // gente conserva la unidad y deja de poder elegirse para los demás.
        description:
          usados > 0
            ? u.kind === 'category'
              ? t(
                  'admin.units.archive_with_courses',
                  'Hay {{count}} curso con esta categoría. La conserva, pero nadie más podrá elegirla.',
                  { count: usados },
                )
              : t(
                  'admin.units.archive_with_people',
                  'Hay {{count}} persona con esta unidad. La conserva, pero nadie más podrá elegirla.',
                  { count: usados },
                )
            : t('admin.units.archive_empty', 'Dejará de aparecer al clasificar a alguien.'),
        confirmLabel: t('admin.units.archive', 'Archivar'),
        // Archivar es reversible (se reactiva con un clic): no merece el rojo.
        tone: 'default',
      })
      if (!ok) return
    }
    try {
      await setOrgUnitActive(u.id, !u.is_active)
      await reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  /* ─── Lo que se pinta ───────────────────────────────────────────────── */

  const visible = useMemo(() => {
    const q = fold(search)
    return units
      .filter((u) => u.kind === kindTab)
      .filter((u) => !q || fold(u.name).includes(q))
  }, [units, kindTab, search])

  const countFor = (kind: OrgUnitKind) => units.filter((u) => u.kind === kind).length

  if (orgs.length === 0 && !loading) {
    return (
      <div className="p-6">
        <p className="text-text-muted">
          {t(
            'admin.units.no_org',
            'Todavía no hay ninguna organización. Falta correr el SQL de la fase 2.',
          )}
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Encabezado */}
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-[-0.02em] flex items-center gap-2">
              <Layers className="w-6 h-6 text-brand-green" />
              {t('admin.units.title', 'Operaciones y áreas')}
              <Tooltip label={t('admin.units.cr_equals_operation')} maxWidth={280}>
                <span className="cursor-help rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-text-muted">
                  CR = operación
                </span>
              </Tooltip>
            </h1>
            <p className="text-sm text-text-muted max-w-[62ch]">
              {t(
                'admin.units.subtitle',
                'El catálogo con el que se clasifica a la gente. Solo se define aquí: en el resto del sitio se elige de esta lista.',
              )}
            </p>
          </div>
          {orgs.length > 1 && (
            <div className="min-w-[220px]">
              <Select
                value={orgId}
                onChange={setOrgId}
                options={orgs.map((o) => ({ value: o.id, label: o.name }))}
              />
            </div>
          )}
        </div>
      </FadeIn>

      {/* Cuánta gente falta por clasificar: el número que manda en la fase 3 */}
      {counts && (
        <FadeIn>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              icon={Users}
              label={t('admin.units.people', 'Personas')}
              value={counts.total}
            />
            <Stat
              icon={Building2}
              label={t('admin.units.units', 'Unidades')}
              value={units.length}
            />
            <Stat
              icon={Search}
              label={t('admin.units.unclassified', 'Sin clasificar')}
              value={counts.unclassified}
              alert={counts.unclassified > 0}
            />
          </div>
        </FadeIn>
      )}

      {/* Pestañas por eje */}
      <div className="flex flex-wrap items-center gap-2">
        {(['category', 'area', 'operation'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKindTab(k)}
            className={cn(
              'h-9 px-4 rounded-full text-sm border transition-colors',
              kindTab === k
                ? 'bg-brand-green text-white dark:text-black border-transparent'
                : 'bg-surface text-text-muted border-line hover:text-text',
            )}
          >
            {KIND_LABEL[k].many}
            <span className="ml-2 opacity-70 tabular-nums">{countFor(k)}</span>
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('admin.units.search', 'Buscar…')}
            className="h-9 pl-9 w-[200px] rounded-full"
          />
        </div>
      </div>

      <p className="text-[12px] text-text-muted -mt-2">{KIND_HELP[kindTab]}</p>

      {/* Alta */}
      <div className="flex flex-wrap gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
          placeholder={t('admin.units.new_placeholder', 'Nombre de la nueva {{kind}}', {
            kind: KIND_LABEL[kindTab].one.toLowerCase(),
          })}
          className="h-11 max-w-[340px]"
        />
        <Button onClick={create} disabled={!newName.trim() || creating} className="h-11">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {t('admin.units.add', 'Añadir')}
        </Button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-text-subtle" />
        </div>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-muted">
          {search
            ? t('admin.units.no_match', 'Nada coincide con la búsqueda.')
            : t(
                'admin.units.empty',
                'Todavía no hay ninguna. Créalas con los nombres oficiales de Talento Humano.',
              )}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((u) => {
            // En operación y área se cuenta GENTE; en categoría, CURSOS.
            const usados =
              u.kind === 'operation' ? (counts?.byOperation.get(u.id) ?? 0)
              : u.kind === 'area' ? (counts?.byArea.get(u.id) ?? 0)
              : (courseCounts.get(u.id) ?? 0)
            /* Marca de la transición: VERDE lo que trajo la base maestra de
               Talento Humano; queda en gris lo que ya estaba. La señal sale de
               `origin`, no de una lista escrita a mano que se quedaría
               desactualizada en cuanto entre un CR nuevo. */
            const fromRoster = u.kind === 'operation' && u.origin === 'roster'
            return (
              <li
                key={u.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-2xl border bg-surface px-4 py-3',
                  fromRoster ? 'border-brand-green/45' : 'border-line',
                  !u.is_active && 'opacity-55',
                )}
              >
                <Input
                  value={nameOf(u)}
                  onChange={(e) => setName(u.id, e.target.value)}
                  className="h-10 flex-1 min-w-[180px]"
                />
                {fromRoster && (
                  <Tooltip label={t('admin.units.origin_roster_hint')} maxWidth={280}>
                    <span className="cursor-help whitespace-nowrap rounded-full border border-brand-green/50 bg-brand-green/10 px-2 py-0.5 text-[11px] font-medium text-brand-green">
                      {t('admin.units.origin_roster')}
                    </span>
                  </Tooltip>
                )}
                <span className="text-sm text-text-muted tabular-nums whitespace-nowrap">
                  {u.kind === 'category'
                    ? t('admin.units.course_count', '{{count}} curso', { count: usados })
                    : t('admin.units.people_count', '{{count}} persona', { count: usados })}
                </span>
                <Tooltip
                  label={
                    u.is_active
                      ? t('admin.units.archive', 'Archivar')
                      : t('admin.units.restore', 'Reactivar')
                  }
                >
                  <Button variant="ghost" size="sm" onClick={() => toggleArchive(u)}>
                    {u.is_active ? (
                      <Archive className="w-4 h-4" />
                    ) : (
                      <RotateCcw className="w-4 h-4" />
                    )}
                  </Button>
                </Tooltip>
              </li>
            )
          })}
        </ul>
      )}

      <SaveDock
        pending={draft.pending(t('admin.units.title', 'Operaciones y áreas'))}
        onSave={draft.save}
        saving={draft.saving}
        onUndo={draft.undo}
        canUndo={draft.canUndo}
      />
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  alert,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  alert?: boolean
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3 flex items-center gap-3">
      <Icon className={cn('w-5 h-5', alert ? 'text-amber-500' : 'text-text-subtle')} />
      <div>
        <div className={cn('text-xl font-semibold tabular-nums', alert && 'text-amber-500')}>
          <AnimatedNumber value={value} />
        </div>
        <div className="text-xs text-text-muted">{label}</div>
      </div>
    </div>
  )
}
