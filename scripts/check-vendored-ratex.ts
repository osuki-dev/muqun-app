/**
 * The install-time check that turns a half-downloaded RaTeX into a sentence.
 *
 * `react-native-enriched-markdown` does not ship its LaTeX engine in the npm
 * tarball. Its postinstall vendors RaTeX in **two** downloads, in this order
 * (`node_modules/react-native-enriched-markdown/vendor-ratex.mjs`):
 *
 *  1. `RaTeX.xcframework.zip` -- the prebuilt static framework, unzipped into
 *     `ios/vendor/RaTeX.xcframework`.
 *  2. the pinned source tarball -- from which four core Swift files
 *     (`RaTeXRenderer.swift` and friends) and the KaTeX `.ttf` fonts are
 *     copied into `ios/vendor/`.
 *
 * Only after *both* land does it write `ios/vendor/.stamp`. If the second
 * download fails -- a proxy the tool cannot see, an interrupted transfer, a
 * full disk, a flaky CDN -- the first one has already been unzipped, and the
 * tree is left with the framework and none of the sources.
 *
 * That half-vendored tree is the trap. The podspec decides whether to compile
 * math by testing one thing:
 *
 *     ratex_present = File.directory?(File.join(__dir__, 'ios/vendor/RaTeX.xcframework'))
 *
 * and then compiles `ios/math/**` and `ios/vendor/*.swift`, on the strength of
 * a comment that says "enable_math already implies ratex_present ... so the
 * vendored references below always resolve". The framework alone satisfies
 * that test, the Swift sources it needs are absent, and the *only* thing the
 * contributor ever sees is Xcode saying
 *
 *     ENRMRaTeXBridge.swift:18:25: error: cannot find type 'RaTeXRenderer' in scope
 *
 * -- a Swift name-resolution error, hundreds of lines into a pod build, that
 * says nothing about a download. This app opts into math explicitly
 * (`"enriched-markdown": { "enableMath": true }` in `package.json`), so that
 * is the path every `bun install` here takes.
 *
 * So we check it ourselves, at install time, where the fix is still one
 * command. Nothing is vendored into this repository and nothing is written
 * into `node_modules`: this only reads what the package's own postinstall was
 * supposed to leave behind, and says which half is missing.
 *
 * The expected file list is read from the package's own `ratex-version.json`
 * rather than hard-coded, so a version bump that re-pins the Swift sources
 * does not need a matching edit here.
 *
 * Severity mirrors the podspec's own reconciliation, so the check never
 * disagrees with the build it is protecting:
 *
 *  - `enableMath` explicitly set and not `false` -> an incomplete tree is a
 *    hard failure, because the pod build will `raise` (or worse, fail in
 *    Swift) rather than degrade.
 *  - `enableMath` absent -> math is on by default but the pod degrades to a
 *    clean build without it, so an incomplete tree is a warning.
 *  - `enableMath: false` -> nothing to check.
 *
 * Run by `postinstall`; also runnable by hand:
 *
 *     bun scripts/check-vendored-ratex.ts
 */
/// <reference types="node" />
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOG = '[muqun] RaTeX vendor check';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = join(repoRoot, 'node_modules', 'react-native-enriched-markdown');
const vendorDir = join(packageRoot, 'ios', 'vendor');

/** The shape of `ratex-version.json` that this check reads. */
interface RatexManifest {
  tag?: string;
  source?: {
    swiftSources?: string[];
    fontsDir?: string;
  };
}

/**
 * How loudly a missing piece is reported: the same three-way split the podspec
 * makes between an explicit opt-in, the implicit default, and an opt-out.
 */
