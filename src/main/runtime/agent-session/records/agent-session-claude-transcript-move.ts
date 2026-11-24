import { constants } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { agentSessionAccountHomePath } from '../../../../shared/agent-session/lifecycle/accounts/agent-session-account-home'
import { encodeClaudeProjectPath } from '../../../ai-vault/scanners/claude/claude-project-dir-encoding'
import { resolveSessionFilePath } from '../../../native-chat/session-file-resolver'

/**
 * Claude resumes a conversation from the launch folder's project bucket, so a chat moving to another
 * folder takes a copy of its transcript there. The original stays, so the old folder keeps its history.
 */
export async function copyClaudeTranscriptToFolder(
  record: Pick<AgentSessionRecord, 'provider' | 'providerHandleChain' | 'accountHome'>,
  fromFolder: string,
  toFolder: string
): Promise<void> {
  const providerSessionId = record.providerHandleChain.at(-1)?.handle.nativeId
  const home = agentSessionAccountHomePath(record.accountHome)
  if (record.provider !== 'claude' || !providerSessionId || !home || fromFolder === toFolder) {
    return
  }
  const projects = join(home, 'projects')
  const transcript = await resolveSessionFilePath('claude', providerSessionId, {
    claudeProjectsDir: projects,
    cwd: fromFolder
  })
  if (!transcript) {
    return
  }
  const bucket = join(projects, encodeClaudeProjectPath(toFolder))
  await mkdir(bucket, { recursive: true })
  // A copy already in the new folder is the conversation's own later history; keep it.
  await copyFile(transcript, join(bucket, basename(transcript)), constants.COPYFILE_EXCL).catch(
    (error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error
      }
    }
  )
}
