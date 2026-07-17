import { useState, useEffect, useRef } from 'react'
import type { Scenario } from '@/data/scenarios'
import { getScenariosForCampaign } from '@/services/scenarios.service'
import { useAuth } from '@/hooks/useAuth'

const scenarioCache = new Map<string, Scenario[]>()

export function useScenarios() {
  const { campaignId } = useAuth()
  const [scenarios, setScenarios] = useState<Scenario[]>(() =>
    campaignId ? (scenarioCache.get(campaignId) ?? []) : [],
  )
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!campaignId) {
      setScenarios([])
      setLoading(false)
      return
    }
    if (fetchedRef.current === campaignId && scenarioCache.has(campaignId)) {
      setScenarios(scenarioCache.get(campaignId)!)
      setLoading(false)
      return
    }
    setLoading(true)
    getScenariosForCampaign(campaignId)
      .then((data) => {
        scenarioCache.set(campaignId, data)
        fetchedRef.current = campaignId
        setScenarios(data)
      })
      .catch(() => setScenarios([]))
      .finally(() => setLoading(false))
  }, [campaignId])

  return { scenarios, loading }
}
