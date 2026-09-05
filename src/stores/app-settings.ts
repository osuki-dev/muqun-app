import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { DEFAULT_THEME_PACK_ID, isThemePackId, type ThemePackId } from '@/constants/theme-packs';
import { isLocalePreference, type LocalePreference } from '@/i18n/locale';
import {
  storedAgentDefaultView,
  type PaneViewMode,
  type StoredAgentViewSettings,
} from '@/lib/pane-view-mode';
import type { TerminalTextSize } from '@/lib/terminal-text-size';

// Declared with the rule that reads it rather than here, because the setting is
// only half the answer to "how big is the terminal text": the other half is the
// pinch, which is a session-only override and is deliberately absent from
// `PersistedSettings` below. Re-exported so the screens that import the type
// from the store keep working.
export type { TerminalTextSize };

/**
 * Which panes a server card lists: `'agents'` for only the ones running a
 * recognised agent binary, `'all'` for every pane in the session.
 *
 * A tmux window/pane and a herdr tab/pane are the same concept, so `'agents'`
 * is a filter on that one list, not a different, smaller list -- see
 * `mirroredServerAgents` vs `mirroredServerPanes` in `lib/server-agents.ts`.
 */
export type ServerCardPanes = 'agents' | 'all';

type PersistedSettings = {
  agentDefaultView: PaneViewMode;
  androidWidgetEnabled: boolean;
  appLockEnabled: boolean;
  hapticsEnabled: boolean;
  language: LocalePreference;
  liveActivityEnabled: boolean;
  notificationsEnabled: boolean;
  serverCardPanes: ServerCardPanes;
  showTerminalKeyRow: boolean;
  terminalTextSize: TerminalTextSize;
  themePack: ThemePackId;
};

type AppSettingsState = PersistedSettings & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  update: (patch: Partial<PersistedSettings>) => Promise<void>;
};

const STORAGE_KEY = 'muqun.settings.v1';
const defaults: PersistedSettings = {
  // Which view an agent pane opens in, for panes this run has not been told
  // about. The per-pane choice is remembered separately and always wins; this
  // is only the starting point. Chat, because an agent pane is a conversation
  // and every other reading of it is one tap away -- and where the gateway
  // cannot normalize the pane, the mode resolver falls back to the terminal on
  // its own, so this default is safe for panes that have no chat view at all.
  // Basics first (Ellen, 2026-07-27): the terminal stays the default until
  // the chat view has earned it; chat remains one header tap away.
  agentDefaultView: 'terminal',
  // A home-screen tile puts agent names where anyone glancing at the phone can
  // read them, so it waits to be asked for, exactly like the Lock Screen card.
  androidWidgetEnabled: false,
  appLockEnabled: false,
  hapticsEnabled: true,
  // `null` is "follow the system", which is what an app should do until it is
  // told otherwise. It is a distinct state from picking English: a device that
  // later switches to Chinese should follow, and only an explicit choice here
  // should pin the app against the system.
  language: null,
  // A Lock Screen card names the agent and the panel it runs in, so it stays
  // off until the user asks for it.
  liveActivityEnabled: false,
  notificationsEnabled: true,
  // What is happening on my machines? is the question the home screen exists
  // for, and a card that lists only agent panes has been answering it wrong:
  // a window running nvim and a shell is exactly as reachable and exactly as
  // worth a tap as one running an agent, and filtering it out silently is what
  // made a session of eleven panes read as four. `'all'`, because every pane
  // already on the device costs no gateway traffic beyond what `'agents'`
  // already paid for -- the gateway answers both lists on the same poll.
  serverCardPanes: 'all',
  showTerminalKeyRow: true,
  terminalTextSize: 'default',
  // Which palette the app is painted with. Orthogonal to colour mode: this
  // picks *which* light and dark pair is in play, the mode picks which half of
  // it is showing. Osuki, because the app should look like itself until asked
  // otherwise.
  themePack: DEFAULT_THEME_PACK_ID,
};

