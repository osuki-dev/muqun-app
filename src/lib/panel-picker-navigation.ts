type PanelPickerDestination = 'picker' | 'workspace' | 'previous';

/** A Home creation flow has no task screen underneath it to receive a pick. */
export function panelPickerDestination({
  newTerminal,
  embedded,
  choice,
  sameServer,
}: {
  newTerminal: boolean;
  embedded: boolean;
  choice: 'session' | 'pane';
  sameServer: boolean;
}): PanelPickerDestination {
  if (newTerminal && choice === 'session') return 'picker';
  if (embedded) return 'previous';
  if (newTerminal || !sameServer) return 'workspace';
  return 'previous';
}
