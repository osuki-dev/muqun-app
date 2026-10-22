import { requireOptionalNativeModule } from 'expo';
import type { AppStorageModule } from './MuqunAppStorage.types';

// Older installed builds remain usable; callers must check this capability.
export default requireOptionalNativeModule<AppStorageModule>('MuqunAppStorage');
