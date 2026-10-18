import { afterAll, expect, test } from 'bun:test';
import { expo } from '@hot-updater/expo';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

type Source = { type: string; id: string; contents: string; reasons: string[] };
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fs.mkdtempSync(path.join(tmpdir(), 'muqun-fingerprint-sources-'));
fs.symlinkSync(path.join(projectRoot, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
afterAll(() => fs.rmSync(fixture, { recursive: true, force: true }));

// Execute the installed SDK's actual per-pattern processor and bundled glob
// implementation. A different glob library could hide the original regression.
const sdkDir = path.dirname(fileURLToPath(import.meta.resolve('hot-updater')));
const sdkBundle = fs.readdirSync(sdkDir).find((name) => /^fingerprint-.*\.mjs$/.test(name))!;
const sdkText = fs.readFileSync(path.join(sdkDir, sdkBundle), 'utf8');
const processor = sdkText.match(/function processExtraSources\([\s\S]*?\n}\n\/\/#endregion/)![0];
const globExport = sdkText.match(/require_out as (\w+)/)![1];
const appendExport = sdkText.match(/appendFingerprintExtraSources as (\w+)/)![1];
const sdk = await import(path.join(sdkDir, sdkBundle));
const processSources: (patterns: string[], cwd: string) => Source[] = runInNewContext(
  `${processor}\nprocessExtraSources`,
  { fs, path, console, import_out: { default: sdk[globExport]() } }
);
const appendSources: (sources: string[], additions: readonly string[]) => string[] =
  sdk[appendExport];

// Load only the public pattern list, with provider environment loading disabled.
const config = spawnSync(
  process.execPath,
  [
    '--eval',
    `const {default: config} = await import(${JSON.stringify(path.join(projectRoot, 'hot-updater.config.ts'))});
     console.log(JSON.stringify(config(null).fingerprint.extraSources));`,
  ],
  { cwd: fixture, env: { NODE_ENV: 'test', HOT_UPDATER_NATIVE_BUILD: '1' }, encoding: 'utf8' }
);
if (config.status !== 0) throw new Error('Could not load public fingerprint source patterns');
const patterns = JSON.parse(config.stdout) as string[];
const modulePatterns = patterns.filter((pattern) => pattern.startsWith('modules/theme-transport/'));
const legacy = ['modules/theme-transport/**/*.{swift,kt,podspec,gradle,json,xml}'];
const write = (name: string, contents = 'fixture source') => {
  const target = path.join(fixture, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
};
const sorted = (sources: Source[]) => sources.sort((a, b) => a.id.localeCompare(b.id));

test('source roots preserve every existing native input from a clean checkout', () => {
  const oldSources = processSources(legacy, projectRoot).filter(
    (source) => !source.id.includes('/build/')
  );
  expect(oldSources.length).toBeGreaterThan(0);
  expect(sorted(processSources(modulePatterns, projectRoot))).toEqual(sorted(oldSources));
});

test('native security source and manifest edits change inputs, generated outputs do not', () => {
  const sources = [
    'expo-module.config.json',
    'ios/ThemePinnedRequest.swift',
    'ios/MuqunThemeTransport.podspec',
    'ios/Tests/TransportChecks.swift',
    'android/build.gradle',
    'android/src/main/AndroidManifest.xml',
    'android/src/main/java/expo/modules/ThemePolicy.kt',
    'android/src/main/java/expo/modules/ThemePolicy.java',
    'android/src/test/java/expo/modules/ThemePolicyTest.kt',
    'android/src/main/res/xml/network_security_config.xml',
  ].map((name) => `modules/theme-transport/${name}`);
  for (const name of sources) write(name);
  const before = sorted(processSources(modulePatterns, fixture));
  expect(before.map((source) => source.id)).toEqual(sources.toSorted());
  for (const name of sources) {
    write(name, 'changed native source');
    expect(
      processSources(modulePatterns, fixture).find((source) => source.id === name)?.contents
    ).toBe('changed native source');
    write(name);
  }
  for (const name of [
    'android/build/intermediates/merged_manifest/release/AndroidManifest.xml',
    'android/build/intermediates/merged_res_blame_folder/release/out/multi-v2/values.json',
    'android/build/generated/source/codegen/Generated.java',
    'build/output.json',
    '.build/output.json',
  ]) {
    write(`modules/theme-transport/${name}`, 'generated output');
  }
  expect(sorted(processSources(modulePatterns, fixture))).toEqual(before);
  // This fixture catches the precise old failure, rather than only asserting a
  // preferred spelling of the new patterns.
  expect(processSources(legacy, fixture).some((source) => source.id.includes('/build/'))).toBe(
    true
  );
});

test('the Expo adapter still appends the public trust anchor to fingerprint inputs', async () => {
  write('package.json', JSON.stringify({ name: 'fingerprint-fixture', version: '1.0.0' }));
  write(
    'app.json',
    JSON.stringify({
      expo: {
        name: 'Fingerprint fixture',
        slug: 'fingerprint-fixture',
        plugins: [['@hot-updater/expo', { publicKeyPath: './keys/test-public.pem' }]],
      },
    })
  );
  write('keys/test-public.pem', 'public fixture A');
  const builder = await expo()({ cwd: fixture });
  const additions = await builder.nativeBuild!.getFingerprintExtraSources!();
  expect(additions).toEqual(['./keys/test-public.pem']);
  const withKey = appendSources(modulePatterns, additions);
  expect(
    processSources(withKey, fixture).find((source) => source.id === 'keys/test-public.pem')
  ).toMatchObject({ contents: 'public fixture A' });
  write('keys/test-public.pem', 'public fixture B');
  expect(
    processSources(withKey, fixture).find((source) => source.id === 'keys/test-public.pem')
  ).toMatchObject({ contents: 'public fixture B' });
});
