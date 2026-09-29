import { memo } from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * DeepSeek stand-in mark: two stacked waves ("deep" water), drawn for Muqun.
 * Source: original artwork, no third-party licence. It is deliberately NOT the
 * DeepSeek whale: the @deepseek-ai/dsh packages are MIT-licensed as code, but
 * that grant does not clearly cover the brand's logo or trade dress, so the
 * official art is not copied here.
 */
export const DeepSeekIcon = memo(function DeepSeekIcon({
  size = 18,
  color,
}: {
  size?: number;
  color: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2.5 9c2-3 4-3 6 0s4 3 6 0 4-3 7 0"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M2.5 16c2-3 4-3 6 0s4 3 6 0 4-3 7 0"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
});
