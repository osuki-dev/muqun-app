#!/usr/bin/env node
/**
 * The theme toolchain, as a command.
 *
 * Everything it does is done by the app's own modules -- `theme/package.ts`,
 * `theme/schema.ts`, `theme/opacity-policy.ts` -- so a package this accepts is
 * a package the importer accepts, by construction rather than by agreement.
 * That is the whole point: an author should not have to discover the twenty-five
 * megabyte ceiling, or the rule against undeclared files, from a red message on
 * a phone.
 *
 * Nothing here touches React Native. The theme core depends only on `zod` and
 * `fflate`, which is what lets this run under plain Node as well as Bun and is
 * why the eventual npm package can share this code rather than fork it.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { packTheme, unpackTheme } from '@/theme/package';
import { parseThemeManifest, THEME_ICONS, THEME_LIMITS, type ThemeManifest } from '@/theme/schema';
import { themeOpacityPolicy } from '@/theme/opacity-policy';
import { createThemeStarter } from '@/theme/authoring';
import { formatThemeJson } from '@/theme/format-json';

const MiB = 1024 * 1024;
const bold = (text: string) => `[1m${text}[0m`;
const red = (text: string) => `[31m${text}[0m`;
const green = (text: string) => `[32m${text}[0m`;
const dim = (text: string) => `[2m${text}[0m`;

function size(bytes: number): string {
  return bytes >= MiB ? `${(bytes / MiB).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
}

class CommandError extends Error {}

/** Read a manifest from either form of theme file. */
function readTheme(file: string): { manifest: ThemeManifest; assets?: Record<string, Uint8Array> } {
  const bytes = readFileSync(file);
  if (/\.muqun-theme$|\.zip$/i.test(file)) {
    const unpacked = unpackTheme(new Uint8Array(bytes));
    return { manifest: unpacked.manifest, assets: unpacked.assets };
  }
  return { manifest: parseThemeManifest(bytes.toString('utf8')) };
}

/** Collect exactly the files the manifest declares, and nothing else. */
function declaredAssets(dir: string, manifest: ThemeManifest): Record<string, Uint8Array> {
  const assets: Record<string, Uint8Array> = {};
  for (const [id, asset] of Object.entries(manifest.assets ?? {})) {
    if (!('path' in asset))
      throw new CommandError(`Asset "${id}" has no packaged path, so it cannot be bundled.`);
    const file = join(dir, asset.path);
    try {
      assets[id] = new Uint8Array(readFileSync(file));
    } catch {
      throw new CommandError(`Asset "${id}" names ${asset.path}, which is not in ${dir}.`);
    }
  }
  return assets;
}

function reportUndeclared(dir: string, manifest: ThemeManifest): string[] {
  const declared = new Set(
    Object.values(manifest.assets ?? {}).flatMap((asset) => ('path' in asset ? [asset.path] : []))
  );
  const found: string[] = [];
  const walk = (relative: string) => {
    let entries: string[];
    try {
      entries = readdirSync(join(dir, relative));
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = relative ? `${relative}/${entry}` : entry;
      if (statSync(join(dir, next)).isDirectory()) walk(next);
      else if (next !== 'theme.json' && !declared.has(next)) found.push(next);
    }
  };
  walk('');
  return found;
}

function cmdPack(dir: string, out?: string): void {
  const root = resolve(dir);
  const manifest = parseThemeManifest(readFileSync(join(root, 'theme.json'), 'utf8'));
  const assets = declaredAssets(root, manifest);
  const extra = reportUndeclared(root, manifest);
  if (extra.length)
    console.log(
      dim(
        `Leaving out ${extra.length} file(s) the manifest does not declare: ${extra.slice(0, 6).join(', ')}${extra.length > 6 ? '…' : ''}`
      )
    );

  const bytes = packTheme({ manifest, assets });
  const target = resolve(out ?? `${manifest.id}.muqun-theme`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);

  // Round-trip through the importer the phone runs, so "it packed" and "it
  // installs" are the same claim.
  const back = unpackTheme(bytes);
  if (back.manifest.id !== manifest.id) throw new CommandError('Round trip changed the theme id.');
  if (Object.keys(back.assets).length !== Object.keys(assets).length)
    throw new CommandError('Round trip lost an asset.');

  console.log(
    `${green('packed')} ${basename(target)}  ${size(bytes.length)}  ` +
      `${Object.keys(assets).length} asset(s)  ${dim('round trip ok')}`
  );
  console.log(dim(`  package limit ${size(THEME_LIMITS.packageBytes)}`));
}

