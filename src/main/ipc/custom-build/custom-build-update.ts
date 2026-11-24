import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'

/** A self-built Orca installs its updater here; builds without one show no update item. */
function customBuildUpdateScript(): string | null {
  const localAppData = process.env.LOCALAPPDATA
  if (process.platform !== 'win32' || !localAppData) {
    return null
  }
  const script = join(localAppData, 'orca-custom-build', 'update-my-orca.ps1')
  return existsSync(script) ? script : null
}

export function registerCustomBuildUpdateHandlers(): void {
  ipcMain.handle('app:customBuildUpdateAvailable', () => customBuildUpdateScript() !== null)
  ipcMain.handle('app:startCustomBuildUpdate', () => {
    const script = customBuildUpdateScript()
    if (!script) {
      return false
    }
    // Its own console window: the update quits and reinstalls Orca, so it must outlive this process.
    spawn(
      'cmd.exe',
      [
        '/c',
        'start',
        '"Update Orca"',
        'powershell.exe',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script
      ],
      { detached: true, stdio: 'ignore', windowsVerbatimArguments: false }
    ).unref()
    return true
  })
}
