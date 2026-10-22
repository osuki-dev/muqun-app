import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast, Text } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetScene, SheetSceneFooter, sheetSceneStyles } from '@/components/sheet-scene';
import type { HomeLayout } from '@/lib/home-layout';
import { useRenderTally } from '@/lib/render-tally';
import { useAppSettings } from '@/stores/app-settings';
import { settleAfter } from '@/lib/compiler-safe-control-flow';

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
      detail: t`Familiar computer cards and quick actions.`,
    },
    {
      id: 'editorial',
      title: t`Editorial`,
      detail: t`A magazine-style Home with attention and recent sessions.`,
    },
    {
      id: 'stage',
      title: t`Stage`,
      detail: t`Your theme's art as a 3D world that moves with your phone, with your agents' status below it.`,
    },
  ];

  async function choose(next: HomeLayout) {
    if (savePending.current) return;
    savePending.current = true;
    return settleAfter(
      async () => {
        try {
          await setHomeLayout(next);
        } catch {
          showToast({
            variant: 'danger',
            title: t`Could not save Home layout`,
            message: t`Home layout changed for this session, but could not be saved on this device. Try again.`,
          });
        }
      },
      () => {
        savePending.current = false;
        onClose();
      }
    );
  }

  return (
    <SheetScene
      testID="settings-home-layout-sheet"
      title={t`Home layout`}
      caption={choices.find((choice) => choice.id === layout)?.title}
      contentSized={true}>
      <View style={sheetSceneStyles.column}>
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
      </View>
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

// Opacity audit: decorative -- a schematic of the layout, not surfaces that carry content.
function HomeLayoutPreview({ layout }: { layout: HomeLayout }) {
  const { colors } = useThemeTokens();
  return (
    <View
      accessible={false}
      style={[
        styles.preview,
        {
          backgroundColor: colors.background,
          borderColor: colors.border,
        },
      ]}>
      <View style={[styles.previewHeader, { backgroundColor: colors.surfaceRaised }]} />
      {layout === 'classic' ? (
        <View style={styles.classicPreview}>
          <View style={[styles.classicCard, { backgroundColor: colors.surface }]} />
          <View style={[styles.classicCard, { backgroundColor: colors.surface }]} />
          <View style={[styles.classicCard, { backgroundColor: colors.surface }]} />
        </View>
      ) : layout === 'stage' ? (
        <StageLayoutPreview />
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

/** Layered artwork and status chips, using the same neutral surfaces as the other layouts. */
function StageLayoutPreview() {
  const { colors } = useThemeTokens();
  return (
    <View style={styles.stagePreview}>
      <View style={styles.stageArt}>
        <View style={[styles.stageBack, { backgroundColor: colors.surface }]} />
        <View style={[styles.stageFront, { backgroundColor: colors.surfaceRaised }]} />
      </View>
      <View style={styles.stageChips}>
        <View style={[styles.stageChip, { backgroundColor: colors.surfaceRaised }]} />
        <View style={[styles.stageChip, { backgroundColor: colors.surfaceRaised }]} />
        <View style={[styles.stageChip, { backgroundColor: colors.surfaceRaised }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stagePreview: { flex: 1, gap: 4 },
  stageArt: { flex: 1 },
  stageBack: {
    position: 'absolute',
    left: 0,
    right: 8,
    top: 0,
    bottom: 6,
    borderRadius: 4,
  },
  stageFront: {
    position: 'absolute',
    left: 8,
    right: 0,
    top: 6,
    bottom: 0,
    borderRadius: 4,
  },
  stageChips: { flexDirection: 'row', gap: 3 },
  stageChip: { width: 16, height: 4, borderRadius: 2 },
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
