import { useEffect } from 'react';
import { useRouter } from 'expo-router';

/** Old deep links must never start a second recorder over the inline composer. */
export default function VoiceInputScreen() {
  const router = useRouter();
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);
  return null;
}
