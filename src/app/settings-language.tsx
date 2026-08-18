import { useRouter } from 'expo-router';

import { SettingsLanguageSheet } from '@/components/settings-language-sheet';

/** The language sheet's route. See `settings-theme` for why it is a route. */
export default function SettingsLanguageScreen() {
  const router = useRouter();
  return <SettingsLanguageSheet onClose={() => router.back()} />;
}
