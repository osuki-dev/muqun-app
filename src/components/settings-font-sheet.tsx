/**
 * The reader's own fonts: what each slot is set to, and the three ways to
 * change it.
 *
 * Muqun offers no fonts. There is no list to scroll, no bundled family to pick
 * from, no licensing to agree to -- the app has nothing to recommend and has
 * not earned an opinion about what somebody should read in. What it has is two
 * slots and a way to put a file in them, which is the whole feature: a reader
 * with a custom need (a Han face that holds up at 14pt, a mono face with a
 * slashed zero, a face their dyslexia gets on with) brings the file, and the
 * app's job is to check it will not break anything and then get out of the way.
 *
 * So the sheet does not police taste. It refuses a file that is not a font,
 * says so in a sentence, and warns -- quietly, once, under the row -- when a
 * face in the monospace slot has uneven advances. It does not refuse it. A
 * reader who wants their proportional favourite in the terminal has been told
 * what will happen and is entitled to it.
 *
 * Two groups rather than one list, because the slots answer different
 * questions and a reader almost always means one of them. Interface first: it
 * is the larger change -- every screen in the app -- and Monospace is the
 * narrower one under it.
 *
 * At most one URL field is open at a time. That is a layout rule with a reason:
 * the sheet system allows one primary action, and two open fields would put two
 * Download buttons on one ground.
 */
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SheetScene,
  SheetSceneAction,
  SheetSceneField,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneRow,
  SHEET_LADDER,
  sheetSceneStyles,
  useSheetSceneInputStyle,
} from '@/components/sheet-scene';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { useUserFontStatus } from '@/hooks/use-user-fonts';
import { feedback } from '@/lib/feedback';
import { fadeIn, fadeOut } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';
import { useAppSettings } from '@/stores/app-settings';
import {
  downloadUserFont,
  importUserFont,
  isDownloadableFontUrl,
  loadUserFont,
  removeUserFontFile,
  SYSTEM_FONT_SLOT,
  UserFontError,
  USER_FONT_MAX_BYTES,
  type FontDownloadProgress,
  type FontSlot,
  type FontSlotId,
  type UserFontProblem,
} from '@/theme/user-fonts';

/** The focused field's clearance above the keyboard: the URL field. */
const KEYBOARD_BOTTOM_OFFSET = 96;

/** Which setting each slot is stored under. */
const SLOT_SETTING = { interface: 'interfaceFont', mono: 'monoFont' } as const;

/** What a slot is doing right now, where that is not simply "nothing". */
type SlotWork =
  | { kind: 'idle' }
  | { kind: 'downloading'; progress: FontDownloadProgress | null }
  | { kind: 'importing' };

