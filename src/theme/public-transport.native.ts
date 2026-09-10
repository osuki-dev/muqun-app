import native from '../../modules/theme-transport/src/MuqunThemeTransportModule';
import { createPublicThemeTransport } from './transport-bridge';

// Internal cancellation identity, not a secret or authorization token. A boot
// prefix keeps Fast Refresh requests separate without adding a crypto module.
const prefix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let sequence = 0;
export const publicThemeTransport = createPublicThemeTransport(
  native,
  () => `${prefix}-${++sequence}`
);
