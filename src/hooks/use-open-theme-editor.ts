import { useRouter } from 'expo-router';
import QuickCrypto from 'react-native-quick-crypto';

import { themeDraftSessions, type ThemeEditorCandidate } from '@/theme/draft-session';

export function useOpenThemeEditor() {
  const router = useRouter();
  /**
   * `origin` says where the theme came from, and it changes what the editor
   * leaves behind.
   *
   * - `settings`: the picker sheet and Settings are under the editor, so Done
   *   dismisses the stack and lands there.
   * - `handed`: a file manager handed the theme over, and `+not-found` is under
   *   it, because the router matched no route for a `file://` URL. The same
   *   dismiss left a reader who had just applied a theme looking at "This link
   *   goes nowhere". There is nothing behind a file, so the editor replaces the
   *   placeholder with home and leaves them there.
   * - `conversation`: an agent or a computer sent the theme into a session.
   *   Closing returns to that session, where the reader may still be asking for
   *   changes. Applying goes home, the one screen that shows the whole theme
   *   at once.
   */
  return (
    candidate: ThemeEditorCandidate,
    origin: 'settings' | 'handed' | 'conversation' = 'settings'
  ) => {
    const draft = QuickCrypto.randomBytes(16).toString('hex');
    const params = origin === 'conversation' ? { draft, from: 'conversation' } : { draft };
    const handed = origin === 'handed';
    let retained = false;
    try {
      themeDraftSessions.put(draft, candidate);
      retained = true;
      if (handed) router.replace('/');
      router.push({ pathname: '/custom-theme', params });
    } catch (error) {
      if (retained) themeDraftSessions.release(draft);
      else candidate.prepared?.dispose();
      throw error;
    }
  };
}
