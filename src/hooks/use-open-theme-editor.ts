import { useRouter } from 'expo-router';
import QuickCrypto from 'react-native-quick-crypto';

import { themeDraftSessions, type ThemeEditorCandidate } from '@/theme/draft-session';

export function useOpenThemeEditor() {
  const router = useRouter();
  /**
   * `handed` marks a theme that arrived from outside the app.
   *
   * It changes one thing and it is not cosmetic: what the editor leaves behind.
   * A theme opened from Settings has the picker sheet and Settings under it, so
   * Done dismisses the stack and lands there. A theme handed over by a file
   * manager has `+not-found` under it -- the router matched no route for a
   * `file://` URL -- so the same dismiss left the reader who had just applied a
   * theme looking at "This link goes nowhere". There is nothing behind a file,
   * so the editor replaces the placeholder with home and leaves them there.
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
