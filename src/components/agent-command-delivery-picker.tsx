import { Tabs } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';

import { usePillTabsLayering } from '@/hooks/use-surface-background';
import type { QuickCommandDelivery } from '@/lib/quick-commands';

/**
 * Reused when creating a shortcut and changing an existing custom shortcut.
 * Fully round on every profile, as the quick-action kind tabs are: the
 * profile's segmented radii are for the settings controls.
 */
export function AgentCommandDeliveryPicker({
  value,
  onChange,
  testID,
  disabled = false,
}: {
  value: QuickCommandDelivery;
  onChange: (value: QuickCommandDelivery) => void;
  testID?: string;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const layering = usePillTabsLayering();
  return (
    <Tabs
      testID={testID}
      options={[
        { label: t`Current agent`, value: 'current-agent', disabled },
        { label: t`Agent collaboration`, value: 'collaboration', disabled },
      ]}
      value={value}
      variant="pill"
      radius="pill"
      optionRadius="pill"
      layering={layering}
      size="compact"
      onChange={(next) => {
        if (next === 'current-agent' || next === 'collaboration') onChange(next);
      }}
    />
  );
}
