import {
  agentSessionExecutionLocationsEqual,
  type AgentSessionExecutionLocation
} from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { agentSessionLeaseIsReleased } from '../../../../shared/agent-session/lifecycle/leases/agent-session-lease-adjudication'
import { isFloatingWorkspaceId } from '../../../../shared/workspace/identity/floating-workspace-worktree'
import type { AgentSessionStoreState } from './agent-session-store-state'

/** A chat to move to another workspace on the same host, if it is still where the caller saw it. */
export type AgentSessionIdleRelocation = {
  sessionId: string
  from: AgentSessionExecutionLocation
  to: AgentSessionExecutionLocation
  now: number
}

/** Only the workspace changes: the host, distro and account a chat runs under are its identity. */
export function agentSessionRelocationAllowed(
  from: AgentSessionExecutionLocation,
  to: AgentSessionExecutionLocation
): boolean {
  return (
    from.executionHostId === to.executionHostId &&
    from.wslDistro === to.wslDistro &&
    from.workspaceId !== to.workspaceId &&
    // Floating ids resume a pinned folder rather than their workspace, so a move would not take.
    !isFloatingWorkspaceId(from.workspaceId) &&
    !isFloatingWorkspaceId(to.workspaceId)
  )
}

/** Moves the record when no owner holds it; false leaves it where it is. The writer moves its journal. */
export function relocateIdleAgentSessionRecord(
  state: AgentSessionStoreState,
  relocation: AgentSessionIdleRelocation
): boolean {
  const record = state.records.get(relocation.sessionId)
  if (
    !record ||
    !agentSessionExecutionLocationsEqual(record.location, relocation.from) ||
    !agentSessionRelocationAllowed(relocation.from, relocation.to) ||
    !agentSessionLeaseIsReleased(record.lease) ||
    record.lastTurn?.state === 'open'
  ) {
    return false
  }
  const { launchDirectory: _unused, ...rest } = record
  state.records.set(relocation.sessionId, {
    ...rest,
    location: relocation.to,
    updatedAt: relocation.now
  })
  return true
}
