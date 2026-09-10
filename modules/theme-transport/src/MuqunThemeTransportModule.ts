import { requireOptionalNativeModule } from 'expo';
import type { ThemeTransportModule } from './MuqunThemeTransport.types';

// Older installed builds remain usable; callers must check this capability.
export default requireOptionalNativeModule<ThemeTransportModule>('MuqunThemeTransport');
