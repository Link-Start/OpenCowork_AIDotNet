import { create } from 'zustand'
import { ipcClient } from '../lib/ipc/ipc-client'

export type SessionGoalStatus = 'active' | 'paused' | 'budget_limited' | 'complete'

export interface SessionGoal {
  sessionId: string
  goalId: string
  objective: string
  status: SessionGoalStatus
  tokenBudget?: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

interface SessionGoalRow {
  session_id: string
  goal_id: string
  objective: string
  status: SessionGoalStatus
  token_budget: number | null
  tokens_used: number
  time_used_seconds: number
  created_at: number
  updated_at: number
}

interface GoalMutationResult {
  success?: boolean
  error?: string
  goal?: SessionGoalRow | null
  cleared?: boolean
}

interface AccountGoalUsageInput {
  sessionId: string
  timeDeltaSeconds: number
  tokenDelta: number
  expectedGoalId?: string | null
}

interface GoalStore {
  goalsBySession: Record<string, SessionGoal>
  _loaded: boolean

  loadGoalsFromDb: () => Promise<void>
  loadGoalForSession: (sessionId: string, force?: boolean) => Promise<SessionGoal | undefined>
  getGoalBySession: (sessionId: string) => SessionGoal | undefined
  createGoal: (args: {
    sessionId: string
    objective: string
    tokenBudget?: number | null
  }) => Promise<{ success: boolean; goal?: SessionGoal; error?: string }>
  setGoal: (args: {
    sessionId: string
    objective: string
    status?: SessionGoalStatus
    tokenBudget?: number | null
  }) => Promise<{ success: boolean; goal?: SessionGoal; error?: string }>
  updateGoal: (
    sessionId: string,
    patch: Partial<Pick<SessionGoal, 'objective' | 'status' | 'tokenBudget'>>
  ) => Promise<{ success: boolean; goal?: SessionGoal; error?: string }>
  clearGoal: (sessionId: string) => Promise<{ success: boolean; cleared: boolean; error?: string }>
  accountGoalUsage: (
    input: AccountGoalUsageInput
  ) => Promise<{ success: boolean; goal?: SessionGoal; error?: string }>
  applySyncedGoal: (goal: SessionGoal) => void
  applySyncedGoalClear: (sessionId: string) => void
}

function rowToGoal(row: SessionGoalRow): SessionGoal {
  return {
    sessionId: row.session_id,
    goalId: row.goal_id,
    objective: row.objective,
    status: row.status,
    tokenBudget: row.token_budget,
    tokensUsed: row.tokens_used,
    timeUsedSeconds: row.time_used_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function isGoalRow(value: GoalMutationResult | SessionGoalRow): value is SessionGoalRow {
  return 'session_id' in value
}

function asGoal(
  result: GoalMutationResult | SessionGoalRow | null | undefined
): SessionGoal | null {
  if (!result) return null
  const row = isGoalRow(result) ? result : result.goal
  return row ? rowToGoal(row) : null
}

function mutationError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type GoalStoreSetter = (
  partial: Partial<GoalStore> | ((state: GoalStore) => Partial<GoalStore>)
) => void

function upsertGoal(setState: GoalStoreSetter, goal: SessionGoal): void {
  setState((state) => ({
    goalsBySession: {
      ...state.goalsBySession,
      [goal.sessionId]: goal
    }
  }))
}

export const useGoalStore = create<GoalStore>((set, get) => ({
  goalsBySession: {},
  _loaded: false,

  loadGoalsFromDb: async () => {
    try {
      const rows = (await ipcClient.invoke('db:goals:list')) as SessionGoalRow[]
      const goalsBySession: Record<string, SessionGoal> = {}
      for (const row of rows) {
        const goal = rowToGoal(row)
        goalsBySession[goal.sessionId] = goal
      }
      set({ goalsBySession, _loaded: true })
    } catch (error) {
      console.error('[GoalStore] Failed to load goals:', error)
      set({ _loaded: true })
    }
  },

  loadGoalForSession: async (sessionId, force = false) => {
    const cached = get().goalsBySession[sessionId]
    if (cached && !force) return cached

    try {
      const row = (await ipcClient.invoke('db:goals:get', sessionId)) as SessionGoalRow | null
      const goal = row ? rowToGoal(row) : undefined
      set((state) => {
        const next = { ...state.goalsBySession }
        if (goal) {
          next[sessionId] = goal
        } else {
          delete next[sessionId]
        }
        return { goalsBySession: next }
      })
      return goal
    } catch (error) {
      console.error('[GoalStore] Failed to load goal:', error)
      return cached
    }
  },

  getGoalBySession: (sessionId) => get().goalsBySession[sessionId],

  createGoal: async (args) => {
    try {
      const result = (await ipcClient.invoke('db:goals:create', args)) as GoalMutationResult
      if (result.error) return { success: false, error: result.error }
      const goal = asGoal(result)
      if (!goal) return { success: false, error: 'Goal was not created' }
      upsertGoal(set, goal)
      return { success: true, goal }
    } catch (error) {
      return { success: false, error: mutationError(error) }
    }
  },

  setGoal: async (args) => {
    try {
      const result = (await ipcClient.invoke('db:goals:set', args)) as GoalMutationResult
      if (result.error) return { success: false, error: result.error }
      const goal = asGoal(result)
      if (!goal) return { success: false, error: 'Goal was not set' }
      upsertGoal(set, goal)
      return { success: true, goal }
    } catch (error) {
      return { success: false, error: mutationError(error) }
    }
  },

  updateGoal: async (sessionId, patch) => {
    try {
      const result = (await ipcClient.invoke('db:goals:update', {
        sessionId,
        patch
      })) as GoalMutationResult
      if (result.error) return { success: false, error: result.error }
      const goal = asGoal(result)
      if (!goal) return { success: false, error: 'Goal was not updated' }
      upsertGoal(set, goal)
      return { success: true, goal }
    } catch (error) {
      return { success: false, error: mutationError(error) }
    }
  },

  clearGoal: async (sessionId) => {
    try {
      const result = (await ipcClient.invoke('db:goals:clear', sessionId)) as GoalMutationResult
      if (result.error) return { success: false, cleared: false, error: result.error }
      set((state) => {
        const next = { ...state.goalsBySession }
        delete next[sessionId]
        return { goalsBySession: next }
      })
      return { success: true, cleared: result.cleared === true }
    } catch (error) {
      return { success: false, cleared: false, error: mutationError(error) }
    }
  },

  accountGoalUsage: async (input) => {
    try {
      const result = (await ipcClient.invoke('db:goals:account', input)) as GoalMutationResult
      if (result.error) return { success: false, error: result.error }
      const goal = asGoal(result)
      if (goal) upsertGoal(set, goal)
      return { success: true, ...(goal ? { goal } : {}) }
    } catch (error) {
      return { success: false, error: mutationError(error) }
    }
  },

  applySyncedGoal: (goal) => {
    upsertGoal(set, goal)
  },

  applySyncedGoalClear: (sessionId) => {
    set((state) => {
      const next = { ...state.goalsBySession }
      delete next[sessionId]
      return { goalsBySession: next }
    })
  }
}))

export function installGoalSyncListener(): () => void {
  const offUpdated = ipcClient.on('goal:updated', (payload: unknown) => {
    const row =
      payload && typeof payload === 'object' ? (payload as { goal?: SessionGoalRow }).goal : null
    if (!row) return
    useGoalStore.getState().applySyncedGoal(rowToGoal(row))
  })

  const offCleared = ipcClient.on('goal:cleared', (payload: unknown) => {
    const sessionId =
      payload && typeof payload === 'object'
        ? (payload as { sessionId?: unknown }).sessionId
        : undefined
    if (typeof sessionId === 'string') {
      useGoalStore.getState().applySyncedGoalClear(sessionId)
    }
  })

  return () => {
    offUpdated()
    offCleared()
  }
}
