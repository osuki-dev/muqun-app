import type { PermissionOption, PermissionRequest } from './agent-protocol';

/** Localize only exact known labels; a provider's unknown scope must remain visible. */
export function permissionOptionLabel(
  option: PermissionOption,
  labels: { allow: string; allow_always: string; deny: string; once: string; turn: string }
): string {
  const label = option.label.trim();
  const normalized = label.toLowerCase();
  if (option.decision === 'allow' && normalized === 'allow once') return labels.once;
  if (option.decision === 'allow' && normalized === 'allow for this turn') return labels.turn;
  if (
    !label ||
    normalized === option.decision ||
    (option.decision === 'allow_always' && normalized === 'always allow')
  )
    return labels[option.decision];
  return option.label;
}

/** JSON is displayed as selectable plain text, including unknown permission fields. */
export function requestedPermissionsText(request: Pick<PermissionRequest, 'metadata'>): string {
  const permissions = request.metadata?.permissions;
  return permissions === undefined || permissions === null
    ? ''
    : JSON.stringify(permissions, null, 2);
}
