import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { createElement, type ReactElement } from 'react';
import { declaration, transpile } from '../../test-support/production-source';

const source = new URL('../app-diagram-provider.tsx', import.meta.url).pathname;
function render(name: string, props: Record<string, unknown>) {
  return runInNewContext(transpile(`${declaration(source, name)}\n${name}(props)`), {
    createElement,
    props,
    X: 'close-icon',
    Maximize: 'maximize-icon',
    Copy: 'copy-icon',
    Check: 'check-icon',
  }) as ReactElement<{ color: string; size: number }>;
}

test('diagram actions use the app icon family with host-supplied color and size', () => {
  for (const [action, expected] of Object.entries({
    close: 'close-icon',
    fit: 'maximize-icon',
    copy: 'copy-icon',
    success: 'check-icon',
  })) {
    const icon = render('renderDiagramViewerIcon', { action, color: '#abcdef', size: 19 });
    expect(icon.type).toBe(expected);
    expect(icon.props).toEqual({ color: '#abcdef', size: 19 });
  }
  const expand = render('renderDiagramExpandIcon', { color: '#123456', size: 22 });
  expect(expand.type).toBe('maximize-icon');
  expect(expand.props).toEqual({ color: '#123456', size: 22 });
});
