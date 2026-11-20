import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getStructuredAgentSessionTabsByPaneKey } from '@/components/native-chat/session/status/structured-agent-session-tabs'
import { resolveCliChatResumeSource } from '@/components/tab-bar/session-actions/cli-chat-resume-source'
import { useAppStore } from '@/store/index'
import {
  hasAiVaultSessionDragData,
  readAiVaultSessionDragData
} from '../resume/history/ai-vault-session-drag'

export const CHAT_MOVE_DRAG_TYPE = 'application/x-orca-chat-move'

/** A chat on its way to another workspace, or a CLI agent that continues there as a chat. */
export type ChatMoveDragPayload =
  | { kind?: 'chat'; sessionId: string; fromWorktreeId: string; agent?: string }
  | { kind: 'cli'; tabId: string; paneKey: string; fromWorktreeId: string }

/** Starts a move drag for a sidebar agent row; a terminal that cannot continue as a chat cancels it. */
export function startChatMoveDrag(
  event: React.DragEvent,
  agent: { paneKey: string; tab: { id: string; worktreeId: string } }
): void {
  event.stopPropagation()
  const state = useAppStore.getState()
  const tab = getStructuredAgentSessionTabsByPaneKey(state.unifiedTabsByWorktree).get(agent.paneKey)
  const cli = tab
    ? null
    : resolveCliChatResumeSource(state, { tab: agent.tab, paneKey: agent.paneKey })
  let payload: ChatMoveDragPayload
  if (tab) {
    payload = {
      sessionId: tab.entityId,
      fromWorktreeId: tab.worktreeId,
      ...(tab.agentSessionAgent ? { agent: tab.agentSessionAgent } : {})
    }
  } else if (cli && !cli.hostUpdateRequired) {
    payload = {
      kind: 'cli',
      tabId: cli.tabId,
      paneKey: cli.paneKey,
      fromWorktreeId: cli.workspaceId
    }
  } else {
    event.preventDefault()
    toast.error(
      translate(
        'auto.lib.chatMoveDrag.cannotMove',
        "This agent can't move: Orca can't continue its conversation as a chat."
      )
    )
    return
  }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(CHAT_MOVE_DRAG_TYPE, JSON.stringify(payload))
}

/** True for any drag the sidebar might move: an agent row or a Session History row. */
export function hasChatMoveDragData(dataTransfer: DataTransfer): boolean {
  return (
    Array.from(dataTransfer.types).includes(CHAT_MOVE_DRAG_TYPE) ||
    hasAiVaultSessionDragData(dataTransfer)
  )
}

function readOwnPayload(raw: string): ChatMoveDragPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const value = parsed as Record<string, unknown>
  if (typeof value.fromWorktreeId !== 'string') {
    return null
  }
  if (value.kind === 'cli') {
    return typeof value.tabId === 'string' && typeof value.paneKey === 'string'
      ? {
          kind: 'cli',
          tabId: value.tabId,
          paneKey: value.paneKey,
          fromWorktreeId: value.fromWorktreeId
        }
      : null
  }
  return typeof value.sessionId === 'string'
    ? {
        sessionId: value.sessionId,
        fromWorktreeId: value.fromWorktreeId,
        ...(typeof value.agent === 'string' ? { agent: value.agent } : {})
      }
    : null
}

/** The agent to move, or null for a history row that is not a chat (it has no workspace to leave). */
export function readChatMoveDragData(dataTransfer: DataTransfer): ChatMoveDragPayload | null {
  const raw = dataTransfer.getData(CHAT_MOVE_DRAG_TYPE)
  if (raw) {
    return readOwnPayload(raw)
  }
  const history = readAiVaultSessionDragData(dataTransfer)
  return history?.structuredSession
    ? {
        sessionId: history.structuredSession.sessionId,
        fromWorktreeId: history.structuredSession.workspaceId,
        agent: history.agent
      }
    : null
}
