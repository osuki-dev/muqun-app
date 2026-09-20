import { useRouter } from 'expo-router';

import { ReskinSurface } from '@/components/reskin-transition';
import { SettingsFontSheet } from '@/components/settings-font-sheet';

/** The font sheet's route. See `settings-theme` for why it is a route. */
export default function SettingsFontScreen() {
  const router = useRouter();
  return (
    /*
      A surface of its own, and the only route in the app that needs one.
      Changing a font here does not close this sheet -- "Use system font" and a
      finished install both leave it open -- and a native form sheet is a
      separate window that the root overlay cannot reach into or photograph.
      Without this the reader would watch the one surface they are looking at
      re-typeset itself while the whole app behind it changed under cover.
    */
    <ReskinSurface id="settings-font">
      <SettingsFontSheet onClose={() => router.back()} />
    </ReskinSurface>
  );
}
