import * as SecureStore from 'expo-secure-store';

export type QuickCommandMode = 'terminal' | 'agent';
export type QuickCommandKind = 'command' | 'keys';

export type QuickCommand = {
  id: string;
  label: string;
  value: string;
  mode: QuickCommandMode;
  kind?: QuickCommandKind;
  custom?: boolean;
};

const STORAGE_KEY = 'muqun.quick-commands.v1';
// Ids of built-in defaults the user has hidden. Kept separate from the custom
// list so a hidden default can be restored without losing the user's own ones.
const HIDDEN_KEY = 'muqun.quick-hidden.v1';

const defaults: QuickCommand[] = [
  { id: 'terminal-status', label: 'Git status', value: 'git status --short', mode: 'terminal' },
  { id: 'terminal-diff', label: 'Diff summary', value: 'git diff --stat', mode: 'terminal' },
  { id: 'terminal-pull', label: 'Pull', value: 'git pull --rebase', mode: 'terminal' },
  { id: 'terminal-log', label: 'Recent commits', value: 'git log --oneline -10', mode: 'terminal' },
  { id: 'terminal-path', label: 'Current path', value: 'pwd', mode: 'terminal' },
  { id: 'terminal-clear', label: 'Clear terminal', value: 'clear', mode: 'terminal' },
  { id: 'terminal-ctrl-c', label: 'Interrupt', value: 'ctrl+c', mode: 'terminal', kind: 'keys' },
  { id: 'terminal-ctrl-z', label: 'Suspend', value: 'ctrl+z', mode: 'terminal', kind: 'keys' },
  { id: 'terminal-escape', label: 'Escape', value: 'esc', mode: 'terminal', kind: 'keys' },
  // Clears the current input line -- what you just typed into the pane but have
  // not run yet. Ctrl+U is the readline erase-to-start binding.
  { id: 'terminal-clear-line', label: 'Clear line', value: 'ctrl+u', mode: 'terminal', kind: 'keys' },
  {
    id: 'agent-summary',
    label: 'Summarize progress',
    value: 'Summarize the current progress and remaining work.',
    mode: 'agent',
  },
  {
    id: 'agent-tests',
    label: 'Run relevant tests',
    value: 'Run the relevant tests and fix any failures.',
    mode: 'agent',
  },
  {
    id: 'agent-continue',
    label: 'Continue task',
    value: 'Continue with the current task.',
    mode: 'agent',
  },
  // Committing is asked of the agent rather than run as a shell command: it can
  // read the diff and write the message, which is the part worth not typing on
  // a phone.
  {
    id: 'agent-commit',
    label: 'Commit',
    value: 'Review the current changes and commit them with a clear message.',
    mode: 'agent',
  },
  {
    id: 'agent-commit-push',
    label: 'Commit & push',
    value: 'Review the current changes, commit them with a clear message, then push.',
    mode: 'agent',
  },
];

export async function loadQuickCommands(mode: QuickCommandMode): Promise<QuickCommand[]> {
  const [custom, hidden] = await Promise.all([loadCustomCommands(), loadHiddenIds()]);
  const visibleDefaults = defaults.filter((command) => !hidden.includes(command.id));
  return [...visibleDefaults, ...custom].filter((command) => command.mode === mode);
}

/** True when any built-in default is currently hidden, so a restore action can show. */
export async function hasHiddenDefaults(): Promise<boolean> {
  return (await loadHiddenIds()).length > 0;
}

/** Bring back every hidden built-in default. Custom commands are untouched. */
export async function restoreDefaultCommands(mode: QuickCommandMode): Promise<QuickCommand[]> {
  await SecureStore.deleteItemAsync(HIDDEN_KEY);
  return loadQuickCommands(mode);
}

export async function addQuickCommand(
  mode: QuickCommandMode,
  label: string,
  value: string,
  kind: QuickCommandKind = 'command'
): Promise<QuickCommand[]> {
  const commands = await loadCustomCommands();
  const next = [
    ...commands,
    {
      id: `custom-${Date.now().toString(36)}`,
      label: label.trim(),
      value: value.trim(),
      mode,
      kind: mode === 'agent' ? 'command' : kind,
      custom: true,
    } satisfies QuickCommand,
  ].slice(-24);
  await saveCustomCommands(next);
  return loadQuickCommands(mode);
}

export async function removeQuickCommand(id: string, mode: QuickCommandMode): Promise<QuickCommand[]> {
  const isDefault = defaults.some((command) => command.id === id);
  if (isDefault) {
    // A built-in isn't deleted (it lives in the bundle) -- it's remembered as
    // hidden so the user is never forced to keep a default they don't want.
    const hidden = await loadHiddenIds();
    if (!hidden.includes(id)) await saveHiddenIds([...hidden, id]);
  } else {
    const commands = (await loadCustomCommands()).filter((command) => command.id !== id);
    await saveCustomCommands(commands);
  }
  return loadQuickCommands(mode);
}

async function loadHiddenIds(): Promise<string[]> {
  const value = await SecureStore.getItemAsync(HIDDEN_KEY);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

async function saveHiddenIds(ids: string[]): Promise<void> {
  await SecureStore.setItemAsync(HIDDEN_KEY, JSON.stringify(ids), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function loadCustomCommands(): Promise<QuickCommand[]> {
  const value = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as QuickCommand[];
    return parsed.filter(
      (command) =>
        command.custom === true &&
        (command.mode === 'terminal' || command.mode === 'agent') &&
        typeof command.label === 'string' &&
        typeof command.value === 'string' &&
        (command.kind === undefined || command.kind === 'command' || command.kind === 'keys')
    );
  } catch {
    return [];
  }
}

export function quickCommandKeys(command: QuickCommand): string[] {
  // Split only on separators between keys in a sequence. A "+" joins a modifier
  // to its key ("ctrl+c") and must survive, or the gateway receives "ctrl" and
  // "c" as two invalid keys.
  return command.value
    .split(/[,\n]/)
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean);
}

async function saveCustomCommands(commands: QuickCommand[]): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(commands), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
