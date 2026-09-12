import { useRouter } from 'expo-router';
import QuickCrypto from 'react-native-quick-crypto';

import { themeDraftSessions, type ThemeEditorCandidate } from '@/theme/draft-session';

export function useOpenThemeEditor() {
  const router = useRouter();
  return (candidate: ThemeEditorCandidate) => {
    const draft = QuickCrypto.randomBytes(16).toString('hex');
    let retained = false;
    try {
      themeDraftSessions.put(draft, candidate);
      retained = true;
      router.push({ pathname: '/custom-theme', params: { draft } });
    } catch (error) {
      if (retained) themeDraftSessions.release(draft);
      else candidate.prepared?.dispose();
      throw error;
    }
  };
}
