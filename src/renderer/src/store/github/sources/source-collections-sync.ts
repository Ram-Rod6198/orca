import type { StoreApi } from 'zustand'
import type { AppState } from '../../types'
import { subscribeStoreWithStatuses } from '../../slices/runtime-status/views/runtime-status-subscriptions'
import { GitHubSourceCollections } from './source-collections'

/** Keeps collection owners in step with repo rows and host connections for the store's lifetime. */
export function createGitHubSourceCollections(store: StoreApi<AppState>) {
  const cache = new GitHubSourceCollections(store)
  subscribeStoreWithStatuses(store, (state, previous, statuses, previousStatuses) => {
    if (
      state.repos !== previous.repos ||
      statuses !== previousStatuses ||
      state.runtimeEnvironments !== previous.runtimeEnvironments ||
      state.sshConnectionStates !== previous.sshConnectionStates ||
      state.sshStateByEnvironment !== previous.sshStateByEnvironment
    ) {
      cache.sync(state.repos ?? [])
    }
  })
  return cache
}
