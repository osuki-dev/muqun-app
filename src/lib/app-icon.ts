/**
 * The launcher icons a reader can choose between.
 *
 * `default` is the compiled Classic icon. Every other entry is registered with
 * `expo-alternate-app-icons` under the same `id` in `app.json`, so adding one
 * is a row here, an entry there, and its artwork under `assets/icons/<id>`.
 *
 * Pure, so the mapping between what the picker shows and what the OS reports
 * can be tested without the native module.
 */
export type AppIconId = 'default' | 'Classic' | 'Mascot' | 'Cyber' | 'Anime' | 'Arcade';

export const APP_ICONS: readonly AppIconId[] = [
  'default',
  'Classic',
  'Mascot',
  'Cyber',
  'Anime',
  'Arcade',
];

/** What the native module is told: `null` restores the compiled icon. */
export function nativeAppIconName(id: AppIconId): string | null {
  return id === 'default' ? null : id;
}

/** What the native module reports back, as a picker value; unknown names are the default. */
export function appIconFromNative(name: string | null | undefined): AppIconId {
  return name && APP_ICONS.includes(name as AppIconId) ? (name as AppIconId) : 'default';
}

/** Preserve the old native alias without showing two identical Classic tiles. */
export const APP_ICON_CHOICES = APP_ICONS.filter((id) => id !== 'Classic');

export function appIconIsSelected(choice: AppIconId, active: AppIconId): boolean {
  return choice === active || (choice === 'default' && active === 'Classic');
}
