import { useNavigation, useRouter } from 'expo-router';
import { SettingsHomeConnectionsSheet } from '@/components/settings-home-connections-sheet';
export default function SettingsHomeConnectionsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  return (
    <SettingsHomeConnectionsSheet
      onClose={() => {
        if (navigation.isFocused()) router.back();
      }}
    />
  );
}
