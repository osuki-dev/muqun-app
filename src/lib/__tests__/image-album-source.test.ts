import { expect, test } from 'bun:test';
import { rawAlbumImage } from '../image-album-source';

const roots = ['file:///app/cache/', 'file:///app/documents/'];
const upload = '/state/muqun-gateway/uploads/11111111-2222-4333-8444-555555555555.png';

test('unmapped Markdown host paths never become phone image pages', () => {
  for (const uri of [
    '/home/user/private.png',
    'file:///home/user/private.png',
    './photo.png',
    upload,
    'file:///app/cache/picked.png',
    'content://media/external/images/1',
    'javascript:alert(1)',
  ]) {
    expect(rawAlbumImage(uri, false, roots)).toBeNull();
  }
  expect(rawAlbumImage('https://images.invalid/photo.png', false)?.uri).toContain('https:');
  expect(rawAlbumImage('data:image/png;base64,fixture', false)?.uri).toContain('data:image/');
});

test('attachment pages allow strict Gateway uploads and files confined to app storage', () => {
  expect(rawAlbumImage(upload, true, roots)?.uploadName).toBe(
    '11111111-2222-4333-8444-555555555555.png'
  );
  expect(rawAlbumImage(`file://${upload}`, true, roots)?.uploadName).toBeDefined();
  expect(rawAlbumImage('file:///app/cache/picked%20photo.png', true, roots)?.uri).toContain(
    'picked%20photo.png'
  );
  expect(rawAlbumImage('content://media/external/images/1', true, roots)?.uri).toContain(
    'content:'
  );
  for (const uri of [
    '/home/user/private.png',
    'file:///home/user/private.png',
    'file:///app/cache-elsewhere/private.png',
    'file:///app/cache/../../private.png',
    'file:///app/cache/%2e%2e/%2e%2e/private.png',
    'file://remote/app/cache/private.png',
    `${upload}/../private.png`,
    `${upload}?other=1`,
    '/state/muqun-gateway/uploads/arbitrary.png',
  ]) {
    expect(rawAlbumImage(uri, true, roots)).toBeNull();
  }
});
