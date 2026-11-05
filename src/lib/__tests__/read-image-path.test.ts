import { describe, expect, test } from 'bun:test';

import { readImagePath } from '../agent-tool-output';

describe('readImagePath', () => {
  const cases: [string, unknown, string | undefined][] = [
    ['Read', { file_path: '/work/shot.png' }, '/work/shot.png'],
    ['read', { filePath: '/work/a.JPEG' }, '/work/a.JPEG'],
    ['Read', '{"file_path":"/work/b.webp"}', '/work/b.webp'],
    ['view_image', { path: 'img/c.heic' }, 'img/c.heic'],
    ['Read', { file_path: '/work/main.rs' }, undefined],
    ['Read', { file_path: '/work/png' }, undefined],
    ['Bash', { file_path: '/work/shot.png' }, undefined],
    ['Read', undefined, undefined],
  ];
  test.each(cases)('%s %p', (name, input, expected) => {
    expect(readImagePath(name, input)).toBe(expected);
  });
});
