import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { SheetScene, SheetSceneFooter, sheetSceneStyles } from '@/components/sheet-scene';
import { Text } from '@/components/text';
import type { HomeLayout } from '@/lib/home-layout';
import { useRenderTally } from '@/lib/render-tally';
import { useAppSettings } from '@/stores/app-settings';

type HomeLayoutChoice = {
  id: HomeLayout;
  title: string;
  detail: string;
};

export function SettingsHomeLayoutSheet({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const layout = useAppSettings((state) => state.homeLayout);
  const setHomeLayout = useAppSettings((state) => state.setHomeLayout);
  const savePending = useRef(false);
  useRenderTally('SettingsHomeLayoutSheet');

  const choices: readonly HomeLayoutChoice[] = [
    {
      id: 'classic',
      title: t`Classic`,
      detail: t`Familiar server cards and quick actions.`,
    },
    {
      id: 'editorial',
      title: t`Editorial`,
      detail: t`A magazine-style Home with attention and recent sessions.`,
    },
  ];

  async function choose(next: HomeLayout) {
    if (savePending.current) return;
    savePending.current = true;
    try {
      await setHomeLayout(next);
    } catch {
      showToast({
        variant: 'danger',
        title: t`Could not save Home layout`,
        message: t`Home layout changed for this session, but could not be saved on this device. Try again.`,
      });
    } finally {
      savePending.current = false;
      onClose();
    }
  }

  return (
    <SheetScene
      testID="settings-home-layout-sheet"
      title={t`Home layout`}
      caption={layout === 'editorial' ? t`Editorial` : t`Classic`}>
      <ScrollView
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}
        showsVerticalScrollIndicator={false}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t`Home layout`}>
          {choices.map((choice) => (
            <HomeLayoutOption
              key={choice.id}
              choice={choice}
              selected={choice.id === layout}
              onPress={() => choose(choice.id)}
            />
          ))}
        </View>
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
}

function HomeLayoutOption({
  choice,
  selected,
  onPress,
}: {
  choice: HomeLayoutChoice;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useThemeTokens();
  return (
    <PressableScale
      testID={`settings-selection:${selected ? 'on' : 'off'}:home-layout-${choice.id}`}
      accessibilityRole="radio"
      accessibilityLabel={choice.title}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={styles.option}>
      <HomeLayoutPreview layout={choice.id} />
      <View style={styles.copy}>
        <Text
          variant="bodySmall"
          weight={selected ? 'semibold' : 'regular'}
          color={selected ? colors.primary : colors.text}>
          {choice.title}
        </Text>
        <Text variant="caption" color={colors.textMuted} numberOfLines={3}>
          {choice.detail}
        </Text>
      </View>
      <View
        accessible={false}
        style={[styles.radio, { borderColor: selected ? colors.primary : colors.border }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
      </View>
    </PressableScale>
  );
}

function HomeLayoutPreview({ layout }: { layout: HomeLayout }) {
  const { colors } = useThemeTokens();
  return (
    <View
      accessible={false}
      style={[styles.preview, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={[styles.previewHeader, { backgroundColor: colors.surfaceRaised }]} />
      {layout === 'classic' ? (
        <View style={styles.classicPreview}>
          <View style={[styles.classicCard, { backgroundColor: colors.surface }]} />
          <View style={[styles.classicCard, { backgroundColor: colors.surface }]} />
          <View style={[styles.classicCard, { backgroundColor: colors.surface }]} />
        </View>
      ) : (
        <View style={styles.editorialPreview}>
          <View style={[styles.editorialLead, { backgroundColor: colors.surface }]} />
          <View style={styles.editorialRail}>
            <View style={[styles.editorialCard, { backgroundColor: colors.surfaceRaised }]} />
            <View style={[styles.editorialCard, { backgroundColor: colors.surfaceRaised }]} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: 108,
    paddingVertical: 10,
    gap: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  preview: {
    width: 100,
    height: 72,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    borderCurve: 'continuous',
    padding: 7,
    gap: 6,
  },
  previewHeader: { height: 6, width: '58%', borderRadius: 3 },
  classicPreview: { gap: 4 },
  classicCard: { height: 12, borderRadius: 3 },
  editorialPreview: { flexDirection: 'row', flex: 1, gap: 5 },
  editorialLead: { flex: 1.25, borderRadius: 4 },
  editorialRail: { flex: 0.75, gap: 4 },
  editorialCard: { flex: 1, borderRadius: 3 },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  radio: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
});
