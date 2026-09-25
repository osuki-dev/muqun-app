import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const surfaces = [
  ['kit toasts', 'src/app/_layout.tsx', 'ToastProvider'],
  [
    'foreground push notices',
    'src/components/in-app-notification-host.tsx',
    'InAppNotificationHost',
  ],
  ['terminal notice decks', 'src/components/notice-deck.tsx', 'NoticeDeck'],
  ['workspace switch indicators', 'src/components/switch-indicator.tsx', 'SwitchIndicator'],
  ['update banners', 'src/components/update-status-banner.tsx', 'UpdateStatusBanner'],
  ["What's New cards", 'src/components/whats-new-card.tsx', 'WhatsNewCard'],
] as const;

test('app-wide notification surfaces reuse the homeLayout-aware presentation contract', () => {
  for (const [name, path, owner] of surfaces) {
    const source = readFileSync(path, 'utf8');

    expect({ name, hasOwner: source.includes(owner) }).toEqual({ name, hasOwner: true });
    expect({ name, usesSharedSurface: source.includes('useNotificationSurfaceStyle') }).toEqual({
      name,
      usesSharedSurface: true,
    });
  }
});
