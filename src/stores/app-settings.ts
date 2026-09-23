import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { DEFAULT_THEME_PACK_ID, isThemePackId, type ThemePackId } from '@/constants/theme-packs';
import { isLocalePreference, type LocalePreference } from '@/i18n/locale';
import {
  storedAgentDefaultView,
  type PaneViewMode,
  type StoredAgentViewSettings,
} from '@/lib/pane-view-mode';
import {
  DEFAULT_HOME_LAYOUT,
  isHomeLayout,
  resolveHomeLayout,
  type HomeLayout,
} from '@/lib/home-layout';
import type { TerminalTextSize } from '@/lib/terminal-text-size';
import { parseFontSlot, SYSTEM_FONT_SLOT, type FontSlot } from '@/theme/user-font-file';

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

// Re-exported from the store the screens already read, the way `TerminalTextSize`
// is: a settings screen asking for the shape of a setting should not have to
// know which half of the font module defines it.
export type { FontSlot };
export type { HomeLayout };

type PersistedSettings = {
  agentDefaultView: PaneViewMode;
  androidWidgetEnabled: boolean;
  appLockEnabled: boolean;
  hapticsEnabled: boolean;
  // The sole appearance preference: also derives global chrome and motion.
  // Theme choice remains independent and owns only colours and artwork.
  homeLayout: HomeLayout;
  /**
   * The face the app's own text is set in, and the face its code is set in.
   *
   * Two slots rather than one, because they answer different questions: a
   * reader who wants a Han face that reads well at 14pt on their phone wants it
   * in the interface, and a reader who wants ligatures and a zero with a slash
   * wants that in the terminal. Nobody wants the same file in both.
   *
   * Global, and deliberately not part of a theme pack. A pack is colour -- the
   * pack format has no font field and the authoring skill forbids one -- and a
   * font that arrived with a palette would be un-chosen every time the reader
   * tried a different theme.
   */
  interfaceFont: FontSlot;
  language: LocalePreference;
  liveActivityEnabled: boolean;
  /** The face the terminal and every code span are drawn in. See `interfaceFont`. */
  monoFont: FontSlot;
  notificationsEnabled: boolean;
  serverCardPanes: ServerCardPanes;
  showTerminalKeyRow: boolean;
  terminalTextSize: TerminalTextSize;
  themePack: ThemePackId;
};

type AppSettingsState = PersistedSettings & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setHomeLayout: (layout: HomeLayout) => Promise<void>;
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
  homeLayout: DEFAULT_HOME_LAYOUT,
  // The system font, which is the absence of a choice rather than a third
  // option. The app offers no fonts of its own, so until a reader brings one
  // there is nothing to choose between.
  interfaceFont: SYSTEM_FONT_SLOT,
  // `null` is "follow the system", which is what an app should do until it is
  // told otherwise. It is a distinct state from picking English: a device that
  // later switches to Chinese should follow, and only an explicit choice here
  // should pin the app against the system.
  language: null,
  // A Lock Screen card names the agent and the panel it runs in, so it stays
  // off until the user asks for it.
  liveActivityEnabled: false,
  monoFont: SYSTEM_FONT_SLOT,
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

let hydrationFlight: Promise<void> | null = null;
let pendingHydrationPatch: Partial<PersistedSettings> = {};
let saveQueue: Promise<void> = Promise.resolve();

export const useAppSettings = create<AppSettingsState>((set, get) => ({
  ...defaults,
  hydrated: false,

  hydrate() {
    if (get().hydrated) return Promise.resolve();
    if (hydrationFlight) return hydrationFlight;

    hydrationFlight = (async () => {
      let stored: Partial<PersistedSettings> = {};
      try {
        const value = await SecureStore.getItemAsync(STORAGE_KEY);
        stored = value ? parseSettings(value) : {};
      } catch {
        const pending = pendingHydrationPatch;
        pendingHydrationPatch = {};
        set({ hydrated: true });
        // An update made before a failed read still deserves the same write
        // path as any other update. There is no stored blob to merge in this
        // case, so the current state is the only recoverable value.
        if (Object.keys(pending).length > 0) {
          await enqueueSave(pickPersisted(get()));
        }
        return;
      }

      const pending = pendingHydrationPatch;
      pendingHydrationPatch = {};
      set({ ...defaults, ...stored, ...pending, hydrated: true });

      // An update that arrived while the read was in flight must be written
      // after the stored blob has been merged, or it could erase unrelated
      // preferences from that blob.
      if (Object.keys(pending).length > 0) {
        await enqueueSave(pickPersisted(get()));
      }
    })().finally(() => {
      hydrationFlight = null;
    });

    return hydrationFlight;
  },

  async update(patch) {
    const next = { ...pickPersisted(get()), ...patch };
    set(next);
    if (!get().hydrated) {
      pendingHydrationPatch = { ...pendingHydrationPatch, ...patch };
      await get().hydrate();
      return;
    }
    await enqueueSave(next);
  },

  setHomeLayout(layout) {
    return get().update({ homeLayout: resolveHomeLayout(layout) });
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
      ...(isHomeLayout(parsed.homeLayout) ? { homeLayout: parsed.homeLayout } : {}),
      // Every field of a stored slot is checked, and a slot that fails any of
      // them reads as no slot at all -- back to the system font, which is the
      // state the app can always be in. The guard is not a formality: the file
      // path inside a slot reaches `new File(...)`, so an unchecked one is a
      // path traversal with a font on the end of it. See `parseFontSlot`.
      ...slotPatch('interfaceFont', parsed.interfaceFont),
      // Anything unrecognised -- a locale we dropped, a hand-edited file, a
      // build that shipped a code we no longer have a catalog for -- falls
      // through to the default and the app follows the system again.
      ...(isLocalePreference(parsed.language) ? { language: parsed.language } : {}),
      ...(typeof parsed.liveActivityEnabled === 'boolean'
        ? { liveActivityEnabled: parsed.liveActivityEnabled }
        : {}),
      ...slotPatch('monoFont', parsed.monoFont),
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

/**
 * One slot, checked, or nothing at all.
 *
 * A helper rather than a spread at each call site, because the two slots are
 * the same sentence and a copy of it is a second place for one of them to stop
 * being guarded.
 */
function slotPatch(key: 'interfaceFont' | 'monoFont', value: unknown): Partial<PersistedSettings> {
  const slot = parseFontSlot(value);
  return slot ? { [key]: slot } : {};
}

function pickPersisted(state: AppSettingsState): PersistedSettings {
  return {
    agentDefaultView: state.agentDefaultView,
    androidWidgetEnabled: state.androidWidgetEnabled,
    appLockEnabled: state.appLockEnabled,
    hapticsEnabled: state.hapticsEnabled,
    homeLayout: state.homeLayout,
    interfaceFont: state.interfaceFont,
    language: state.language,
    liveActivityEnabled: state.liveActivityEnabled,
    monoFont: state.monoFont,
    notificationsEnabled: state.notificationsEnabled,
    serverCardPanes: state.serverCardPanes,
    showTerminalKeyRow: state.showTerminalKeyRow,
    terminalTextSize: state.terminalTextSize,
    themePack: state.themePack,
  };
}

function enqueueSave(value: PersistedSettings): Promise<void> {
  const write = saveQueue.then(() =>
    SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(value), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
  );
  // Keep the queue usable after a failed write while preserving the rejection
  // for the caller that initiated that write.
  saveQueue = write.catch(() => {});
  return write;
}
