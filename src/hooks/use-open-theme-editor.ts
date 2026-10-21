import { useRouter } from 'expo-router';
import QuickCrypto from 'react-native-quick-crypto';

import { themeDraftSessions, type ThemeEditorCandidate } from '@/theme/draft-session';

export function useOpenThemeEditor() {
  const router = useRouter();
  /**
   * The editor's Done goes one step back, to whatever opened it: the themes
   * sheet or a session. Applying never navigates.
   *
   * `handed` marks a theme a file manager handed over. `+not-found` is under it
   * then, because the router matched no route for a `file://` URL, and going
   * back would leave the reader looking at "This link goes nowhere". So the
   * placeholder is replaced with Home first, and Done lands there.
   */
  return (candidate: ThemeEditorCandidate, handed = false) => {
    const draft = QuickCrypto.randomBytes(16).toString('hex');
    let retained = false;
    try {
      themeDraftSessions.put(draft, candidate);
      retained = true;
      if (handed) router.replace('/');
      router.push({ pathname: '/custom-theme', params: { draft } });
    } catch (error) {
      if (retained) themeDraftSessions.release(draft);
      else candidate.prepared?.dispose();
      throw error;
    }
  };
}
