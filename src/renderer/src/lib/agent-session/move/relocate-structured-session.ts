import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { runtimeTargetForOwnerEnvironment } from '@/runtime/rpc/targets/runtime-client-target'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from '../../workspace/ownership/worktree-runtime-owner'
import { activateAiVaultStructuredSession } from '../open/activate-ai-vault-structured-session'

// Closing, moving and reopening a chat waits on its agent's exit, which can take a few seconds.
const RELOCATE_TIMEOUT_MS = 30_000

type AgentSessionRelocateReply =
  | { ok: true; moved: boolean; workspaceId: string }
  | { ok: false; refusal: { code?: string; message?: string } }

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
  const state = useAppStore.getState()
  const owner = runtimeEnvironmentIdOrLocalUnlessTwin(state, move.fromWorktreeId)
  // A chat's files and agent stay on its machine, so it can only move between that machine's workspaces.
  if (owner !== runtimeEnvironmentIdOrLocalUnlessTwin(state, move.toWorktreeId)) {
    toast.error(
      translate(
        'auto.lib.relocateStructuredSession.otherHost',
        'A chat can only move to a workspace on the same machine.'
      )
    )
    return
  }
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