export function SettingsFontSheet({ onClose }: { onClose: () => void }) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro` -- see the
  // note at the top of the settings screen for why.
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  useRenderTally('SettingsFontSheet');

  const interfaceFont = useAppSettings((state) => state.interfaceFont);
  const monoFont = useAppSettings((state) => state.monoFont);

  /** Which group has its URL field open, if any. At most one. */
  const [urlSlot, setUrlSlot] = useState<FontSlotId | null>(null);
  const [url, setUrl] = useState('');
  const [work, setWork] = useState<Record<FontSlotId, SlotWork>>({
    interface: { kind: 'idle' },
    mono: { kind: 'idle' },
  });
  const [errors, setErrors] = useState<Partial<Record<FontSlotId, UserFontProblem>>>({});
  /**
   * The live download, so leaving the sheet stops it.
   *
   * A reader who swipes a sheet away has cancelled what was on it. Without
   * this the fetch would run to completion against a screen nobody is looking
   * at, and land a font the reader had already changed their mind about.
   */
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  /** What launch registration could not do, until the reader fixes it. */
  const launchProblems = useUserFontStatus((state) => state.problems);

  const slots: Record<FontSlotId, FontSlot> = { interface: interfaceFont, mono: monoFont };

  function setSlotWork(id: FontSlotId, next: SlotWork) {
    setWork((current) => ({ ...current, [id]: next }));
  }

  function setSlotError(id: FontSlotId, problem: UserFontProblem | undefined) {
    setErrors((current) => ({ ...current, [id]: problem }));
  }

  /**
   * Store the new slot, bind the alias, and throw nothing away until both are
   * done.
   *
   * The alias is rebound here rather than left to the next launch, because a
   * reader who has just installed a font is looking straight at the app and
   * "restart to see it" is not an answer. See `loadUserFont` for the one
   * surface this cannot reach in-process.
   */
  async function apply(id: FontSlotId, slot: FontSlot) {
    await loadUserFont(id, slot);
    await useAppSettings.getState().update({ [SLOT_SETTING[id]]: slot });
    setSlotError(id, undefined);
  }

  async function download(id: FontSlotId) {
    const trimmed = url.trim();
    if (!isDownloadableFontUrl(trimmed)) {
      setSlotError(id, { kind: 'download' });
      return;
    }
    await feedback('selection');
    const controller = new AbortController();
    abortRef.current = controller;
    setSlotError(id, undefined);
    setSlotWork(id, { kind: 'downloading', progress: null });
    try {
      const installed = await downloadUserFont({
        slot: id,
        url: trimmed,
        previous: slots[id],
        signal: controller.signal,
        onProgress: (progress) => setSlotWork(id, { kind: 'downloading', progress }),
      });
      await apply(id, installed);
      setUrl('');
      setUrlSlot(null);
    } catch (error) {
      reportFailure(id, error);
    } finally {
      abortRef.current = null;
      setSlotWork(id, { kind: 'idle' });
    }
  }

  async function importFile(id: FontSlotId) {
    await feedback('selection');
    setSlotError(id, undefined);
    setSlotWork(id, { kind: 'importing' });
    try {
      const installed = await importUserFont({ slot: id, previous: slots[id] });
      // `null` is the reader closing the picker, which is not a failure and
      // must not be drawn as one.
      if (installed) await apply(id, installed);
    } catch (error) {
      reportFailure(id, error);
    } finally {
      setSlotWork(id, { kind: 'idle' });
    }
  }

  function reportFailure(id: FontSlotId, error: unknown) {
    const problem =
      error instanceof UserFontError ? error.problem : ({ kind: 'storage' } as UserFontProblem);
    // A cancel is the reader's own decision arriving back as an exception.
    // Saying "could not download" to somebody who pressed the back arrow is
    // the app arguing with them.
    setSlotError(id, problem.kind === 'cancelled' ? undefined : problem);
  }

  async function clearSlot(id: FontSlotId) {
    await feedback('selection');
    const previous = slots[id];
    await useAppSettings.getState().update({ [SLOT_SETTING[id]]: SYSTEM_FONT_SLOT });
    // The setting first, the file after: a slot that is already back on the
    // system font cannot be left pointing at bytes that have gone.
    removeUserFontFile(previous);
    setSlotError(id, undefined);
  }

  function openUrlField(id: FontSlotId) {
    setUrl('');
    setSlotError(id, undefined);
    setUrlSlot((current) => (current === id ? null : id));
  }

  return (
    <SheetScene
      testID="settings-font-sheet"
      title={t`Font`}
      caption={t`Muqun has no fonts of its own. Add one and it is kept on this device.`}>
      {/*
        Keyboard-aware because a URL is typed into this scroller, and
        `SheetSceneFooter` adds the keyboard's own height at the end so the
        group below the open field stays reachable while it is up.
      */}
      <KeyboardAwareScrollView
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}>
        <FontSlotGroup
          id="interface"
          first
          heading={t`Interface`}
          description={t`Every screen in the app.`}
          slot={interfaceFont}
          work={work.interface}
          problem={errors.interface ?? launchProblems.interface}
          urlOpen={urlSlot === 'interface'}
          url={url}
          onUrlChange={setUrl}
          onOpenUrl={() => openUrlField('interface')}
          onDownload={() => void download('interface')}
          onImport={() => void importFile('interface')}
          onUseSystem={() => void clearSlot('interface')}
        />
        <SheetSceneGroupRule />
        <FontSlotGroup
          id="mono"
          heading={t`Monospace`}
          description={t`The terminal, and code in a reply.`}
          slot={monoFont}
          work={work.mono}
          problem={errors.mono ?? launchProblems.mono}
          urlOpen={urlSlot === 'mono'}
          url={url}
          onUrlChange={setUrl}
          onOpenUrl={() => openUrlField('mono')}
          onDownload={() => void download('mono')}
          onImport={() => void importFile('mono')}
          onUseSystem={() => void clearSlot('mono')}
        />
        <SheetSceneFooter bottomInset={insets.bottom} />
      </KeyboardAwareScrollView>
    </SheetScene>
  );
}

/** One slot: what it is set to now, and the three ways to change it. */
function FontSlotGroup({
  id,
  first,
  heading,
  description,
  slot,
  work,
  problem,
  urlOpen,
  url,
  onUrlChange,
  onOpenUrl,
  onDownload,
  onImport,
  onUseSystem,
}: {
  id: FontSlotId;
  first?: boolean;
  heading: string;
  description: string;
  slot: FontSlot;
  work: SlotWork;
  problem: UserFontProblem | undefined;
  urlOpen: boolean;
  url: string;
  onUrlChange: (next: string) => void;
  onOpenUrl: () => void;
  onDownload: () => void;
  onImport: () => void;
  onUseSystem: () => void;
}) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const inputStyle = useSheetSceneInputStyle();
  const busy = work.kind !== 'idle';
  const installed = slot.kind === 'file' ? slot : null;
  const progress = work.kind === 'downloading' ? work.progress : null;

  /**
   * The quiet note under a monospace face whose glyphs are not all one width.
   *
   * A note and not a refusal. It is measured at install time from `i M W 0`,
   * so it is a fact rather than a guess, and what it predicts is real: the grid
   * places every glyph on a fixed cell advance, so a proportional face draws
   * with visible gaps and overlaps. But the reader picked it, and a terminal
   * that refuses the font somebody chose for it is an app that has decided it
   * knows better.
   */
  const notMonospace = id === 'mono' && installed?.isMonospace === false;

  /**
   * Why a file was not installed, as one sentence the reader can act on.
   *
   * Sentence case, and no vocabulary the app invented. The three that name a
   * format are separate from the general one on purpose: "this is a web font"
   * tells somebody to go and re-export it, and "this file is not a font" tells
   * them nothing they did not already suspect. The download status is in the
   * sentence for the same reason -- 404 is a link that is wrong and 403 is a
   * link that needs a login, and those are different afternoons.
   *
   * Declared here rather than at module scope because the Lingui macro
   * transforms `t` where `useLingui()` lexically binds it; a `t` passed in as an
   * argument extracts no messages and ships the English source to every reader.
   */
  function problemSentence(problem: UserFontProblem): string {
    switch (problem.kind) {
      case 'format':
        if (problem.format === 'woff' || problem.format === 'woff2') {
          return t`This is a web font. Muqun needs a .ttf or .otf file.`;
        }
        if (problem.format === 'collection') {
          return t`This is a font collection. Muqun needs a single font file.`;
        }
        if (problem.format === 'webpage') {
          return t`That link opens a web page, not the font file. Use the file's direct download link.`;
        }
        return t`This file is not a TrueType or OpenType font.`;
      case 'too-large':
        return t`This file is too large.`;
      case 'empty':
        return t`This file is empty.`;
      case 'unreadable':
        return t`This font could not be read.`;
      case 'download':
        return problem.status === undefined
          ? t`Could not download. Check the link and your connection.`
          : t`Could not download: ${problem.status}`;
      case 'storage':
        return t`The font file is missing. Add it again.`;
      case 'cancelled':
        return '';
    }
  }

  return (
    <View>
      <SheetSceneGroupHeading title={heading} first={first} testID={`font-group-${id}`} />
      <SheetSceneRow
        title={installed ? installed.label : t`System font`}
        caption={installed ? installed.source : description}
        captionKind={installed ? 'path' : 'text'}
        selected
        // The slot is the label and whatever is in it is the value, which is
        // the one arrangement that reads correctly in every state: "Interface,
        // SerifInterface", "Monospace, System font", "Monospace, Downloading".
        //
        // The value is always present and never `undefined`, because Android
        // does not clear an accessibility value that is set and then removed --
        // the view keeps the last description it was given, so a row that had
        // finished downloading went on announcing "Downloading" for the rest of
        // the session. Found on device.
        accessibilityLabel={heading}
        accessibilityValue={{
          text: busy ? t`Downloading` : installed ? installed.label : t`System font`,
        }}
        testID={`font-current-${id}`}
        selectedTestID={`font-current-${id}-selected`}
        trailing={
          <View style={styles.underRow}>
            {progress?.totalBytes ? (
              <ThemeImportProgress
                compact
                label={t`Downloading`}
                phase={`font-${id}`}
                completed={progress.bytesWritten}
                total={progress.totalBytes}
                testID={`font-progress-${id}`}
              />
            ) : null}
            {problem ? (
              <Animated.View entering={fadeIn('short')} exiting={fadeOut('micro')}>
                <Text
                  variant="caption"
                  color={colors.danger}
                  accessibilityRole="alert"
                  testID={`font-error-${id}`}>
                  {problemSentence(problem)}
                </Text>
              </Animated.View>
            ) : null}
            {notMonospace ? (
              <Animated.View entering={fadeIn('short')}>
                <Text variant="caption" color={colors.textMuted} testID={`font-uneven-${id}`}>
                  {t`Not monospace — the terminal may look uneven`}
                </Text>
              </Animated.View>
            ) : null}
          </View>
        }
      />

      <SheetSceneRow
        title={t`Paste a URL…`}
        disabled={busy}
        onPress={onOpenUrl}
        testID={`font-paste-${id}`}
      />
      {urlOpen ? (
        // Keyed on the slot so opening the other group's field is a new node
        // rather than the same one sliding between two headings.
        <Animated.View key={id} entering={fadeIn('short')} exiting={fadeOut('micro')}>
          <SheetSceneField
            label={t`Font file address`}
            hint={t`A direct link to a .ttf or .otf file.`}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              keyboardType="url"
              inputMode="url"
              onChangeText={onUrlChange}
              onSubmitEditing={onDownload}
              placeholder="https://"
              placeholderTextColor={colors.textMuted}
              returnKeyType="go"
              style={inputStyle}
              testID={`font-url-${id}`}
              value={url}
            />
          </SheetSceneField>
          <SheetSceneAction
            label={t`Download`}
            busy={work.kind === 'downloading'}
            disabled={!isDownloadableFontUrl(url)}
            onPress={onDownload}
            testID={`font-download-${id}`}
          />
        </Animated.View>
      ) : null}

      <SheetSceneRow
        title={t`Import a file…`}
        caption={t`A .ttf or .otf up to ${Math.round(USER_FONT_MAX_BYTES / (1024 * 1024))} MB.`}
        disabled={busy}
        onPress={onImport}
        testID={`font-import-${id}`}
      />
      {/*
        Always here, and not only when a font is installed. It is the way back,
        and a row that appears and disappears is a control the reader has to
        find twice; disabled while the slot is already on the system font says
        the same thing without moving anything.
      */}
      <SheetSceneRow
        title={t`Use system font`}
        disabled={busy || !installed}
        disabledCaption={installed ? undefined : t`Already on`}
        onPress={onUseSystem}
        testID={`font-system-${id}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /** The progress bar, the error and the note, under the row they belong to. */
  underRow: { gap: SHEET_LADDER.tight, paddingBottom: SHEET_LADDER.tight },
});
