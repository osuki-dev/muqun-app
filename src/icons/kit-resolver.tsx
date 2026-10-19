import type { IconResolver } from '@osuki-dev/ui';

import { AppIcon, type AppIconName } from './app-icon';

// These names belong to Kit's own controls, not the app's icon API. Keep this
// boundary small and update it when upgrading Kit's built-in controls.
const kitControls: Record<string, AppIconName> = {
  ArrowDown: 'move-down',
  ArrowUp: 'move-up',
  Brain: 'reasoning',
  Calendar: 'calendar',
  Check: 'done',
  CheckCircle2: 'completed',
  ChevronDown: 'disclosure-down',
  ChevronLeft: 'previous',
  ChevronRight: 'next',
  ChevronsLeft: 'first-page',
  ChevronsRight: 'last-page',
  CircleAlert: 'notice',
  CircleCheck: 'completed',
  Clock: 'time',
  Copy: 'copy',
  Inbox: 'inbox',
  Info: 'information',
  Minus: 'remove',
  Paperclip: 'attachment',
  Plus: 'create',
  Search: 'search',
  TriangleAlert: 'warning',
  Wrench: 'tool',
  X: 'close',
  'chrome.back': 'previous',
  'chrome.send': 'message-send',
  'chrome.attach': 'attachment',
  'chrome.create': 'create',
  'chrome.scan': 'pair-scan',
  'chrome.settings': 'settings',
  'chrome.parameters': 'controls',
  'home.arrow': 'continue',
};

export const resolveKitIcon: IconResolver = (name, props) => {
  const semanticName = kitControls[name];
  if (!semanticName) return null;
  // Kit owns its outer style and rotation. Applying them here would double it.
  return <AppIcon name={semanticName} size={props.size} color={props.color} />;
};
