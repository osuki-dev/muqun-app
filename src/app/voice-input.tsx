import { useEffect, useState } from 'react';
import { useIsFocused, useRouter } from 'expo-router';
import { VoiceInputPanel } from '@/components/voice-input-button';
import { clearVoiceInput, useVoiceInput } from '@/stores/voice-input';

export default function VoiceInputScreen() {
  const router = useRouter();
  const focused = useIsFocused();
  const current = useVoiceInput((state) => state.request);
  const [request] = useState(current);
  useEffect(
    () => () => {
      if (request) clearVoiceInput(request.owner);
    },
    [request]
  );
  useEffect(() => {
    if (!current && router.canGoBack()) router.back();
  }, [current, router]);
  if (!focused || !request || request !== current) return null;
  return (
    <VoiceInputPanel
      onText={(text) => {
        if (useVoiceInput.getState().request === request) request.deliver(text);
      }}
      onClose={() => clearVoiceInput(request.owner)}
    />
  );
}
