import { describe, expect, test } from 'bun:test';
import { updateNoteBullets } from './update-note-bullets';

describe('updateNoteBullets', () => {
  test('drops a channel heading and keeps the changes', () => {
    expect(
      updateNoteBullets(
        '## Android preview update\n\n- Replies keep their place.\n- Themes apply faster.\n'
      )
    ).toEqual(['Replies keep their place.', 'Themes apply faster.']);
  });

  test('joins wrapped bullets and strips inline markup', () => {
    expect(
      updateNoteBullets(
        '* **Home** shows five sessions\n  without scrolling.\n1. See [the guide](https://x.test) for `mq`.'
      )
    ).toEqual(['Home shows five sessions without scrolling.', 'See the guide for mq.']);
  });

  test('keeps CRLF notes readable', () => {
    expect(updateNoteBullets('# Title\r\n- One\r\n- Two')).toEqual(['One', 'Two']);
  });

  test('returns null for prose, a lone heading or a later heading', () => {
    expect(updateNoteBullets('Fixes a crash when opening settings.')).toBeNull();
    expect(updateNoteBullets('## Update')).toBeNull();
    expect(updateNoteBullets('- One\n\n## More\n- Two')).toBeNull();
    expect(updateNoteBullets('- One\n\nSome closing words.')).toBeNull();
  });
});
