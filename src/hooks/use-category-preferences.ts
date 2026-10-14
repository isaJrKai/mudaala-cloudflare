'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiDelete, apiGet, apiPost } from '@/lib/client'
import { CATEGORIES } from '@/lib/constants'
import { useSession } from '@/hooks/use-session'

type Interest = { category: string; score: number; lastSelectedAt: string }
type StoredGuestInterest = { category: string; score: number; lastSelectedAt: string }
const GUEST_KEY = 'mudaala:category-interests:guest'

function readGuestInterests(): Interest[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(GUEST_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is StoredGuestInterest =>
      item && typeof item.category === 'string' &&
      CATEGORIES.some((category) => category.key === item.category) &&
      typeof item.score === 'number' && typeof item.lastSelectedAt === 'string',
    )
  } catch {
    return []
  }
}

function effectiveScore(interest: Interest | undefined): number {
  if (!interest) return 0
  const ageDays = Math.max(0, (Date.now() - new Date(interest.lastSelectedAt).getTime()) / 86_400_000)
  // Half-life of 30 days: interests adapt instead of becoming permanent.
  return interest.score * Math.pow(0.5, ageDays / 30)
}

export function useCategoryPreferences() {
  const { user, isLoading } = useSession()
  const userId = user?.id
  const [interests, setInterests] = useState<Interest[]>([])
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setInterests([])
    setLoadedFor(null)
    if (isLoading) return () => { active = false }
    if (!userId) {
      setInterests(readGuestInterests())
      setLoadedFor('guest')
      return () => { active = false }
    }
    // Server-side memory is authoritative for signed-in users and is always
    // fetched anew when the account changes. Never read another account's
    // local preference state.
    apiGet<{ interests: Interest[] }>('/api/category-preferences')
      .then((result) => {
        if (active) setInterests(result.interests)
      })
      .catch(() => {
        // Browsing remains usable if personalization is temporarily offline.
      })
      .finally(() => {
        if (active) setLoadedFor(userId)
      })
    return () => { active = false }
  }, [userId, isLoading])

  const activeInterests = loadedFor === (userId ?? 'guest') ? interests : []

  const orderedCategories = useMemo(() => {
    const scores = new Map(activeInterests.map((interest) => [interest.category, effectiveScore(interest)]))
    return [...CATEGORIES].sort((a, b) => {
      const difference = (scores.get(b.key) ?? 0) - (scores.get(a.key) ?? 0)
      return Math.abs(difference) < 0.01 ? CATEGORIES.findIndex((item) => item.key === a.key) - CATEGORIES.findIndex((item) => item.key === b.key) : difference
    })
  }, [activeInterests])

  const recordCategorySelection = useCallback(async (category: string) => {
    const selectedAt = new Date().toISOString()
    setInterests((current) => {
      const existing = current.find((item) => item.category === category)
      const next = {
        category,
        score: Math.min(100, (existing?.score ?? 0) + 3),
        lastSelectedAt: selectedAt,
      }
      const merged = [...current.filter((item) => item.category !== category), next]
      if (!userId) {
        try { localStorage.setItem(GUEST_KEY, JSON.stringify(merged)) } catch { /* storage may be unavailable */ }
      }
      return merged
    })
    if (userId) {
      try {
        const result = await apiPost<{ interest: Interest }>('/api/category-preferences', { category })
        setInterests((current) => [...current.filter((item) => item.category !== category), result.interest])
      } catch {
        // The current visit still feels responsive; a later reload will use
        // the server's confirmed state rather than inventing persistence.
      }
    }
  }, [userId])

  const resetCategoryPreferences = useCallback(async () => {
    if (userId) {
      try {
        await apiDelete<{ reset: boolean }>('/api/category-preferences')
      } catch {
        // Keep the current state if the server did not confirm the reset.
        return
      }
    } else {
      try { localStorage.removeItem(GUEST_KEY) } catch { /* storage may be unavailable */ }
    }
    setInterests([])
  }, [userId])

  return {
    orderedCategories,
    recordCategorySelection,
    resetCategoryPreferences,
    hasCategoryPreferences: activeInterests.some((interest) => interest.score > 0),
  }
}
