import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { auditThemeContrast } from '../src/theme/contrast';
import { inspectThemeImage } from '../src/theme/image-inspection';
import { packTheme, unpackTheme } from '../src/theme/package';
import { parseThemeManifest } from '../src/theme/schema';

const directory = path.resolve(process.argv[2] ?? 'themes/comic-bloom');
const manifest = parseThemeManifest(await readFile(path.join(directory, 'theme.json'), 'utf8'));
if (auditThemeContrast(manifest).length) throw new Error('Theme contrast audit failed');
const assets: Record<string, Uint8Array> = {};
for (const [id, descriptor] of Object.entries(manifest.assets ?? {})) {
  if (!('path' in descriptor)) throw new Error('Offline package cannot contain remote assets');
  const bytes = new Uint8Array(await readFile(path.join(directory, descriptor.path)));
  inspectThemeImage(bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (descriptor.sha256 && descriptor.sha256 !== digest) throw new Error('Asset SHA-256 mismatch');
  assets[id] = bytes;
}
const bytes = packTheme({ manifest, assets });
const roundTrip = unpackTheme(bytes);
if (JSON.stringify(roundTrip.manifest) !== JSON.stringify(manifest))
  throw new Error('Manifest round-trip failed');
for (const [id, original] of Object.entries(assets)) {
  const restored = roundTrip.assets[id];
  if (
    original.length !== restored.length ||
    original.some((byte, index) => byte !== restored[index])
  )
    throw new Error('Image round-trip failed');
}
const output = path.resolve(process.argv[3] ?? `dist/themes/${manifest.id}.muqun-theme`);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(
  `${output}: ${bytes.length} bytes; schema, contrast, static image headers, SHA-256 and byte-exact round-trip passed`
);
