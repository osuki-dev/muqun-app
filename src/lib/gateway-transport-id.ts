import type { GATEWAY_TRANSPORT as TransportName } from './gateway-transport';

/**
 * The name a paired record carries for the encrypted transport, restated
 * without the cipher module behind it.
 *
 * `gateway-transport.ts` owns the constant and imports the native crypto it
 * needs; pure decision code (the request policy, tests under Bun) names the
 * transport through this module instead. The type annotation ties the two
 * spellings together: a change to the original is a type error here.
 */
export const GATEWAY_TRANSPORT: typeof TransportName = 'muqun-aes-256-gcm-v1';
