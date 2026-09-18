import * as Clipboard from 'expo-clipboard';
import { Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Button } from '@/components/themed-button';
import { Skeleton } from '@/components/themed-skeleton';
import { Check, Copy, X } from 'lucide-react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMarkdownFonts } from '@/hooks/use-user-fonts';
import { createMarkdownStyle } from '@/lib/markdown-style';
import { ImagePreviewModal } from '@/components/image-preview-modal';
import { SheetFrame } from '@/components/sheet-ground';
import { PressableScale } from '@/components/pressable-scale';
import { formatAssetSize } from '@/lib/asset-display';
import { fenceLanguageForFile, fencedFile } from '@/lib/code-language';
import { useLatestRef } from '@/hooks/use-render-refs';
import { useRelativeTime } from '@/hooks/use-relative-time';
import { fadeIn, fadeOut } from '@/lib/motion';
import {
  assetImageSource,
  readAssetImageSource,
  readAssetText,
  type AssetImageSource,
  type SessionAsset,
  readAssetBytes,
} from '@/lib/gateway-client';
import { CodeLinesView } from '@/components/code-lines-view';
import { MarkdownDocumentView } from '@/components/markdown-document-view';
import { HIGHLIGHT_MAX_CHARS, MAX_ASSET_TEXT_BYTES, indexTextLines } from '@/lib/text-preview';
import { describeGatewayFailure } from '@/lib/network-error';
import { isSafeExternalLink } from '@/lib/safe-link';
import { CustomThemeLibrary, type ThemePrimaryAction } from '@/components/custom-theme-library';
import { SheetSceneAction } from '@/components/sheet-scene';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { prepareThemeAssets, type PreparedThemeAssets } from '@/theme/assets';
import { ThemeImportRequest } from '@/theme/import-request';
import { unpackTheme } from '@/theme/package';
import { THEME_LIMITS } from '@/theme/schema';
import type { ThemeEditorCandidate } from '@/theme/draft-session';
import { themeFromDocument } from '@/theme/file-preview';

/**
 * Read-only view of one artifact the agent produced.
 *
 * Every kind is displayed straight from the gateway rather than copied to a
 * cache file first: an image is fetched by the image library, which sends the
 * bearer token itself and owns the decode and the disk cache, and text is read
 * into a string because that is what the renderers want anyway. Nothing here
 * holds a whole file in the JS heap except text, which is size-capped by
 * `readAssetText` -- and that cap is now the only one: what arrives is drawn,
 * a block or a line at a time.
 */
export function AssetViewer({ asset, onClose }: { asset: SessionAsset; onClose: () => void }) {
  if (asset.kind === 'image' && asset.previewable) {
    const source = assetImageSource(asset);
    if (!source) return <EncryptedImageViewer asset={asset} onClose={onClose} />;
    return (
      <ImagePreviewModal
        images={[
          {
            id: asset.id,
            uri: source.uri,
            headers: source.headers,
            cacheKey: source.cacheKey,
          },
        ]}
        initialIndex={0}
        onClose={onClose}
      />
    );
  }

  return <AssetSheet asset={asset} onClose={onClose} />;
}

