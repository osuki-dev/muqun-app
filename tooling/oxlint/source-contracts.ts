import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseSync, visitorKeys, type Node } from 'oxc-parser';

export function parse(path: string, text = readFileSync(path, 'utf8')) {
  const result = parseSync(path, text);
  if (result.errors.length) throw new Error(`Cannot parse ${path}: ${result.errors[0]?.message}`);
  return result.program;
}
export function nodes(root: Node): Node[] {
  const result: Node[] = [];
  function visit(node: Node) {
    result.push(node);
    for (const key of visitorKeys[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) if (item) visit(item as Node);
      } else if (child) visit(child as Node);
    }
  }
  visit(root);
  return result;
}
export function name(node: Node | null | undefined): string {
  if (!node) return '';
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed)
    return `${name(node.object)}.${name(node.property)}`;
  return '';
}
const calls = (root: Node, callee: string) =>
  nodes(root).filter((node) => node.type === 'CallExpression' && name(node.callee) === callee);
const hasIdentifier = (root: Node, identifier: string) =>
  nodes(root).some((node) => node.type === 'Identifier' && node.name === identifier);
const fn = (root: Node, id: string) =>
  nodes(root).find((node) => node.type === 'FunctionDeclaration' && node.id?.name === id);

export function paneShape(root: Node): string[] {
  const templates = nodes(root).filter(
    (node) => node.type === 'TemplateLiteral' && hasIdentifier(node, 'PANE_OUTPUT_FORMAT')
  );
  const shape = templates[0];
  const problems: string[] = [];
  if (
    templates.length !== 1 ||
    shape?.type !== 'TemplateLiteral' ||
    shape.expressions.length !== 3 ||
    name(shape.expressions[0]) !== 'PANE_OUTPUT_FORMAT' ||
    name(shape.expressions[1]) !== 'source' ||
    shape.expressions[2]?.type !== 'ConditionalExpression' ||
    name(shape.expressions[2].test) !== 'ownsScreen' ||
    shape.expressions[2].consequent.type !== 'Literal' ||
    shape.expressions[2].consequent.value !== 'alt' ||
    shape.expressions[2].alternate.type !== 'Literal' ||
    shape.expressions[2].alternate.value !== 'main' ||
    JSON.stringify(shape.quasis.map((quasi) => quasi.value.cooked)) !==
      JSON.stringify(['', ':', ':', ''])
  )
    problems.push(
      'Build the three-part pane cache shape exactly once, from format, source and screen ownership.'
    );
  if (
    calls(root, 'panePrefetchTargets').length &&
    !nodes(root).some(
      (node) =>
        node.type === 'Property' && name(node.key) === 'shape' && name(node.value) === 'outputShape'
    )
  )
    problems.push(
      'Prefetch must reuse outputShape so cache writes and recalls share one identity.'
    );
  return problems;
}

export function composerDelivery(root: Node): string[] {
  const send = fn(root, 'sendInput');
  if (!send) return ['Missing the terminal composer sendInput function.'];
  const problems: string[] = [];
  const awaited = nodes(send)
    .filter((node) => node.type === 'AwaitExpression' && node.argument.type === 'CallExpression')
    .map((node) =>
      node.type === 'AwaitExpression' && node.argument.type === 'CallExpression'
        ? name(node.argument.callee)
        : ''
    );
  if (
    JSON.stringify(awaited) !==
    JSON.stringify(['awaitUploads', 'assignment.assign', 'sendAgentText', 'sendPaneCharacters'])
  )
    problems.push(
      'The composer must await uploads and delivery acknowledgment, never output painting.'
    );
  if (
    calls(send, 'setTimeout').length ||
    !calls(send, 'refreshOutput').some((call) =>
      nodes(send).some(
        (node) =>
          node.type === 'UnaryExpression' && node.operator === 'void' && node.argument === call
      )
    )
  )
    problems.push('Refresh output without awaiting or delaying composer completion.');
  for (const callee of ['isCurrentSend', 'composerSendGuard.release'])
    if (!calls(send, callee).length)
      problems.push(`Preserve the composer ownership guard: ${callee}.`);
  for (const member of ['activePaneRef.current', 'activeServerRef.current'])
    if (!nodes(send).some((node) => name(node) === member))
      problems.push(`Verify ${member} before clearing the composer.`);
  const clear = calls(send, 'setDraft').find(
    (node) =>
      node.type === 'CallExpression' &&
      node.arguments[0]?.type === 'Literal' &&
      node.arguments[0].value === ''
  );
  const delivery = calls(send, 'sendPaneCharacters')[0];
  if (!clear || !delivery || clear.start < delivery.start)
    problems.push('Clear the draft only after delivery is acknowledged.');
  return problems;
}

