import { afterEach, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { migrateJournalDomainSchema } from './journal-domain-schema'
import { applyJournalWriterEffect } from './journal-writer-effects'
import { encodeAgentSessionRecord } from '../../../shared/agent-session/lifecycle/records/agent-session-record-stored-form'
import type { AgentSessionRecord } from '../../../shared/agent-session/lifecycle/agent-session-record'
import { agentSessionRecordFixture } from '../testing/agent-session-record-test-fixture'

const FROM = {
  executionHostId: 'local',
  wslDistro: null,
  workspaceId: 'repo::/workspaces/repo/main',
  workspaceKind: 'git-worktree'
} as const
const TO = { ...FROM, workspaceId: 'other::/workspaces/other/main' }

const RELEASED_LEASE = agentSessionRecordFixture({ sessionId: 'moving-chat' }).lease

const databases: Database.Database[] = []
afterEach(() => {
  for (const db of databases.splice(0)) {
    db.close()
  }
})

function journal(chat: Partial<AgentSessionRecord> = {}) {
  const db = new Database(':memory:')
  databases.push(db)
  migrateJournalDomainSchema(db)
  const record = {
    ...agentSessionRecordFixture({ sessionId: 'moving-chat', createdAt: 5_000, location: FROM }),
    lease: RELEASED_LEASE,
    launchDirectory: '/workspaces/repo/main',
    ...chat
  }
  db.prepare('INSERT INTO agent_session_records(session_id,record_json) VALUES(?,?)').run(
    record.sessionId,
    JSON.stringify(encodeAgentSessionRecord(record))
  )
  db.prepare(`INSERT INTO journal_chat_state(session_id,workspace_id,epoch,last_activity_at)
    VALUES('moving-chat',?,'current',5000)`).run(FROM.workspaceId)
  return db
}

function relocate(
  db: Database.Database,
  move: { from?: AgentSessionRecord['location']; to?: AgentSessionRecord['location'] } = {}
) {
  db.exec('BEGIN IMMEDIATE')
  const result = applyJournalWriterEffect(db, '/state', {
    kind: 'store',
    mutation: {
      input: {
        kind: 'command',
        command: {
          kind: 'relocate-idle',
          sessionId: 'moving-chat',
          from: move.from ?? FROM,
          to: move.to ?? TO,
          now: 30_000
        }
      }
    }
  })
  db.exec('COMMIT')
  return typeof result === 'object' && result !== null && 'value' in result ? result.value : null
}

function saved(db: Database.Database) {
  const record = JSON.parse(
    String(
      db
        .prepare("SELECT record_json FROM agent_session_records WHERE session_id='moving-chat'")
        .get()?.record_json
    )
  ) as AgentSessionRecord
  const head = db
    .prepare("SELECT workspace_id FROM journal_chat_state WHERE session_id='moving-chat'")
    .get()?.workspace_id
  return { record, head }
}

it('moves an idle chat and its journal head to the other workspace together', () => {
  const db = journal()
  expect(relocate(db)).toBe(true)
  const { record, head } = saved(db)
  expect(record.location).toEqual(TO)
  expect(head).toBe(TO.workspaceId)
  // The old folder must not be resumed in the new workspace.
  expect(record.launchDirectory).toBeUndefined()
})

const refusals: {
  name: string
  chat?: Partial<AgentSessionRecord>
  arrange?: (db: Database.Database) => void
  from?: AgentSessionRecord['location']
  to?: AgentSessionRecord['location']
}[] = [
  {
    name: 'an owner reserved it',
    chat: { lease: { ...RELEASED_LEASE, claimStatus: 'reserved', reservedSpawnToken: 'spawn' } }
  },
  { name: 'its last turn is still open', chat: { lastTurn: { state: 'open', at: 5_000 } } },
  {
    name: 'input waits to be sent',
    arrange: (db) =>
      db
        .prepare(`INSERT INTO journal_submission_attempts(session_id,epoch,message_id,attempt_sequence,
        attempt_index,current,item_id,ordinal,submitted_at,fingerprint,dispatch_state,payload_json)
        VALUES('moving-chat','current','send',1,0,1,'item-1',1,1,'fingerprint','pending','body')`)
        .run()
  },
  {
    name: 'queued text waits to be sent',
    arrange: (db) =>
      db
        .prepare(
          `INSERT INTO journal_queue_cards VALUES('moving-chat','current','queued',1,'waiting',1,NULL,'body')`
        )
        .run()
  },
  {
    name: 'it is recorded somewhere other than where the caller saw it',
    from: { ...FROM, workspaceId: 'repo::/workspaces/repo/elsewhere' }
  },
  { name: 'the target is on another machine', to: { ...TO, executionHostId: 'ssh:box' } },
  { name: 'the target is inside WSL', to: { ...TO, wslDistro: 'Ubuntu' } }
]

it.each(refusals)('leaves a chat where it is when $name', ({ chat, arrange, from, to }) => {
  const db = journal(chat)
  arrange?.(db)
  expect(relocate(db, { from, to })).toBe(false)
  const { record, head } = saved(db)
  expect(record.location).toEqual(FROM)
  expect(head).toBe(FROM.workspaceId)
})
