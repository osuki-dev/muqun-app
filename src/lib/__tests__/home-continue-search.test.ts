import { expect, test } from 'bun:test';
import {
  homeContinueSearchEnabled,
  homeProviderTextColor,
  searchedHomeContinueEntries,
} from '../home-continue-search';
import type { HomeContinueEntry } from '../home-continue';
import { contrastRatio } from '@/theme/contrast';
import { defaultAgentFeatures } from '../agent-protocol';
import type { MirroredServerDiscovery } from '../agent-discovery';
import { THEME_PACK_IDS, resolveThemePack } from '@/constants/theme-packs';
import { createThemeStarter } from '@/theme/starter';
import { parseThemeManifest } from '@/theme/schema';
import { readFileSync } from 'node:fs';

const entries: HomeContinueEntry[] = Array.from({ length: 16 }, (_, index) => ({
  key: String(index),
  title: `Session ${index}`,
  atMs: 100 - index,
  destination: {
    type: 'recent',
    target: {
      kind: 'agent-session',
      serverId: 'server',
      sessionId: 'session',
      asid: String(index),
      directory: index === 15 ? '/work/hidden-project' : '/work/app',
      agentId: index === 15 ? 'deepseek' : 'opencode',
    },
  },
}));

test('search replaces the heading only after fifteen available sessions', () => {
  expect(homeContinueSearchEnabled(15)).toBe(false);
  expect(homeContinueSearchEnabled(16)).toBe(true);
});

test('search reaches collapsed rows by title, directory and provider without reranking', () => {
  expect(searchedHomeContinueEntries(entries, '', false, 4)).toEqual(entries.slice(0, 4));
  for (const query of ['SESSION 15', '  Hidden-PROJECT  ', 'deepseek']) {
    expect(searchedHomeContinueEntries(entries, query, false, 4)).toEqual([entries[15]]);
  }
  expect(searchedHomeContinueEntries(entries, 'session', false, 4)).toEqual(entries);
  expect(searchedHomeContinueEntries(entries, 'session    DEEPSEEK', false, 4)).toEqual([
    entries[15],
  ]);
});

test('clear and whitespace restore the exact collapsed or expanded ordering', () => {
  expect(searchedHomeContinueEntries(entries, '', false, undefined)).toEqual(entries.slice(0, 10));
  expect(searchedHomeContinueEntries(entries, '\n  \t', false, 8)).toEqual(entries.slice(0, 8));
  expect(searchedHomeContinueEntries(entries, '', true, 4)).toBe(entries);
  expect(searchedHomeContinueEntries(entries, 'not a session', false, 4)).toEqual([]);
});

test('agent labels and gateway labels are metadata, not arbitrary entry fields', () => {
  const pane: HomeContinueEntry = {
    key: 'pane',
    title: 'Terminal',
    atMs: 0,
    agentLabel: 'T3 Code',
    destination: { type: 'pane', serverId: 'server', cwd: '/work/pane' },
  };
  const withBody = { ...pane, body: 'secret transcript' };
  expect(searchedHomeContinueEntries([withBody], 't3', false, 4)).toEqual([withBody]);
  expect(
    searchedHomeContinueEntries([withBody], 'studio', false, 4, {}, { server: 'Studio' })
  ).toEqual([withBody]);
  expect(searchedHomeContinueEntries([withBody], 'secret', false, 4)).toEqual([]);
});

test('provider search uses the discovered display name and kind for a custom agent id', () => {
  const entry: HomeContinueEntry = {
    ...entries[15],
    destination: {
      type: 'agent-session',
      target: {
        kind: 'agent-session',
        serverId: 'server',
        sessionId: 'session',
        asid: 'custom',
        directory: '/work',
        agentId: 'custom-id',
      },
    },
  };
  const discovery: MirroredServerDiscovery = {
    observedAtMs: 0,
    terminal: null,
    ssh: null,
    agents: {
      supported: true,
      multiAgent: true,
      catalogAggregation: true,
      sessionRouting: true,
      agents: [
        {
          id: 'custom-id',
          kind: 'deepseek',
          name: 'Research Provider',
          status: 'connected',
          enabled: true,
          features: defaultAgentFeatures(),
        },
      ],
    },
  };
  for (const query of ['research provider', 'DEEPSEEK', 'custom-id']) {
    expect(searchedHomeContinueEntries([entry], query, false, 4, { server: discovery })).toEqual([
      entry,
    ]);
  }
});

