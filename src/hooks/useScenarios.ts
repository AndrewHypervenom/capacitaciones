import { useState, useEffect, useRef } from 'react'
import type { Scenario } from '@/data/scenarios'
import type { ChoiceScenario } from '@/data/choiceScenarios'
import { getScenariosForCampaign } from '@/services/scenarios.service'
import { getChoiceScenariosForCampaign } from '@/services/choiceScenarios.service'
import { useAuth } from '@/hooks/useAuth'

const scenarioCache = new Map<string, Scenario[]>()
const choiceCache = new Map<string, ChoiceScenario[]>()

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

export function useChoiceScenarios() {
  const { campaignId } = useAuth()
  const [choiceScenarios, setChoiceScenarios] = useState<ChoiceScenario[]>(() =>
    campaignId ? (choiceCache.get(campaignId) ?? []) : [],
  )
  const [loading, setLoading] = useState(true)
  const fetchedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!campaignId) {
      setChoiceScenarios([])
      setLoading(false)
      return
    }
    if (fetchedRef.current === campaignId && choiceCache.has(campaignId)) {
      setChoiceScenarios(choiceCache.get(campaignId)!)
      setLoading(false)
      return
    }
    setLoading(true)
    getChoiceScenariosForCampaign(campaignId)
      .then((data) => {
        choiceCache.set(campaignId, data)
        fetchedRef.current = campaignId
        setChoiceScenarios(data)
      })
      .catch(() => setChoiceScenarios([]))
      .finally(() => setLoading(false))
  }, [campaignId])

  return { choiceScenarios, loading }
}
