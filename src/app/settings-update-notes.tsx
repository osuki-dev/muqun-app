import { useLingui } from '@lingui/react/macro';
import { nativeApplicationVersion } from 'expo-application';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetScene, SheetSceneFooter, sheetSceneStyles } from '@/components/sheet-scene';
import { UpdateReleaseNotes } from '@/components/update-release-notes';
import { closeUpdateDetails, useUpdateDetails } from '@/stores/update-details';

export default function SettingsUpdateNotesScreen() {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const [selection] = useState(() => useUpdateDetails.getState());
  useEffect(() => closeUpdateDetails, []);
  return (
    <SheetScene
      title={t`What's new`}
      testID="settings-update-notes-sheet"
      caption={
        selection.bundled
          ? nativeApplicationVersion
            ? `${t`Built-in`} · ${nativeApplicationVersion}`
            : t`Built-in`
          : selection.phase === 'restarting'
            ? t`Restarting Muqun…`
            : selection.phase === 'restart-failed'
              ? t`Restart Muqun to finish updating`
              : selection.phase === 'downloading'
                ? t`Updating Muqun…`
                : undefined
      }>
      <ScrollView
        nestedScrollEnabled
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}>
        <UpdateReleaseNotes notes={selection.notes} bundled={selection.bundled} />
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}
