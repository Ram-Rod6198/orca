import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/rpc/targets/runtime-client-target'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from '../../workspace/ownership/worktree-runtime-owner'
import { activateAiVaultStructuredSession } from '../open/activate-ai-vault-structured-session'
import { resolveCliChatResumeSource } from '@/components/tab-bar/session-actions/cli-chat-resume-source'
import { runCliChatResume } from '@/components/tab-bar/session-actions/cli-chat-resume-run'
import type { ChatMoveDragPayload } from './chat-move-drag'

// Closing, moving and reopening a chat waits on its agent's exit, which can take a few seconds.
const RELOCATE_TIMEOUT_MS = 30_000

type AgentSessionRelocateReply =
  | { ok: true; moved: boolean; workspaceId: string }
  | { ok: false; refusal: { code?: string; message?: string } }

/** The owner both workspaces share, or null (with a notice): an agent's files stay on its machine. */
function sameMachineOwner(fromWorktreeId: string, toWorktreeId: string) {
  const state = useAppStore.getState()
  const owner = runtimeEnvironmentIdOrLocalUnlessTwin(state, fromWorktreeId)
  if (owner === runtimeEnvironmentIdOrLocalUnlessTwin(state, toWorktreeId)) {
    return { owner }
  }
  toast.error(
    translate(
      'auto.lib.relocateStructuredSession.otherHost',
      'A chat can only move to a workspace on the same machine.'
    )
  )
  return null
}

/** A dropped agent row: a chat moves; a CLI agent continues as a chat there and its terminal closes. */
export async function moveDraggedAgent(
  agent: ChatMoveDragPayload,
  toWorktreeId: string
): Promise<void> {
  if (agent.kind !== 'cli') {
    return relocateStructuredSession({ ...agent, toWorktreeId })
  }
  if (!sameMachineOwner(agent.fromWorktreeId, toWorktreeId)) {
    return
  }
  const source = resolveCliChatResumeSource(useAppStore.getState(), {
    tab: { id: agent.tabId, worktreeId: agent.fromWorktreeId },
    paneKey: agent.paneKey
  })
  if (!source) {
    toast.error(
      translate(
        'auto.lib.chatMoveDrag.cannotMove',
        "This agent can't move: Orca can't continue its conversation as a chat."
      )
    )
    return
  }
  // Continue it as a chat where its conversation lives, then move that chat like any other.
  const chatsBefore = new Set(agentSessionIdsIn(agent.fromWorktreeId))
  await runCliChatResume(source, true)
  const chat = agentSessionIdsIn(agent.fromWorktreeId).find((id) => !chatsBefore.has(id))
  if (chat && toWorktreeId !== agent.fromWorktreeId) {
    await relocateStructuredSession({
      sessionId: chat,
      fromWorktreeId: agent.fromWorktreeId,
      toWorktreeId
    })
  }
}

function agentSessionIdsIn(worktreeId: string): string[] {
  return (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).flatMap((tab) =>
    tab.contentType === 'agent-session' && tab.entityId ? [tab.entityId] : []
  )
}

/** A chat dragged onto another workspace: the host moves it, then it opens where it now lives. */
export async function relocateStructuredSession(move: {
  sessionId: string
  fromWorktreeId: string
  toWorktreeId: string
  agent?: string
}): Promise<void> {
  if (move.fromWorktreeId === move.toWorktreeId) {
    return
  }
  const machine = sameMachineOwner(move.fromWorktreeId, move.toWorktreeId)
  if (!machine) {
    return
  }
  const { owner } = machine
  let reply: AgentSessionRelocateReply
  try {
    reply = await callRuntimeRpc<AgentSessionRelocateReply>(
      runtimeTargetForOwnerEnvironment(owner),
      'agentSession.relocate',
      { sessionId: move.sessionId, workspaceId: move.toWorktreeId },
      { timeoutMs: RELOCATE_TIMEOUT_MS }
    )
  } catch {
    toast.error(
      translate(
        'auto.lib.relocateStructuredSession.failed',
        "Orca couldn't move this chat. Try again in a moment."
      )
    )
    return
  }
  if (!reply.ok) {
    toast.error(
      reply.refusal.message ??
        translate(
          'auto.lib.relocateStructuredSession.failed',
          "Orca couldn't move this chat. Try again in a moment."
        )
    )
    return
  }
  if (!reply.moved) {
    toast.error(
      translate(
        'auto.lib.relocateStructuredSession.busy',
        'This chat has messages waiting to send, so it stayed where it was.'
      )
    )
  }
  // Reopen it either way: the move closed its tab first.
  await activateAiVaultStructuredSession({
    structuredSession: { sessionId: move.sessionId, workspaceId: reply.workspaceId },
    agent: move.agent
  })
}
