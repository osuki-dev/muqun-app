import { describe, expect, test } from 'bun:test';

import {
  engineFailureAction,
  isDeclinedByUser,
  isUnsupportedModelFailure,
  permissionSubject,
  readApprovalBody,
} from '../agent-engine-text';

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

describe('readApprovalBody', () => {
  test('separates the rule key from what it is about', () => {
    expect(readApprovalBody('external_directory: /etc/*')).toEqual({
      action: 'external_directory',
      subject: '/etc/*',
    });
  });

  test('leaves prose that merely contains a colon whole', () => {
    expect(readApprovalBody('Run: sleep 30; echo slept')).toEqual({
      action: '',
      subject: 'Run: sleep 30; echo slept',
    });
  });

  test('a body with no key at all is all subject', () => {
    expect(readApprovalBody('  /etc/hosts  ')).toEqual({ action: '', subject: '/etc/hosts' });
  });
});

describe('a failure the picker can answer', () => {
  test('the sentence a host with no configured default produces', () => {
    // Verbatim from the live 2.0.1 service: `/api/model/default` answered
    // `null`, OpenCode ran the first entry of its own list, and refused it.
    expect(isUnsupportedModelFailure('Model jev-latest is not supported')).toBe(true);
    expect(engineFailureAction('Model jev-latest is not supported')).toBe('choose-model');
  });

  test('however the engine words it', () => {
    expect(engineFailureAction('model opencode/jev-latest not supported')).toBe('choose-model');
    expect(engineFailureAction('AI_APICallError: The model is not supported.')).toBe(
      'choose-model'
    );
  });

  test('a failure about something else is left alone', () => {
    // The plate offers the picker only where the picker is the fix; anything
    // else keeps the engine's own sentence and no action at all.
    expect(engineFailureAction('ENOENT: no such file or directory')).toBeNull();
    expect(engineFailureAction('This tool is not supported on Windows')).toBeNull();
    expect(engineFailureAction('rate limit exceeded')).toBeNull();
    expect(engineFailureAction('')).toBeNull();
  });
});
