// `agentSession.relocate` — the user moves a chat to another workspace on its host. The chat is
// closed first, so nothing holds its old location; the client reopens it where the reply says.

import { defineMethod } from '../../../core'
import '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-params'
import '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-continue-params'
import '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-rename-params'
import '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-queued-edit-params'
import { RelocateParams } from '../../../../../../shared/rpc-contract/structured-agent-session/structured-agent-session-relocate-params'
import {
  refuse,
  refuseUnclassified
} from '../../../../../../shared/agent-session/failures/agent-session-wire-refusals'
import {
  ensureStructuredHostInstalled,
  requireStructuredCapability,
  requireStructuredHost
} from '../creation/structured-agent-session-gate'
import { refuseAgentSessionMutation } from '../../../../../native-chat/agent-session-wire/operations/structured-agent-session-mutation-refusals'
import { runsForBot } from '../../../../../bots/bot-session-tabs'
import {
  captureStructuredSessionSurface,
  retireCapturedStructuredSessionSurface
} from '../../../../agent-session/lifecycle/structured-agent-session-close'
import { agentSessionRelocationAllowed } from '../../../../agent-session/records/agent-session-record-relocate'

export const STRUCTURED_AGENT_SESSION_RELOCATE_METHODS = [
  defineMethod({
    name: 'agentSession.relocate',
    permission: 'workspace',
    params: RelocateParams,
    handler: async (params, ctx) => {
      requireStructuredCapability(ctx)
      await ensureStructuredHostInstalled(ctx)
      const host = requireStructuredHost(ctx)
      const { sessionId } = params
      const record = host.deps.store.getConversation(sessionId)
      if (!record) {
        return refuseAgentSessionMutation(
          refuse(
            'agent_session_identity_required',
            { reason: 'recordMissing' },
            'This chat is no longer on this host.'
          )
        )
      }
      const to = await ctx.runtime.resolveStructuredAgentSessionWorkspaceLocation(
        params.workspaceId
      )
      if (!agentSessionRelocationAllowed(record.location, to)) {
        return refuseAgentSessionMutation(
          refuseUnclassified(
            'agent_session_conflict',
            'This chat can only move to another workspace on the same machine.'
          )
        )
      }
      // A bot's thread keeps running without a tab, and a turn in progress would lose its owner.
      if (runsForBot(ctx.runtime.bots, sessionId) || record.lastTurn?.state === 'open') {
        return refuseAgentSessionMutation(
          refuseUnclassified(
            'agent_session_conflict',
            'Wait for the agent to finish, then move it.'
          )
        )
      }
      const surface = captureStructuredSessionSurface(host, sessionId, ctx.runtime)
      try {
        const retired = await retireCapturedStructuredSessionSurface(
          host,
          sessionId,
          surface,
          ctx.runtime
        )
        if (retired.error !== undefined) {
          throw retired.error
        }
      } finally {
        await host.close(sessionId, 'user-close')
      }
      const moved = await host.serialize(sessionId, async () =>
        host.hasSession(sessionId)
          ? false
          : host.deps.store.relocateIdleChat({
              sessionId,
              from: record.location,
              to,
              now: Date.now()
            })
      )
      const now = host.deps.store.getConversation(sessionId)
      return {
        ok: true as const,
        moved,
        workspaceId: (now ?? record).location.workspaceId
      }
    }
  })
]
