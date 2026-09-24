import { definePlugin, defineRule, type Node } from '@oxlint/plugins';
import { dirname, resolve } from 'node:path';
import type { Node as ParsedNode } from 'oxc-parser';
import {
  composerDelivery,
  homeBoundary,
  homeModels,
  inputAdapter,
  paneShape,
  sshDialogs,
} from './source-contracts.ts';

const dependencyIndex = new Map([
  ['useAnimatedGestureHandler', 1],
  ['useAnimatedKeyboardHandler', 1],
  ['useAnimatedProps', 1],
  ['useAnimatedReaction', 2],
  ['useAnimatedScrollHandler', 1],
  ['useAnimatedStyle', 1],
  ['useDerivedValue', 1],
  ['useHandler', 1],
]);
const noReanimatedDependencies = defineRule({
  meta: { type: 'problem', schema: [] },
  create(context) {
    const hooks = new Map<string, number>();
    const namespaces = new Set<string>();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'react-native-reanimated') return;
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name);
          if (specifier.type !== 'ImportSpecifier') continue;
          const imported =
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : String(specifier.imported.value);
          const index = dependencyIndex.get(imported);
          if (index !== undefined) hooks.set(specifier.local.name, index);
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        const index =
          callee.type === 'Identifier'
            ? hooks.get(callee.name)
            : callee.type === 'MemberExpression' &&
                !callee.computed &&
                callee.object.type === 'Identifier' &&
                namespaces.has(callee.object.name) &&
                callee.property.type === 'Identifier'
              ? dependencyIndex.get(callee.property.name)
              : undefined;
        const dependency = index === undefined ? null : node.arguments[index];
        if (dependency && !(dependency.type === 'Identifier' && dependency.name === 'undefined'))
          context.report({
            node: dependency,
            message:
              'Reanimated derives dependencies from worklet closures; omit the deprecated dependency argument.',
          });
      },
    };
  },
});

function contract(check: (path: string, root: ParsedNode) => string[]) {
  return defineRule({
    meta: { type: 'problem', schema: [] },
    create(context) {
      return {
        Program(node: Node) {
          for (const message of check(context.filename, node as unknown as ParsedNode))
            context.report({ node, message });
        },
      };
    },
  });
}

export default definePlugin({
  meta: { name: 'muqun' },
  rules: {
    'no-reanimated-dependencies': noReanimatedDependencies,
    'pane-cache-shape': contract((path, root) =>
      path.endsWith('/src/components/server-terminal-workspace.tsx') ? paneShape(root) : []
    ),
    'composer-delivery': contract((path, root) =>
      path.endsWith('/src/components/server-terminal-workspace.tsx') ? composerDelivery(root) : []
    ),
    'ssh-dialog-contract': contract((path, root) =>
      path.endsWith('/src/components/ssh-host-key-dialog.tsx') ? sshDialogs(root) : []
    ),
    'input-adapter-contract': contract((path, root) => {
      const component = ['input', 'textarea', 'search-input'].find((name) =>
        path.endsWith(`/src/components/themed-${name}.tsx`)
      );
      return component ? inputAdapter(root, component, resolve(dirname(path), '../..')) : [];
    }),
    'home-model-boundary': contract((path, root) =>
      homeModels.some((name) => path.endsWith(`/src/lib/${name}.ts`))
        ? homeBoundary(path, root, resolve(dirname(path), '..'))
        : []
    ),
  },
});
