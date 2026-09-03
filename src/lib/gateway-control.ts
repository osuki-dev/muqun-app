import {
  createTab,
  createWorkspace,
  deletePane,
  deleteTab,
  deleteWorkspace,
  focusAgent,
  focusPane,
  focusTab,
  focusWorkspace,
  getAgent,
  getPane,
  readPaneOutput,
  renamePane,
  renameTab,
  renameWorkspace,
  sendAgentText,
  sendPaneKeys,
  sendPaneText,
  splitPane,
} from '@/lib/gateway-client';
import { selectCurrentSessionState, useSessionControlStore } from '@/stores/session-control';

export async function runGatewayAction(
  action: () => Promise<unknown>,
  success: string
): Promise<void> {
  const store = useSessionControlStore.getState();
  store.setBusy(true);
  store.setStatusMessage(null);
  try {
    await action();
    await useSessionControlStore.getState().refresh();
    useSessionControlStore.getState().setStatusMessage(success);
  } catch (err) {
    useSessionControlStore
      .getState()
      .setStatusMessage(err instanceof Error ? err.message : 'Action failed.');
  } finally {
    useSessionControlStore.getState().setBusy(false);
  }
}

export function selectWorkspace(sessionId: string, id: string): void {
  useSessionControlStore.getState().selectWorkspace(sessionId, id);
}

export function selectTab(sessionId: string, id: string): void {
  useSessionControlStore.getState().selectTab(sessionId, id);
}

export function selectPane(sessionId: string, id: string): void {
  useSessionControlStore.getState().selectPane(sessionId, id);
}

export function selectAgent(sessionId: string, id: string): void {
  useSessionControlStore.getState().selectAgent(sessionId, id);
}

export function focusWorkspaceCommand(sessionId: string, id: string): Promise<void> {
  selectWorkspace(sessionId, id);
  return runGatewayAction(() => focusWorkspace(sessionId, id), `Focused workspace ${id}`);
}

export function focusTabCommand(sessionId: string, id: string): Promise<void> {
  selectTab(sessionId, id);
  return runGatewayAction(() => focusTab(sessionId, id), `Focused tab ${id}`);
}

export function focusPaneCommand(sessionId: string, id: string): Promise<void> {
  selectPane(sessionId, id);
  return runGatewayAction(() => focusPane(sessionId, id), `Focused pane ${id}`);
}

export function focusAgentCommand(sessionId: string, id: string): Promise<void> {
  selectAgent(sessionId, id);
  return runGatewayAction(() => focusAgent(sessionId, id), `Focused agent ${id}`);
}

export function createWorkspaceCommand(
  sessionId: string,
  label: string,
  cwd: string
): Promise<void> {
  return runGatewayAction(
    () => createWorkspace(sessionId, compactPayload({ label, cwd, focus: true })),
    'Workspace created'
  );
}

export function renameWorkspaceCommand(sessionId: string, label: string): Promise<void> {
  const { selectedWorkspaceId } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(
    () => renameWorkspace(sessionId, selectedWorkspaceId, label),
    'Workspace renamed'
  );
}

export function deleteWorkspaceCommand(sessionId: string): Promise<void> {
  const { selectedWorkspaceId } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(
    () => deleteWorkspace(sessionId, selectedWorkspaceId),
    'Workspace deleted'
  );
}

export function createTabCommand(
  sessionId: string,
  workspaceId: string,
  label: string,
  cwd: string
): Promise<void> {
  return runGatewayAction(
    () =>
      createTab(sessionId, compactPayload({ workspace_id: workspaceId, label, cwd, focus: true })),
    'Tab created'
  );
}

export function renameTabCommand(sessionId: string, label: string): Promise<void> {
  const { selectedTabId } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(() => renameTab(sessionId, selectedTabId, label), 'Tab renamed');
}

export function deleteTabCommand(sessionId: string): Promise<void> {
  const { selectedTabId } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(() => deleteTab(sessionId, selectedTabId), 'Tab deleted');
}

export async function readPaneOutputCommand(sessionId: string, paneId?: string): Promise<void> {
  const store = useSessionControlStore.getState();
  const id = paneId || selectCurrentSessionState(store).selectedPaneId;
  if (!id) return;
  store.setBusy(true);
  store.setStatusMessage(null);
  try {
    store.selectPane(sessionId, id);
    store.setPaneOutput(sessionId, await readPaneOutput(sessionId, id));
  } catch (err) {
    store.setStatusMessage(err instanceof Error ? err.message : 'Failed to read pane output.');
  } finally {
    store.setBusy(false);
  }
}

export function sendPaneTextCommand(sessionId: string, text: string): Promise<void> {
  const { selectedPaneId } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(() => sendPaneText(sessionId, selectedPaneId, text), 'Text sent');
}

export function renamePaneCommand(sessionId: string, label: string): Promise<void> {
  const { selectedPaneId } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(() => renamePane(sessionId, selectedPaneId, label), 'Pane renamed');
}

export function loadPaneCommand(sessionId: string): Promise<void> {
  const { selectedPaneId } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(async () => {
    useSessionControlStore
      .getState()
      .setDetailJson(sessionId, JSON.stringify(await getPane(sessionId, selectedPaneId), null, 2));
  }, 'Pane loaded');
}

export function sendPaneKeysCommand(sessionId: string, keys: string[]): Promise<void> {
  const { selectedPaneId } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(() => sendPaneKeys(sessionId, selectedPaneId, keys), 'Keys sent');
}

export function splitPaneCommand(
  sessionId: string,
  direction: string,
  command: string
): Promise<void> {
  const { selectedPaneId } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(
    () =>
      splitPane(sessionId, selectedPaneId, {
        direction: direction.trim() || 'right',
        command: command.trim() ? [command.trim()] : undefined,
      }),
    'Pane split created'
  );
}

export function deletePaneCommand(sessionId: string): Promise<void> {
  const { selectedPaneId } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(() => deletePane(sessionId, selectedPaneId), 'Pane deleted');
}

export function sendAgentTextCommand(sessionId: string, text: string): Promise<void> {
  const { selectedAgentTarget } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(
    () => sendAgentText(sessionId, selectedAgentTarget, text),
    'Agent message sent'
  );
}

export function loadAgentCommand(sessionId: string): Promise<void> {
  const { selectedAgentTarget } = selectCurrentSessionState(useSessionControlStore.getState());
  return runGatewayAction(async () => {
    useSessionControlStore
      .getState()
      .setDetailJson(
        sessionId,
        JSON.stringify(await getAgent(sessionId, selectedAgentTarget), null, 2)
      );
  }, 'Agent loaded');
}

function compactPayload<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== '')
  ) as Partial<T>;
}