export const useAppSettings = create<AppSettingsState>((set, get) => ({
  ...defaults,
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return;
    try {
      const value = await SecureStore.getItemAsync(STORAGE_KEY);
      const stored = value ? parseSettings(value) : {};
      set({ ...defaults, ...stored, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  async update(patch) {
    const next = { ...pickPersisted(get()), ...patch };
    set(next);
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
}));

function parseSettings(value: string): Partial<PersistedSettings> {
  try {
    const parsed = JSON.parse(value) as Partial<PersistedSettings> & StoredAgentViewSettings;
    // Reads the switch this setting replaced where it is absent, which is the
    // whole of the upgrade: nothing rewrites the old keys, they simply stop
    // being persisted the next time anything is saved. A stored `text` -- the
    // reading removed by card #841 -- reads as nothing stored, so such an
    // install opens its agent panes on the terminal like every other.
    const agentDefaultView = storedAgentDefaultView(parsed);
    return {
      ...(agentDefaultView ? { agentDefaultView } : {}),
      ...(typeof parsed.androidWidgetEnabled === 'boolean'
        ? { androidWidgetEnabled: parsed.androidWidgetEnabled }
        : {}),
      ...(typeof parsed.appLockEnabled === 'boolean'
        ? { appLockEnabled: parsed.appLockEnabled }
        : {}),
      ...(typeof parsed.hapticsEnabled === 'boolean'
        ? { hapticsEnabled: parsed.hapticsEnabled }
        : {}),
      // Anything unrecognised -- a locale we dropped, a hand-edited file, a
      // build that shipped a code we no longer have a catalog for -- falls
      // through to the default and the app follows the system again.
      ...(isLocalePreference(parsed.language) ? { language: parsed.language } : {}),
      ...(typeof parsed.liveActivityEnabled === 'boolean'
        ? { liveActivityEnabled: parsed.liveActivityEnabled }
        : {}),
      ...(typeof parsed.notificationsEnabled === 'boolean'
        ? { notificationsEnabled: parsed.notificationsEnabled }
        : {}),
      // The setting this replaced was a switch about whether to show anything
      // at all; this one is a choice about which panes to show, and the two
      // questions do not answer each other. So there is no migration from the
      // old `showServerAgents` boolean -- an install that had it either way
      // simply starts at the new default above, same as an install that never
      // had it.
      ...(parsed.serverCardPanes === 'agents' || parsed.serverCardPanes === 'all'
        ? { serverCardPanes: parsed.serverCardPanes }
        : {}),
      ...(typeof parsed.showTerminalKeyRow === 'boolean'
        ? { showTerminalKeyRow: parsed.showTerminalKeyRow }
        : {}),
      ...(parsed.terminalTextSize === 'compact' ||
      parsed.terminalTextSize === 'default' ||
      parsed.terminalTextSize === 'large'
        ? { terminalTextSize: parsed.terminalTextSize }
        : {}),
      // A pack we have since dropped, or a build that shipped before this one
      // existed, falls back to Osuki rather than leaving the app with a theme
      // id nothing in the registry answers to.
      ...(isThemePackId(parsed.themePack) ? { themePack: parsed.themePack } : {}),
    };
  } catch {
    return {};
  }
}

function pickPersisted(state: AppSettingsState): PersistedSettings {
  return {
    agentDefaultView: state.agentDefaultView,
    androidWidgetEnabled: state.androidWidgetEnabled,
    appLockEnabled: state.appLockEnabled,
    hapticsEnabled: state.hapticsEnabled,
    language: state.language,
    liveActivityEnabled: state.liveActivityEnabled,
    notificationsEnabled: state.notificationsEnabled,
    serverCardPanes: state.serverCardPanes,
    showTerminalKeyRow: state.showTerminalKeyRow,
    terminalTextSize: state.terminalTextSize,
    themePack: state.themePack,
  };
}
