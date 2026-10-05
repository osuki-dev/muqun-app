import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

import { assetPresentation } from '@/lib/asset-viewer-layout';
import type { AssetKind } from '@/lib/session-assets';
import { HIGHLIGHT_MAX_CHARS, MAX_ASSET_TEXT_BYTES } from '@/lib/text-preview';

function asset(kind: AssetKind, overrides: { previewable?: boolean; size?: number } = {}) {
  return {
    kind,
    previewable: overrides.previewable ?? kind !== 'binary',
    size: overrides.size ?? 1_024,
  };
}

describe('assetPresentation', () => {
  test('a picture opens in the lightbox; one with no preview is described', () => {
    expect(assetPresentation(asset('image'))).toBe('lightbox');
    expect(assetPresentation(asset('image', { previewable: false }))).toBe('details');
  });

  test('markdown is a document, whatever its length once read', () => {
    expect(assetPresentation(asset('markdown'))).toBe('document');
    expect(assetPresentation(asset('markdown'), HIGHLIGHT_MAX_CHARS * 4)).toBe('document');
  });

  test('text -- source, JSON, CSV -- is a highlighted listing inside the budget, rows past it', () => {
    expect(assetPresentation(asset('text'))).toBe('code');
    expect(assetPresentation(asset('text'), HIGHLIGHT_MAX_CHARS)).toBe('code');
    expect(assetPresentation(asset('text'), HIGHLIGHT_MAX_CHARS + 1)).toBe('lines');
  });

  test('text past the byte ceiling is refused before it is read', () => {
    expect(assetPresentation(asset('text', { size: MAX_ASSET_TEXT_BYTES + 1 }))).toBe('too-large');
    expect(assetPresentation(asset('markdown', { size: MAX_ASSET_TEXT_BYTES + 1 }))).toBe(
      'too-large'
    );
    // The ceiling is about text the app would hold; a big picture is still a picture.
    expect(assetPresentation(asset('image', { size: MAX_ASSET_TEXT_BYTES + 1 }))).toBe('lightbox');
  });

  test('PDF, binary and unpreviewable text get the details body', () => {
    expect(assetPresentation(asset('pdf'))).toBe('details');
    expect(assetPresentation(asset('binary'))).toBe('details');
    expect(assetPresentation(asset('text', { previewable: false }))).toBe('details');
  });
});

/**
 * The viewer's ground and gutter, held where they are written.
 *
 * Everything but a picture is text on the viewer's ground, so that ground is
 * the frosted one every sheet wears -- the wallpaper at full strength behind a
 * README was the bug -- and every body keeps the sheet's gutter rather than a
 * number of its own.
 */
describe('the file viewer', () => {
  const viewer = readFileSync('src/components/asset-viewer.tsx', 'utf8');

  test('stands on the frosted sheet ground', () => {
    expect(viewer).toContain('<SheetFrame tint="background" frosted>');
  });

  test('announces the file with the sheet heading', () => {
    expect(viewer).toContain('<SheetSceneHeading');
  });

  test('keeps no horizontal margin of its own beside the sheet gutter', () => {
    const margins = [...viewer.matchAll(/padding(?:Horizontal)?: (\d+)/g)].map((match) => match[1]);
    // The only literal left is the retry pill's own padding inside a control.
    expect(margins).toEqual(['16']);
    expect(viewer).toContain('inset={SHEET_LADDER.gutter}');
    expect(viewer).toContain('horizontal: SHEET_LADDER.gutter');
  });
});
