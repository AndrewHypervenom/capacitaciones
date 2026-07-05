import { useState, useEffect, useMemo } from 'react'
import type { LearningModule } from '@/data/modules'
import { getVisibleModules } from '@/services/modules.service'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

const cache = new Map<string, LearningModule[]>()

export function useModules() {
  const { campaignId: profileCampaignId, isSuperAdmin } = useAuth()
  const [resolvedCampaignId, setResolvedCampaignId] = useState<string | null>(profileCampaignId)
  const [modules, setModules] = useState<LearningModule[]>(() =>
    profileCampaignId ? (cache.get(profileCampaignId) ?? []) : [],
  )
  // Start as not-loading when we already have cached data for this campaign
  const [loading, setLoading] = useState(
    () => !profileCampaignId || !cache.has(profileCampaignId),
  )
  const [error, setError] = useState<Error | null>(null)

  // Superadmin sin campaña asignada: usar la primera campaña activa
  useEffect(() => {
    if (profileCampaignId) {
      setResolvedCampaignId(profileCampaignId)
      return
    }
    if (isSuperAdmin) {
      supabase
        .from('campaigns')
        .select('id')
        .eq('is_active', true)
        .order('created_at')
        .limit(1)
        .single()
        .then(({ data }) => {
          if (data?.id) setResolvedCampaignId(data.id)
          else setLoading(false)
        })
    } else {
      setLoading(false)
    }
  }, [profileCampaignId, isSuperAdmin])

  useEffect(() => {
    if (!resolvedCampaignId) return

    // Use the module-level cache regardless of component lifecycle —
    // fetchedRef was instance-local and caused cache misses on every remount.
    if (cache.has(resolvedCampaignId)) {
      setModules(cache.get(resolvedCampaignId)!)
      setLoading(false)
      return
    }

    setLoading(true)
    getVisibleModules(resolvedCampaignId)
      .then((data) => {
        cache.set(resolvedCampaignId, data)
        setModules(data)
        setError(null)
      })
      .catch((err: Error) => {
        setError(err)
        setModules([])
      })
      .finally(() => setLoading(false))
  }, [resolvedCampaignId])

  // Módulos del Plan de Formación general (sin curso). Los módulos que
  // pertenecen a un curso se muestran/cuentan dentro de su curso.
  const planModules = useMemo(() => modules.filter((m) => !m.courseId), [modules])

  return { modules, planModules, loading, error }
}

export function invalidateModulesCache(campaignId?: string) {
  if (campaignId) {
    cache.delete(campaignId)
  } else {
    cache.clear()
  }
}
