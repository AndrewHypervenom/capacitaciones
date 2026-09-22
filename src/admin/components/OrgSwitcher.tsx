import { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Select } from '@/components/ui/Select'
import { Tooltip } from '@/components/ui/Tooltip'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/cn'
import { getActiveOrgId, getOrganizations, setActiveOrgId } from '@/services/org.service'
import type { Organization } from '@/types/database'

/**
 * Con qué organización trabaja el superadmin (LATAM, Brasil…). Todo el panel
 * lee de aquí sus CR, áreas y categorías. El resto del staff no elige: trabaja
 * en la suya, así que el selector ni se pinta. Tampoco con una sola org viva.
 */
export function OrgSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { isSuperAdmin } = useAuth()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [activeId, setActiveId] = useState('')

  useEffect(() => {
    if (!isSuperAdmin) return
    let alive = true
    Promise.all([getOrganizations(), getActiveOrgId()])
      .then(([list, active]) => {
        if (!alive) return
        setOrgs(list)
        setActiveId(active ?? '')
      })
      .catch(() => {})
    return () => { alive = false }
  }, [isSuperAdmin])

  if (!isSuperAdmin || orgs.length < 2) return null

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Tooltip label={t('admin.org_switcher.hint')} className="shrink-0" maxWidth={240}>
        <Building2 className="h-4 w-4 text-text-subtle" aria-hidden />
      </Tooltip>
      <div className="min-w-0 flex-1">
        <Select
          value={activeId}
          onChange={(id) => {
            if (!id || id === activeId) return
            setActiveOrgId(id, orgs.find((o) => o.id === id)?.default_campaign_id)
          }}
          options={orgs.map((o) => ({ value: o.id, label: o.name }))}
        />
      </div>
    </div>
  )
}
