import { defineRule, type Node } from '@oxlint/plugins';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/**
 * `muqun/react-compiler`: every component and hook React Compiler would skip.
 *
 * A component the compiler declines to optimize ships without any automatic
 * memoization, and nothing says so: it renders, it passes review, and it
 * re-renders everything under it on every update. React Doctor reports some of
 * these from source, but it reads the source before the Lingui macro has run,
 * so it both flags tagged templates the build never shows the compiler and
 * misses every file a pull request did not touch.
 *
 * So this rule runs the build's own pipeline -- the Lingui macro, then
 * `babel-plugin-react-compiler` -- and reports each `CompileError` at the line
 * the compiler names, with its reason. The fixes are nearly always mechanical:
 *
 * - a Reanimated shared value written with `.value =`: use `.set()` / `.get()`;
 * - `try`/`finally`, a `try` without `catch`, a `throw` inside `try`, or a
 *   conditional/optional chain inside `try`: move the statement behind
 *   `@/lib/compiler-safe-control-flow`, or hoist the expression out of the `try`;
 * - a ref read or written during render: `useLatestReader`/`useStableHandler`
 *   in `@/hooks/use-render-refs`, a `carryBox` from `@/lib/carry-forward`, or a
 *   hook of its own marked `'use no memo'` for a deliberate render-time write;
 * - a disabled `react-hooks/exhaustive-deps`: `useEffectEvent` for what the
 *   effect reads without reacting to.
 *
 * A function or file that opts out with `'use no memo'` is left alone: that is a
 * decision, written down where it is made.
 */

const require = createRequire(resolve(process.cwd(), 'package.json'));

type CompilerEvent = {
  kind: string;
  fnLoc?: { start?: { line: number } } | null;
  detail?: {
    options?: CompilerDetail;
  } & CompilerDetail;
};
type CompilerDetail = {
  reason?: string;
  description?: string | null;
  loc?: { start?: { line: number; column: number } } | null;
  details?: { loc?: { start?: { line: number; column: number } } | null; message?: string }[];
};
type Babel = {
  transformSync: (code: string, options: Record<string, unknown>) => unknown;
  parseSync: (code: string, options: Record<string, unknown>) => BabelFile | null;
};
type BabelFile = { program: { directives: Directive[]; body: unknown[] } };
type Directive = { value: { value: string } };

let babel: Babel | null = null;

function loadBabel(): Babel {
  babel ??= require('@babel/core') as Babel;
  return babel;
}

const PARSER = { plugins: ['typescript', 'jsx'] as string[] };

/** Start lines of every function that opts out with `'use no memo'`. */
function optedOutFunctions(root: BabelFile): { file: boolean; lines: Set<number> } {
  const lines = new Set<number>();
  const file = root.program.directives.some((d) => d.value.value === 'use no memo');
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const n = node as {
      type?: string;
      body?: { directives?: Directive[] };
      loc?: { start: { line: number } };
    };
    if (
      (n.type === 'FunctionDeclaration' ||
        n.type === 'FunctionExpression' ||
        n.type === 'ArrowFunctionExpression') &&
      n.body?.directives?.some((d) => d.value.value === 'use no memo') &&
      n.loc
    )
      lines.add(n.loc.start.line);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      visit(value);
    }
  };
  visit(root.program.body);
  return { file, lines };
}

export type CompilerFinding = { line: number; column: number; message: string };

const CACHE_DIR = resolve(process.cwd(), 'node_modules/.cache/muqun-react-compiler');
let cacheSalt: string | null = null;

/**
 * The compiler versions a cached answer was made with. Running the compiler is
 * most of what this rule costs, so an unchanged file under unchanged tooling
 * answers from `node_modules/.cache` instead.
 */
function toolingSalt(): string {
  if (cacheSalt !== null) return cacheSalt;
  const version = (name: string) => {
    try {
      return (
        JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')) as {
          version: string;
        }
      ).version;
    } catch {
      return 'unknown';
    }
  };
  cacheSalt = [
    version('babel-plugin-react-compiler'),
    version('@lingui/babel-plugin-lingui-macro'),
    version('@babel/core'),
    RULE_REVISION,
  ].join('|');
  return cacheSalt;
}

/** Bumped when what this file reports changes, so old cache entries are not reused. */
const RULE_REVISION = '1';

/** What React Compiler reports for one source file, minus deliberate opt-outs. */
export function reactCompilerFindings(filename: string, code: string): CompilerFinding[] {
  const key = createHash('sha256').update(toolingSalt()).update('\0').update(code).digest('hex');
  const cached = resolve(CACHE_DIR, `${key}.json`);
  try {
    return JSON.parse(readFileSync(cached, 'utf8')) as CompilerFinding[];
  } catch {
    // Not cached yet.
  }
  const findings = compile(filename, code);
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cached, JSON.stringify(findings));
  } catch {
    // A cache that cannot be written only costs time.
  }
  return findings;
}

function compile(filename: string, code: string): CompilerFinding[] {
  const b = loadBabel();
  const parsed = b.parseSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    parserOpts: PARSER,
  });
  if (!parsed) return [];
  const optOut = optedOutFunctions(parsed);
  if (optOut.file) return [];
  const findings: CompilerFinding[] = [];
  const seen = new Set<string>();
  b.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    code: false,
    parserOpts: PARSER,
    plugins: [
      '@lingui/babel-plugin-lingui-macro',
      [
        'babel-plugin-react-compiler',
        {
          target: '19',
          panicThreshold: 'none',
          logger: {
            logEvent(_file: string, event: CompilerEvent) {
              if (event.kind !== 'CompileError') return;
              if (optOut.lines.has(event.fnLoc?.start?.line ?? -1)) return;
              const detail = event.detail?.options ?? event.detail ?? {};
              const reason = detail.reason ?? 'React Compiler cannot compile this';
              const spots = (detail.details ?? [])
                .map((d) => d.loc?.start)
                .filter((start): start is { line: number; column: number } => Boolean(start));
              const at = spots.length
                ? spots
                : detail.loc?.start
                  ? [detail.loc.start]
                  : [{ line: event.fnLoc?.start?.line ?? 1, column: 0 }];
              for (const spot of at) {
                const message = `React Compiler skips this component or hook: ${reason}.`;
                const key = `${spot.line}:${spot.column}:${message}`;
                if (seen.has(key)) continue;
                seen.add(key);
                findings.push({ line: spot.line, column: spot.column, message });
              }
            },
          },
        },
      ],
    ],
  });
  return findings;
}

const SOURCE = /\/src\/.+\.tsx?$/;
const SKIP = /(\/__tests__\/|\.test\.tsx?$|\.web\.tsx?$|\.d\.ts$)/;

export const reactCompiler = defineRule({
  meta: { type: 'problem', schema: [] },
  create(context) {
    return {
      Program(node: Node) {
        const path = context.filename;
        if (!SOURCE.test(path) || SKIP.test(path)) return;
        const code = context.sourceCode.text;
        // Only a module that can hold a component or a hook is worth compiling.
        if (!/\buse[A-Z]|<[A-Za-z]/.test(code)) return;
        let findings: CompilerFinding[];
        try {
          findings = reactCompilerFindings(path, code);
        } catch (error) {
          context.report({
            node,
            message: `React Compiler could not read this file: ${String(error).slice(0, 200)}`,
          });
          return;
        }
        for (const finding of findings)
          context.report({
            loc: { line: finding.line, column: finding.column },
            message: finding.message,
          });
      },
    };
  },
});
