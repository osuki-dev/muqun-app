import { useRouter } from 'expo-router';

import { SettingsHomeLayoutSheet } from '@/components/settings-home-layout-sheet';

/** The Home layout picker uses the native form-sheet route conventions. */
export default function SettingsHomeLayoutScreen() {
  const router = useRouter();
  return <SettingsHomeLayoutSheet onClose={() => router.back()} />;
}
