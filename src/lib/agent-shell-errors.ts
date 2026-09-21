const SHELL_NOT_FOUND_TAG = 'ShellNotFoundError';
const SERIALIZED_SHELL_NOT_FOUND_TAG =
  /(?:\\?")_tag(?:\\?")\s*:\s*(?:\\?")ShellNotFoundError(?:\\?")/;

function containsShellNotFound(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (typeof value === 'string') return SERIALIZED_SHELL_NOT_FOUND_TAG.test(value);
  if (!value || typeof value !== 'object') return false;

  if (value instanceof Error) {
    if (containsShellNotFound(value.message, depth + 1)) return true;
    return containsShellNotFound((value as Error & { cause?: unknown }).cause, depth + 1);
  }

  const record = value as Record<string, unknown>;
  if (record._tag === SHELL_NOT_FOUND_TAG) return true;
  return ['error', 'cause', 'message'].some((key) => containsShellNotFound(record[key], depth + 1));
}

/** A missing background shell is already in the state Stop was meant to reach. */
export function isShellNotFoundError(error: unknown): boolean {
  return containsShellNotFound(error);
}
