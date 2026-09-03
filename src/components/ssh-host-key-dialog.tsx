import { Trans, useLingui } from '@lingui/react/macro';
import { Dialog, Input, Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View } from 'react-native';

import type { SshKeyboardInteractiveChallenge } from '@/lib/ssh-client';
import { sanitizeServerText, SERVER_LINE_LIMIT } from '@/lib/ssh-server-text';
import type { SshTrustedHostKey } from '@/lib/ssh-hosts';

/**
 * How long a connect dialog waits for the one before it to be gone.
 *
 * iOS presents one modal at a time and it is unforgiving about the handover: a
 * modal asked to appear while the previous one is still going away never
 * appears at all, and nothing says so. Trusting a host key and then being asked
 * for a one-time code is exactly that sequence -- and against a server on the
 * same machine both happen inside a single frame -- so the sign-in dialog was
 * mounted, rendered, and invisible, and the connection waited forever on a
 * question nobody could see.
 *
 * So the two dialogs hand over through one beat: each records when it left the
 * screen, and the next waits out whatever is left of the beat before it asks to
 * be presented. It is only ever spent between two dialogs of one connection --
 * the reader has just tapped Trust and the handshake is still in flight -- so
 * it costs nothing anyone can perceive. Android stacks dialogs happily and
 * never waits.
 */
const MODAL_HANDOFF_MS = Platform.OS === 'ios' ? 350 : 0;

/** When the last connect dialog left the screen, module-wide. */
let lastDialogClosedAt = 0;

function handoffRemainingMs(): number {
  if (MODAL_HANDOFF_MS === 0 || lastDialogClosedAt === 0) return 0;
  return Math.max(0, MODAL_HANDOFF_MS - (Date.now() - lastDialogClosedAt));
}

/**
 * `false` until the previous connect dialog has had its beat. Render nothing
 * while it is false; see {@link MODAL_HANDOFF_MS}.
 */
function useModalHandoff(): boolean {
  const [ready, setReady] = useState(() => handoffRemainingMs() === 0);
  useEffect(() => {
    const remaining = handoffRemainingMs();
    const timer = remaining > 0 ? setTimeout(() => setReady(true), remaining) : undefined;
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      lastDialogClosedAt = Date.now();
    };
  }, []);
  return ready;
}

/**
 * Trust-on-first-use and its refusal, in one dialog, shared by every screen
 * that opens an SSH connection -- the terminal and the gateway tunnel both.
 *
 * An `unknown` key is shown and asked about; a `mismatch` is refused with the
 * red warning and an explicit "Replace key", the one decision the app must
 * never make on its own. Every string the far side wrote goes through
 * `sanitizeServerText` first, so a hostile server cannot dress its key up as
 * the app's own words.
 */
export function SshHostKeyDialog({
  verdict,
  presented,
  trusted,
  host,
  onResolve,
}: {
  verdict: 'unknown' | 'mismatch';
  presented: SshTrustedHostKey;
  /** The saved key, for the mismatch comparison. */
  trusted?: SshTrustedHostKey;
  host: string;
  onResolve: (accept: boolean) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const ready = useModalHandoff();
  const mismatch = verdict === 'mismatch';
  if (!ready) return null;
  return (
    <Dialog
      visible
      onClose={() => onResolve(false)}
      tone={mismatch ? 'danger' : 'warning'}
      title={mismatch ? t`Host key changed` : t`New host key`}
      message={
        mismatch
          ? t`${host} presented a different key from the one saved for it. This happens after a reinstall, and it also happens when something is intercepting the connection. Do not replace it unless you know why it changed.`
          : t`${host} presented a key this app has not seen before. Compare the fingerprint with the server before trusting it.`
      }
      actionLayout="row"
      actions={[
        { id: 'cancel', label: t`Cancel`, onPress: () => onResolve(false) },
        mismatch
          ? {
              id: 'replace',
              label: t`Replace key`,
              tone: 'destructive',
              onPress: () => onResolve(true),
            }
          : { id: 'trust', label: t`Trust`, tone: 'primary', onPress: () => onResolve(true) },
      ]}>
      <View style={styles.fingerprints}>
        {mismatch && trusted ? (
          <View style={styles.fingerprint}>
            <Text variant="caption" color={theme.colors.textMuted}>
              <Trans>Saved</Trans>
            </Text>
            <Text selectable variant="caption" style={styles.mono}>
              {`${sanitizeServerText(trusted.algorithm, 64)}\n${trusted.fingerprint}`}
            </Text>
          </View>
        ) : null}
        <View style={styles.fingerprint}>
          <Text variant="caption" color={theme.colors.textMuted}>
            {mismatch ? t`Presented now` : t`Fingerprint`}
          </Text>
          <Text selectable variant="caption" style={styles.mono}>
            {`${sanitizeServerText(presented.algorithm, 64)}\n${presented.fingerprint}`}
          </Text>
        </View>
      </View>
    </Dialog>
  );
}

/**
 * The server's own questions -- a name, an instruction, one or more prompts --
 * shown as plain text and cut short. A prompt with nothing left after
 * sanitising is labelled by the app instead, so a field is never unlabelled.
 */
export function SshKeyboardInteractiveDialog({
  challenge,
  onResolve,
}: {
  challenge: SshKeyboardInteractiveChallenge;
  onResolve: (answers: string[] | undefined) => void;
}) {
  const { t } = useLingui();
  const [answers, setAnswers] = useState<string[]>([]);
  const [keyboardUp, setKeyboardUp] = useState(false);
  const ready = useModalHandoff();
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const name = sanitizeServerText(challenge.name, 80);
  const instruction = sanitizeServerText(challenge.instruction);
  const prompts = challenge.prompts.map((item) => ({
    label: sanitizeServerText(item.prompt, SERVER_LINE_LIMIT),
    echo: item.echo === true,
  }));
  // Android draws this dialog behind the soft keyboard, so Continue can end up
  // out of reach, and the system back gesture -- the obvious way to get the
  // keyboard out of the way -- closes the dialog instead, which cancels the
  // sign-in. Two answers: the keyboard's own return key submits, and a close
  // request while the keyboard is up puts the keyboard away rather than
  // abandoning the connection.
  const submit = () => onResolve(prompts.map((_item, index) => answers[index] ?? ''));
  if (!ready) return null;
  return (
    <Dialog
      visible
      onClose={() => {
        if (keyboardUp) {
          Keyboard.dismiss();
          return;
        }
        onResolve(undefined);
      }}
      title={name || t`Sign in`}
      message={instruction || t`The server is asking for more before it lets you in.`}
      actionLayout="row"
      actions={[
        { id: 'cancel', label: t`Cancel`, onPress: () => onResolve(undefined) },
        {
          id: 'submit',
          label: t`Continue`,
          tone: 'primary',
          onPress: submit,
        },
      ]}>
      <View style={styles.prompts}>
        {prompts.map((item, index) => (
          <Input
            key={index}
            label={item.label || t`Answer`}
            value={answers[index] ?? ''}
            onChangeText={(value) =>
              setAnswers((previous) => {
                const next = [...previous];
                next[index] = value;
                return next;
              })
            }
            secureTextEntry={!item.echo}
            autoCapitalize="none"
            autoCorrect={false}
            variant="outline"
            size="compact"
            returnKeyType={index === prompts.length - 1 ? 'go' : 'next'}
            onSubmitEditing={index === prompts.length - 1 ? submit : undefined}
          />
        ))}
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  fingerprints: { gap: 12 },
  fingerprint: { gap: 4 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  prompts: { gap: 10 },
});
