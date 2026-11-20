import type { AgentSessionStoreCommand } from './agent-session-store-command'
import type { AgentSessionStoreTransactions } from './agent-session-store-transactions'
import type { AgentSessionRecordCommand } from './agent-session-record-command'
import type { AgentSessionIdleForget } from './agent-session-record-forget'
import type { AgentSessionIdleRelocation } from './agent-session-record-relocate'

export abstract class AgentSessionRecordPublication {
  constructor(protected readonly transactions: AgentSessionStoreTransactions) {}
  abstract holdsRecords(): boolean
  /** Runs in the chat's journal lane after any conversion, so nothing opens the chat meanwhile. */
  protected abstract settleChatAtRest(
    sessionId: string,
    settle: () => Promise<boolean>
  ): Promise<boolean>

  /** Deletes a chat at rest for good, with its tab, when `stillWanted` agrees after any conversion
   *  of it. Its journal rows follow in background pages on the next maintenance tick, so a batch
   *  of deletions shares one pass. The caller holds the chat's conversation lane, so nothing opens
   *  it meanwhile. */
  forgetIdleChat = (
    forget: AgentSessionIdleForget,
    stillWanted: () => Promise<boolean>
  ): Promise<boolean> =>
    this.settleChatAtRest(
      forget.sessionId,
      async () =>
        (await stillWanted()) &&
        this.commitStoreCommand({
          kind: 'forget-idle',
          ...forget,
          legacyTabIds: this.transactions.legacySessionTabIds
        })
    )

  /** Moves a closed chat with its journal head to another workspace on its host; false leaves it.
   *  The caller holds the chat's conversation lane, so nothing reopens it meanwhile. */
  relocateIdleChat = (move: AgentSessionIdleRelocation): Promise<boolean> =>
    this.settleChatAtRest(move.sessionId, () =>
      this.commitStoreCommand({ kind: 'relocate-idle', ...move })
    )

  /** Notify committed death evidence from every transition; listeners must not throw. */
  onDeathEvidence(listener: (sessionId: string) => void): () => void {
    this.transactions.deathEvidenceListeners.add(listener)
    return () => this.transactions.deathEvidenceListeners.delete(listener)
  }

  /** Notify when committed records start or stop holding any chat; listeners must not throw. */
  onHeldChange(listener: () => void): () => void {
    this.transactions.heldChangeListeners.add(listener)
    return () => this.transactions.heldChangeListeners.delete(listener)
  }

  /** Each commit's written or removed record ids, and whether it changed which chats have tabs, once
   *  the commit is published. */
  onRecordsChanged = (
    listener: (sessionIds: readonly string[], tabsChanged: boolean) => void
  ): (() => void) => {
    this.transactions.recordsChanged.listeners.add(listener)
    return () => {
      this.transactions.recordsChanged.listeners.delete(listener)
    }
  }

  /** How many conversations `listConversations` lists, without listing them. */
  conversationCount = (): number =>
    this.transactions.state.records.size +
    [...this.transactions.state.unreadableRecords.values()].filter((row) => row.conversation).length

  /** The record's frozen row: a commit that writes it replaces it, so identity says it changed. */
  recordStamp = (sessionId: string): object | undefined =>
    this.transactions.state.records.get(sessionId) ??
    this.transactions.state.unreadableRecords.get(sessionId)

  protected commitRecordCommand<C extends AgentSessionRecordCommand>(
    id: string,
    command: C,
    check?: () => void
  ) {
    return this.transactions.record(id, command, check)
  }

  protected commitStoreCommand<C extends AgentSessionStoreCommand>(command: C, check?: () => void) {
    return this.transactions.command(command, check)
  }
}
