/** A refresh authorizes one read attempt, including a failed or canceled read. */
export function consumeWorkOutputRefresh(
  consumed: Map<string, number>,
  attemptId: string,
  refresh: { attemptId: string; nonce: number } | null
) {
  if (!refresh || refresh.attemptId !== attemptId || consumed.get(attemptId) === refresh.nonce)
    return false;
  consumed.set(attemptId, refresh.nonce);
  return true;
}