function EncryptedImageViewer({ asset, onClose }: { asset: SessionAsset; onClose: () => void }) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const [source, setSource] = useState<AssetImageSource | null>(null);
  // A mailbox, not a dependency. The caller hands `onClose` down as an inline
  // arrow, so its identity changes on every parent render -- and the terminal
  // workspace re-renders for every streamed frame. With the callback in the
  // effect's dependency list, an agent printing meant the read below was torn
  // down and restarted a few times a second: `source` never landed, and the
  // viewer sat on its loading state for as long as the output kept coming.
  const onCloseRef = useLatestRef(onClose);
  useEffect(() => {
    let active = true;
    // The same bargain the text read below makes, and for the same reason: a
    // picture is downloaded whole before the lightbox has anything to show, so
    // closing the viewer while it is coming has to stop the download rather
    // than let it finish into a screen that has gone.
    const controller = new AbortController();
    readAssetImageSource(asset, { signal: controller.signal })
      .then((next) => {
        if (active) setSource(next);
      })
      .catch(() => {
        if (active) onCloseRef.current();
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [asset, onCloseRef]);
  if (!source) {
    // The bytes have to arrive before the lightbox has anything to show, and
    // the wait is spent as the same black surface the lightbox opens on -- with
    // the way out already in place. An invisible placeholder here was a trap:
    // a viewer that is open but shows nothing has nothing to press.
    return (
      <Modal
        visible
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={onClose}>
        <View style={styles.encryptedLoading}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <PressableScale
            accessibilityLabel={t`Close preview`}
            onPress={onClose}
            style={[styles.encryptedLoadingClose, { top: insets.top + 10 }]}>
            <X size={20} color="#FFFFFF" />
          </PressableScale>
        </View>
      </Modal>
    );
  }
  return (
    <ImagePreviewModal
      images={[{ id: asset.id, uri: source.uri, cacheKey: source.cacheKey }]}
      initialIndex={0}
      onClose={onClose}
    />
  );
}

/** How long the header's copy button stays a tick before it is a copy icon again. */
const COPIED_FEEDBACK_MS = 1_600;

/** Everything that is not an image: a document, some text, or a file we can only describe. */
function AssetSheet({ asset, onClose }: { asset: SessionAsset; onClose: () => void }) {
  const surfaceBackground = useSurfaceBackground();
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();
  const relativeTime = useRelativeTime();

  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const markdownFonts = useMarkdownFonts();
  const markdownStyle = useMemo(
    () => createMarkdownStyle(theme.colors, markdownFonts),
    [theme.colors, markdownFonts]
  );
  const textual = asset.previewable && (asset.kind === 'markdown' || asset.kind === 'text');
  /**
   * The one ceiling left, and it is about the phone rather than the renderer.
   *
   * `asset.size` is a real file size in real bytes, which is what this has to
   * be measured in -- the renderers' own limits are in characters, because
   * glyphs are what they lay out. Above this the file is not asked for at all:
   * refusing after downloading five megabytes into a component that will not
   * draw them is what the viewer used to do at a tenth of the size.
   */
  const tooLarge = textual && asset.size > MAX_ASSET_TEXT_BYTES;
  const readable = textual && !tooLarge;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by "Try again"; the only thing that re-runs the read. */
  const [attempt, setAttempt] = useState(0);
  const [previewedThemeDocument, setPreviewedThemeDocument] = useState<string | null>(null);
  /**
   * The one decision a previewed theme offers, pinned rather than scrolled to.
   *
   * The library drew its own Apply between the preview and the appearance
   * settings, and the settings are several screens long on a phone: the device
   * run had to scroll 900px to reach the confirm on a theme it had just opened.
   * Taking the action (`onPrimaryActionChange`) moves it to the bottom bar
   * below, where the viewer's other permanent controls already are, and stops
   * the library drawing the inline one. `setPrimary` is a `useState` setter, so
   * its identity is stable and the library reports again only when the action
   * itself changes; the same contract the detail route has used since #834.
   */
  const [primary, setPrimary] = useState<ThemePrimaryAction | null>(null);
  const themeDocumentIdentity = `${asset.id}:${asset.modified_unix_ms}`;
  const themeManifest = useMemo(
    () => themeFromDocument(asset.name, content),
    [asset.name, content]
  );
  /**
   * A packaged theme, fetched and opened without leaving this file.
   *
   * A `.muqun-theme` is a ZIP, so none of the viewer's text paths apply and the
   * reader used to be told to go and find the file themselves -- for a package
   * an agent had just written into this very session. The gateway serves it on
   * the same endpoint that feeds the image viewer, so the whole trip is: tap,
   * watch it arrive, and look at it here.
   *
   * `prepared` holds decoded artwork and must be disposed. This owns it, which
   * is why `CustomThemeLibrary` is told it does not.
   */
  const packaged = /\.muqun-theme$/i.test(asset.name);
  const [pack, setPack] = useState<ThemeEditorCandidate | null>(null);
  const [packProgress, setPackProgress] = useState<{ done: number; total: number | null } | null>(
    null
  );
  useEffect(() => () => pack?.prepared?.dispose(), [pack]);
  /**
   * The download and the staging, owned until the state above takes them.
   *
   * Closing the viewer mid-download used to orphan a whole staged directory
   * under `Paths.cache`: the cleanup on the effect above had already run --
   * against a `pack` that was still null -- and the `setPack` that arrived
   * afterwards on an unmounted component went nowhere, so the images just
   * decoded themselves onto the disk and stayed there. Nothing ever collected
   * them; `collectThemeAssetGarbage` only sweeps the *installed* directory.
   *
   * The discipline is `ThemeLinkImport`'s, not a second one: a request owns the
   * work, unmount cancels it, `handoff` is the single boundary where ownership
   * moves to whoever disposes next, and the `finally` disposes whenever it did
   * not. `handoff` throws on an aborted signal before it sets its flag, which is
   * what closes the gap between the last check and the assignment.
   */
  const active = useRef<ThemeImportRequest | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.cancel();
      active.current = null;
    };
  }, []);
  async function openPackagedTheme() {
    if (packProgress || active.current) return;
    const request = new ThemeImportRequest();
    active.current = request;
    setError(null);
    setPackProgress({ done: 0, total: asset.size || null });
    let prepared: PreparedThemeAssets | undefined;
    let transferred = false;
    try {
      const bytes = await readAssetBytes(asset, {
        signal: request.signal,
        maxBytes: THEME_LIMITS.packageBytes,
        onProgress: (done, total) => {
          if (mounted.current && !request.signal.aborted) setPackProgress({ done, total });
        },
      });
      const unpacked = unpackTheme(bytes);
      prepared = await prepareThemeAssets(unpacked, { signal: request.signal });
      const candidate = { manifest: unpacked.manifest, prepared };
      request.handoff(() => setPack(candidate));
      transferred = true;
    } catch (failure) {
      // A read this screen itself cancelled is not a failure to report: there is
      // no longer a screen to report it on.
      if (mounted.current && !request.isCanceled)
        setError(describeGatewayFailure(failure, t`Could not open this theme.`).message);
    } finally {
      if (!transferred) prepared?.dispose();
      if (active.current === request) active.current = null;
      if (mounted.current) setPackProgress(null);
    }
  }

  useEffect(() => {
    if (!readable) return;
    let active = true;
    // Closing the viewer, or moving to another file, cancels the read in
    // flight. Without it the download runs to completion into a component that
    // has gone, holding the socket and the bytes for nobody.
    const controller = new AbortController();
    setContent(null);
    setError(null);
    readAssetText(asset, { signal: controller.signal })
      .then((text) => {
        if (active) setContent(text);
      })
      .catch((failure: unknown) => {
        // A read this component itself cancelled is not a failure to report:
        // there is no longer a screen to report it on.
        if (active) {
          setError(describeGatewayFailure(failure, t`Could not open this file.`).message);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [asset, attempt, readable, t]);

  const subtitle = [formatAssetSize(asset.size), relativeTime(asset.modified_unix_ms)]
    .filter(Boolean)
    .join(' · ');

  /**
   * The whole file, to the clipboard.
   *
   * The code viewer virtualizes its lines, so a drag selects within one line
   * and not across the document -- which is the correct trade for a file that
   * can be ten thousand lines long, but it does take away the only way there
   * was to get the text out. This is that way, and it is a better one: nobody
   * was dragging a selection over 200 KB.
   */
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    if (content === null) return;
    void Clipboard.setStringAsync(content).then(() => setCopied(true));
  }, [content]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    // `fade`, not `slide`: a document is opened, not pulled up. The slide read
    // as a half sheet that had stopped short even though the window was always
    // full bleed, and it put this surface in a different category from the
    // image lightbox, which is the same act on the same listing. Both are now
    // full screen and neither travels.
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}>
      {/* Both insets are paid here rather than per body: the fill is on this
          view, so padding it keeps the colour edge to edge while the content
          stays clear of the status bar and the gesture bar.

          `SheetFrame` rather than a flat `colors.background`: this is the one
          themed surface in the app that was painting its own floor, so a pack
          with a `shell.background` had a wallpaper everywhere except here. It
          stays a `Modal` and not a route because it is opened from *inside* the
          files form sheet, where it would be a third subview of a layout that
          lays out two -- the constraint `session-artifacts.tsx:701` records.
          And it keeps square corners and no grabber, for the same reason
          `SheetHandle` draws nothing inside a fullscreen frame: this is a
          full-bleed viewer, not a sheet that can be dragged away, and rounding
          the top of something that fills the screen is a corner over nothing. */}
      <View style={styles.sheet}>
        <SheetFrame tint="background">
          <View style={[styles.sheetColumn, { paddingBottom: insets.bottom }]}>
            {/* SafeAreaView reports zero insets inside a native Modal, so pad from
            the root provider's insets instead.

            `zIndex` and `elevation` are not decoration: the way out of this
            screen lives in here, and it has to stay on top of, and ahead of,
            whatever the body puts on the screen -- including a loading state
            that fills the rest of it. A viewer you cannot leave while it is
            loading is worse than one that fails. */}
            <View style={[styles.headerLayer, { paddingTop: insets.top }]}>
              <View style={styles.header}>
                <View style={styles.headerText}>
                  <Text variant="bodySmall" numberOfLines={1}>
                    {asset.name}
                  </Text>
                  <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                    {subtitle}
                  </Text>
                </View>
                {content ? (
                  <PressableScale
                    accessibilityLabel={t`Copy`}
                    onPress={copy}
                    style={[
                      styles.close,
                      { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
                    ]}>
                    {copied ? (
                      <Check size={18} color={theme.colors.success} />
                    ) : (
                      <Copy size={18} color={theme.colors.text} />
                    )}
                  </PressableScale>
                ) : null}
                <PressableScale
                  accessibilityLabel={t`Close file`}
                  onPress={onClose}
                  style={[
                    styles.close,
                    { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
                  ]}>
                  <X size={18} color={theme.colors.text} />
                </PressableScale>
              </View>
            </View>

            {pack ? (
              <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
                <CustomThemeLibrary
                  key={`${themeDocumentIdentity}:pack`}
                  initialCandidate={pack}
                  detail
                  // The prepared artwork belongs to this screen, which disposes it
                  // when the reader closes the file.
                  ownsPreparedAssets={false}
                  onClosePreview={() => setPack(null)}
                  onPrimaryActionChange={setPrimary}
                />
              </ScrollView>
            ) : previewedThemeDocument === themeDocumentIdentity && themeManifest ? (
              <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
                <CustomThemeLibrary
                  key={themeDocumentIdentity}
                  initialManifest={themeManifest}
                  detail
                  onClosePreview={() => setPreviewedThemeDocument(null)}
                  onPrimaryActionChange={setPrimary}
                />
              </ScrollView>
            ) : (
              <>
                {themeManifest ? (
                  <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
                    <Button
                      testID="asset-preview-theme"
                      onPress={() =>
                        setPreviewedThemeDocument(themeDocumentIdentity)
                      }>{t`Preview`}</Button>
                  </View>
                ) : packaged ? (
                  <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 8 }}>
                    <Button
                      testID="asset-open-theme-package"
                      disabled={Boolean(packProgress)}
                      onPress={() => void openPackagedTheme()}>{t`Preview`}</Button>
                    {packProgress ? (
                      <ThemeImportProgress
                        label={t`Downloading theme`}
                        receivedBytes={packProgress.done}
                        completed={packProgress.done}
                        total={packProgress.total ?? undefined}
                      />
                    ) : null}
                  </View>
                ) : null}
                <AssetBody
                  asset={asset}
                  readable={readable}
                  tooLarge={tooLarge}
                  content={content}
                  error={error}
                  markdownStyle={markdownStyle}
                  onRetry={() => setAttempt((previous) => previous + 1)}
                />
              </>
            )}

            {/* Pinned, for the same reason the detail route pins its own: the
                confirm for a theme sits under a preview and a column of
                appearance settings, and one you have to go looking for is one
                the reader has already decided against. `KeyboardStickyView`
                rather than a plain bar because this viewer is the one place a
                theme is read next to a file: nothing here opens a keyboard
                today, and if something does the button rides above it instead
                of underneath. The column already pays the bottom inset. */}
            {primary ? (
              <KeyboardStickyView offset={{ closed: 0, opened: -insets.bottom }}>
                <View style={styles.themeAction}>
                  <SheetSceneAction
                    // The id belongs to the apply: `theme-document` looks for it
                    // on a theme that is not the current one, and
                    // `custom-themes` presses it and then checks it has gone.
                    testID={primary.applies ? 'theme-apply' : undefined}
                    label={primary.applies ? t`Apply theme` : t`Done`}
                    disabled={primary.disabled}
                    onPress={primary.run}
                  />
                </View>
              </KeyboardStickyView>
            ) : null}
          </View>
        </SheetFrame>
      </View>
    </Modal>
  );
}

