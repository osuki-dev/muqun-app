import { homeTargetKey, type HomeTarget } from '@/lib/home-recents';
import type { OpenCodeReadiness } from '@/lib/home-opencode-readiness';
import { homeWorkspaceHandoffStore } from '@/lib/home-workspace-handoff';
import { DEMO_SSH_HOST_ID } from '@/lib/demo-ssh-transcript';

export type { HomeTarget } from '@/lib/home-recents';

/**
 * Home may expose the offline demo shell as an SSH-looking destination, but
 * its host is not persisted in the SSH store. Keep that synthetic identity
 * valid only while the demo is the selected gateway; a stale recent entry
 * must never open the demo shell after leaving demo mode.
 */
export function isHomeSshTargetAvailable(
  hostId: string,
  persistedHostIds: readonly string[],
  demoActive: boolean
): boolean {
  return persistedHostIds.includes(hostId) || (demoActive && hostId === DEMO_SSH_HOST_ID);
}

/**
 * Home's command boundary.
 *
 * This module knows how to sequence a Home intent and how to reject stale
 * asynchronous work. It deliberately knows nothing about React Native,
 * Expo Router, storage, or a gateway client. Those concerns are supplied by
 * the hook adapter so the same controller can be exercised with small fake
 * ports and future Home layouts can share it.
 */

export type HomeServerEntry = {
  kind: 'gateway-terminal';
  serverId: string;
  sessionId?: string;
  workspaceId?: string;
  tabId?: string;
  paneId?: string;
};

export type HomeOpenCodeEntry = {
  kind: 'opencode-session';
  serverId: string;
  /** Gateway routing session, when a recent target supplies it. */
  sessionId?: string;
  directory?: string;
  /** OpenCode agent session identity, when a recent target supplies it. */
  asid?: string;
};

export type HomeCommand =
  | { type: 'resume-server'; target: HomeServerEntry }
  | { type: 'resume-target'; target: HomeTarget }
  | { type: 'open-opencode'; target: HomeOpenCodeEntry }
  | { type: 'new-opencode'; serverId: string; directory?: string }
  | { type: 'new-terminal'; serverId: string; workspaceId?: string }
  | { type: 'open-ssh'; hostId?: string }
  | { type: 'pair-gateway' }
  | { type: 'manage-connections' };

export type HomeSessionChoice = {
  id: string;
  label: string;
  kind: string;
};

export type HomeTerminalSelection = {
  /** The session the existing panels route should load first. */
  sessionId: string;
  /** The gateway's complete session choices for its explicit picker rail. */
  choices: readonly HomeSessionChoice[];
  label?: string;
};

export type HomeNavigation =
  | { type: 'server'; target: HomeServerEntry }
  | {
      type: 'opencode';
      target: HomeOpenCodeEntry;
      intent: 'existing' | 'new';
    }
  | {
      type: 'panels';
      serverId: string;
      selection: HomeTerminalSelection;
      intent?: 'new-terminal';
    }
  | { type: 'ssh'; hostId?: string }
  | { type: 'pair' }
  | { type: 'manage' };

export type HomeResumeServerResult = boolean | 'missing' | void;

export type HomeCommandPorts = {
  /** Whether a server target is still present in the current paired records. */
  hasServer: (serverId: string) => boolean;
  /** Synchronous selection for an already hydrated server record. */
  selectServerNow: (serverId: string) => boolean;
  /** Keychain-backed selection for a record not currently active. */
  selectServer: (serverId: string) => Promise<boolean>;
  /** Current global selection, used to reject an outside selection race. */
  selectedServerId?: () => string | null | undefined;
  /** The source Home route remains focused while its owner tree is replaced. */
  sourceRouteActive?: () => boolean;
  /** Read the existing server/session API needed by the panels picker. */
  loadTerminalSelection: (serverId: string) => Promise<HomeTerminalSelection | null>;
  /** Validate persisted terminal and SSH targets before routing to them. */
  validateTarget?: (target: Exclude<HomeTarget, { kind: 'opencode-session' }>) => Promise<boolean>;
  /** An adapter owns actual route calls and any transport warm ordering. */
  navigate: (destination: HomeNavigation) => void;
  /** Optional shared capability/setup gate for creating a new OpenCode session. */
  prepareNewOpenCode?: (serverId: string, directory?: string) => Promise<OpenCodeReadiness>;
  /**
   * Optional adapter for the existing server-open path. The guard remains
   * valid when the source Home owner unmounts, so an embedded adapter can
   * finish a cross-server handoff without retaining that component.
   */
  resumeServer?: (
    target: HomeServerEntry,
    isCurrent: () => boolean
  ) => HomeResumeServerResult | Promise<HomeResumeServerResult>;
};

