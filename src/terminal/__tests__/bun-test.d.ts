// Local ambient types for the `bun:test` runtime.
//
// The project runs its tests with `bun test` and deliberately does not depend
// on `@types/bun`, so this shim declares just the subset of the API those tests
// use. The declaration is ambient, so it covers every suite in the project. It
// exists only to keep `tsc --noEmit` honest; it is not a runtime dependency and
// is never imported by production code.
declare module 'bun:test' {
  interface Matchers<T = unknown> {
    toBe(expected: T): void;
    toEqual(expected: T): void;
    toMatchObject(expected: Record<string, unknown>): void;
    toBeNull(): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toHaveLength(length: number): void;
    toContain(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    /** `digits` is the number of decimal places compared, defaulting to 2. */
    toBeCloseTo(expected: number, digits?: number): void;
    toThrow(expected?: string | RegExp | Error): void;
    readonly not: Matchers<T>;
    /**
     * Match on why a promise rejected. It answers with a promise of its own, so
     * the assertion has to be awaited or the test ends before it has run.
     */
    readonly rejects: AsyncMatchers;
  }

  /** The awaited half of the matchers, for an assertion that settles first. */
  interface AsyncMatchers<T = unknown> {
    toThrow(expected?: string | RegExp | Error): Promise<void>;
    readonly not: AsyncMatchers<T>;
  }

  export function expect<T>(actual: T): Matchers<T>;

  interface EachFn {
    <Row extends readonly unknown[]>(
      cases: readonly Row[]
    ): (name: string, fn: (...args: [...Row]) => void | Promise<void>) => void;
    <Row>(cases: readonly Row[]): (name: string, fn: (arg: Row) => void | Promise<void>) => void;
  }

  interface TestFn {
    /**
     * `timeoutMs` overrides bun's 5s default for one test. Declared because a
     * couple of the invariant suites do seconds of real work, and because a
     * suite that has to let a real timer elapse -- a budget the code under test
     * owns, rather than one the test can shorten -- needs more than the default
     * allows either way.
     */
    (name: string, fn: () => void | Promise<void>, timeoutMs?: number): void;
    each: EachFn;
    skip(name: string, fn: () => void | Promise<void>): void;
    only(name: string, fn: () => void | Promise<void>): void;
  }

  export const test: TestFn;
  export const it: TestFn;
  export function describe(name: string, fn: () => void): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;

  export const mock: {
    /**
     * Replace a module's exports for every importer in this test file.
     *
     * The project's tests are otherwise pure, and this is deliberately the
     * narrow exception: a store that reaches SecureStore and the network can
     * only be exercised as the shipped module if those two edges are stubbed.
     * It must be called before the module under test is imported.
     */
    module(specifier: string, factory: () => unknown): void;
  };
}
