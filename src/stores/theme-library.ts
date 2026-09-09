import { createMMKV } from 'react-native-mmkv';
import QuickCrypto from 'react-native-quick-crypto';
import { create } from 'zustand';

import {
  ThemeRepository,
  type InstalledTheme,
  type ThemeLibrary,
  type ThemeSelection,
} from '@/theme/repository';
import type { ResolvedCustomTheme } from '@/theme/resolve';
import { isOwnedThemeAsset, setThemeAssetReferences } from '@/theme/assets';

// Metadata is a single MMKV value, not SecureStore or a collection of partially
// updated keys. A failed durable write must never repaint the running app.
let repository: ThemeRepository | undefined;
function getRepository() {
  if (!repository) {
    const storage = createMMKV({ id: 'muqun.theme-library' });
    const restored = new ThemeRepository(
      { read: () => storage.getString('library'), write: (value) => storage.set('library', value) },
      () => QuickCrypto.randomBytes(16).toString('hex'),
      isOwnedThemeAsset
    );
    restored.hydrate();
    repository = restored;
  }
  return repository;
}

type ThemeLibraryState = {
  hydrated: boolean;
  library: ThemeLibrary;
  active: ResolvedCustomTheme | null;
  hydrate: () => void;
  save: (text: string, assets?: Record<string, string>) => InstalledTheme;
  apply: (selection: ThemeSelection) => void;
  undo: () => void;
  remove: (id: string) => void;
  exportColors: (id: string) => string;
  setTerminalBackgroundOpacity: (id: string, value: number | undefined) => void;
  setSurfaceBackgroundOpacity: (id: string, value: number | undefined) => void;
  setHideHomeLogo: (id: string, value: boolean | undefined) => void;
  setHideHomeText: (id: string, value: boolean | undefined) => void;
  resetAppearancePreferences: (id: string) => void;
};

export const useThemeLibrary = create<ThemeLibraryState>((set) => {
  const publish = (repo: ThemeRepository) => {
    const library = repo.snapshot();
    setThemeAssetReferences(repo.hasAuthoritativeAssetReferences() ? library.themes : null);
    set({ library, active: repo.active(), hydrated: true });
  };
  return {
    hydrated: false,
    library: { version: 1, themes: [], selection: null, previous: null },
    active: null,
    hydrate() {
      try {
        publish(getRepository());
      } catch {
        setThemeAssetReferences(null);
        set({ hydrated: true });
      }
    },
    save(text, assets) {
      const repo = getRepository();
      const installed = repo.save(text, assets);
      publish(repo);
      return installed;
    },
    apply(selection) {
      const repo = getRepository();
      repo.apply(selection);
      publish(repo);
    },
    undo() {
      const repo = getRepository();
      repo.undo();
      publish(repo);
    },
    remove(id) {
      const repo = getRepository();
      repo.remove(id);
      publish(repo);
    },
    exportColors(id) {
      return getRepository().exportColors(id);
    },
    setTerminalBackgroundOpacity(id, value) {
      const repo = getRepository();
      repo.setTerminalBackgroundOpacity(id, value);
      publish(repo);
    },
    setSurfaceBackgroundOpacity(id, value) {
      const repo = getRepository();
      repo.setSurfaceBackgroundOpacity(id, value);
      publish(repo);
    },
    setHideHomeLogo(id, value) {
      const repo = getRepository();
      repo.setHideHomeLogo(id, value);
      publish(repo);
    },
    setHideHomeText(id, value) {
      const repo = getRepository();
      repo.setHideHomeText(id, value);
      publish(repo);
    },
    resetAppearancePreferences(id) {
      const repo = getRepository();
      repo.resetAppearancePreferences(id);
      publish(repo);
    },
  };
});
