import { HapticsProvider, IconProvider } from '@osuki-dev/ui';
import type { ReactNode } from 'react';

import { GroundTextPlate } from '@/components/sheet-ground';
import { AppSurfaceDecorator } from '@/components/surface-decorator';
import { kitFeedback } from '@/lib/feedback';
import { useAppSettings } from '@/stores/app-settings';
import { resolveKitIcon } from '@/icons/kit-resolver';

/**
 * What the kit's components read besides the theme: the reader's haptics, the
 * pack's surface opacity and artwork, and the plate for text on the ground.
 * Contexts only, so nothing here can be the fault the error boundary catches.
 */
export function KitProviders({ children }: { children: ReactNode }) {
  const hapticsEnabled = useAppSettings((state) => state.hapticsEnabled);
  return (
    <HapticsProvider enabled={hapticsEnabled} feedback={kitFeedback}>
      <IconProvider resolve={resolveKitIcon}>
        <AppSurfaceDecorator>
          <GroundTextPlate>{children}</GroundTextPlate>
        </AppSurfaceDecorator>
      </IconProvider>
    </HapticsProvider>
  );
}
