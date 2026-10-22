/**
 * Rebuild launcher exports from the checked-in masters. Requires ImageMagick 7.
 * Run: bun scripts/generate-brand-assets.ts
 * Limit exports to named styles: bun scripts/generate-brand-assets.ts Mint Sakura
 * Creative edits use imagegen; this step only sizes, composites and encodes assets.
 * No generated-image cache, network service or untracked source is required.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type IconSpec = {
  id: string;
  directory: string;
  light: string;
  dark: string;
  fullBleed?: boolean;
};
const root = fileURLToPath(new URL('../', import.meta.url));
const specs: IconSpec[] = JSON.parse(readFileSync(`${root}assets/icons/catalog.json`, 'utf8'));
const selectedIds = new Set(process.argv.slice(2));
for (const id of selectedIds) {
  if (!specs.some((spec) => spec.id === id)) throw new Error(`Unknown icon style: ${id}`);
}
const encode = [
  '-strip',
  '-depth',
  '8',
  '+dither',
  '-colors',
  '256',
  '-define',
  'png:compression-level=9',
];
function magick(args: string[]) {
  execFileSync('magick', args, { cwd: root, stdio: 'inherit' });
}

for (const spec of specs) {
  if (selectedIds.size > 0 && !selectedIds.has(spec.id)) continue;
  const folder = `assets/icons/${spec.directory}`;
  // Classic's hand-drawn in-app mark and launcher exports are the originals.
  if (spec.directory === 'classic') continue;
  const master = `${folder}/mark.png`;
  // The in-app mark (Settings footer, launch loader, lock screen, Home) follows the
  // selected launcher icon. Cutouts sit on a transparent canvas; a full-bleed master
  // has no cutout, so it becomes a rounded icon tile instead of an opaque square.
  magick([
    master,
    '-resize',
    '384x384',
    ...(spec.fullBleed
      ? [
          '-alpha',
          'set',
          '(',
          '-size',
          '384x384',
          'xc:none',
          '-fill',
          'white',
          '-draw',
          'roundrectangle 0,0,383,383,86,86',
          ')',
          '-compose',
          'DstIn',
          '-composite',
          '-compose',
          'over',
        ]
      : []),
    '-gravity',
    'center',
    '-background',
    'none',
    '-extent',
    '512x512',
    ...encode,
    `${folder}/brand-mark.png`,
  ]);
  // Preserve imagegen-prepared full-bleed icon canvases.
  if (spec.fullBleed) continue;
  for (const [filename, background] of [
    ['icon.png', spec.light],
    ...(spec.dark === spec.light ? [] : [['icon-dark.png', spec.dark]]),
  ]) {
    magick([
      master,
      '-resize',
      '720x720',
      '-gravity',
      'center',
      '-background',
      background,
      '-extent',
      '1024x1024',
      '-alpha',
      'remove',
      '-alpha',
      'off',
      ...encode,
      `${folder}/${filename}`,
    ]);
  }
  // 440px bounding square has a 622px diagonal: fully inside the 66/108 safe circle.
  magick([
    master,
    '-resize',
    '440x440',
    '-gravity',
    'center',
    '-background',
    'none',
    '-extent',
    '1024x1024',
    ...encode,
    `${folder}/android-foreground.png`,
  ]);
  // Small, dedicated picker previews avoid bundling 1024px native build inputs in JS.
  for (const [mode, background] of [
    ['light', spec.light],
    ['dark', spec.dark],
  ]) {
    if (mode === 'dark' && spec.dark === spec.light) continue;
    magick([
      master,
      '-resize',
      '134x134',
      '-gravity',
      'center',
      '-background',
      background,
      '-extent',
      '192x192',
      '-alpha',
      'remove',
      '-alpha',
      'off',
      ...encode,
      `${folder}/preview-${mode}.png`,
    ]);
  }
}
// A targeted export must not touch shared assets or another style's checked-in output.
if (selectedIds.size > 0) {
  console.log(`Launcher assets regenerated: ${[...selectedIds].join(', ')}.`);
  process.exit(0);
}
for (const [mode, filename] of [
  ['light', 'icon.png'],
  ['dark', 'icon-dark.png'],
]) {
  magick([
    `assets/icons/classic/${filename}`,
    '-resize',
    '192x192',
    '-alpha',
    'off',
    ...encode,
    `assets/icons/classic/preview-${mode}.png`,
  ]);
}
// Shared monochrome identity retains Classic's facial negative space for every style.
// Classic's existing foreground is already a real transparent mark; use that as the source.
magick([
  'assets/icons/classic/android-icon-foreground.png',
  '-trim',
  '+repage',
  '-resize',
  '440x440',
  '-gravity',
  'center',
  '-background',
  'none',
  '-extent',
  '1024x1024',
  '-colorspace',
  'Gray',
  '-threshold',
  '35%',
  '-transparent',
  'black',
  ...encode,
  'assets/icons/monochrome.png',
]);
magick([
  'assets/icons/classic/icon.png',
  '-resize',
  '64x64',
  ...encode,
  'assets/icons/favicon.png',
]);
console.log('Launcher assets and compact previews regenerated.');
