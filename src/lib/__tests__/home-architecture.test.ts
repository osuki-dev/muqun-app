import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const modelRoots = [
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

/** Follow runtime imports only: source API types do not establish a connection. */
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const imports: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const allTypes =
        clause?.isTypeOnly ||
        (!clause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((element) => element.isTypeOnly));
      if (!allTypes) imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      const clause = node.exportClause;
      if (
        !clause ||
        !ts.isNamedExports(clause) ||
        clause.elements.some((element) => !element.isTypeOnly)
      )
        imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      imports.push(argument && ts.isStringLiteral(argument) ? argument.text : '<dynamic import>');
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

describe('Home foundation dependency boundary', () => {
  for (const model of modelRoots) {
    test(`${model} remains independent of UI, native storage and transport`, () => {
      const visited = new Set<string>();
      const violations: string[] = [];
      function walk(file: string) {
        if (visited.has(file)) return;
        visited.add(file);
        for (const dependency of runtimeImports(file)) {
          if (dependency === 'zustand/vanilla') continue;
          const base = dependency.startsWith('@/')
            ? resolve(sourceRoot, dependency.slice(2))
            : dependency.startsWith('.')
              ? resolve(dirname(file), dependency)
              : null;
          const target = base && [`${base}.ts`, `${base}/index.ts`].find(existsSync);
          // The pure domain layer may share other lib rules, never a store/hook
          // singleton or a transport/storage adapter with native side effects.
          if (
            !target ||
            !target.startsWith(`${sourceRoot}/lib/`) ||
            /\/(gateway-client|gateway-storage|agent-session|workspace-snapshot)\.ts$/.test(target)
          )
            violations.push(`${file} -> ${dependency}`);
          else walk(target);
        }
      }
      walk(resolve(sourceRoot, 'lib', `${model}.ts`));
      expect(violations).toEqual([]);
    });
  }
});
