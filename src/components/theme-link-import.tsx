import { throwIfThemeAborted } from '@/theme/abort';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Button } from '@/components/themed-button';
import { Input } from '@/components/themed-input';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { prepareThemeAssetStream, type PreparedThemeAssets } from '@/theme/assets';
import type { ThemeAssetProgress } from '@/theme/asset-stream';
import type { ThemeEditorCandidate } from '@/theme/draft-session';
import { inspectThemeLink, themeLinkImportAvailable } from '@/theme/link-import';
import { isGitHubThemeLink, type ThemeLinkInspection } from '@/theme/link-source';
import { normalizeThemeLink } from '@/theme/link-normalize';
import { GitThemeSourceError } from '@/theme/git-source';
import { ThemeImportRequest } from '@/theme/import-request';

/** Inline review, followed by the existing editor. Nothing installs or applies
 * until the editor's explicit confirmation; closing cancels this owned request. */
export function ThemeLinkImport({
  onReady,
  onClose,
}: {
  onReady: (candidate: ThemeEditorCandidate) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const background = useSurfaceBackground();
  const [url, setUrl] = useState('');
  const [review, setReview] = useState<ThemeLinkInspection | null>(null);
  const [revision, setRevision] = useState('');
  const [manifestPath, setManifestPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ThemeAssetProgress | null>(null);
  // Which wait the reader is in. Fetching a manifest reports nothing until it
  // finishes, so without this the whole review step is a blank panel.
  const [stage, setStage] = useState<'inspecting' | 'downloading' | null>(null);
  // A blob/tree link names a branch. Say so, because a branch can move under it.
  const [splitFromLink, setSplitFromLink] = useState(false);
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

  function cancel() {
    active.current?.cancel();
    active.current = null;
    setBusy(false);
    setProgress(null);
    setStage(null);
  }

  async function run(action: (request: ThemeImportRequest) => Promise<void>) {
    if (active.current) return;
    const request = new ThemeImportRequest();
    active.current = request;
    setBusy(true);
    setError(null);
    try {
      await action(request);
    } catch (cause) {
      if (mounted.current && active.current === request && !request.isCanceled)
        setError(
          cause instanceof GitThemeSourceError && cause.code === 'ambiguous-link'
            ? t`Use the repository URL, then enter its branch and theme file below`
            : cause instanceof GitThemeSourceError
              ? t`Check the repository URL, branch and theme file`
              : cause instanceof Error
                ? cause.message
                : t`Something went wrong`
        );
    } finally {
      if (mounted.current && active.current === request) {
        active.current = null;
        setBusy(false);
        setProgress(null);
        setStage(null);
      }
    }
  }

  function inspect() {
    if (!themeLinkImportAvailable) return;
    // Split a branch link into the three fields this screen already shows,
    // rather than telling the reader to do it by hand. The mutable ref stays
    // visible and editable; nothing here widens what the parser accepts.
    const link = normalizeThemeLink(url);
    const nextRevision = link.revision ?? revision;
    const nextManifestPath = link.manifestPath ?? manifestPath;
    if (link.url !== url) setUrl(link.url);
    if (link.revision) setRevision(link.revision);
    if (link.manifestPath) setManifestPath(link.manifestPath);
    setSplitFromLink(Boolean(link.branchFromLink));
    void run(async ({ signal }) => {
      setStage('inspecting');
      const inspection = await inspectThemeLink(link.url, {
        signal,
        revision: nextRevision,
        manifestPath: nextManifestPath,
      });
      throwIfThemeAborted(signal);
      if (mounted.current) setReview(inspection);
    });
  }

  function preview() {
    if (!review) return;
    void run(async (request) => {
      const { signal } = request;
      setStage('downloading');
      let prepared: PreparedThemeAssets | undefined;
      let transferred = false;
      try {
        prepared = await prepareThemeAssetStream(review.manifest, review.assets(signal), {
          signal,
          onProgress(value) {
            if (mounted.current && !signal.aborted) setProgress(value);
          },
        });
        throwIfThemeAborted(signal);
        if (!mounted.current) return;
        const candidate = { manifest: review.manifest, prepared };
        request.handoff(() => onReady(candidate));
        transferred = true;
      } finally {
        if (!transferred) prepared?.dispose();
      }
    });
  }

  return (
    <View testID="theme-link-import" style={{ gap: 12 }}>
      <Input
        label={t`Theme URL`}
        accessibilityLabel={t`Theme URL`}
        testID="theme-link-input"
        variant="outline"
        value={url}
        editable={!busy}
        maxLength={2048}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={() => {
          if (!review) inspect();
        }}
        onChangeText={(value) => {
          cancel();
          setUrl(value);
          setReview(null);
          setError(null);
          setSplitFromLink(false);
        }}
      />
      {splitFromLink ? (
        <Text testID="theme-link-split" selectable variant="caption" color={colors.textMuted}>
          {t`Branch and theme file came from the link. A branch can change later`}
        </Text>
      ) : null}
      {isGitHubThemeLink(url) ? (
        <View style={{ gap: 12 }}>
          <Input
            label={t`Branch or commit (optional)`}
            testID="theme-link-revision"
            variant="outline"
            value={revision}
            editable={!busy}
            maxLength={256}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(value) => {
              cancel();
              setRevision(value);
              setReview(null);
              setError(null);
            }}
          />
          <Input
            label={t`Theme file (optional)`}
            helper={t`Defaults to theme.json at the repository root`}
            testID="theme-link-manifest-path"
            variant="outline"
            value={manifestPath}
            editable={!busy}
            maxLength={512}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(value) => {
              cancel();
              setManifestPath(value);
              setReview(null);
              setError(null);
            }}
          />
        </View>
      ) : null}
      {!themeLinkImportAvailable ? (
        <Text selectable variant="caption" color={colors.textMuted}>
          {t`Update the app to import public theme links. You can still import a file`}
        </Text>
      ) : (
        <Text variant="caption" color={colors.textMuted}>
          {t`Paste a public theme link or GitHub repository`}
        </Text>
      )}
      {review ? (
        <View
          testID="theme-link-review"
          style={{
            gap: 8,
            padding: 12,
            borderRadius: 12,
            backgroundColor: background(colors.surface),
          }}>
          <Text selectable>{review.manifest.name}</Text>
          <Text selectable variant="caption" color={colors.textMuted}>
            {new URL(review.sourceUrl).hostname}
          </Text>
          {review.commit ? (
            <Text selectable testID="theme-link-commit" variant="caption" color={colors.textMuted}>
              {t`Pinned commit`}: {review.commit}
            </Text>
          ) : null}
          {review.resourceDomains.length ? (
            <>
              <Text variant="caption" color={colors.textMuted}>{t`Images download from`}</Text>
              {review.resourceDomains.map((domain) => (
                <Text key={domain} selectable variant="caption">
                  {domain}
                </Text>
              ))}
            </>
          ) : null}
          <Text variant="caption" color={colors.textMuted}>
            {t`Preview first. Your current theme stays unchanged`}
          </Text>
        </View>
      ) : null}
      {stage ? (
        <ThemeImportProgress
          testID="theme-link-progress"
          label={stage === 'inspecting' ? t`Reading the theme link` : t`Preparing images`}
          completed={progress?.completedAssets}
          total={progress?.totalAssets}
          receivedBytes={progress?.receivedBytes}
        />
      ) : null}
      {error ? (
        <Text selectable testID="theme-link-error" accessibilityRole="alert" color={colors.danger}>
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Button
          testID={review ? 'theme-link-preview' : 'theme-link-inspect'}
          disabled={busy || !themeLinkImportAvailable || !url.trim()}
          onPress={review ? preview : inspect}>
          {busy ? t`Loading` : review ? t`Download and preview` : t`Review link`}
        </Button>
        <Button
          variant="ghost"
          testID="theme-link-cancel"
          onPress={() => {
            if (busy) cancel();
            else onClose();
          }}>{t`Cancel`}</Button>
      </View>
    </View>
  );
}
