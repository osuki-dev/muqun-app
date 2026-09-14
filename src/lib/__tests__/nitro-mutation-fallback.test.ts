import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Exercise the dependency's actual entry function with native absence. This is
// deliberately not a reimplementation of its method policy.
function functionSource(file: string, name: string): string {
  const source = readFileSync(
    new URL(`../../../node_modules/react-native-nitro-fetch/${file}`, import.meta.url),
    'utf8'
  );
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true);
  const declaration = tree.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === name
  );
  if (!declaration) throw new Error(`Dependency entry ${name} is missing`);
  return ts.transpileModule(declaration.getText(tree).replace(/^export /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

for (const file of ['src/fetch.ts', 'lib/module/fetch.js']) {
  test(`${file}: native absence refuses mutations before global fetch`, async () => {
    const calls: unknown[] = [];
    const raw = runInNewContext(`${functionSource(file, 'nitroFetchRaw')}; nitroFetchRaw`, {
      NitroFetchHybrid: {},
      resolveRequestBody: async (_input: unknown, init: unknown) => init,
      resolveBlobBody: async (init: unknown) => init,
      fetch: async (...args: unknown[]) => {
        calls.push(args);
        return {
          status: 204,
          statusText: 'No Content',
          ok: true,
          headers: { forEach: () => undefined },
          arrayBuffer: async () => new ArrayBuffer(0),
        };
      },
    }) as (input: unknown, init?: { method?: string }) => Promise<unknown>;
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'post', 'UNKNOWN']) {
      let message = '';
      try {
        await raw('https://gateway.invalid', { method });
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain('Native mutation transport unavailable');
      expect(calls.length).toBe(0);
    }
    let failed = false;
    try {
      await raw({ method: 'POST', url: 'https://gateway.invalid' });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(calls.length).toBe(0);
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      await raw('https://gateway.invalid', { method });
    }
    await raw('https://gateway.invalid');
    await raw({ method: 'POST' }, { method: 'GET' });
    expect(calls.length).toBe(6);
  });
}

test('explicit browser entry retains browser mutation behavior', async () => {
  const calls: unknown[] = [];
  const browserFetch = runInNewContext(`${functionSource('src/index.web.tsx', 'fetch')}; fetch`, {
    NitroRequestClass: class {},
    globalThis: {
      fetch: async (...args: unknown[]) => {
        calls.push(args);
        return { status: 201 };
      },
    },
  }) as (input: string, init: { method: string }) => Promise<{ status: number }>;
  expect((await browserFetch('https://web.invalid', { method: 'POST' })).status).toBe(201);
  expect(calls.length).toBe(1);
});
