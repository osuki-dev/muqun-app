import { Redirect } from 'expo-router';

/**
 * The old address of the theme catalogue.
 *
 * The catalogue was a sheet of its own, opened from the themes sheet. It is the
 * themes sheet's Gallery tab now, so this route only forwards there -- a link
 * that still names it lands on the same catalogue, one sheet shallower.
 */
export default function SettingsThemeBrowseScreen() {
  return <Redirect href={{ pathname: '/settings-theme', params: { tab: 'gallery' } }} />;
}
