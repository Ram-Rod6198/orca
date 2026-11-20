import { ipcMain, shell } from 'electron'
import { stat } from 'node:fs/promises'
import { isLocallyOwned, validateLocalPathTarget } from './shell-owned-path-target'

const RUNNABLE_EXTENSION = /\.(bat|cmd|exe)$/i

/** A clicked link to a script or program on this Windows PC runs it; other opens keep the text/reveal rules. */
export async function runLinkedProgram(pathValue: string, ownerHostId: unknown): Promise<boolean> {
  if (process.platform !== 'win32' || !isLocallyOwned(ownerHostId)) {
    return false
  }
  const target = await validateLocalPathTarget(pathValue)
  if (!target.ok || !RUNNABLE_EXTENSION.test(target.path)) {
    return false
  }
  const file = await stat(target.path).catch(() => null)
  // Windows runs .bat/.cmd in a console window and starts .exe files.
  return file?.isFile() === true && (await shell.openPath(target.path)) === ''
}

export function registerRunLinkedProgramHandler(): void {
  ipcMain.handle('shell:runLinkedProgram', (_event, pathValue: string, ownerHostId: unknown) =>
    runLinkedProgram(pathValue, ownerHostId)
  )
}
