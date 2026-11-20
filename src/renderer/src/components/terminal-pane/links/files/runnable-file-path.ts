import { isWindowsUserAgent } from '@/app-shell/platform/user-agent-platform'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../../shared/execution-host/execution-host'

/** Windows runs these when opened, so a click on a link to one launches it instead of showing its text. */
export function opensByRunning(filePath: string): boolean {
  return isWindowsUserAgent() && /\.(bat|cmd|exe)$/i.test(filePath)
}

/** Runs a script or program on this computer that a link names; false leaves the click to the usual open. */
export async function runLinkedLocalProgram(filePath: string): Promise<boolean> {
  return (
    opensByRunning(filePath) &&
    (await window.api.shell.runLinkedProgram?.(filePath, LOCAL_EXECUTION_HOST_ID)) === true
  )
}
