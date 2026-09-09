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
import { isOwnedThemeAsset } from '@/theme/assets';

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
};

export const useThemeLibrary = create<ThemeLibraryState>((set) => {
  const publish = (repo: ThemeRepository) =>
    set({ library: repo.snapshot(), active: repo.active(), hydrated: true });
  return {
    hydrated: false,
    library: { version: 1, themes: [], selection: null, previous: null },
    active: null,
    hydrate() {
      try {
        publish(getRepository());
      } catch {
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
  };
});
