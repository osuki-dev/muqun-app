import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import config from '../../../app.json';

test('iOS registers only the Muqun theme document type', () => {
  const documentTypes = config.expo.ios.infoPlist.CFBundleDocumentTypes;
  expect(documentTypes).toHaveLength(1);
  expect(documentTypes[0].LSItemContentTypes).toEqual(['dev.osuki.muqun.theme']);
  expect(documentTypes.flatMap((entry) => entry.LSItemContentTypes)).not.toContain('public.json');
  expect(documentTypes.flatMap((entry) => entry.LSItemContentTypes)).not.toContain(
    'public.zip-archive'
  );
});

test('the iOS document type owns only the Muqun theme extension', () => {
  const declarations = config.expo.ios.infoPlist.UTExportedTypeDeclarations;
  expect(declarations).toHaveLength(1);
  expect(declarations[0].UTTypeIdentifier).toBe('dev.osuki.muqun.theme');
  expect(declarations[0].UTTypeConformsTo).toEqual(['public.zip-archive']);
  expect(declarations[0].UTTypeTagSpecification['public.filename-extension']).toEqual([
    'muqun-theme',
  ]);
});

test('packaged themes are shared with the custom MIME type', () => {
  const source = readFileSync('src/theme/local-files.ts', 'utf8');
  expect(source).toContain(
    "mimeType: packaged ? 'application/vnd.muqun.theme' : 'application/json'"
  );
});