function AssetBody({
  asset,
  readable,
  tooLarge,
  content,
  error,
  markdownStyle,
  onRetry,
}: {
  asset: SessionAsset;
  readable: boolean;
  /** Text, but past the size the app will hold; nothing was read. */
  tooLarge: boolean;
  content: string | null;
  error: string | null;
  markdownStyle: ReturnType<typeof createMarkdownStyle>;
  onRetry: () => void;
}) {
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();

  const theme = useThemeTokens();

  /** A markdown file is a document; everything else is code, whatever it is called. */
  const document = asset.kind === 'markdown';

  /**
   * What the highlighted renderer is handed, when it is the one drawing.
   *
   * Source, config, a log, a diff, a `.txt` -- wrapped in one fenced block
   * named after its extension, and highlighted natively. There is no JavaScript
   * tokenizer here and never was: this is the only path in the app that
   * colours code, and above `HIGHLIGHT_MAX_CHARS` it is not the path taken.
   */
  const source = useMemo(() => {
    if (content === null || document || content.length > HIGHLIGHT_MAX_CHARS) return '';
    return fencedFile(content, fenceLanguageForFile(asset.name));
  }, [asset.name, content, document]);

  /**
   * The same file as rows, when it is past the size one native pass can lay
   * out. Built once per file rather than per render: a megabyte is split on
   * newlines exactly once, and `CodeLinesView` reads the result.
   */
  const index = useMemo(() => {
    if (content === null || document || content.length <= HIGHLIGHT_MAX_CHARS) return null;
    return indexTextLines(content);
  }, [content, document]);

  /**
   * The path, for a file the reader has to go and open somewhere else.
   *
   * The header's copy action needs the file's text and a refused file has none,
   * so the one thing worth carrying away is where it is. Same feedback as the
   * header: a word, for as long as a tick lasts there.
   */
  const [pathCopied, setPathCopied] = useState(false);
  const copyPath = useCallback(() => {
    void Clipboard.setStringAsync(asset.path).then(() => setPathCopied(true));
  }, [asset.path]);
  useEffect(() => {
    if (!pathCopied) return;
    const timer = setTimeout(() => setPathCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [pathCopied]);

  // The states of one viewer, and they used to be bare returns: the spinner
  // ceased to exist and a full page of markdown existed, on the same frame. Each branch is now a layer of its own, keyed so React tears the old
  // one down rather than reusing it, and the two overlap for the length of a
  // short fade -- which is what makes a document read as having arrived rather
  // than as having replaced something.
  if (tooLarge) {
    // The one refusal left, and the only one that says a number. It is reached
    // before a byte is read, so what it offers is the way to the file rather
    // than the file: nothing here has the text to put on the clipboard.
    const size = formatAssetSize(asset.size);
    const ceiling = formatAssetSize(MAX_ASSET_TEXT_BYTES);
    return (
      <AssetBodyLayer id="too-large">
        <View style={styles.centerState}>
          <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centerText}>
            {t`This file is ${size}. Muqun opens text files up to ${ceiling}; larger ones stay on the server.`}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted} selectable>
            {asset.path}
          </Text>
          <PressableScale
            testID="asset-copy-path"
            accessibilityLabel={t`Copy path`}
            onPress={copyPath}
            style={[
              styles.retry,
              { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
            ]}>
            <Text variant="caption" color={theme.colors.primary}>
              {pathCopied ? t`Copied` : t`Copy path`}
            </Text>
          </PressableScale>
        </View>
      </AssetBodyLayer>
    );
  }

  if (!readable) {
    return (
      <AssetBodyLayer id="details">
        <AssetDetails asset={asset} />
      </AssetBodyLayer>
    );
  }

  if (error) {
    return (
      <AssetBodyLayer id="error">
        <View style={styles.centerState}>
          <Text variant="bodySmall" color={theme.colors.danger} selectable>
            {error}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted} selectable>
            {asset.path}
          </Text>
          {/* A failure is not a dead end: the read is cheap to repeat and the
              usual cause -- a gateway that went away for a moment -- usually is
              not there on the second ask. Closing is the other way out, and it
              is in the header, which stays above this. */}
          <PressableScale
            accessibilityLabel={t`Try again`}
            onPress={onRetry}
            style={[
              styles.retry,
              { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
            ]}>
            <Text variant="caption" color={theme.colors.primary}>
              <Trans>Try again</Trans>
            </Text>
          </PressableScale>
        </View>
      </AssetBodyLayer>
    );
  }

  if (content === null) {
    return (
      <AssetBodyLayer id="loading">
        {/* `pointerEvents="none"`: a loading state is a statement, not a
            control, and a full-height view that swallows touches while it waits
            is how one turns into a trap.

            Paragraphs rather than a spinner. What is coming is a page of text,
            and a spinner centred in an empty screen says only "wait" -- where
            this says what the wait is for, in the shape and at the position the
            text will land in, so nothing moves when it does. */}
        <View style={styles.skeletonBody} pointerEvents="none">
          <Skeleton variant="text" width="48%" height={20} />
          <Skeleton variant="text" lines={4} height={13} style={styles.skeletonParagraph} />
          <Skeleton variant="text" lines={3} height={13} style={styles.skeletonParagraph} />
          <Skeleton variant="rect" width="100%" height={72} style={styles.skeletonParagraph} />
          <Skeleton variant="text" lines={2} height={13} style={styles.skeletonParagraph} />
        </View>
      </AssetBodyLayer>
    );
  }

  if (!content.trim()) {
    return (
      <AssetBodyLayer id="empty">
        <View style={styles.centerState}>
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            <Trans>This file is empty.</Trans>
          </Text>
        </View>
      </AssetBodyLayer>
    );
  }

  if (document) {
    // A document of any length, a block at a time. A README is one cell; a
    // 300 KB changelog is eighty, and only the ones near the viewport exist.
    return (
      <AssetBodyLayer id="document">
        <MarkdownDocumentView
          testID="asset-document"
          markdown={content}
          markdownStyle={markdownStyle}
          selectionColor={theme.colors.primarySubtle}
        />
      </AssetBodyLayer>
    );
  }

  if (index) {
    // Past the size one native layout pass stays linear at. Rows, numbered,
    // pannable, and on screen in the time it takes to split a string.
    return (
      <AssetBodyLayer id="lines">
        <CodeLinesView
          testID="asset-lines"
          lines={index.lines}
          longest={index.longest}
          markdownStyle={markdownStyle}
          note={t`Too large to highlight — showing plain text.`}
        />
      </AssetBodyLayer>
    );
  }

  return (
    <AssetBodyLayer id="code">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.documentContent}
        showsVerticalScrollIndicator={false}>
        {/* github flavor, and it is doing two jobs here. Tables are a GFM
            extension and the commonmark renderer runs their cells together as
            inline text -- and a fenced block is a component of its own under
            this flavor, with a header naming the language, a copy button, and a
            code pane that scrolls sideways instead of wrapping. Wrapping is
            what breaks the column alignment a log or a diff is read for, so
            that last part is not a detail. Static content, so the streaming
            guidance for commonmark does not apply here. */}
        <EnrichedMarkdownText
          flavor="github"
          markdown={source}
          markdownStyle={markdownStyle}
          containerStyle={styles.markdown}
          selectable
          selectionColor={theme.colors.primarySubtle}
          selectionHandleColor={theme.colors.primary}
          streamingAnimation={false}
          textBreakStrategy="simple"
          md4cFlags={{ latexMath: true }}
          onLinkPress={({ url }) => {
            if (isSafeExternalLink(url)) void Linking.openURL(url);
          }}
        />
      </ScrollView>
    </AssetBodyLayer>
  );
}

