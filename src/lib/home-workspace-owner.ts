import { createStore } from 'zustand/vanilla';

/**
 * The lifetime boundary for Home's selected Gateway workspace.
 *
 * A compact Home starts with the server list, while a Pad with a selected
 * record starts in the existing task workspace. Once that workspace has been
 * activated, a width change must not replace it with a new tree. The selected
 * server remains the intentional identity boundary; a transient empty record
 * while storage is loading does not clear an owner that was already valid.
 */
export type HomeWorkspaceOwnerMode = 'compact' | 'pad';

export type HomeWorkspaceOwnerInput = {
  mode: HomeWorkspaceOwnerMode;
  loading: boolean;
  serverId: string | null | undefined;
  /** A selected Home composition can keep Pad on Home instead of the task owner. */
  preferList?: boolean;
  /** A blurred root may retain an existing owner, but cannot acquire its first one. */
  allowInitialActivation?: boolean;
};

type HomeWorkspaceHostState = {
  serverId: string | null;
  token: number;
  claim: (serverId: string) => number;
  release: (token: number) => void;
};

let nextHostToken = 0;

/**
 * The root Home route's one retained workspace host.
 *
 * A terminal route can be pushed above Home while the root screen is frozen by
 * the native stack. The route must know whether that existing host is still
 * alive before mounting another ServerTerminalWorkspace of its own.
 */
export const homeWorkspaceHostStore = createStore<HomeWorkspaceHostState>((set, get) => ({
  serverId: null,
  token: 0,
  claim(serverId) {
    const token = ++nextHostToken;
    set({ serverId, token });
    return token;
  },
  release(token) {
    if (get().token === token) set({ serverId: null, token: 0 });
  },
}));

export function claimHomeWorkspaceHost(serverId: string): number {
  return homeWorkspaceHostStore.getState().claim(serverId);
}

export function releaseHomeWorkspaceHost(token: number): void {
  homeWorkspaceHostStore.getState().release(token);
}

export type HomeWorkspaceRouteMode = 'route-owner' | 'root-handoff';

/** A deep link mounts its own task only when the frozen Home root has no host. */
export function homeWorkspaceRouteMode(rootOwnerServerId: string | null): HomeWorkspaceRouteMode {
  return rootOwnerServerId ? 'root-handoff' : 'route-owner';
}

/**
 * Returns the server whose task workspace should stay mounted, or `null` when
 * Home should continue showing its list presentation.
 */
export function reconcileHomeWorkspaceOwner(
  currentServerId: string | null,
  input: HomeWorkspaceOwnerInput
): string | null {
  // A Home composition preference controls cold startup only. Replacing an
  // already-mounted Pad workspace would destroy its terminal ownership when a
  // reader changes the preference in Settings.
  if (input.preferList && !currentServerId) return null;
  const serverId = input.serverId || null;

  // A concrete different record is an intentional target change, including
  // while its selection is still being hydrated. The task key is server
  // scoped, so this is the one transition that should replace the owner.
  if (serverId) {
    if (currentServerId) return serverId;
    return input.mode === 'pad' && !input.loading && input.allowInitialActivation !== false
      ? serverId
      : null;
  }

  // Storage hydration can briefly expose no record. Keep an already-mounted
  // owner through that gap; an authoritative, finished empty result clears it.
  return input.loading ? currentServerId : null;
}
