import { useState, useEffect, useMemo } from 'react'
import type { LearningModule } from '@/data/modules'
import { getVisibleModules, getAllPublishedModules, getPreviewModules } from '@/services/modules.service'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'

const cache = new Map<string, LearningModule[]>()

// Clave de caché para superadmin: ve todos los módulos publicados, sin campaña
const ALL_KEY = '__all__'
// Vista previa del staff: incluye borradores (lo que se está armando)
const PREVIEW_KEY = '__preview__'

export function useModules() {
  const { campaignId: profileCampaignId, isSuperAdmin, loading: authLoading } = useAuth()
  // Rol REAL (useAuth lo reporta como 'learner' dentro de la vista previa).
  const realRole = useAuthStore((s) => s.profile?.role ?? null)
  const previewMode =
    IS_LEARNER_PREVIEW && (realRole === 'superadmin' || realRole === 'capacitador')

  // Superadmin no depende de campaña: carga todo lo publicado
  const cacheKey = authLoading
    ? null
    : previewMode
      ? PREVIEW_KEY
      : isSuperAdmin ? ALL_KEY : profileCampaignId

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
    const fetcher =
      cacheKey === PREVIEW_KEY
        ? getPreviewModules()
        : cacheKey === ALL_KEY
          ? getAllPublishedModules()
          : getVisibleModules(cacheKey)
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
