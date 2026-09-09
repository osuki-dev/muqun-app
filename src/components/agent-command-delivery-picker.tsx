import { useLingui } from '@lingui/react/macro';
import { Tabs } from '@osuki-dev/ui';

import type { QuickCommandDelivery } from '@/lib/quick-commands';

/** Reused when creating a shortcut and changing an existing custom shortcut. */
export function AgentCommandDeliveryPicker({
  value,
  onChange,
}: {
  value: QuickCommandDelivery;
  onChange: (value: QuickCommandDelivery) => void;
}) {
  const { t } = useLingui();
  return (
    <Tabs
      options={[
        { label: t`Current agent`, value: 'current-agent' },
        { label: t`Agent collaboration`, value: 'collaboration' },
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
