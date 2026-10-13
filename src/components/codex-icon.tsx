import { Image } from 'expo-image';

/** Official Codex extension artwork; see assets/agents/README.md for provenance. */
export function CodexIcon({ size }: { size: number }) {
  return (
    <Image
      source={require('../../assets/agents/codex.png')}
      style={{ width: size, height: size }}
      contentFit="contain"
      accessible={false}
    />
  );
}