function cmdCheck(file: string, explain = false): number {
  const { manifest } = readTheme(file);
  console.log(bold(`${manifest.name}  ${dim(manifest.id)}`));

  let problems = 0;
  const floors: Record<'surface' | 'terminal', number[]> = { surface: [], terminal: [] };
  for (const mode of ['light', 'dark'] as const) {
    const policy = themeOpacityPolicy(manifest.variants[mode]);
    floors.surface.push(policy.surface.minimum);
    floors.terminal.push(policy.terminal.minimum);
    const issues = [...policy.surface.baselineIssues, ...policy.terminal.baselineIssues];
    console.log(
      `  ${mode.padEnd(5)} interface ${(policy.surface.minimum * 100).toFixed(0)}%` +
        `  terminal ${(policy.terminal.minimum * 100).toFixed(0)}%` +
        (policy.ansiIssues.length ? dim(`  ${policy.ansiIssues.length} ANSI below 4.5:1`) : '')
    );
    if (explain) {
      // The floor is the highest of these. Printing them in order is the
      // difference between "your slider is 99%" and "these two colours are why".
      for (const group of [
        ['interface', policy.surface] as const,
        ['terminal', policy.terminal] as const,
      ]) {
        const worst = group[1].explain().filter((pair) => pair.floor > 0);
        if (!worst.length) continue;
        console.log(dim(`    ${group[0]} floor is set by:`));
        for (const pair of worst.slice(0, 5))
          console.log(
            `      ${(pair.floor * 100).toFixed(0).padStart(3)}%  ${pair.path} ` +
              dim(`(needs ${pair.required}:1)`)
          );
      }
    }
    for (const issue of issues) {
      problems += 1;
      console.log(
        `    ${red('fails at full opacity')} ${issue.path} ` +
          `${issue.ratio.toFixed(2)}:1 < ${issue.required}:1`
      );
    }
  }

  // The number an author actually feels: how much of the slider they get.
  const shared = {
    surface: Math.max(...floors.surface),
    terminal: Math.max(...floors.terminal),
  };
  for (const [role, floor] of Object.entries(shared)) {
    const points = Math.round((1 - floor) * 100);
    const note =
      points === 0
        ? red('no translucency possible')
        : points < 10
          ? red(`only ${points} points of travel`)
          : green(`${points} points of travel`);
    console.log(`  ${role.padEnd(9)} slider ${(floor * 100).toFixed(0)}%-100%  ${note}`);
  }
  if (
    Math.min(...floors.surface) < shared.surface ||
    Math.min(...floors.terminal) < shared.terminal
  )
    console.log(
      dim('  Both modes share the stricter floor, so the tighter palette decides the slider.')
    );

  const assets = Object.entries(manifest.assets ?? {});
  console.log(`  ${assets.length}/${THEME_LIMITS.assets} asset(s) declared`);

  // The icons table accepts names this build does not know, so that an older
  // app ignores a newer pack's glyph instead of refusing the whole theme. The
  // cost of that tolerance is that a typo is silent at runtime -- so it is
  // reported here, where an author is listening, and only as a warning.
  const icons = Object.entries(manifest.icons ?? {}).filter(([, icon]) => icon);
  if (icons.length) {
    const known = new Set<string>(THEME_ICONS);
    const unknown = icons.map(([name]) => name).filter((name) => !known.has(name));
    console.log(`  ${icons.length} icon(s) replaced`);
    for (const name of unknown)
      console.log(
        `    ${red('not a glyph this build draws')} ${name} ` +
          dim(`(known: ${THEME_ICONS.join(', ')})`)
      );
    for (const [name, icon] of icons) {
      if (icon && !Object.hasOwn(manifest.assets ?? {}, icon.asset)) {
        problems += 1;
        console.log(`    ${red('names an asset the manifest does not declare')} ${name}`);
      }
    }
  }
  return problems;
}

function cmdValidate(file: string): void {
  const { manifest, assets } = readTheme(file);
  console.log(`${green('valid')} ${manifest.name} ${dim(`(${manifest.id} ${manifest.version})`)}`);
  if (assets) console.log(dim(`  ${Object.keys(assets).length} packaged asset(s)`));
}

function cmdUnpack(file: string, dir: string): void {
  const bytes = new Uint8Array(readFileSync(file));
  const { manifest, assets } = unpackTheme(bytes);
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'theme.json'), formatThemeJson(JSON.stringify(manifest)));
  for (const [id, content] of Object.entries(assets)) {
    const asset = (manifest.assets ?? {})[id];
    if (!asset || !('path' in asset)) continue;
    const target = join(root, asset.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log(`${green('unpacked')} ${manifest.id} into ${dir}`);
}

function cmdInit(slug: string | undefined, dir: string): void {
  const starter = createThemeStarter();
  const manifest = slug ? { ...starter, id: slug, name: slug } : starter;
  const root = resolve(dir);
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'theme.json'), formatThemeJson(JSON.stringify(manifest)));
  console.log(
    `${green('created')} ${join(dir, 'theme.json')} ${dim('(complete, already passes the contrast gate)')}`
  );
}

const USAGE = `muqun-theme — build and check Muqun themes

  init [slug] [--dir .]        write a complete starter theme.json
  check <file> [--explain]     contrast floors, slider travel, asset count
                               --explain names the colours setting each floor
  validate <file>              parse a .muqun-theme or .muqun-theme.json
  pack <dir> [--out file]      build a .muqun-theme and verify it round trips
  unpack <file> <dir>          extract a package for editing

A <file> may be a .muqun-theme package or a .muqun-theme.json manifest.`;

function main(argv: string[]): number {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const positional = argv.filter((value, index) => {
    if (value.startsWith('--')) return false;
    return !(index > 0 && argv[index - 1].startsWith('--'));
  });
  const [command, first, second] = positional;

  switch (command) {
    case 'init':
      cmdInit(first, flag('dir') ?? '.');
      return 0;
    case 'check':
      if (!first) throw new CommandError('check needs a file.');
      return cmdCheck(first, argv.includes('--explain')) > 0 ? 1 : 0;
    case 'validate':
      if (!first) throw new CommandError('validate needs a file.');
      cmdValidate(first);
      return 0;
    case 'pack':
      if (!first) throw new CommandError('pack needs a directory.');
      cmdPack(first, flag('out'));
      return 0;
    case 'unpack':
      if (!first || !second) throw new CommandError('unpack needs a file and a directory.');
      cmdUnpack(first, second);
      return 0;
    default:
      console.log(USAGE);
      return command === undefined || command === '--help' || command === 'help' ? 0 : 1;
  }
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  // Schema failures arrive as multi-line "<path>: <message>" text. That is the
  // right level of detail for someone editing the file; it is only wrong on a
  // phone, where nobody can act on it.
  console.error(red(error instanceof Error ? error.message : String(error)));
  process.exit(1);
}
