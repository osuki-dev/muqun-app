/**
 * The launcher icons a reader can choose between.
 *
 * `default` is the icon `app.json` compiles as the app's own: the rendered
 * mascot. Every other entry is an alternate icon registered with
 * `expo-alternate-app-icons` under the same `id` in `app.json`, so adding one
 * is a row here, an entry there, and its artwork under `assets/icons/<id>`.
 *
 * Pure, so the mapping between what the picker shows and what the OS reports
 * can be tested without the native module.
 */
export type AppIconId = 'default' | 'Classic';

export const APP_ICONS: readonly AppIconId[] = ['default', 'Classic'];

/** What the native module is told: `null` restores the compiled icon. */
export function nativeAppIconName(id: AppIconId): string | null {
  return id === 'default' ? null : id;
}

/** What the native module reports back, as a picker value; unknown names are the default. */
export function appIconFromNative(name: string | null | undefined): AppIconId {
  return name && APP_ICONS.includes(name as AppIconId) ? (name as AppIconId) : 'default';
}
