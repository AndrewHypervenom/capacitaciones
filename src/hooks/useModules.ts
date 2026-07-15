import { useState, useEffect, useMemo } from 'react'
import type { LearningModule } from '@/data/modules'
import { getVisibleModules, getAllPublishedModules } from '@/services/modules.service'
import { useAuth } from '@/hooks/useAuth'

const cache = new Map<string, LearningModule[]>()

// Clave de caché para superadmin: ve todos los módulos publicados, sin campaña
const ALL_KEY = '__all__'

export function useModules() {
  const { campaignId: profileCampaignId, isSuperAdmin, loading: authLoading } = useAuth()

  // Superadmin no depende de campaña: carga todo lo publicado
  const cacheKey = authLoading ? null : isSuperAdmin ? ALL_KEY : profileCampaignId

  const [modules, setModules] = useState<LearningModule[]>(() =>
    cacheKey ? (cache.get(cacheKey) ?? []) : [],
  )
  const [loading, setLoading] = useState(() => !cacheKey || !cache.has(cacheKey))
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    // Mientras el perfil carga no sabemos rol ni campaña — seguimos en loading
    if (authLoading) return
    if (!cacheKey) {
      setModules([])
      setLoading(false)
      return
    }

    if (cache.has(cacheKey)) {
      setModules(cache.get(cacheKey)!)
      setLoading(false)
      return
    }

    setLoading(true)
    const fetcher = cacheKey === ALL_KEY ? getAllPublishedModules() : getVisibleModules(cacheKey)
    fetcher
      .then((data) => {
        cache.set(cacheKey, data)
        setModules(data)
        setError(null)
      })
      .catch((err: Error) => {
        setError(err)
        setModules([])
      })
      .finally(() => setLoading(false))
  }, [cacheKey, authLoading])

  // Módulos del Plan de Formación general (sin curso). Los módulos que
  // pertenecen a un curso se muestran/cuentan dentro de su curso.
  const planModules = useMemo(() => modules.filter((m) => !m.courseId), [modules])

  return { modules, planModules, loading, error }
}

export function invalidateModulesCache(campaignId?: string) {
  if (campaignId) {
    cache.delete(campaignId)
    cache.delete(ALL_KEY)
  } else {
    cache.clear()
  }
}