export type HomeCommandResult =
  | { status: 'dispatched'; operationId: number }
  | { status: 'duplicate'; operationId: number }
  | { status: 'superseded'; operationId: number }
  | { status: 'missing-target'; operationId: number; target: string }
  | { status: 'unavailable'; operationId: number; message: string }
  | { status: 'setup-required'; operationId: number; readiness: OpenCodeReadiness }
  | { status: 'failed'; operationId: number; message: string };

type PendingOperation = { id: number; key: string; owner: symbol; survivesDispose: boolean };

// The coordinator belongs to the module rather than a React hook instance.
// Home has several layouts and cards, and one can unmount while another is
// still resolving a selection. Keeping ownership here makes those entry
// points share the same pending action without retaining a component ref.
let nextOperationId = 0;
let pendingOperation: PendingOperation | null = null;

/**
 * Route intent claims bridge the short gap between Home dispatch and the
 * destination screen mounting. A Home component can receive two taps before
 * Expo Router has mounted the first `/agent` route; the second must not become
 * a second creation request. The destination consumes the claim on mount.
 */
const newOpenCodeIntentClaims = new Map<string, number>();

export function consumeNewOpenCodeIntent(serverId: string, directory?: string): void {
  newOpenCodeIntentClaims.delete(newOpenCodeIntentKey(serverId, directory));
}

/**
 * A small operation controller shared by every Home entry point.
 *
 * A new user action supersedes an older pending selection. Equivalent actions
 * while a selection or creation is pending are duplicates and do not dispatch
 * a second request. Every async continuation checks this operation identity
 * immediately before navigation, so a late result cannot take the reader away
 * from the newer action they chose.
 */