type MathSetting = 'explicit' | 'default' | 'off';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function mathSetting(): MathSetting {
  const pkg = readJson(join(repoRoot, 'package.json')) as {
    'enriched-markdown'?: { enableMath?: unknown };
  };
  const config = pkg['enriched-markdown'];
  if (!config || typeof config !== 'object' || !('enableMath' in config)) return 'default';
  return config.enableMath === false ? 'off' : 'explicit';
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Everything the podspec compiles or links when math is on, and whether it is
 * actually on disk. Paths are relative to the package root so the message a
 * reader gets names the same paths the podspec does.
 */
function missingPieces(manifest: RatexManifest): string[] {
  const missing: string[] = [];

  // 1. The XCFramework: the one thing the podspec does check for.
  if (!isDirectory(join(vendorDir, 'RaTeX.xcframework'))) {
    missing.push('ios/vendor/RaTeX.xcframework/ (the prebuilt framework)');
  } else if (!existsSync(join(vendorDir, 'RaTeX.xcframework', 'Info.plist'))) {
    // An interrupted unzip can leave the directory without its manifest.
    missing.push('ios/vendor/RaTeX.xcframework/Info.plist (the unzip did not finish)');
  }

  // 2. The Swift sources the podspec compiles into its own module. These are
  //    the ones whose absence produces "cannot find type 'RaTeXRenderer'".
  const swiftSources = manifest.source?.swiftSources ?? [];
  for (const source of swiftSources) {
    const name = basename(source);
    if (!existsSync(join(vendorDir, name))) missing.push(`ios/vendor/${name}`);
  }
  if (swiftSources.length === 0) {
    missing.push('ratex-version.json lists no source.swiftSources (the manifest itself is wrong)');
  }

  // 3. The KaTeX fonts, which become the `RaTeXCoreFonts` resource bundle.
  //    An empty directory is as broken as an absent one -- the bundle would
  //    build and the glyphs would be gone at run time.
  const fonts = join(vendorDir, 'Fonts');
  if (!isDirectory(fonts)) {
    missing.push('ios/vendor/Fonts/ (the KaTeX .ttf fonts)');
  } else if (!readdirSync(fonts).some((file) => file.endsWith('.ttf'))) {
    missing.push('ios/vendor/Fonts/*.ttf (the directory is there but holds no fonts)');
  }

  return missing;
}

function report(missing: string[], setting: MathSetting, manifest: RatexManifest): void {
  const tag = manifest.tag ? ` (${manifest.tag})` : '';
  const lines = [
    `${LOG}: the vendored RaTeX tree${tag} is incomplete.`,
    '',
    '  Missing, under node_modules/react-native-enriched-markdown/:',
    ...missing.map((piece) => `    - ${piece}`),
    '',
    "  The package's postinstall downloads RaTeX in two parts and only the",
    '  first one landed. Its podspec checks for the framework alone, so the',
    '  iOS build will not warn about this -- it fails in Swift with',
    '  "cannot find type \'RaTeXRenderer\' in scope".',
    '',
    '  Fix it by re-running the vendor step:',
    '',
    '    NODE_USE_ENV_PROXY=1 node node_modules/react-native-enriched-markdown/postinstall.mjs',
    '',
    '  NODE_USE_ENV_PROXY=1 is not optional behind a proxy: that script downloads',
    "  with Node's fetch, which ignores http_proxy/https_proxy unless it is set.",
    '  See AGENTS.md, "Installing behind a proxy".',
    '',
    '  If you do not need LaTeX math on iOS, turn it off instead and the',
    '  download stops being required:',
    '',
    '    package.json -> "enriched-markdown": { "enableMath": false }',
  ];

  if (setting === 'explicit') {
    console.error(lines.join('\n'));
    process.exit(1);
  }
  // Math was never asked for by name, and the pod degrades to a build without
  // it, so this is worth saying once and not worth failing over.
  console.warn(lines.join('\n'));
}

function main(): void {
  const setting = mathSetting();
  if (setting === 'off') return;

  // Not installed (a pruned or partial tree): nothing of ours to verify.
  if (!isDirectory(packageRoot)) return;

  const manifestPath = join(packageRoot, 'ratex-version.json');
  if (!existsSync(manifestPath)) {
    // A build of the package that does not vendor RaTeX at all. Not our
    // failure to report, and not one this check can describe.
    return;
  }

  const manifest = readJson(manifestPath) as RatexManifest;
  const missing = missingPieces(manifest);
  if (missing.length > 0) report(missing, setting, manifest);
}

main();
