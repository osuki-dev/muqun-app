import QuickCrypto from 'react-native-quick-crypto';
import { publicThemeTransport } from './public-transport';
import { inspectThemeLinkSource, type ThemeLinkOptions } from './link-source';

export const themeLinkImportAvailable = publicThemeTransport !== null;
export async function inspectThemeLink(input: string, options: ThemeLinkOptions = {}) {
  if (!publicThemeTransport) throw new Error('This app build cannot import theme links');
  return inspectThemeLinkSource(
    publicThemeTransport,
    async (algorithm, bytes) => QuickCrypto.createHash(algorithm).update(bytes).digest('hex'),
    input,
    options
  );
}
