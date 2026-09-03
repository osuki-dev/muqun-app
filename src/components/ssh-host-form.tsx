import { Trans, useLingui } from '@lingui/react/macro';
import { Input, SegmentedControl, Text, Textarea, useThemeTokens, useToast } from '@osuki-dev/ui';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { feedback } from '@/lib/feedback';
import { describeSshFailure, generateSshKeyPair, inspectSshPrivateKey } from '@/lib/ssh-client';
import { sshFailureLine } from '@/lib/ssh-server-text';
import {
  EMPTY_SSH_HOST_DRAFT,
  sshHostDraftFrom,
  validateSshHostDraft,
  type SshCredential,
  type SshHostDraft,
  type SshHostDraftError,
  type SshHostDraftField,
  type SshHostRecord,
} from '@/lib/ssh-hosts';
import { useSshHostsStore } from '@/stores/ssh-hosts';

/**
 * Add or edit one SSH host.
 *
 * One form for both, because the facts are the same; what differs is that an
 * edit never shows the stored secret and leaving the secret blank keeps it.
 * A private key is checked by the native library before it is saved -- a key
 * that cannot be parsed, or a passphrase that does not open it, is an error on
 * the field rather than a failed connection later -- and the app can mint an
 * Ed25519 key of its own, showing the public half to paste into the server's
 * `authorized_keys`.
 */
