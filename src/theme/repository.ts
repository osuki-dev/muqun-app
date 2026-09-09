import { isThemePackId, type ThemePackId } from '@/constants/theme-packs';
import { auditThemeContrast } from '@/theme/contrast';
import { cloneThemeData } from '@/theme/clone';
import { compileTheme, type ResolvedCustomTheme } from '@/theme/resolve';
import { parseThemeManifest, type ThemeManifest } from '@/theme/schema';

export type ThemeSelection = { kind: 'builtin'; id: ThemePackId } | { kind: 'custom'; id: string };

export type InstalledTheme = {
  id: string;
  manifest: ThemeManifest;
  /** App-owned files already installed by the asset pipeline, never author URLs. */
  assets: Record<string, string>;
};

export type ThemeLibrary = {
  version: 1;
  themes: InstalledTheme[];
  selection: ThemeSelection | null;
  previous: ThemeSelection | null;
};

export interface ThemeLibraryStorage {
  read(): string | undefined;
  /** Replace metadata atomically or throw, leaving the previous value intact. */
  write(value: string): void;
}

const MAX_THEMES = 50;
const MAX_LIBRARY_BYTES = 16 * 1024 * 1024;
const empty = (): ThemeLibrary => ({ version: 1, themes: [], selection: null, previous: null });

function selection(value: unknown, themes: InstalledTheme[]): ThemeSelection | null {
  if (!value || typeof value !== 'object' || !('kind' in value) || !('id' in value)) return null;
  if (value.kind === 'builtin' && isThemePackId(value.id)) return { kind: 'builtin', id: value.id };
  if (
    value.kind === 'custom' &&
    typeof value.id === 'string' &&
    themes.some((theme) => theme.id === value.id)
  ) {
    return { kind: 'custom', id: value.id };
  }
  return null;
}

/** Recovery paths must meet the same readability requirement as explicit apply. */
function readableSelection(value: unknown, themes: InstalledTheme[]): ThemeSelection | null {
  const valid = selection(value, themes);
  if (valid?.kind === 'custom') {
    const installed = themes.find((theme) => theme.id === valid.id)!;
    if (auditThemeContrast(installed.manifest).length) return null;
  }
  return valid;
}

function validateInstalledAssets(manifest: ThemeManifest, assets: Record<string, string>): void {
  const expected = Object.keys(manifest.assets ?? {});
  if (
    Object.keys(assets).length !== expected.length ||
    expected.some(
      (id) =>
        !Object.hasOwn(assets, id) ||
        typeof assets[id] !== 'string' ||
        !assets[id].startsWith('file:///')
    )
  ) {
    throw new Error('All theme assets must be installed locally before saving');
  }
}

/** Pure transactional repository: disk/image/network adapters are separate owners. */
export class ThemeRepository {
  private state: ThemeLibrary = empty();
  private compiled = new Map<string, ResolvedCustomTheme>();

  constructor(
    private storage: ThemeLibraryStorage,
    private allocateId: () => string,
    private assetAvailable: (uri: string) => boolean = (uri) => uri.startsWith('file:///')
  ) {}

  hydrate(): ThemeLibrary {
    // Storage failures are not corrupt JSON. Let the adapter retry later rather
    // than silently replacing a temporarily unreadable library with an empty one.
    const value = this.storage.read();
    try {
      if (!value || value.length > MAX_LIBRARY_BYTES) return this.resetMemory();
      const raw = JSON.parse(value) as Partial<ThemeLibrary>;
      if (raw.version !== 1 || !Array.isArray(raw.themes) || raw.themes.length > MAX_THEMES)
        return this.resetMemory();
      const themes: InstalledTheme[] = [];
      for (const candidate of raw.themes) {
        try {
          if (
            typeof candidate?.id !== 'string' ||
            !/^[a-zA-Z0-9-]{1,100}$/.test(candidate.id) ||
            themes.some((theme) => theme.id === candidate.id)
          )
            continue;
          const manifest = parseThemeManifest(JSON.stringify(candidate.manifest));
          validateInstalledAssets(manifest, candidate.assets);
          if (Object.values(candidate.assets).some((uri) => !this.assetAvailable(uri))) continue;
          themes.push({ id: candidate.id, manifest, assets: { ...candidate.assets } });
        } catch {
          /* Preserve other valid installations when one record is corrupt. */
        }
      }
      const previous = readableSelection(raw.previous, themes);
      this.state = {
        version: 1,
        themes,
        selection: readableSelection(raw.selection, themes) ?? previous,
        previous,
      };
      this.compiled.clear();
      return this.snapshot();
    } catch {
      return this.resetMemory();
    }
  }

