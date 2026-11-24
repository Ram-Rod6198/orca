import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { createNonSecureContextUuid } from '../../../../../shared/identifiers/non-secure-context-uuid'
import type { AiVaultSessionTitle } from '../../../../../shared/ai-vault/contracts/ai-vault-session-title'
import { adoptAgentSessionLaunchVerdict } from '../launch/routing/agent-session-launch-plan'
import {
  beginStructuredAgentSessionProvisionalLaunch,
  structuredLaunchOwner
} from '../structured-agent-session-provisional-tab'
import { adoptingAgentOnHost } from '@/components/right-sidebar/ai-vault/session-actions/ai-vault-session-resume-in-chat-launch'

/** A terminal whose agent has not reported this run, known only by the conversation its title names. */
export type TitledTerminalAgent = {
  tabId: string
  fromWorktreeId: string
  conversation: Pick<AiVaultSessionTitle, 'agent' | 'sessionId'>
}

const failed = () =>
  toast.error(
    translate(
      'auto.lib.chatMoveDrag.cannotMove',
      "This agent can't move: Orca can't continue its conversation as a chat."
    )
  )

/** Resumes the terminal's conversation as a chat where it lives, closes the terminal, and returns the chat. */
export async function continueTitledTerminalAsChat(
  terminal: TitledTerminalAgent
): Promise<string | null> {
  const worktreeId = terminal.fromWorktreeId
  const executionHostId = structuredLaunchOwner(
    { route: 'structured-native-chat' },
    worktreeId
  )?.executionHostId
  if (!executionHostId) {
    failed()
    return null
  }
  const agent = await adoptingAgentOnHost(terminal.conversation.agent, worktreeId, executionHostId)
  const launch = beginStructuredAgentSessionProvisionalLaunch({
    plan: adoptAgentSessionLaunchVerdict({
      route: 'structured-native-chat',
      requestId: createNonSecureContextUuid(),
      agent,
      worktreeId,
      executionHostId,
      resumeFrom: { providerSessionId: terminal.conversation.sessionId }
    }),
    hooks: {}
  })
  const settlement = launch ? await launch.settlement : null
  if (settlement?.kind !== 'structured') {
    if (!(settlement?.kind === 'failed' && settlement.notified)) {
      failed()
    }
    return null
  }
  // The chat now owns the conversation; its old CLI must not write to it too.
  useAppStore.getState().closeTab(terminal.tabId)
  return settlement.sessionId
}
