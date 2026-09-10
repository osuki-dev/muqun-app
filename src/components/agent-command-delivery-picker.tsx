import { useLingui } from '@lingui/react/macro';
import { Tabs } from '@osuki-dev/ui';

import type { QuickCommandDelivery } from '@/lib/quick-commands';

/** Reused when creating a shortcut and changing an existing custom shortcut. */
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
  return (
    <Tabs
      testID={testID}
      options={[
        { label: t`Current agent`, value: 'current-agent', disabled },
        { label: t`Agent collaboration`, value: 'collaboration', disabled },
      ]}
      value={value}
      variant="pill"
      size="compact"
      onChange={(next) => {
        if (next === 'current-agent' || next === 'collaboration') onChange(next);
      }}
    />
  );
}