export function sshDialogs(root: Node): string[] {
  const problems: string[] = [];
  for (const id of ['SshHostKeyDialog', 'SshKeyboardInteractiveDialog']) {
    const dialog = fn(root, id);
    if (!dialog) {
      problems.push(`Missing ${id}.`);
      continue;
    }
    if (
      !calls(dialog, 'useModalHandoff').length ||
      !nodes(dialog).some(
        (node) =>
          node.type === 'IfStatement' &&
          node.test.type === 'UnaryExpression' &&
          node.test.operator === '!' &&
          name(node.test.argument) === 'ready' &&
          node.consequent.type === 'ReturnStatement' &&
          node.consequent.argument?.type === 'Literal' &&
          node.consequent.argument.value === null
      )
    )
      problems.push(`${id} must wait for the native modal handoff before presenting.`);
    if (id !== 'SshKeyboardInteractiveDialog') continue;
    for (const event of ['keyboardDidShow', 'keyboardDidHide'])
      if (
        !calls(dialog, 'Keyboard.addListener').some(
          (node) =>
            node.type === 'CallExpression' &&
            node.arguments[0]?.type === 'Literal' &&
            node.arguments[0].value === event
        )
      )
        problems.push(`The sign-in dialog must observe ${event}.`);
    const dismiss = calls(dialog, 'Keyboard.dismiss')[0];
    const cancel = calls(dialog, 'onResolve').find(
      (node) => node.type === 'CallExpression' && name(node.arguments[0]) === 'undefined'
    );
    if (!dismiss || !cancel || dismiss.start > cancel.start || !hasIdentifier(dialog, 'keyboardUp'))
      problems.push('Dismiss an open keyboard before cancelling sign-in.');
    for (const prop of ['returnKeyType', 'onSubmitEditing'])
      if (!nodes(dialog).some((node) => node.type === 'JSXAttribute' && name(node.name) === prop))
        problems.push(`The sign-in input requires ${prop} for keyboard submission.`);
  }
  return problems;
}

export const homeModels = [
  'home-layout',
  'agent-workbench-global-owner',
  'home-target-availability',
  'home-workspace-owner',
  'home-workspace-handoff',
  'home-editorial-layout',
  'home-server-model',
  'home-recents',
  'home-recents-state',
  'home-attention',
  'home-commands',
  'server-agents-state',
];
export function homeBoundary(file: string, root: Node, sourceDir: string): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  function visit(path: string, tree: Node) {
    if (seen.has(path)) return;
    seen.add(path);
    const dependencies: string[] = [];
    for (const node of nodes(tree)) {
      if (
        node.type === 'ImportDeclaration' &&
        node.importKind !== 'type' &&
        (!node.specifiers.length ||
          node.specifiers.some(
            (item) => item.type !== 'ImportSpecifier' || item.importKind !== 'type'
          ))
      )
        dependencies.push(String(node.source.value));
      if (
        (node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration') &&
        node.source &&
        node.exportKind !== 'type' &&
        (node.type === 'ExportAllDeclaration' ||
          !node.specifiers.length ||
          node.specifiers.some((item) => item.exportKind !== 'type'))
      )
        dependencies.push(String(node.source.value));
      if (node.type === 'ImportExpression')
        dependencies.push(
          node.source.type === 'Literal' ? String(node.source.value) : '<dynamic import>'
        );
      if (node.type === 'CallExpression' && name(node.callee) === 'require')
        dependencies.push(
          node.arguments[0]?.type === 'Literal'
            ? String(node.arguments[0].value)
            : '<dynamic import>'
        );
    }
    for (const dependency of dependencies) {
      if (dependency === 'zustand/vanilla') continue;
      const base = dependency.startsWith('@/')
        ? resolve(sourceDir, dependency.slice(2))
        : dependency.startsWith('.')
          ? resolve(dirname(path), dependency)
          : null;
      const target = base && [`${base}.ts`, `${base}/index.ts`].find(existsSync);
      if (
        !target ||
        !target.startsWith(`${sourceDir}/lib/`) ||
        ['gateway-client', 'gateway-storage', 'agent-session', 'workspace-snapshot'].some((id) =>
          target.endsWith(`/${id}.ts`)
        )
      )
        problems.push(
          `${path} imports ${dependency}; Home models must remain independent of UI, native storage and transport.`
        );
      else visit(target, parse(target));
    }
  }
  visit(file, root);
  return problems;
}
