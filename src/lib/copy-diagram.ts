import * as Clipboard from 'expo-clipboard';
import { fromByteArray } from 'react-native-quick-base64';

export async function copyDiagram(data: string | Uint8Array): Promise<void> {
  if (typeof data === 'string') {
    await Clipboard.setStringAsync(data);
  } else {
    await Clipboard.setImageAsync(fromByteArray(data));
  }
}