export function SshHostForm({ record, onDone }: { record: SshHostRecord | null; onDone: () => void }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const addHost = useSshHostsStore((state) => state.addHost);
  const updateHost = useSshHostsStore((state) => state.updateHost);
  const removeHost = useSshHostsStore((state) => state.removeHost);

  const [draft, setDraft] = useState<SshHostDraft>(() =>
    record ? sshHostDraftFrom(record) : EMPTY_SSH_HOST_DRAFT
  );
  const [errors, setErrors] = useState<Partial<Record<SshHostDraftField, string>>>({});
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [removeArmed, setRemoveArmed] = useState(false);

  function patch(changes: Partial<SshHostDraft>) {
    setDraft((previous) => ({ ...previous, ...changes }));
    const touched = Object.keys(changes) as SshHostDraftField[];
    if (touched.some((field) => errors[field])) {
      setErrors((previous) => {
        const next = { ...previous };
        for (const field of touched) delete next[field];
        return next;
      });
    }
  }

  function describe(error: SshHostDraftError): string {
    return error === 'required' ? t`Required.` : t`Not valid.`;
  }

  async function save() {
    const editing = record !== null;
    const result = validateSshHostDraft(draft, { requireSecret: !editing });
    if (!result.ok) {
      const next: Partial<Record<SshHostDraftField, string>> = {};
      for (const [field, error] of Object.entries(result.errors)) {
        next[field as SshHostDraftField] = describe(error);
      }
      setErrors(next);
      return;
    }
    const { value } = result;

    let credential: SshCredential | undefined;
    if (value.authType === 'keyboardInteractive') {
      // Nothing to store; the server asks its questions on the shell screen.
      credential = { type: 'keyboardInteractive' };
    } else if (value.authType === 'password' && value.password) {
      credential = { type: 'password', password: value.password };
    } else if (value.authType === 'privateKey' && value.privateKey) {
      try {
        inspectSshPrivateKey(value.privateKey, value.passphrase || undefined);
      } catch (error) {
        const failure = describeSshFailure(error);
        setErrors({ privateKey: t`The key could not be read (${failure.code}). Check the key and its passphrase.` });
        return;
      }
      credential = value.passphrase
        ? { type: 'privateKey', privateKey: value.privateKey, passphrase: value.passphrase }
        : { type: 'privateKey', privateKey: value.privateKey };
    } else if (editing && record.auth.type !== value.authType) {
      // Switched the method without supplying the new secret.
      setErrors(value.authType === 'password' ? { password: describe('required') } : { privateKey: describe('required') });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateHost(record.id, { ...value, credential });
      } else if (credential) {
        await addHost({ ...value, credential });
      }
      await feedback('success');
      onDone();
    } catch (error) {
      setSaving(false);
      showToast({
        variant: 'danger',
        title: t`Could not save host`,
        message: error instanceof Error ? error.message : t`Its details could not be written to secure storage.`,
      });
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const pair = await generateSshKeyPair({
        type: 'ed25519',
        comment: 'muqun',
        passphrase: draft.passphrase || undefined,
      });
      patch({ privateKey: pair.privateKey });
      setPublicKey(pair.publicKey);
    } catch (error) {
      showToast({
        variant: 'danger',
        title: t`Could not generate a key`,
        message: sshFailureLine(describeSshFailure(error)),
      });
    } finally {
      setGenerating(false);
    }
  }

  async function copyPublicKey() {
    if (!publicKey) return;
    await Clipboard.setStringAsync(publicKey);
    await feedback('success');
    showToast({ variant: 'success', message: t`Public key copied` });
  }

  async function remove() {
    if (!record) return;
    if (!removeArmed) {
      setRemoveArmed(true);
      return;
    }
    setSaving(true);
    try {
      await removeHost(record.id);
      await feedback('success');
      onDone();
    } catch (error) {
      setSaving(false);
      showToast({
        variant: 'danger',
        title: t`Could not remove host`,
        message: error instanceof Error ? error.message : t`Its details could not be removed from secure storage.`,
      });
    }
  }

  const keyAuth = draft.authType === 'privateKey';

  return (
    <View style={[styles.card, { backgroundColor: theme.colors.surface }]}>
      <Input
        label={t`Name`}
        value={draft.label}
        onChangeText={(value) => patch({ label: value })}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="next"
        error={errors.label}
        variant="outline"
        size="compact"
      />
      <View style={styles.addressRow}>
        <View style={styles.hostField}>
          <Input
            label={t`Host`}
            value={draft.host}
            onChangeText={(value) => patch({ host: value })}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="next"
            error={errors.host}
            variant="outline"
            size="compact"
            testID="ssh-host-input"
          />
        </View>
        <View style={styles.portField}>
          <Input
            label={t`Port`}
            value={draft.port}
            onChangeText={(value) => patch({ port: value })}
            keyboardType="number-pad"
            returnKeyType="next"
            error={errors.port}
            variant="outline"
            size="compact"
            testID="ssh-port-input"
          />
        </View>
      </View>
      <Input
        label={t`Username`}
        value={draft.username}
        onChangeText={(value) => patch({ username: value })}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        error={errors.username}
        variant="outline"
        size="compact"
        testID="ssh-username-input"
      />

      <View style={styles.field}>
        <Text variant="caption" color={theme.colors.textMuted}>
          <Trans>Sign in with</Trans>
        </Text>
        <SegmentedControl
          value={draft.authType}
          onChange={(value) =>
            patch({
              authType:
                value === 'privateKey' ? 'privateKey' : value === 'keyboardInteractive' ? 'keyboardInteractive' : 'password',
            })
          }
          options={[
            { label: t`Password`, value: 'password' },
            { label: t`Private key`, value: 'privateKey' },
            { label: t`Ask each time`, value: 'keyboardInteractive' },
          ]}
        />
      </View>

      {keyAuth ? (
        <>
          <Textarea
            label={record ? t`Private key (leave blank to keep the saved one)` : t`Private key`}
            value={draft.privateKey}
            onChangeText={(value) => patch({ privateKey: value })}
            autoCapitalize="none"
            autoCorrect={false}
            minRows={4}
            maxRows={8}
            error={errors.privateKey}
            style={styles.mono}
            testID="ssh-private-key-input"
          />
          <Input
            label={t`Passphrase (optional)`}
            value={draft.passphrase}
            onChangeText={(value) => patch({ passphrase: value })}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            variant="outline"
            size="compact"
          />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Generate an Ed25519 key`}
            disabled={generating || saving}
            onPress={() => void generate()}
            style={[styles.secondaryButton, { backgroundColor: theme.colors.surfaceRaised }]}>
            <Text variant="caption" color={theme.colors.text}>
              {generating ? t`Generating…` : t`Generate an Ed25519 key`}
            </Text>
          </PressableScale>
          {publicKey ? (
            <View style={[styles.publicKey, { backgroundColor: theme.colors.primarySubtle }]}>
              <Text variant="caption" color={theme.colors.textMuted}>
                <Trans>Add this line to ~/.ssh/authorized_keys on the server:</Trans>
              </Text>
              <Text selectable variant="caption" style={styles.mono}>
                {publicKey}
              </Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Copy the public key`}
                onPress={() => void copyPublicKey()}
                style={[styles.secondaryButton, { backgroundColor: theme.colors.surface }]}>
                <Text variant="caption" color={theme.colors.text}>
                  <Trans>Copy public key</Trans>
                </Text>
              </PressableScale>
            </View>
          ) : null}
        </>
      ) : draft.authType === 'keyboardInteractive' ? (
        <Text variant="caption" color={theme.colors.textMuted}>
          <Trans>
            The server asks its own questions when you connect, a password or a one-time code, and nothing is
            stored on this device.
          </Trans>
        </Text>
      ) : (
        <Input
          label={record ? t`Password (leave blank to keep the saved one)` : t`Password`}
          value={draft.password}
          onChangeText={(value) => patch({ password: value })}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          error={errors.password}
          variant="outline"
          size="compact"
          testID="ssh-password-input"
        />
      )}

      <Text variant="caption" color={theme.colors.textMuted}>
        <Trans>Passwords and keys are sealed in the keychain on this device and never leave it.</Trans>
      </Text>

      <View style={styles.buttons}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Cancel`}
          disabled={saving}
          onPress={onDone}
          style={[styles.button, { backgroundColor: theme.colors.surfaceRaised }]}>
          <Text variant="caption" color={theme.colors.textMuted}>
            <Trans>Cancel</Trans>
          </Text>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={record ? t`Save changes to ${record.label}` : t`Save host`}
          feedback="selection"
          disabled={saving}
          onPress={() => void save()}
          style={[styles.button, { backgroundColor: theme.colors.primary }]}>
          <Text variant="caption" color={theme.colors.onPrimary}>
            {saving ? t`Saving…` : t`Save`}
          </Text>
        </PressableScale>
      </View>

      {record ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={removeArmed ? t`Confirm removing ${record.label}` : t`Remove ${record.label}`}
          disabled={saving}
          onPress={() => void remove()}
          style={[
            styles.button,
            { backgroundColor: removeArmed ? theme.colors.danger : theme.colors.dangerSubtle },
          ]}>
          <Text variant="caption" color={removeArmed ? theme.colors.onPrimary : theme.colors.danger}>
            {removeArmed ? t`Tap again to remove` : t`Remove host`}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 14,
    padding: 16,
    borderRadius: appChrome.radius.noticeCard,
    borderCurve: 'continuous',
  },
  addressRow: {
    flexDirection: 'row',
    gap: 10,
  },
  hostField: {
    flex: 1,
  },
  portField: {
    width: 96,
  },
  field: {
    gap: 8,
  },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  publicKey: {
    gap: 8,
    padding: 12,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    minHeight: 44,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButton: {
    minHeight: 40,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
});
