/** React Native's abort-controller 3 has neither reason nor throwIfAborted.
 * Keep causes owned by this feature without modifying platform prototypes. */
const causes = new WeakMap<AbortSignal, unknown>();

export function themeAbortReason(signal?: AbortSignal): unknown {
  const reason = signal && (causes.get(signal) ?? signal.reason);
  if (reason != null) return reason;
  const error = new Error('Theme operation canceled');
  error.name = 'AbortError';
  return error;
}

export function throwIfThemeAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw themeAbortReason(signal);
}

export function abortThemeOperation(controller: AbortController, reason?: unknown): void {
  if (controller.signal.aborted) return;
  causes.set(controller.signal, reason ?? themeAbortReason());
  controller.abort(reason);
}
