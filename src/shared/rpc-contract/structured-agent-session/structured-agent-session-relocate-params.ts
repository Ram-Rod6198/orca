// Split out of structured-agent-session-params.ts, which is at its line limit.

import { OptionsParams } from './structured-agent-session-params'
import { Identifier } from './structured-agent-session-identifiers'

// The host derives the rest of the target location itself, so a client cannot change host or distro.
export const RelocateParams = OptionsParams.extend({
  workspaceId: Identifier('Invalid workspace id')
}).strict()
