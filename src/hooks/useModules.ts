import { useState, useEffect, useMemo } from 'react'
import type { LearningModule } from '@/data/modules'
import {
  getVisibleModules,
  getAllPublishedModules,
  getPreviewModules,
  getVisibleModulesLite,
  getAllPublishedModulesLite,
  getPreviewModulesLite,
} from '@/services/modules.service'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/stores/authStore'
import { IS_LEARNER_PREVIEW } from '@/lib/previewMode'

const cache = new Map<string, LearningModule[]>()

// Clave de caché para superadmin: ve todos los módulos publicados, sin campaña
const ALL_KEY = '__all__'
// Vista previa del staff: incluye borradores (lo que se está armando)
const PREVIEW_KEY = '__preview__'
// Aprendiz sin campaña asignada: solo los módulos que cuelgan de un curso que la
// RLS le deje leer (catálogo abierto). Antes la clave quedaba en null y no se
// consultaba nada: el catálogo se veía, pero al entrar decía "Módulo no
// encontrado".
const NO_CAMPAIGN_KEY = '__no_campaign__'
// Prefijo de las entradas SIN contenido de secciones (ver el `lite` de abajo).
const LITE_PREFIX = 'lite:'

/**
 * `lite: true` trae la lista SIN el contenido de las secciones (`blocks_data`).
 *
 * Es lo que debe pedir cualquier pantalla que solo cuenta módulos, arma enlaces
 * o muestra títulos: la consulta completa embebe el cuerpo entero de cada
 * módulo y, para un superadmin (que ve todo lo publicado de la plataforma), eso
 * son megabytes de JSON por cada pestaña nueva. Solo las pantallas que RENDERIZAN
 * un módulo —ModulePage y los editores— necesitan la versión completa.
 *
 * Las dos versiones tienen cachés separadas, así que pedir la ligera nunca puede
 * dejar a otra pantalla con módulos sin secciones.
 */
export function useModules(opts: { lite?: boolean } = {}) {
  const { lite = false } = opts
  const { campaignId: profileCampaignId, isSuperAdmin, loading: authLoading } = useAuth()
  // Rol REAL (useAuth lo reporta como 'learner' dentro de la vista previa).
  const realRole = useAuthStore((s) => s.profile?.role ?? null)
  const previewMode =
    IS_LEARNER_PREVIEW && (realRole === 'superadmin' || realRole === 'capacitador')

  // Superadmin no depende de campaña: carga todo lo publicado
  const baseKey = authLoading
    ? null
    : previewMode
      ? PREVIEW_KEY
      : isSuperAdmin ? ALL_KEY : (profileCampaignId ?? NO_CAMPAIGN_KEY)
  // La caché ligera vive en su propio espacio: una entrada ligera jamás puede
  // responder a quien pidió el contenido completo.
  const cacheKey = baseKey === null ? null : lite ? `${LITE_PREFIX}${baseKey}` : baseKey

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
      baseKey === PREVIEW_KEY
        ? (lite ? getPreviewModulesLite() : getPreviewModules())
        : baseKey === ALL_KEY
          ? (lite ? getAllPublishedModulesLite() : getAllPublishedModules())
          : (() => {
              const campaign = baseKey === NO_CAMPAIGN_KEY ? null : baseKey
              return lite ? getVisibleModulesLite(campaign) : getVisibleModules(campaign)
            })()
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
    // `baseKey` y `lite` son de donde SALE `cacheKey`: van en las dependencias por
    // corrección formal, pero no pueden disparar el efecto por su cuenta.
  }, [cacheKey, baseKey, lite, authLoading])

  // Módulos del Plan de Formación general (sin curso). Los módulos que
  // pertenecen a un curso se muestran/cuentan dentro de su curso.
  const planModules = useMemo(() => modules.filter((m) => !m.courseId), [modules])

  return { modules, planModules, loading, error }
}

export function invalidateModulesCache(campaignId?: string) {
  if (campaignId) {
    // Cada clave se borra en sus DOS versiones (completa y ligera): si solo se
    // limpiara una, la pantalla que pide la otra seguiría mostrando lo viejo.
    for (const key of [campaignId, ALL_KEY, NO_CAMPAIGN_KEY, PREVIEW_KEY]) {
      cache.delete(key)
      cache.delete(`${LITE_PREFIX}${key}`)
    }
  } else {
    cache.clear()
  }
}
