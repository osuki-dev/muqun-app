import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ComposerSendGuard } from '../composer-send-guard';

test('composer send is synchronously exclusive until its delivery settles', () => {
  const guard = new ComposerSendGuard();
  const first = guard.acquire();
  expect(first).not.toBeNull();
  expect(guard.acquire()).toBeNull();
  expect(guard.release(Symbol('unrelated'))).toBe(false);
  expect(guard.acquire()).toBeNull();
  expect(guard.release(first!)).toBe(true);
  expect(guard.acquire()).not.toBeNull();
});

test('a completion from before session reset cannot release a newer send', () => {
  const guard = new ComposerSendGuard();
  const old = guard.acquire()!;
  guard.reset();
  const current = guard.acquire()!;
  expect(guard.owns(old)).toBe(false);
  expect(guard.release(old)).toBe(false);
  expect(guard.owns(current)).toBe(true);
  expect(guard.acquire()).toBeNull();
  expect(guard.release(current)).toBe(true);
});

test('normal send awaits upload and delivery acknowledgment, not post-send output paint', () => {
  const text = readFileSync('src/components/server-terminal-workspace.tsx', 'utf8');
  const source = ts.createSourceFile(
    'workspace.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let send: ts.FunctionDeclaration | undefined;
  function find(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'sendInput') send = node;
    ts.forEachChild(node, find);
  }
  find(source);
  expect(send).toBeDefined();
  const awaited: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression))
      awaited.push(node.expression.expression.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(send!);
  expect(awaited).toEqual(['awaitUploads', 'sendAgentText', 'sendPaneCharacters']);
  const body = send!.getText(source);
  expect(body).toContain('void refreshOutput();');
  expect(body).not.toContain('setTimeout(');
  expect(body.indexOf("setDraft('')")).toBeGreaterThan(body.indexOf('await sendPaneCharacters'));
  expect(body).toContain('if (!isCurrentSend()) return;');
  expect(body).toContain('composerSendGuard.release(sendToken)');
  expect(body).toContain('activePaneRef.current === requestPaneId');
  expect(body).toContain('activeServerRef.current === requestServerId');
});
