import * as Clipboard from 'expo-clipboard';
import { Trans, useLingui } from '@lingui/react/macro';
import { Skeleton, Text, useThemeTokens } from '@osuki-dev/ui';
import { Check, Copy, X } from 'lucide-react-native';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { createMarkdownStyle } from '@/components/agent-markdown-output';
import { CodeView } from '@/components/code-view';
import { ImagePreviewModal } from '@/components/image-preview-modal';
import { PressableScale } from '@/components/pressable-scale';
import { formatAssetSize } from '@/lib/asset-display';
import { useLatestRef } from '@/hooks/use-render-refs';
import { useRelativeTime } from '@/hooks/use-relative-time';
import { fadeIn, fadeOut } from '@/lib/motion';
import {
  assetImageSource,
  readAssetImageSource,
  readAssetText,
  type AssetImageSource,
  type SessionAsset,
} from '@/lib/gateway-client';
import { describeGatewayFailure } from '@/lib/network-error';
import { isSafeExternalLink } from '@/lib/safe-link';

/**
 * Read-only view of one artifact the agent produced.
 *
 * Every kind is displayed straight from the gateway rather than copied to a
 * cache file first: an image is fetched by the image library, which sends the
 * bearer token itself and owns the decode and the disk cache, and text is read
 * into a string because that is what the renderer wants anyway. Nothing here
 * holds a whole file in the JS heap except text, which is size-capped by
 * `readAssetText`.
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

/**
 * Where a document stops being rendered as a document.
 *
 * `react-native-enriched-markdown` parses and lays out natively, which is why
 * this sits far above the tokenizer's gate -- but the work still lands in one
 * uninterruptible pass on the frame the text arrives, and past a point it stops
 * being linear. Measured through the app, from the string being in hand to the
 * renderer's first paint, warm (the very first markdown mount of a session
 * costs an extra second on Android whatever the size, so only warm numbers say
 * anything about size):
 *
 *   size        iOS simulator    Android emulator
 *   20 KiB              18 ms              857 ms
 *   60 KiB              18 ms            1_749 ms
 *   200 KiB          5_023 ms            5_999 ms
 *
 * iOS is flat to 60 KiB and then falls off a cliff; Android is expensive
 * throughout and ends in the same place. Five to six seconds is not a slow
 * render, it is the phone not answering, and it is exactly what the report in
 * card #661 described. 64 KiB is the last size measured on the flat part of the
 * curve, and it is comfortably above every document an agent actually writes.
 *
 * Above it the file is shown as its own source through `CodeView`, which
 * virtualizes its lines -- and, since anything over this is also over
 * `HIGHLIGHT_MAX_BYTES`, says in its own caption that this is plain text.
 */
const MARKDOWN_MAX_BYTES = 64 * 1024;

/** Everything that is not an image: a document, some text, or a file we can only describe. */
function AssetSheet({ asset, onClose }: { asset: SessionAsset; onClose: () => void }) {
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
  const markdownStyle = useMemo(() => createMarkdownStyle(theme.colors), [theme.colors]);
  const readable = asset.previewable && (asset.kind === 'markdown' || asset.kind === 'text');
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by "Try again"; the only thing that re-runs the read. */
  const [attempt, setAttempt] = useState(0);

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
          stays clear of the status bar and the gesture bar. */}
      <View
        style={[
          styles.sheet,
          { backgroundColor: theme.colors.background, paddingBottom: insets.bottom },
        ]}>
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
                style={[styles.close, { backgroundColor: theme.colors.surfaceRaised }]}>
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
              style={[styles.close, { backgroundColor: theme.colors.surfaceRaised }]}>
              <X size={18} color={theme.colors.text} />
            </PressableScale>
          </View>
        </View>

        <AssetBody
          asset={asset}
          readable={readable}
          content={content}
          error={error}
          markdownStyle={markdownStyle}
          onRetry={() => setAttempt((previous) => previous + 1)}
        />
      </View>
    </Modal>
  );
}

function AssetBody({
  asset,
  readable,
  content,
  error,
  markdownStyle,
  onRetry,
}: {
  asset: SessionAsset;
  readable: boolean;
  content: string | null;
  error: string | null;
  markdownStyle: ReturnType<typeof createMarkdownStyle>;
  onRetry: () => void;
}) {
  const { t } = useLingui();

  const theme = useThemeTokens();

  // Four states of one viewer, and they used to be four bare returns: the
  // spinner ceased to exist and a full page of markdown existed, on the same
  // frame. Each branch is now a layer of its own, keyed so React tears the old
  // one down rather than reusing it, and the two overlap for the length of a
  // short fade -- which is what makes a document read as having arrived rather
  // than as having replaced something.
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
            style={[styles.retry, { backgroundColor: theme.colors.surfaceRaised }]}>
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

  if (asset.kind === 'markdown' && content.length <= MARKDOWN_MAX_BYTES) {
    return (
      <AssetBodyLayer id="markdown">
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.documentContent}
          showsVerticalScrollIndicator={false}>
          {/* github flavor: tables are a GFM extension and the commonmark
              renderer runs their cells together as inline text. Static content,
              so the streaming guidance for commonmark does not apply here. */}
          <EnrichedMarkdownText
            flavor="github"
            markdown={content}
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

  // Text and code: monospace, coloured by extension, and never wrapped -- a
  // re-wrapped line breaks the column alignment that is the whole point of
  // reading a log or a diff.
  return (
    <AssetBodyLayer id="code">
      <CodeView name={asset.name} content={content} />
    </AssetBodyLayer>
  );
}

/**
 * The wrapper every one of the viewer's four states shares.
 *
 * The `key` is what does the work: without it React keeps one host view across
 * the change and neither the exit nor the entrance ever runs, which is exactly
 * how four different bodies came to hand over in a single frame.
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
      <View style={[styles.detailsCard, { backgroundColor: theme.colors.surfaceRaised }]}>
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
  // Both properties, because they are two different platforms' answer to the
  // same question: `zIndex` orders the layer on iOS, `elevation` is what
  // Android actually draws and hit-tests by.
  headerLayer: {
    zIndex: 1,
    elevation: 1,
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
  codeContent: {
    padding: 16,
    paddingBottom: 40,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 12.5,
    lineHeight: 18,
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
