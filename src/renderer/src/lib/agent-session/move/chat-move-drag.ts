import { getStructuredAgentSessionTabsByPaneKey } from '@/components/native-chat/session/status/structured-agent-session-tabs'
import { useAppStore } from '@/store/index'
import {
  hasAiVaultSessionDragData,
  readAiVaultSessionDragData
} from '../resume/history/ai-vault-session-drag'

export const CHAT_MOVE_DRAG_TYPE = 'application/x-orca-chat-move'

/** A chat on its way to another workspace: what the sidebar drop needs to move it. */
export type ChatMoveDragPayload = {
  sessionId: string
  fromWorktreeId: string
  agent?: string
}

/** Starts a move drag for a sidebar agent row that is a chat; anything else cancels the drag. */
export function startChatMoveDrag(event: React.DragEvent, paneKey: string): void {
  event.stopPropagation()
  const tab = getStructuredAgentSessionTabsByPaneKey(
    useAppStore.getState().unifiedTabsByWorktree
  ).get(paneKey)
  // Terminal agents run in their folder's process, so only chats can change workspace.
  if (!tab) {
    event.preventDefault()
    return
  }
  const payload: ChatMoveDragPayload = {
    sessionId: tab.entityId,
    fromWorktreeId: tab.worktreeId,
    ...(tab.agentSessionAgent ? { agent: tab.agentSessionAgent } : {})
  }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(CHAT_MOVE_DRAG_TYPE, JSON.stringify(payload))
}

/** True for any drag the sidebar might move: a chat row or a Session History row. */
export function hasChatMoveDragData(dataTransfer: DataTransfer): boolean {
  return (
    Array.from(dataTransfer.types).includes(CHAT_MOVE_DRAG_TYPE) ||
    hasAiVaultSessionDragData(dataTransfer)
  )
}

/** The chat to move, or null for a history row that is not a chat (it has no workspace to leave). */
export function readChatMoveDragData(dataTransfer: DataTransfer): ChatMoveDragPayload | null {
  const raw = dataTransfer.getData(CHAT_MOVE_DRAG_TYPE)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (
        parsed &&
        typeof parsed === 'object' &&
        'sessionId' in parsed &&
        'fromWorktreeId' in parsed &&
        typeof parsed.sessionId === 'string' &&
        typeof parsed.fromWorktreeId === 'string'
      ) {
        return {
          sessionId: parsed.sessionId,
          fromWorktreeId: parsed.fromWorktreeId,
          ...('agent' in parsed && typeof parsed.agent === 'string' ? { agent: parsed.agent } : {})
        }
      }
    } catch {
      return null
    }
    return null
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
