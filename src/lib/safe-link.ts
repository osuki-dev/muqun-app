/**
 * Terminal and agent output is untrusted, so links extracted from it are
 * restricted to the web schemes before they reach `Linking.openURL`. Without
 * this an `intent://` or custom-scheme link in a pane could reach other apps.
 */
export function isSafeExternalLink(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
