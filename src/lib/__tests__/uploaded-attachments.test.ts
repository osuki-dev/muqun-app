import { expect, test } from 'bun:test';
import { parseTimelineItem } from '../agent-protocol';
import { splitUploadedAttachmentSuffix } from '../uploaded-attachments';

const video = '/state/muqun-gateway/uploads/11111111-2222-4333-8444-555555555555.mp4';
const photo = '/state/muqun-gateway/uploads/66666666-7777-4888-8999-000000000000.webp';
const suffix = (paths: string[]) =>
  `\n\nAttached files (on this host):${paths.map((path) => `\n- ${path}`).join('')}`;
const row = (text: string, extra = {}) =>
  parseTimelineItem({ id: 'history', role: 'user', part: { type: 'text', text }, ...extra });

test('canonical history recovers uploaded media without an optimistic row and deduplicates wire attachments', () => {
  const text = 'Review this recording.';
  const item = row(text + suffix([video, photo]), { attachments: [`file://${video}`] });
  expect(item?.part).toEqual({ type: 'text', text });
  expect(item?.attachments).toEqual([`file://${video}`, photo]);
  expect(row(suffix([video]))?.part).toEqual({ type: 'text', text: '' });
  expect(row(text + suffix([video]))?.attachments).toEqual([video]);
  const macVideo = video.replace('/state', '/Users/person/Library/Application Support');
  expect(row(text + suffix([macVideo]))?.attachments).toEqual([macVideo]);
  expect(row(text + suffix([macVideo]))?.part).toEqual({ type: 'text', text });
});

test('untrusted or nonterminal attachment prose remains byte for byte', () => {
  for (const text of [
    'Explain this:' + suffix(['/etc/private.mp4']),
    suffix([video]) + '\nAfter the list',
    suffix([video, 'https://host/muqun-gateway/uploads/11111111-2222-4333-8444-555555555555.mp4']),
    suffix([video.replace('/state/', '/state/../')]),
    suffix([video.replace('/state/', '//host/')]),
    suffix([video + '/other']),
    suffix([video + '?query']),
    suffix([video.replace('/state', '/state\tfiles')]),
    '```text' + suffix([video]),
  ]) {
    expect(splitUploadedAttachmentSuffix(text)).toEqual({ text, attachments: [] });
    expect(row(text)?.part).toEqual({ type: 'text', text });
  }
});

test('assistant examples never become user attachment metadata', () => {
  const text = 'Example' + suffix([video]);
  const item = row(text, { role: 'assistant' });
  expect(item?.part).toEqual({ type: 'text', text });
  expect(item?.attachments).toBeUndefined();
});
