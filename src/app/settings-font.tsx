import { useRouter } from 'expo-router';

import { SettingsFontSheet } from '@/components/settings-font-sheet';

/** The font sheet's route. See `settings-theme` for why it is a route. */
export default function SettingsFontScreen() {
  const router = useRouter();
  return <SettingsFontSheet onClose={() => router.back()} />;
}