/**
 * The wrapper every one of the viewer's states shares.
 *
 * The `key` is what does the work: without it React keeps one host view across
 * the change and neither the exit nor the entrance ever runs, which is exactly
 * how different bodies came to hand over in a single frame.
 */
function AssetBodyLayer({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Animated.View
      key={id}
      entering={fadeIn('short')}
      exiting={fadeOut('micro')}
      style={styles.bodyLayer}>
      {children}
    </Animated.View>
  );
}

/** For a PDF or a binary: say what it is and where it stays, and stop there. */
function AssetDetails({ asset }: { asset: SessionAsset }) {
  const { t } = useLingui();
  const relativeTime = useRelativeTime();

  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const rows: { label: string; value: string }[] = [
    { label: t`Type`, value: asset.mime || asset.kind },
    { label: t`Size`, value: formatAssetSize(asset.size) || t`unknown` },
    { label: t`Modified`, value: relativeTime(asset.modified_unix_ms) || t`unknown` },
    { label: t`Path`, value: asset.path },
  ];

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.detailsContent}>
      <Text variant="bodySmall" color={theme.colors.textMuted}>
        <Trans>No preview for this kind of file. It stays on the server.</Trans>
      </Text>
      <View
        style={[
          styles.detailsCard,
          { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
        ]}>
        {rows.map((row) => (
          <View key={row.label} style={styles.detailsRow}>
            <Text variant="caption" color={theme.colors.textMuted}>
              {row.label}
            </Text>
            <Text variant="caption" selectable style={styles.detailsValue}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
  },
  // The ground fills the sheet; the column inside it pays the bottom inset, so
  // the wallpaper still reaches the gesture bar.
  sheetColumn: {
    flex: 1,
  },
  // Both properties, because they are two different platforms' answer to the
  // same question: `zIndex` orders the layer on iOS, `elevation` is what
  // Android actually draws and hit-tests by.
  headerLayer: {
    zIndex: 1,
    elevation: 1,
  },
  // The bar the theme confirm sits in: the viewer's own gutter, and enough room
  // above the column's bottom inset that the button is not on the edge.
  themeAction: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  documentContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  markdown: {
    width: '100%',
  },
  detailsContent: {
    padding: 16,
    gap: 12,
  },
  detailsCard: {
    borderRadius: 15,
    borderCurve: 'continuous',
    padding: 14,
    gap: 10,
  },
  detailsRow: {
    gap: 2,
  },
  detailsValue: {
    // Paths are long and mid-word breaks are unreadable; let it wrap instead.
    flexShrink: 1,
  },
  bodyLayer: {
    flex: 1,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 24,
  },
  // The refusal is a sentence with two numbers in it, not a label: it wraps,
  // and it reads as prose centred under nothing rather than as a ragged column.
  centerText: {
    textAlign: 'center',
  },
  // The same padding the markdown body uses, so the placeholder lines sit where
  // the paragraphs replacing them will.
  skeletonBody: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  skeletonParagraph: {
    marginTop: 18,
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 17,
    borderCurve: 'continuous',
  },
  // The lightbox's own backdrop, worn early: the loading state opens on the
  // same black the picture will land on, so arrival changes the content and
  // not the room. The close chip copies the lightbox's, for the same reason.
  encryptedLoading: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  encryptedLoadingClose: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.30)',
    zIndex: 1,
    elevation: 1,
  },
});
