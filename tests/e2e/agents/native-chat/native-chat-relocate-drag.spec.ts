// A chat dragged from its workspace's agent rows onto another workspace moves there with its history.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import { test as base } from '../../desktop/electron-fixtures/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from '../../desktop/renderer-probes/store'
import { createChatOnHost, writeClaudeStub } from '../session-fixtures/structured-claude-stub'
import { buildFakeAgentCommandOverride } from '../session-fixtures/fake-agent-command-override'
import { resolveCliCommand } from '../../../../src/shared/shell/command-resolution/node-cli-command-resolution'

const STUB_SCRIPT = path.join(
  process.cwd(),
  'tests',
  'e2e',
  'fixtures',
  'structured-claude-stub.cjs'
)
const WINDOWS_DIRS = [
  path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'),
  process.env.SystemRoot ?? 'C:\\Windows',
  path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0'),
  path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd')
]

type Stub = { command: string; pathEnv: string }

/** The POSIX stub on macOS/Linux; on Windows a .cmd launcher for the same Node stub. */
function writeStub(dir: string): Stub | null {
  if (process.platform !== 'win32') {
    const stub = writeClaudeStub(dir)
    return stub
      ? { command: stub.command, pathEnv: [dir, '/usr/bin', '/bin'].join(path.delimiter) }
      : null
  }
  const pathEnv = [dir, ...WINDOWS_DIRS].join(path.delimiter)
  const emptyHome = path.join(dir, 'empty-home')
  mkdirSync(emptyHome)
  // A real claude reachable from this PATH or a fallback install dir would spend real usage.
  if (path.isAbsolute(resolveCliCommand('claude', { pathEnv, homePath: emptyHome }))) {
    return null
  }
  const command = path.join(dir, 'claude.cmd')
  const launchLog = path.join(dir, 'launches.jsonl')
  writeFileSync(command, `@"${process.execPath}" "${STUB_SCRIPT}" "${launchLog}" %*\r\n`)
  return { command, pathEnv }
}

const test = base.extend<{ stub: Stub }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright fixture callbacks require object destructuring here.
  stub: async ({}, provideFixture, testInfo) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-relocate-'))
    const stub = writeStub(dir)
    if (!stub) {
      rmSync(dir, { recursive: true, force: true })
      testInfo.skip(true, 'a real claude would shadow the stub')
      return
    }
    await provideFixture(stub)
    rmSync(dir, { recursive: true, force: true })
  },
  launchEnv: async ({ stub }, provideFixture) => {
    await provideFixture({ PATH: stub.pathEnv })
  }
})

const card = (page: Page, worktreeId: string) =>
  page.locator(`[data-worktree-id=${JSON.stringify(worktreeId)}]`)

const chatTabOwner = (page: Page, sessionId: string) =>
  page.evaluate((id) => {
    const tabs = window.__store?.getState().unifiedTabsByWorktree ?? {}
    return Object.entries(tabs).find(([, rows]) => rows.some((tab) => tab.entityId === id))?.[0]
  }, sessionId)

/** A chat that finished one turn in the main workspace, plus a second workspace of the same project. */
async function chatAndSecondWorkspace(page: Page, stub: Stub) {
  await waitForSessionReady(page)
  const from = await waitForActiveWorktree(page)
  await page.evaluate(
    async (command) => {
      await window.__store?.getState().updateSettings({
        nativeChatProviders: { claude: true, codex: true },
        defaultTuiAgent: 'claude',
        agentCmdOverrides: { claude: command }
      })
      // Chats launch a program path; the PowerShell `& path` form is only for terminal agents.
    },
    process.platform === 'win32' ? stub.command : buildFakeAgentCommandOverride(stub.command)
  )
  const sessionId = await createChatOnHost(page, from)
  const to = await page.evaluate(async (worktreeId) => {
    const state = window.__store?.getState()
    const owner = Object.values(state?.worktreesByRepo ?? {})
      .flat()
      .find((row) => row.id === worktreeId)
    if (!state || !owner) {
      throw new Error('the first workspace has no repository')
    }
    return (await state.createWorktree(owner.repoId, `relocate-${Date.now()}`, undefined, 'skip'))
      .worktree.id
  }, from)
  await expect.poll(() => chatTabOwner(page, sessionId), { timeout: 30_000 }).toBe(from)
  // The sidebar lists an agent once it reports, so finish one turn first.
  await page
    .locator(`[data-testid="sortable-tab"][data-tab-id$=${JSON.stringify(sessionId)}]`)
    .click()
  const chat = page.locator('[data-native-chat-root="true"]')
  await chat.getByRole('textbox').click()
  await page.keyboard.type('hello')
  await chat.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(chat.getByText('Stub reply.')).toBeVisible({ timeout: 30_000 })
  await expect(chatRow(page, from)).toBeVisible({ timeout: 30_000 })
  await expect(card(page, to)).toBeVisible()
  return { from, to, sessionId }
}

