/**
 * Control flow React Compiler cannot lower, moved out of the components that
 * need it.
 *
 * The compiler (babel-plugin-react-compiler 1.0) gives up on a whole component
 * when it meets a `try` with a `finally`, a `try` without a `catch`, or a
 * `throw` inside a `try`, and that component then re-renders everything it
 * renders on every update. These helpers hold that syntax at module scope, where
 * the compiler does not look, so a component can keep the exact behaviour
 * through a call instead. `muqun/react-compiler` in `tooling/oxlint` keeps the
 * syntax from coming back.
 *
 * Each helper is a literal `try … finally` or `throw`: the order of effects, the
 * value returned and the error propagated are the ones the inline statement had.
 */

/** `try { return await body() } finally { settle() }`. */
export async function settleAfter<T>(body: () => Promise<T>, settle: () => void): Promise<T> {
  try {
    return await body();
  } finally {
    settle();
  }
}

/** `try { return await body() } finally { await settle() }`, for a `finally` that awaits. */
export async function settleAfterAsync<T>(
  body: () => Promise<T>,
  settle: () => Promise<void>
): Promise<T> {
  try {
    return await body();
  } finally {
    await settle();
  }
}

/** `try { return body() } finally { settle() }`, for synchronous code. */
export function settleAfterSync<T>(body: () => T, settle: () => void): T {
  try {
    return body();
  } finally {
    settle();
  }
}

/** `throw error`, as a call: a `throw` inside a `try` block. */
export function rethrow(error: unknown): never {
  throw error;
}

/**
 * `try { return await body() } catch (error) { return recover(error) }`.
 *
 * For a `try`/`catch` whose block holds a conditional, a logical or an optional
 * chain, which React Compiler cannot lower inside a `try` either.
 */
export async function recoverWith<T>(
  body: () => Promise<T>,
  recover: (error: unknown) => T | Promise<T>
): Promise<T> {
  try {
    return await body();
  } catch (error) {
    return await recover(error);
  }
}

/** `try { return body() } catch (error) { return recover(error) }`, for synchronous code. */
export function recoverWithSync<T>(body: () => T, recover: (error: unknown) => T): T {
  try {
    return body();
  } catch (error) {
    return recover(error);
  }
}
