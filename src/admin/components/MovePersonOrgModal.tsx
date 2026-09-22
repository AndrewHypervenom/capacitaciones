import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { COUNTRIES } from '@/lib/countries'
import { toast } from '@/stores/toastStore'
import {
  getOrganizationsIncludingHidden, getOrgUnits, invalidateOrganizations, movePersonToOrg,
} from '@/services/org.service'
import type { Organization, OrgUnit, Profile } from '@/types/database'

interface Props {
  user: Profile
  onClose: () => void
  onMoved: (orgId: string) => void
}

/**
 * Pasa a una persona de una organización a otra (LATAM ↔ Brasil). Solo
 * superadmin.
 *
 * No es cambiar un campo: la base le cambia la org, el CR y el área, la pasa
 * al contenedor interno de la org destino y le lleva su progreso (si no, vería
 * 0%). El CR y el área tienen que ser de la org destino, y su país también:
 * alguien de Colombia no se pasa a Brasil sin cambiarle antes el país.
 */
export function MovePersonOrgModal({ user, onClose, onMoved }: Props) {
  const { t } = useTranslation()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgId, setOrgId] = useState('')
  const [units, setUnits] = useState<OrgUnit[]>([])
  const [operationId, setOperationId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getOrganizationsIncludingHidden()
      .then((list) => {
        if (!alive) return
        const others = list.filter((o) => o.id !== user.org_id)
        setOrgs(others)
        if (others.length === 1) setOrgId(others[0].id)
      })
      .catch(() => { if (alive) setOrgs([]) })
    return () => { alive = false }
  }, [user.org_id])

  useEffect(() => {
    setOperationId('')
    setAreaId('')
    setUnits([])
    if (!orgId) return
    let alive = true
    getOrgUnits(orgId)
      .then((list) => { if (alive) setUnits(list) })
      .catch(() => { if (alive) setUnits([]) })
    return () => { alive = false }
  }, [orgId])

  const target = orgs.find((o) => o.id === orgId) ?? null
  const operations = useMemo(() => units.filter((u) => u.kind === 'operation'), [units])
  const areas = useMemo(() => units.filter((u) => u.kind === 'area'), [units])

  // Mismo candado que la base: un empleado tiene que ser de un país de la org.
  const targetCountries = target?.countries ?? []
  const countryMismatch =
    !!target &&
    !user.is_client &&
    targetCountries.length > 0 &&
    !targetCountries.includes((user.country ?? '').toUpperCase())
  const countryLabel = (() => {
    const c = COUNTRIES.find((x) => x.code === user.country)
    return c ? `${c.flag} ${c.name}` : t('admin.users.move_org_no_country')
  })()

  const canSave = !!target && !countryMismatch && !saving

  const handleSave = async () => {
    if (!canSave || !target) return
    setSaving(true)
    setError(null)
    try {
      const { progressRowsMoved } = await movePersonToOrg({
        userId: user.id,
        orgId: target.id,
        operationId: operationId || null,
        areaId: areaId || null,
      })
      invalidateOrganizations()
      toast.success(
        t('admin.users.move_org_done', { name: user.display_name ?? '', org: target.name }),
        t('admin.users.move_org_done_hint', { count: progressRowsMoved }),
      )
      onMoved(target.id)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      title={t('admin.users.move_org')}
      subtitle={user.display_name ?? user.id.slice(0, 8)}
      icon={<ArrowRightLeft className="h-4 w-4" />}
      accent="violet"
      size="md"
      dismissible={!saving}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-3 py-2 text-[13px] font-medium text-text-muted transition-colors hover:bg-glass/10 hover:text-text disabled:opacity-40"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-primary/12 px-3.5 py-2 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/18 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('admin.users.move_org_save')}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-text-muted">
            {t('admin.users.move_org_target')}
          </label>
          <Select
            value={orgId}
            onChange={setOrgId}
            placeholder={t('admin.users.move_org_pick')}
            options={orgs.map((o) => ({
              value: o.id,
              label: o.deleted_at ? `${o.name} · ${t('admin.users.move_org_hidden')}` : o.name,
            }))}
          />
        </div>

        {target && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-text-muted">
                  {t('admin.users.move_org_cr')}
                </label>
                <Select
                  value={operationId}
                  onChange={setOperationId}
                  placeholder={
                    operations.length ? t('admin.users.move_org_none') : t('admin.users.move_org_no_units')
                  }
                  options={[
                    { value: '', label: t('admin.users.move_org_none') },
                    ...operations.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                  disabled={operations.length === 0}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-text-muted">
                  {t('admin.users.move_org_area')}
                </label>
                <Select
                  value={areaId}
                  onChange={setAreaId}
                  placeholder={
                    areas.length ? t('admin.users.move_org_none') : t('admin.users.move_org_no_units')
                  }
                  options={[
                    { value: '', label: t('admin.users.move_org_none') },
                    ...areas.map((u) => ({ value: u.id, label: u.name })),
                  ]}
                  disabled={areas.length === 0}
                />
              </div>
            </div>

            {countryMismatch ? (
              <p className="text-[12px] leading-relaxed text-red-500">
                {t('admin.users.move_org_country_mismatch', { country: countryLabel, org: target.name })}
              </p>
            ) : (
              <p className="text-[12px] leading-relaxed text-text-muted">
                {t('admin.users.move_org_note', { org: target.name })}
              </p>
            )}
          </>
        )}

        {error && <p className="text-[12px] text-red-500">{error}</p>}
      </div>
    </Modal>
  )
}
