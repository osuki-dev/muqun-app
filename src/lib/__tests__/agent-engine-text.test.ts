import { describe, expect, test } from 'bun:test';

import { isDeclinedByUser, permissionSubject } from '../agent-engine-text';

describe('permissionSubject', () => {
  test('takes the rule key off the front of the prompt', () => {
    expect(
      permissionSubject({
        action: 'external_directory',
        prompt: 'external_directory: /etc/*',
        resources: ['/etc/*'],
      })
    ).toBe('/etc/*');
  });

  test('matches the key whatever case it arrived in', () => {
    expect(
      permissionSubject({ action: 'shell', prompt: 'Shell: rm -rf build', resources: [] })
    ).toBe('rm -rf build');
  });

  test('leaves a prompt that merely contains a colon alone', () => {
    expect(
      permissionSubject({
        action: 'shell',
        prompt: 'git commit -m "fix: the header"',
        resources: [],
      })
    ).toBe('git commit -m "fix: the header"');
  });

  test('falls back to the resource when the prompt was only the key', () => {
    expect(permissionSubject({ action: 'edit', prompt: 'edit:', resources: ['src/app.tsx'] })).toBe(
      'src/app.tsx'
    );
  });

  test('uses the first resource when there is no prompt', () => {
    expect(permissionSubject({ action: 'edit', prompt: '  ', resources: ['src/app.tsx'] })).toBe(
      'src/app.tsx'
    );
  });

  test('says nothing when the request carries nothing to say', () => {
    expect(permissionSubject({ action: 'edit', prompt: '', resources: [] })).toBe('');
  });
});

describe('isDeclinedByUser', () => {
  test('recognises the engine sentence', () => {
    expect(isDeclinedByUser('The user declined this tool call')).toBe(true);
  });

  test('and its other two words for it', () => {
    expect(isDeclinedByUser('User denied the request')).toBe(true);
    expect(isDeclinedByUser('rejected by the user')).toBe(true);
    expect(isDeclinedByUser('Denied by user')).toBe(true);
  });

  test('leaves a real error alone', () => {
    expect(isDeclinedByUser('EACCES: permission denied, open /etc/hosts')).toBe(false);
    expect(isDeclinedByUser('Connection refused')).toBe(false);
    expect(isDeclinedByUser('')).toBe(false);
  });
});
