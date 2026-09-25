import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { parseSync, visitorKeys, type Node } from 'oxc-parser';

// Keep Bun's runtime types local: its global fetch extensions are not React Native APIs.
const { Transpiler } = createRequire(import.meta.url)('bun') as {
  Transpiler: new (options: { loader: string; target: string }) => {
    transformSync(source: string): string;
  };
};

/** Parse only to isolate production code from native imports; Bun executes it. */
export function productionSource(path: string) {
  const text = readFileSync(path, 'utf8');
  const result = parseSync(path, text);
  if (result.errors.length) throw new Error(`Cannot parse ${path}: ${result.errors[0]?.message}`);
  return { program: result.program, text, code: (node: Node) => text.slice(node.start, node.end) };
}

export function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const item of child) if (item) walk(item as Node, visit);
    } else if (child) walk(child as Node, visit);
  }
}

export function declaration(path: string, name: string) {
  const source = productionSource(path);
  let found: Node | undefined;
  walk(source.program, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === name) found = node;
  });
  if (!found) throw new Error(`Missing production function ${name} in ${path}`);
  return source.code(found);
}

const transpiler = new Transpiler({ loader: 'tsx', target: 'bun' });
export function transpile(source: string) {
  const last = parseSync('harness.tsx', source).program.body.at(-1);
  if (last?.type === 'ExpressionStatement') {
    const expression = source.slice(last.expression.start, last.expression.end);
    return transpiler.transformSync(
      `(() => { ${source.slice(0, last.start)}; return (${expression}); })()`
    );
  }
  return transpiler.transformSync(source);
}