test('provider text has distinct readable theme inks in light and dark', () => {
  for (const { colors, surface } of [
    {
      colors: {
        primary: '#9a3412',
        info: '#1d4ed8',
        success: '#166534',
        text: '#111111',
        textMuted: '#555555',
      },
      surface: '#ffffff',
    },
    {
      colors: {
        primary: '#fdba74',
        info: '#93c5fd',
        success: '#86efac',
        text: '#eeeeee',
        textMuted: '#bbbbbb',
      },
      surface: '#111111',
    },
  ]) {
    const inks = ['OpenCode', 'DeepSeek', 'T3 Code'].map((kind) =>
      homeProviderTextColor(kind, colors, surface)
    );
    expect(new Set(inks).size).toBe(3);
    for (const ink of inks) expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
    expect(homeProviderTextColor('unknown', colors, surface)).toBe(colors.textMuted);
    expect(homeProviderTextColor('Research Provider', colors, surface)).toBe(colors.textMuted);
  }
  const colors = {
    primary: '#eeeeee',
    info: '#eeeeee',
    success: '#eeeeee',
    text: '#111111',
    textMuted: '#555555',
  };
  const inks = ['opencode', 'deepseek', 't3'].map((kind) =>
    homeProviderTextColor(kind, colors, '#ffffff')
  );
  expect(new Set(inks).size).toBe(3);
  for (const ink of inks) expect(contrastRatio(ink, '#ffffff')).toBeGreaterThanOrEqual(4.5);
});

test('colliding palettes remain distinct after contrast correction across light, dark and midtone surfaces', () => {
  for (const surface of [
    '#ffffff',
    '#111111',
    '#747474',
    '#757575',
    '#767676',
    '#777777',
    '#888888',
  ]) {
    for (const accent of ['#eeeeee', '#111111', '#888888']) {
      const colors = {
        primary: accent,
        info: accent,
        success: accent,
        text:
          contrastRatio('#000000', surface) >= contrastRatio('#ffffff', surface)
            ? '#000000'
            : '#ffffff',
        textMuted: '#888888',
      };
      const inks = ['opencode', 'deepseek', 't3'].map((kind) =>
        homeProviderTextColor(kind, colors, surface)
      );
      expect(new Set(inks).size).toBe(3);
      for (const ink of inks) expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
      expect(homeProviderTextColor('t3', colors, surface)).toBe(inks[2]);
      expect(homeProviderTextColor('unknown', colors, surface)).toBe(colors.textMuted);
    }
  }
});

test('different authored inks that converge during correction still keep provider identity', () => {
  const colors = {
    primary: '#ffffff',
    info: '#fffffe',
    success: '#feffff',
    text: '#000000',
    textMuted: '#555555',
  };
  const inks = ['opencode', 'deepseek', 't3'].map((kind) =>
    homeProviderTextColor(kind, colors, '#ffffff')
  );
  expect(new Set(inks).size).toBe(3);
  for (const ink of inks) expect(contrastRatio(ink, '#ffffff')).toBeGreaterThanOrEqual(4.5);
});

test('selected-row hex and rgba fills are composited over the list surface before contrast checks', () => {
  const colors = {
    primary: '#ffffff',
    info: '#ffffff',
    success: '#ffffff',
    text: '#000000',
    textMuted: '#555555',
    surface: '#ffffff',
  };
  for (const fill of ['#00000040', 'rgba(0, 0, 0, 0.25)']) {
    const inks = ['opencode', 'deepseek', 't3'].map((kind) =>
      homeProviderTextColor(kind, colors, fill)
    );
    expect(new Set(inks).size).toBe(3);
    for (const ink of inks) expect(contrastRatio(ink, '#bfbfbf')).toBeGreaterThanOrEqual(4.5);
  }
});

test('built-in and installed custom palettes retain readable, distinct provider names', () => {
  const courier = parseThemeManifest(
    readFileSync(
      new URL('../../../assets/themes/cover-courier/theme.json', import.meta.url),
      'utf8'
    )
  );
  const variants = [
    ...THEME_PACK_IDS.flatMap((id) => {
      const pack = resolveThemePack(id);
      return [pack.light, pack.dark];
    }),
    ...Object.values(createThemeStarter().variants),
    ...Object.values(courier.variants),
  ];
  for (const { colors } of variants) {
    for (const surface of [colors.surface, colors.surfaceRaised, colors.background]) {
      const inks = ['opencode', 'deepseek', 't3'].map((kind) =>
        homeProviderTextColor(kind, colors, surface)
      );
      expect(new Set(inks.map((ink) => ink.toLowerCase())).size).toBe(3);
      for (const ink of inks) expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('unsupported runtime color notations are not partially parsed', () => {
  const colors = {
    primary: 'rgb(30, 40, 50)',
    info: 'blue',
    success: '#090',
    text: '#111111',
    textMuted: '#555555',
  };
  expect(homeProviderTextColor('OpenCode', colors, '#ffffff')).toBe(colors.primary);
  expect(homeProviderTextColor('DeepSeek', colors, '#ffffff')).toBe(colors.info);
  expect(homeProviderTextColor('T3 Code', colors, '#ffffff')).toBe(colors.success);
});