export function createHomeCommandController(ports: HomeCommandPorts) {
  const owner = Symbol('home-command-owner');

  function begin(key: string, survivesDispose: boolean): PendingOperation | HomeCommandResult {
    if (pendingOperation?.key === key)
      return { status: 'duplicate', operationId: pendingOperation.id };
    homeWorkspaceHandoffStore.getState().clear();
    const operation = { id: ++nextOperationId, key, owner, survivesDispose };
    pendingOperation = operation;
    return operation;
  }

  function current(operation: PendingOperation): boolean {
    return pendingOperation?.id === operation.id && (ports.sourceRouteActive?.() ?? true);
  }

  function owns(operation: PendingOperation): boolean {
    return pendingOperation?.id === operation.id && pendingOperation.owner === owner;
  }

  function finish(operation: PendingOperation): void {
    if (owns(operation)) pendingOperation = null;
  }

  function dispose(): void {
    if (
      pendingOperation?.owner === owner &&
      (!pendingOperation.survivesDispose || !(ports.sourceRouteActive?.() ?? true))
    )
      pendingOperation = null;
  }

  function superseded(operation: PendingOperation): HomeCommandResult {
    // Release this operation when it is still the owner. `finish` is
    // ownership-aware, so a stale continuation cannot clear a newer action.
    finish(operation);
    return { status: 'superseded', operationId: operation.id };
  }

  function failed(operation: PendingOperation, error: unknown): HomeCommandResult {
    if (!current(operation)) return superseded(operation);
    finish(operation);
    return {
      status: 'failed',
      operationId: operation.id,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  function missing(operation: PendingOperation, target: string): HomeCommandResult {
    finish(operation);
    return { status: 'missing-target', operationId: operation.id, target };
  }

  function unavailable(operation: PendingOperation, message: string): HomeCommandResult {
    finish(operation);
    return { status: 'unavailable', operationId: operation.id, message };
  }

  function setupRequired(
    operation: PendingOperation,
    readiness: OpenCodeReadiness
  ): HomeCommandResult {
    finish(operation);
    return { status: 'setup-required', operationId: operation.id, readiness };
  }

  async function selectBeforeNavigate(
    operation: PendingOperation,
    serverId: string
  ): Promise<HomeCommandResult | null> {
    if (!serverId) return missing(operation, 'server');

    // Selecting an in-memory record is synchronous and still goes through the
    // same operation guard. A stale/not-yet-live rendered record can still be
    // selected from keychain storage, so always try that fallback before
    // treating the destination as missing.
    if (ports.selectServerNow(serverId)) return null;
    const selected = await ports.selectServer(serverId);
    if (!current(operation)) return superseded(operation);
    if (!selected) return missing(operation, serverId);
    return null;
  }

  function selectedServerStillOwns(
    operation: PendingOperation,
    serverId: string
  ): HomeCommandResult | null {
    if (!current(operation)) return superseded(operation);
    if (ports.selectedServerId && ports.selectedServerId() !== serverId)
      return superseded(operation);
    return null;
  }

  async function dispatch(command: HomeCommand): Promise<HomeCommandResult> {
    const operation = begin(
      commandKey(command),
      command.type === 'resume-server' ||
        (command.type === 'resume-target' && command.target.kind !== 'ssh-host') ||
        command.type === 'open-opencode' ||
        command.type === 'new-opencode' ||
        command.type === 'new-terminal'
    );
    if (!isOperation(operation)) return operation;

    try {
      switch (command.type) {
        case 'resume-server': {
          const { target } = command;
          if (!target.serverId || !ports.hasServer(target.serverId))
            return missing(operation, target.serverId || 'server');
          // The existing Home server path navigates immediately while its
          // adapter serializes selection and transport warming. Keeping this
          // callback separate prevents the command boundary from reordering
          // that transport-owned work.
          if (ports.resumeServer) {
            const committed = await ports.resumeServer(target, () => current(operation));
            if (committed === false) return superseded(operation);
            if (committed === 'missing') return missing(operation, target.serverId);
          } else {
            ports.navigate({ type: 'server', target });
          }
          if (!owns(operation)) return superseded(operation);
          finish(operation);
          return { status: 'dispatched', operationId: operation.id };
        }
        case 'resume-target': {
          const { target } = command;
          if (target.kind === 'ssh-host') {
            if (ports.validateTarget) {
              const valid = await ports.validateTarget(target);
              if (!current(operation)) return superseded(operation);
              if (!valid) return missing(operation, homeTargetKey(target));
            }
            ports.navigate({ type: 'ssh', hostId: target.hostId });
            finish(operation);
            return { status: 'dispatched', operationId: operation.id };
          }
          const selection = await selectBeforeNavigate(operation, target.serverId);
          if (selection) return selection;
          const ownership = selectedServerStillOwns(operation, target.serverId);
          if (ownership) return ownership;
          if (target.kind === 'gateway-terminal' && ports.validateTarget) {
            const valid = await ports.validateTarget(target);
            if (!current(operation)) return superseded(operation);
            if (!valid) return missing(operation, homeTargetKey(target));
            const validatedOwnership = selectedServerStillOwns(operation, target.serverId);
            if (validatedOwnership) return validatedOwnership;
          }
          if (target.kind === 'gateway-terminal') {
            if (ports.resumeServer) {
              const committed = await ports.resumeServer(target, () => current(operation));
              if (committed === false) return superseded(operation);
              if (committed === 'missing') return missing(operation, target.serverId);
            } else ports.navigate({ type: 'server', target });
            if (!owns(operation)) return superseded(operation);
            finish(operation);
            return { status: 'dispatched', operationId: operation.id };
          }
          ports.navigate({
            type: 'opencode',
            target,
            intent: 'existing',
          });
          finish(operation);
          return { status: 'dispatched', operationId: operation.id };
        }
        case 'open-opencode': {
          const selection = await selectBeforeNavigate(operation, command.target.serverId);
          if (selection) return selection;
          const ownership = selectedServerStillOwns(operation, command.target.serverId);
          if (ownership) return ownership;
          ports.navigate({ type: 'opencode', target: command.target, intent: 'existing' });
          finish(operation);
          return { status: 'dispatched', operationId: operation.id };
        }
        case 'new-opencode': {
          const selection = await selectBeforeNavigate(operation, command.serverId);
          if (selection) return selection;
          const ownership = selectedServerStillOwns(operation, command.serverId);
          if (ownership) return ownership;
          if (ports.prepareNewOpenCode) {
            const readiness = await ports.prepareNewOpenCode(command.serverId, command.directory);
            if (!current(operation)) return superseded(operation);
            const preparedOwnership = selectedServerStillOwns(operation, command.serverId);
            if (preparedOwnership) return preparedOwnership;
            if (readiness.status !== 'ready') return setupRequired(operation, readiness);
          }
          const intentKey = newOpenCodeIntentKey(command.serverId, command.directory);
          const claimedBy = newOpenCodeIntentClaims.get(intentKey);
          if (claimedBy !== undefined) {
            finish(operation);
            return { status: 'duplicate', operationId: claimedBy };
          }
          newOpenCodeIntentClaims.set(intentKey, operation.id);
          try {
            ports.navigate({
              type: 'opencode',
              target: {
                kind: 'opencode-session',
                serverId: command.serverId,
                ...(command.directory ? { directory: command.directory } : {}),
              },
              intent: 'new',
            });
          } catch (error) {
            newOpenCodeIntentClaims.delete(intentKey);
            throw error;
          }
          finish(operation);
          return { status: 'dispatched', operationId: operation.id };
        }
        case 'new-terminal': {
          const selection = await selectBeforeNavigate(operation, command.serverId);
          if (selection) return selection;
          const terminal = await ports.loadTerminalSelection(command.serverId);
          if (!current(operation)) return superseded(operation);
          if (ports.selectedServerId && ports.selectedServerId() !== command.serverId)
            return superseded(operation);
          if (!terminal) return unavailable(operation, 'This server has no terminal session.');
          if (!terminal.sessionId || terminal.choices.length === 0)
            return unavailable(operation, 'This server has no terminal session.');
          ports.navigate({
            type: 'panels',
            serverId: command.serverId,
            selection: terminal,
            intent: 'new-terminal',
          });
          finish(operation);
          return { status: 'dispatched', operationId: operation.id };
        }
        case 'open-ssh':
          if (command.hostId && ports.validateTarget) {
            const valid = await ports.validateTarget({ kind: 'ssh-host', hostId: command.hostId });
            if (!current(operation)) return superseded(operation);
            if (!valid) return missing(operation, command.hostId);
          }
          ports.navigate({ type: 'ssh', hostId: command.hostId });
          finish(operation);
          return { status: 'dispatched', operationId: operation.id };
        case 'pair-gateway':
          ports.navigate({ type: 'pair' });
          finish(operation);
          return { status: 'dispatched', operationId: operation.id };
        case 'manage-connections':
          ports.navigate({ type: 'manage' });
          finish(operation);
          return { status: 'dispatched', operationId: operation.id };
      }
    } catch (error) {
      return failed(operation, error);
    }
  }

  return { dispatch, dispose };
}

function isOperation(value: PendingOperation | HomeCommandResult): value is PendingOperation {
  return 'key' in value;
}

function commandKey(command: HomeCommand): string {
  switch (command.type) {
    case 'resume-server':
      return key(['resume-server', command.target]);
    case 'resume-target':
      return key(['resume-target', homeTargetKey(command.target)]);
    case 'open-opencode':
      return key(['open-opencode', command.target]);
    case 'new-opencode':
      return key(['new-opencode', command.serverId, command.directory ?? '']);
    case 'new-terminal':
      return key(['new-terminal', command.serverId, command.workspaceId ?? '']);
    case 'open-ssh':
      return key(['open-ssh', command.hostId ?? '']);
    case 'pair-gateway':
      return 'pair-gateway';
    case 'manage-connections':
      return 'manage-connections';
  }
}

function key(value: unknown): string {
  return JSON.stringify(value);
}

function newOpenCodeIntentKey(serverId: string, directory?: string): string {
  return key(['new-opencode-intent', serverId, directory ?? '']);
}
