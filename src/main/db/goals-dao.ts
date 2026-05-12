import { nanoid } from 'nanoid'
import { getDb } from './database'

export type SessionGoalStatus = 'active' | 'paused' | 'budget_limited' | 'complete'

export interface SessionGoalRow {
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

export interface SessionGoalUpdate {
  objective?: string
  status?: SessionGoalStatus
  tokenBudget?: number | null
}

export interface AccountGoalUsageArgs {
  sessionId: string
  timeDeltaSeconds: number
  tokenDelta: number
  expectedGoalId?: string | null
}

function normalizeStatusAfterBudget(
  status: SessionGoalStatus,
  tokensUsed: number,
  tokenBudget: number | null
): SessionGoalStatus {
  if (
    (status === 'active' || status === 'paused') &&
    tokenBudget !== null &&
    tokensUsed >= tokenBudget
  ) {
    return 'budget_limited'
  }
  return status
}

function validateGoalBudget(tokenBudget: number | null | undefined): void {
  if (tokenBudget !== undefined && tokenBudget !== null && tokenBudget <= 0) {
    throw new Error('goal budgets must be positive when provided')
  }
}

export function listGoals(): SessionGoalRow[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM session_goals ORDER BY updated_at DESC')
    .all() as SessionGoalRow[]
}

export function getGoal(sessionId: string): SessionGoalRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM session_goals WHERE session_id = ?').get(sessionId) as
    | SessionGoalRow
    | undefined
}

export function createGoal(args: {
  sessionId: string
  objective: string
  tokenBudget?: number | null
}): SessionGoalRow | null {
  validateGoalBudget(args.tokenBudget)
  const db = getDb()
  const now = Date.now()
  const status = normalizeStatusAfterBudget('active', 0, args.tokenBudget ?? null)
  const row = db
    .prepare(
      `INSERT INTO session_goals (
        session_id, goal_id, objective, status, token_budget,
        tokens_used, time_used_seconds, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
      ON CONFLICT(session_id) DO NOTHING
      RETURNING *`
    )
    .get(args.sessionId, nanoid(), args.objective, status, args.tokenBudget ?? null, now, now) as
    | SessionGoalRow
    | undefined

  return row ?? null
}

export function replaceGoal(args: {
  sessionId: string
  objective: string
  status?: SessionGoalStatus
  tokenBudget?: number | null
}): SessionGoalRow {
  validateGoalBudget(args.tokenBudget)
  const db = getDb()
  const now = Date.now()
  const status = normalizeStatusAfterBudget(args.status ?? 'active', 0, args.tokenBudget ?? null)
  return db
    .prepare(
      `INSERT INTO session_goals (
        session_id, goal_id, objective, status, token_budget,
        tokens_used, time_used_seconds, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        goal_id = excluded.goal_id,
        objective = excluded.objective,
        status = excluded.status,
        token_budget = excluded.token_budget,
        tokens_used = 0,
        time_used_seconds = 0,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
      RETURNING *`
    )
    .get(
      args.sessionId,
      nanoid(),
      args.objective,
      status,
      args.tokenBudget ?? null,
      now,
      now
    ) as SessionGoalRow
}

export function updateGoal(sessionId: string, patch: SessionGoalUpdate): SessionGoalRow | null {
  validateGoalBudget(patch.tokenBudget)
  const existing = getGoal(sessionId)
  if (!existing) return null

  const objective = patch.objective ?? existing.objective
  const tokenBudget = patch.tokenBudget !== undefined ? patch.tokenBudget : existing.token_budget
  const status = normalizeStatusAfterBudget(
    patch.status ?? existing.status,
    existing.tokens_used,
    tokenBudget
  )
  const now = Date.now()
  const db = getDb()
  return db
    .prepare(
      `UPDATE session_goals
       SET objective = ?,
           status = ?,
           token_budget = ?,
           updated_at = ?
       WHERE session_id = ?
       RETURNING *`
    )
    .get(objective, status, tokenBudget, now, sessionId) as SessionGoalRow | null
}

export function clearGoal(sessionId: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM session_goals WHERE session_id = ?').run(sessionId)
  return result.changes > 0
}

export function accountGoalUsage(args: AccountGoalUsageArgs): SessionGoalRow | null {
  const timeDeltaSeconds = Math.max(0, Math.floor(args.timeDeltaSeconds))
  const tokenDelta = Math.max(0, Math.floor(args.tokenDelta))
  if (timeDeltaSeconds === 0 && tokenDelta === 0) {
    return getGoal(args.sessionId) ?? null
  }

  const expectedGoalId = args.expectedGoalId?.trim() || null
  const db = getDb()
  const now = Date.now()
  return db
    .prepare(
      `UPDATE session_goals
       SET time_used_seconds = time_used_seconds + ?,
           tokens_used = tokens_used + ?,
           status = CASE
             WHEN status IN ('active', 'paused')
               AND token_budget IS NOT NULL
               AND tokens_used + ? >= token_budget
             THEN 'budget_limited'
             ELSE status
           END,
           updated_at = ?
       WHERE session_id = ?
         AND (? IS NULL OR goal_id = ?)
         AND status IN ('active', 'paused', 'budget_limited', 'complete')
       RETURNING *`
    )
    .get(
      timeDeltaSeconds,
      tokenDelta,
      tokenDelta,
      now,
      args.sessionId,
      expectedGoalId,
      expectedGoalId
    ) as SessionGoalRow | null
}
