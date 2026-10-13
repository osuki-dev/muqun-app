import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { PdfView, type PdfErrorCode } from 'react-native-better-pdf';
import { Text } from '@/components/text';
import { PressableScale } from '@/components/pressable-scale';
import { readAssetBytes, type SessionAsset } from '@/lib/gateway-client';
import { AudioPlaybackError } from '@/lib/audio-playback-session';
import { formatAssetSize } from '@/lib/asset-display';
import { FILE_CONTENT_LIMIT } from '@/lib/media-limits';
import { PdfPreviewSession, PdfPreviewTooLargeError } from '@/lib/pdf-preview-session';

let fileSequence = 0;
function createPreviewFile() {
  return new File(Paths.cache, `pdf-preview-${Date.now()}-${fileSequence++}.pdf`);
}
type Failure = PdfErrorCode | 'too-large' | 'gateway-unsupported' | 'download';

function downloadFailure(error: unknown): Failure {
  if (
    error instanceof PdfPreviewTooLargeError ||
    (error instanceof Error && error.message.startsWith('HTTP 413:'))
  )
    return 'too-large';
  if (error instanceof AudioPlaybackError) return 'gateway-unsupported';
  return 'download';
}

/** The surrounding AssetViewer owns the header, save action and system back. */
export function PdfAssetPreview({ asset }: { asset: SessionAsset }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <PdfReader
      key={`${asset.id}:${asset.modified_unix_ms}:${attempt}`}
      asset={asset}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function PdfReader({ asset, onRetry }: { asset: SessionAsset; onRetry: () => void }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [uri, setUri] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const pageLabel = (page: number | string, pageCount: number | string) =>
    t`Page ${page} of ${pageCount}`;
  useEffect(() => {
    let active = true;
    const file = createPreviewFile();
    const session = new PdfPreviewSession(
      {
        uri: file.uri,
        // Gateway credentials and encrypted transport stay in our client. The
        // native renderer only ever receives an app-owned file:// URI.
        read: (signal, maxBytes) => readAssetBytes(asset, { signal, maxBytes, download: true }),
        write: (bytes) => {
          file.create();
          file.write(bytes);
        },
        remove: () => {
          if (file.exists) file.delete();
        },
      },
      asset.size
    );
    void session.prepare().then(
      (localUri) => {
        if (active) setUri(localUri);
      },
      (error: unknown) => {
        if (active) setFailure(downloadFailure(error));
      }
    );
    return () => {
      active = false;
      session.close();
    };
  }, [asset]);

  const ceiling = formatAssetSize(FILE_CONTENT_LIMIT);
  const message =
    failure === 'too-large'
      ? t`PDF preview supports files up to ${ceiling}. Open this file on your computer.`
      : failure === 'gateway-unsupported'
        ? t`Update the Gateway to open or save this file.`
        : failure === 'password-required' || failure === 'invalid-password'
          ? t`This PDF is password-protected. Save it to open with a PDF reader.`
          : failure === 'invalid-pdf' || failure === 'unsupported-pdf'
            ? t`This PDF cannot be previewed. Save it to open with a PDF reader.`
            : t`Could not open this PDF.`;
  const retryable =
    failure === 'download' || failure === 'page-render-failed' || failure === 'out-of-memory';
  return (
    <View style={styles.body} testID="pdf-asset-preview">
      {failure ? (
        <View style={styles.center} testID="pdf-preview-error">
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            {message}
          </Text>
          {retryable ? (
            <PressableScale accessibilityRole="button" onPress={onRetry} style={styles.retry}>
              <Text color={theme.colors.primary}>{t`Try again`}</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : (
        <>
          {uri ? (
            <PdfView
              source={{ uri }}
              fitPolicy="width"
              pageAccessibilityLabel={pageLabel('{page}', '{pageCount}')}
              enableFormFilling={false}
              style={[styles.body, { backgroundColor: theme.colors.surface }]}
              onLoad={(event) => setPageCount(event.pageCount)}
              onPageChange={(event) => {
                setPage(event.page + 1);
                setPageCount(event.pageCount);
              }}
              onError={(error) => setFailure(error.code)}
            />
          ) : null}
          {pageCount > 0 ? (
            <Text
              variant="caption"
              color={theme.colors.textMuted}
              style={styles.position}
              testID="pdf-page-position">
              {pageLabel(page, pageCount)}
            </Text>
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.center]} testID="pdf-preview-loading">
              <ActivityIndicator color={theme.colors.primary} accessibilityLabel={t`Loading`} />
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  position: { textAlign: 'center', paddingVertical: 8 },
  retry: { padding: 12 },
});
