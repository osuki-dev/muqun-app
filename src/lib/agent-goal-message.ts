/** Only the known goal continuation envelope is folded, not ordinary prompts. */
export function goalContinuationSummary(text: string): string | null {
  const prefix = 'Continue the active goal:';
  const policy = 'Continue active goals until their acceptance criteria are verified.';
  const trimmed = text.trim();
  if (
    !trimmed.startsWith(prefix) ||
    !trimmed.includes('osuki_goal') ||
    !trimmed.includes('Current acceptance:')
  )
    return null;
  const boundary = trimmed.indexOf(policy, prefix.length);
  if (boundary < 0) return null;
  return trimmed.slice(prefix.length, boundary).trim() || null;
}