const chatRow = (page: Page, worktreeId: string) =>
  card(page, worktreeId).locator('.agent-disclosure-row').first()

async function expectMoved(page: Page, sessionId: string, from: string, to: string) {
  await expect.poll(() => chatTabOwner(page, sessionId), { timeout: 30_000 }).toBe(to)
  await expect(card(page, to).locator('.agent-disclosure-row')).toHaveCount(1, { timeout: 30_000 })
  await expect(card(page, from).locator('.agent-disclosure-row')).toHaveCount(0)
  // Opening the moved chat can raise a new workspace's setup prompt over the sidebar's last rows.
  await page
    .getByRole('button', { name: 'Dismiss setup scripts' })
    .click({ timeout: 5_000 })
    .catch(() => {})
}

test('dragging a chat onto another workspace moves it there', async ({ orcaPage: page, stub }) => {
  const { from, to, sessionId } = await chatAndSecondWorkspace(page, stub)
  await chatRow(page, from).dragTo(card(page, to))
  await expectMoved(page, sessionId, from, to)
})

test("dropping a chat on a project header moves it to the project's main workspace", async ({
  orcaPage: page,
  stub
}) => {
  const { from, to, sessionId } = await chatAndSecondWorkspace(page, stub)
  await chatRow(page, from).dragTo(card(page, to))
  await expectMoved(page, sessionId, from, to)
  await chatRow(page, to).dragTo(page.locator('[data-chat-drop-project-id]').first())
  await expectMoved(page, sessionId, to, from)
})

test('dropping a chat on a group header asks which project, then moves it there', async ({
  orcaPage: page,
  stub
}) => {
  const { from, to, sessionId } = await chatAndSecondWorkspace(page, stub)
  await chatRow(page, from).dragTo(card(page, to))
  await expectMoved(page, sessionId, from, to)
  const project = await page.evaluate(async (worktreeId) => {
    const state = window.__store?.getState()
    const repoId = Object.values(state?.worktreesByRepo ?? {})
      .flat()
      .find((row) => row.id === worktreeId)?.repoId
    const repo = state?.repos.find((row) => row.id === repoId)
    const group = await state?.createProjectGroup('Games', 'local')
    if (!state || !repo || !group || !(await state.moveProjectToGroup(repo, group.id))) {
      throw new Error('could not put the project in a group')
    }
    return { name: repo.displayName, groupId: group.id }
  }, from)
  const groupHeader = page.locator(`[data-chat-drop-group-id=${JSON.stringify(project.groupId)}]`)
  await expect(groupHeader).toBeVisible({ timeout: 30_000 })
  await chatRow(page, to).dragTo(groupHeader)
  const menu = page.getByRole('menu')
  await expect(menu.getByText('Move chat to project')).toBeVisible()
  await menu.getByRole('menuitem', { name: project.name }).click()
  await expectMoved(page, sessionId, to, from)
})

test('dropping a Session History chat on a workspace moves it there', async ({
  orcaPage: page,
  stub
}) => {
  const { from, to, sessionId } = await chatAndSecondWorkspace(page, stub)
  // The payload Session History rows write when they start a drag.
  await card(page, to).evaluate(
    (target, payload) => {
      const data = new DataTransfer()
      data.setData('application/x-orca-ai-vault-session', JSON.stringify(payload))
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data })
        )
      }
    },
    {
      kind: 'ai-vault-session',
      version: 1,
      agent: 'claude',
      sessionId,
      structuredSession: { sessionId, workspaceId: from },
      title: 'hello',
      command: ''
    }
  )
  await expectMoved(page, sessionId, from, to)
})