  snapshot(): ThemeLibrary {
    return cloneThemeData(this.state);
  }

  save(text: string, installedAssets: Record<string, string> = {}): InstalledTheme {
    const manifest = parseThemeManifest(text);
    validateInstalledAssets(manifest, installedAssets);
    if (Object.values(installedAssets).some((uri) => !this.assetAvailable(uri)))
      throw new Error('Theme images must be stored in the app theme library');
    if (this.state.themes.length >= MAX_THEMES)
      throw new Error('Remove a saved theme before adding another');
    const id = this.allocateId();
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id) || this.state.themes.some((theme) => theme.id === id))
      throw new Error('Could not allocate a unique theme installation');
    const installed = { id, manifest, assets: { ...installedAssets } };
    this.commit({ ...this.state, themes: [...this.state.themes, installed] });
    return cloneThemeData(installed);
  }

  apply(next: ThemeSelection): ThemeLibrary {
    const valid = selection(next, this.state.themes);
    if (!valid) throw new Error('Theme is no longer installed');
    if (valid.kind === 'custom') {
      const installed = this.state.themes.find((theme) => theme.id === valid.id)!;
      if (auditThemeContrast(installed.manifest).length)
        throw new Error('Fix theme text contrast before applying');
    }
    if (this.state.selection?.kind === valid.kind && this.state.selection.id === valid.id)
      return this.snapshot();
    this.commit({ ...this.state, previous: this.state.selection, selection: valid });
    return this.snapshot();
  }

  undo(): ThemeLibrary {
    this.commit({
      ...this.state,
      selection: readableSelection(this.state.previous, this.state.themes),
      previous: null,
    });
    return this.snapshot();
  }

  remove(id: string): ThemeLibrary {
    const themes = this.state.themes.filter((theme) => theme.id !== id);
    const previous = readableSelection(this.state.previous, themes);
    this.commit({
      ...this.state,
      themes,
      selection: readableSelection(this.state.selection, themes) ?? previous,
      previous,
    });
    this.compiled.delete(id);
    return this.snapshot();
  }

  active(): ResolvedCustomTheme | null {
    if (this.state.selection?.kind !== 'custom') return null;
    const id = this.state.selection.id;
    const installed = this.state.themes.find((theme) => theme.id === id);
    if (!installed) return null;
    let result = this.compiled.get(id);
    if (!result) {
      result = compileTheme(installed.manifest, id);
      this.compiled.set(id, result);
    }
    return result;
  }

  exportColors(id: string): string {
    const theme = this.state.themes.find((entry) => entry.id === id);
    if (!theme) throw new Error('Theme is no longer installed');
    const {
      assets: _assets,
      decoration: _decoration,
      variantDecorations: _variants,
      homeIdentity: _identity,
      source: _source,
      ...colors
    } = theme.manifest;
    return JSON.stringify(parseThemeManifest(JSON.stringify(colors)), null, 2);
  }

  private commit(next: ThemeLibrary): void {
    const value = JSON.stringify(next);
    if (new TextEncoder().encode(value).length > MAX_LIBRARY_BYTES)
      throw new Error('Theme library is full');
    this.storage.write(value);
    this.state = next;
  }

  private resetMemory(): ThemeLibrary {
    this.state = empty();
    this.compiled.clear();
    return this.snapshot();
  }
}
