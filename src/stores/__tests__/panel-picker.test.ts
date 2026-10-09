import { beforeEach, expect, test } from 'bun:test';
import { usePanelPickerStore } from '../panel-picker';

beforeEach(() => usePanelPickerStore.setState({ pick: null, returnTarget: null }));

test('consuming a Lazygit pick preserves the exact server, session and origin pane', () => {
  const store = usePanelPickerStore.getState();
  store.choosePanel({
    serverId: 'server-a',
    paneId: 'git-pane',
    returnTo: { sessionId: 'session-a', paneId: 'origin-pane' },
  });
  store.clearPick();
  expect(usePanelPickerStore.getState().pick).toBeNull();
  expect(usePanelPickerStore.getState().returnTarget).toEqual({
    serverId: 'server-a',
    sessionId: 'session-a',
    paneId: 'git-pane',
    previousPaneId: 'origin-pane',
  });
});

test('returning or explicitly selecting another pane ends the excursion', () => {
  const store = usePanelPickerStore.getState();
  store.choosePanel({
    serverId: 'server-a',
    paneId: 'git-pane',
    returnTo: { sessionId: 'session-a', paneId: 'origin-pane' },
  });
  store.choosePanel({ serverId: 'server-a', paneId: 'origin-pane' });
  expect(usePanelPickerStore.getState().returnTarget).toBeNull();
  expect(usePanelPickerStore.getState().pick?.paneId).toBe('origin-pane');
});

test('ordinary panel picks never acquire a return target', () => {
  usePanelPickerStore.getState().choosePanel({ serverId: 'server-b', paneId: 'terminal-b' });
  expect(usePanelPickerStore.getState().returnTarget).toBeNull();
});
