import { useLingui } from '@lingui/react/macro';
import { Icon, Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { isImageAttachment, type PendingAttachment } from '@/lib/attachments';
import { DURATION, fadeIn, fadeOut, listLayout, zoomIn, zoomOut } from '@/lib/motion';

const TILE_SIZE = 62;

/**
 * The files staged for the next message, above the input.
 *
 * Uploading starts when a file is picked, so by the time the user reaches Send
 * these tiles are the only account of what is ready and what is not. Each one
 * therefore carries its own state and its own retry, which is what lets one
 * failed photo be dealt with without disturbing the rest of the strip.
 */
export function AttachmentStrip({
  attachments,
  onRemove,
  onRetry,
  onPreview,
  textColor,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onPreview: (id: string) => void;
  textColor: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  if (attachments.length === 0) return null;

  /** What the overlay is showing, for anyone who cannot see the overlay. */
  function describeStatus(status: PendingAttachment['status']): string {
    switch (status) {
      case 'pending':
        return t`queued to upload`;
      case 'uploading':
        return t`uploading`;
      case 'done':
        return t`uploaded`;
      case 'error':
        return t`upload failed`;
    }
  }

  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}>
      {attachments.map((attachment) => {
        const failed = attachment.status === 'error';
        const isImage = isImageAttachment(attachment.mime);
        // A tap means retry on a failed tile and preview on anything else worth
        // looking at, so the label has to say which of the two it is.
        const status = describeStatus(attachment.status);
        const label = failed
          ? t`Retry uploading ${attachment.name}`
          : isImage
          ? t`Preview ${attachment.name}, ${status}`
          : `${attachment.name}, ${status}`;

        return (
          // A picked file used to be simply there, and a removed one simply
          // gone, with the tiles to its right jumping into the gap. The tile
          // arrives from small -- it came from a picker that was over this
          // screen a moment ago -- and the rest close the gap rather than
          // teleporting across it.
          <Animated.View
            key={attachment.id}
            entering={zoomIn('short')}
            exiting={zoomOut('micro')}
            layout={listLayout('short')}
            style={styles.tileWrap}>
            <PressableScale
              accessibilityLabel={label}
              disabled={!failed && !isImage}
              pressedScale={0.94}
              onPress={() => (failed ? onRetry(attachment.id) : onPreview(attachment.id))}
              style={[
                styles.tile,
                {
                  backgroundColor: theme.colors.surfaceRaised,
                },
                failed
                  ? { borderColor: theme.colors.danger, borderWidth: StyleSheet.hairlineWidth }
                  : null,
              ]}>
              {isImage ? (
                <Image
                  source={{ uri: attachment.localUri }}
                  style={styles.thumbnail}
                  contentFit="cover"
                  // The decode's own fade. It was 100 ms, which is not a step
                  // on any scale this app uses; `micro` is the token for a
                  // state flip you should barely notice, which is what this is.
                  transition={DURATION.micro}
                />
              ) : (
                <View style={styles.fileTile}>
                  <Icon name="FileText" size={17} color={theme.colors.textMuted} />
                  <Text
                    variant="caption"
                    color={textColor}
                    numberOfLines={2}
                    style={styles.fileName}>
                    {attachment.name}
                  </Text>
                </View>
              )}
              {/* Queued and uploading are separate on purpose: with a pool of
                  three, a nine-photo pick leaves six tiles that are waiting
                  rather than stalled, and a spinner on all nine would say the
                  opposite. */}
              {/* Queued, uploading and failed are three states of one thing, so
                  they hand over rather than cutting: each fades in as the last
                  fades out, and the tile is never briefly bare between them. */}
              {attachment.status === 'pending' ? (
                <Animated.View
                  entering={fadeIn('micro')}
                  exiting={fadeOut('micro')}
                  style={[styles.overlay, styles.busyOverlay]}>
                  <Icon name="Clock" size={16} color="#FFFFFF" />
                </Animated.View>
              ) : null}
              {attachment.status === 'uploading' ? (
                <Animated.View
                  entering={fadeIn('micro')}
                  exiting={fadeOut('micro')}
                  style={[styles.overlay, styles.busyOverlay]}>
                  <Spinner size="sm" color="#FFFFFF" />
                </Animated.View>
              ) : null}
              {failed ? (
                <Animated.View
                  entering={fadeIn('micro')}
                  exiting={fadeOut('micro')}
                  style={[styles.overlay, styles.failedOverlay]}>
                  <Icon name="RotateCcw" size={17} color="#FFFFFF" />
                </Animated.View>
              ) : null}
            </PressableScale>
            {/* Ready is worth its own mark rather than just the absence of an
                overlay, because Send waiting on a tile only makes sense if the
                user can see which tiles it is waiting for. It lands rather than
                appearing: an upload finishing is the one moment in this strip
                worth an arrival beat. */}
            {attachment.status === 'done' ? (
              <Animated.View
                entering={zoomIn('micro')}
                exiting={fadeOut('micro')}
                style={[styles.readyBadge, { backgroundColor: theme.colors.success }]}>
                <Icon name="Check" size={9} color="#FFFFFF" strokeWidth={3} />
              </Animated.View>
            ) : null}
            <PressableScale
              accessibilityLabel={t`Remove ${attachment.name}`}
              hitSlop={6}
              pressedScale={0.9}
              onPress={() => onRemove(attachment.id)}
              style={[styles.remove, { backgroundColor: theme.colors.text }]}>
              <Icon name="X" size={11} color={theme.colors.background} strokeWidth={3} />
            </PressableScale>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: {
    gap: 8,
    paddingHorizontal: 1,
    // Room for the remove button, which overhangs the top-right corner.
    paddingTop: 6,
    paddingRight: 6,
    paddingBottom: 2,
  },
  tileWrap: {
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  fileTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 4,
  },
  fileName: {
    textAlign: 'center',
    fontSize: 9,
    lineHeight: 11,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  failedOverlay: {
    backgroundColor: 'rgba(190, 40, 40, 0.55)',
  },
  readyBadge: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 19,
    height: 19,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
