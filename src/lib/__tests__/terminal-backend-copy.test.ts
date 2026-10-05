import { describe, expect, mock, test } from 'bun:test';

// The Lingui macro is compiled away in the app; here it reads as the source text.
const interpolate = (strings: TemplateStringsArray, ...values: unknown[]) =>
  strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), '');
mock.module('@lingui/core/macro', () => ({
  t: interpolate,
  plural: interpolate,
  msg: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const message = interpolate(strings, ...values);
    return { id: message, message };
  },
}));

const { TMUX_START_COMMAND, terminalBackendCopy } = await import('../terminal-backend-copy');

describe('terminal backend copy', () => {
  test('tmux names tmux and offers the command that starts a server', () => {
    const copy = terminalBackendCopy('tmux');
    expect(copy.reason).toContain('tmux');
    expect(copy.command).toBe(TMUX_START_COMMAND);
    expect(TMUX_START_COMMAND).toBe('tmux new-session -d');
  });

  test('herdr and other backends name themselves and offer no command', () => {
    expect(terminalBackendCopy('herdr').reason).toContain('Herdr');
    expect(terminalBackendCopy('herdr').command).toBeUndefined();
    expect(terminalBackendCopy('zellij').reason).toContain('zellij');
    expect(terminalBackendCopy('zellij').command).toBeUndefined();
  });
});
