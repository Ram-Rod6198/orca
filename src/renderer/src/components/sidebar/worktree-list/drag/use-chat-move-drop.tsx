import React, { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import {
  hasChatMoveDragData,
  readChatMoveDragData,
  type ChatMoveDragPayload
} from '@/lib/agent-session/move/chat-move-drag'
import { moveDraggedAgent } from '@/lib/agent-session/move/relocate-structured-session'

const DROP_HIGHLIGHT = ['ring-1', 'ring-ring', 'rounded-sm'] as const

type ChatDropTarget =
  | { kind: 'workspace'; element: HTMLElement; worktreeId: string }
  | { kind: 'project'; element: HTMLElement; projectId: string }
  | { kind: 'group'; element: HTMLElement; groupId: string }

function chatDropTargetAt(node: EventTarget | null): ChatDropTarget | null {
  if (!(node instanceof Element)) {
    return null
  }
  const workspace = node.closest<HTMLElement>('[data-worktree-id]')
  if (workspace?.dataset.worktreeId) {
    return { kind: 'workspace', element: workspace, worktreeId: workspace.dataset.worktreeId }
  }
  const project = node.closest<HTMLElement>('[data-chat-drop-project-id]')
  if (project?.dataset.chatDropProjectId) {
    return { kind: 'project', element: project, projectId: project.dataset.chatDropProjectId }
  }
  const group = node.closest<HTMLElement>('[data-chat-drop-group-id]')
  if (group?.dataset.chatDropGroupId) {
    return { kind: 'group', element: group, groupId: group.dataset.chatDropGroupId }
  }
  return null
}

/** A project's main checkout, or its only workspace: where a chat dropped on the project lands. */
function workspaceOfProject(projectId: string): string | null {
  const worktrees = useAppStore.getState().worktreesByRepo[projectId] ?? []
  return (worktrees.find((worktree) => worktree.isMainWorktree) ?? worktrees[0])?.id ?? null
}

function moveChatTo(chat: ChatMoveDragPayload, worktreeId: string | null): void {
  if (!worktreeId) {
    toast.error(
      translate(
        'auto.components.sidebar.chatMoveDrop.noWorkspace',
        'That project has no workspace to move the chat into yet.'
      )
    )
    return
  }
  void moveDraggedAgent(chat, worktreeId)
}

type ProjectPick = { chat: ChatMoveDragPayload; groupId: string; x: number; y: number }

/** Lets a chat row or Session History row drop onto a workspace, project or group in the sidebar.
 *  Every other drag goes to the list's own handlers unchanged. */
export function useChatMoveDrop({
  handleWorktreeDragOver,
  handleWorktreeDrop
}: {
  handleWorktreeDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  handleWorktreeDrop: (event: React.DragEvent<HTMLDivElement>) => void
}) {
  const t = useTranslate()
  const highlighted = useRef<HTMLElement | null>(null)
  const [pick, setPick] = useState<ProjectPick | null>(null)

  const highlight = useCallback((element: HTMLElement | null) => {
    if (highlighted.current === element) {
      return
    }
    highlighted.current?.classList.remove(...DROP_HIGHLIGHT)
    element?.classList.add(...DROP_HIGHLIGHT)
    highlighted.current = element
  }, [])

  useEffect(() => {
    const clear = () => highlight(null)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
      clear()
    }
  }, [highlight])

  const onDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasChatMoveDragData(event.dataTransfer)) {
        handleWorktreeDragOver(event)
        return
      }
      const target = chatDropTargetAt(event.target)
      highlight(target?.element ?? null)
      if (target) {
        event.preventDefault()
        // History rows offer only copy; a sidebar chat offers move.
        event.dataTransfer.dropEffect =
          event.dataTransfer.effectAllowed === 'copy' ? 'copy' : 'move'
      }
    },
    [handleWorktreeDragOver, highlight]
  )

  const onDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (
        !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      ) {
        highlight(null)
      }
    },
    [highlight]
  )

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!hasChatMoveDragData(event.dataTransfer)) {
        handleWorktreeDrop(event)
        return
      }
      highlight(null)
      const target = chatDropTargetAt(event.target)
      if (!target) {
        return
      }
      event.preventDefault()
      const chat = readChatMoveDragData(event.dataTransfer)
      if (!chat) {
        toast.error(
          translate(
            'auto.components.sidebar.chatMoveDrop.notChat',
            'Only chats can move between workspaces; terminal agents stay in their folder.'
          )
        )
        return
      }
      if (target.kind === 'workspace') {
        moveChatTo(chat, target.worktreeId)
      } else if (target.kind === 'project') {
        moveChatTo(chat, workspaceOfProject(target.projectId))
      } else {
        setPick({ chat, groupId: target.groupId, x: event.clientX, y: event.clientY })
      }
    },
    [handleWorktreeDrop, highlight]
  )

  const projects = pick
    ? useAppStore.getState().repos.filter((repo) => repo.projectGroupId === pick.groupId)
    : []
  const projectMenu = (
    <DropdownMenu
      open={pick !== null}
      onOpenChange={(open) => !open && setPick(null)}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: pick?.x ?? 0, top: pick?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-52" sideOffset={0} align="start">
        <DropdownMenuLabel>
          {t('auto.components.sidebar.chatMoveDrop.pickProject', 'Move chat to project')}
        </DropdownMenuLabel>
        {projects.length === 0 ? (
          <DropdownMenuItem disabled>
            {t('auto.components.sidebar.chatMoveDrop.emptyGroup', 'This group has no projects')}
          </DropdownMenuItem>
        ) : (
          projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onSelect={() => pick && moveChatTo(pick.chat, workspaceOfProject(project.id))}
            >
              {project.displayName}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return { dropHandlers: { onDragOver, onDragLeave, onDrop }, projectMenu }
}
