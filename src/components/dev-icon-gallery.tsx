import { LegendList } from '@legendapp/list/react-native';
import { useLingui } from '@lingui/react/macro';
import { PressableScale, SearchInput, Text, useThemeTokens } from '@osuki-dev/ui';
import { useState } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SettingsSegmented } from '@/components/settings-segmented';
import { OpenCodeIcon } from '@/components/opencode-icon';
import { AppIcon, APP_ICON_STROKE_WIDTH, type AppIconName } from '@/icons/app-icon';
import catalog from '@/icons/semantic-catalog.json';

type GalleryEntry = { name: AppIconName | 'brand-opencode'; component: string };
const entries: GalleryEntry[] = Object.entries(catalog).map(([component, name]) => ({
  component,
  name: name as AppIconName,
}));
const marks: GalleryEntry[] = [
  { name: 'brand-opencode', component: 'OpenCodeIcon' },
  { name: 'brand-codex', component: 'CodexIcon' },
  { name: 'brand-t3', component: 'T3Icon' },
  { name: 'brand-deepseek', component: 'DeepSeekIcon' },
  { name: 'working-spinner', component: 'WorkingSpinner' },
];
const sizeOptions = [16, 20, 24, 32].map((value) => ({
  label: String(value),
  value: String(value),
}));
const strokeOptions = [0.5, 1, 1.5, 2].map((value) => ({
  label: String(value),
  value: String(value),
}));
const keyOfEntry = (entry: GalleryEntry) => entry.name;

/** One ephemeral inspector for both home layouts. Never mounted in production. */
export function DevIconGalleryEntry() {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  if (!__DEV__) return null;
  return (
    <>
      <View pointerEvents="box-none" style={[styles.entry, { bottom: insets.bottom + 8 }]}>
        <PressableScale
          testID="dev-icon-gallery-open"
          accessibilityRole="button"
          accessibilityLabel={t`Open icon preview`}
          onPress={() => setOpen(true)}
          style={[
            styles.entryButton,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}>
          <AppIcon name="grid" size={16} color={theme.colors.text} />
          <Text variant="label" style={{ color: theme.colors.text }}>{t`Icons`}</Text>
        </PressableScale>
      </View>
      {open ? <IconGalleryModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function IconGalleryCell({
  entry,
  size,
  stroke,
}: {
  entry: GalleryEntry;
  size: number;
  stroke: number;
}) {
  const theme = useThemeTokens();
  return (
    <View
      style={[
        styles.cell,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}>
      <View style={styles.glyph}>
        {entry.name === 'brand-opencode' ? (
          <OpenCodeIcon size={size} color={theme.colors.text} />
        ) : (
          <AppIcon
            name={entry.name}
            size={entry.name === 'brand-t3' ? (size * 74) / 111 : size}
            strokeWidth={stroke}
            color={theme.colors.text}
          />
        )}
      </View>
      <Text variant="caption" numberOfLines={2} style={[styles.name, { color: theme.colors.text }]}>
        {entry.name}
      </Text>
    </View>
  );
}

function IconGalleryModal({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [size, setSize] = useState('24');
  const [stroke, setStroke] = useState(String(APP_ICON_STROKE_WIDTH));
  const needle = query.trim().toLowerCase();
  const matches = (entry: GalleryEntry) =>
    `${entry.name} ${entry.component}`.toLowerCase().includes(needle);
  const filtered = entries.filter(matches);
  const filteredMarks = marks.filter(matches);
  const columns = width >= 700 ? 5 : 3;
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}>
      <GestureHandlerRootView
        style={[
          styles.modal,
          {
            backgroundColor: theme.colors.background,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
        ]}>
        <View style={styles.heading}>
          <View style={styles.headingCopy}>
            <Text variant="heading">{t`Icon preview`}</Text>
            <Text
              variant="caption"
              style={{
                color: theme.colors.textMuted,
              }}>{t`${filtered.length} of ${entries.length} icons · development only`}</Text>
          </View>
          <PressableScale
            testID="dev-icon-gallery-close"
            accessibilityRole="button"
            accessibilityLabel={t`Close icon preview`}
            onPress={onClose}
            style={styles.close}>
            <AppIcon name="close" size={24} color={theme.colors.text} />
          </PressableScale>
        </View>
        <View style={styles.controls}>
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder={t`Search icons`}
            accessibilityLabel={t`Search icons`}
            testID="dev-icon-gallery-search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <Text variant="caption" style={{ color: theme.colors.textMuted }}>{t`Size`}</Text>
          <SettingsSegmented
            options={sizeOptions}
            value={size}
            onChange={setSize}
            testID="dev-icon-gallery-size"
          />
          <Text variant="caption" style={{ color: theme.colors.textMuted }}>{t`Stroke width`}</Text>
          <SettingsSegmented
            options={strokeOptions}
            value={stroke}
            onChange={setStroke}
            testID="dev-icon-gallery-stroke"
          />
        </View>
        <LegendList
          dataKey={`columns-${columns}`}
          recycleItems
          style={styles.viewport}
          testID="dev-icon-gallery-list"
          data={filtered}
          numColumns={columns}
          keyExtractor={keyOfEntry}
          estimatedItemSize={104}
          extraData={{ size, stroke, foreground: theme.colors.text, surface: theme.colors.surface }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <IconGalleryCell entry={item} size={Number(size)} stroke={Number(stroke)} />
          )}
          ListEmptyComponent={
            filteredMarks.length ? null : (
              <Text variant="bodySmall" style={styles.empty}>{t`No matching icons`}</Text>
            )
          }
          ListFooterComponent={
            filteredMarks.length ? (
              <View style={styles.footer}>
                <Text variant="label">{t`Brand marks and working indicator`}</Text>
                <Text
                  variant="caption"
                  style={{
                    color: theme.colors.textMuted,
                  }}>{t`Marks keep their original geometry and stroke.`}</Text>
                <View style={styles.markRow}>
                  {filteredMarks.map((entry) => (
                    <View key={entry.name} style={styles.mark}>
                      <IconGalleryCell entry={entry} size={Number(size)} stroke={Number(stroke)} />
                    </View>
                  ))}
                </View>
              </View>
            ) : null
          }
        />
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  entry: { position: 'absolute', left: 12, zIndex: 1000 },
  entryButton: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modal: { flex: 1 },
  heading: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headingCopy: { flex: 1, gap: 4 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  controls: { paddingHorizontal: 20, paddingBottom: 16, gap: 8 },
  viewport: { flex: 1 },
  list: { paddingHorizontal: 12, paddingBottom: 20 },
  cell: {
    minHeight: 96,
    margin: 4,
    padding: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 8,
  },
  glyph: { height: 36, justifyContent: 'center', alignItems: 'center' },
  name: { textAlign: 'center' },
  empty: { padding: 20 },
  footer: { paddingTop: 20, paddingHorizontal: 4, gap: 8 },
  markRow: { flexDirection: 'row', flexWrap: 'wrap' },
  mark: { width: '50%' },
});
