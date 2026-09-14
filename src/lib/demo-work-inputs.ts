import { DEMO_PAIRING_SERVER_ID } from './pairing';
import {
  parseTaskInputReceipt,
  taskInputScopeKey,
  type TaskInputReceipt,
  type TaskInputUpload,
  type TaskInputReceiptReader,
  type TaskInputRef,
} from './task-inputs';
import type { PickedFile } from './attachment-queue';
import type { WorkFrozenInput } from './work-api';

// A bundled one-pixel GIF. The demo never reads a device file or sends upload bytes.
const gif = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const uri = `data:image/gif;base64,${gif}`;
const sha256 = '1e85ec81b9800b4c443d39caca0d0926089a3ac201120db1ceb45b93789480b8';
export function pickDemoWorkInput(source: string): Promise<PickedFile[]> {
  return Promise.resolve([
    {
      uri,
      mime: 'image/gif',
      size: 34,
      width: 1,
      height: 1,
      name: source === 'file' ? 'fictional-expired-reference.gif' : 'fictional-reference.gif',
    },
  ]);
}

/** Explicit offline receipt protocol. It does not exercise native multipart or server security. */
export function createDemoWorkInputs(clock = Date.now) {
  let sequence = 1;
  const requests = new Map<string, { signature: string; receipt: TaskInputReceipt }>();
  const inputs = new Map<string, { receipt: TaskInputReceipt; taskId: string | null }>();
  const previouslyExpired = new Set<string>();
  const upload: TaskInputUpload = async (record, scope, key, file, context) => {
    if (!context.isCurrent() || context.signal?.aborted)
      throw new Error('Demo input owner changed');
    if (record.serverId !== DEMO_PAIRING_SERVER_ID || scope.sessionId !== 'demo')
      throw new Error('Demo input scope mismatch');
    taskInputScopeKey(scope);
    if (
      file.uri !== uri ||
      file.mime !== 'image/gif' ||
      !['fictional-reference.gif', 'fictional-expired-reference.gif'].includes(file.name)
    )
      throw new Error('Only bundled fictional demo inputs are available');
    const signature = JSON.stringify([scope.project, file.uri, file.name, file.mime, file.size]);
    const previous = requests.get(key);
    if (previous) {
      if (previous.signature !== signature) throw new Error('Demo request_key_conflict');
      return parseTaskInputReceipt(previous.receipt, scope);
    }
    const expiresImmediately =
      file.name === 'fictional-expired-reference.gif' && !previouslyExpired.has(signature);
    if (expiresImmediately) previouslyExpired.add(signature);
    const current = clock();
    const receipt: TaskInputReceipt = {
      input_id: `d4d30000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
      session_id: scope.sessionId,
      repo_path: scope.project,
      name: file.name,
      mime: file.mime,
      size_bytes: 34,
      sha256,
      created_at_ms: current - 2000,
      expires_at_ms: expiresImmediately ? current - 1 : current + 172800000,
    };
    requests.set(key, { signature, receipt });
    inputs.set(receipt.input_id, { receipt, taskId: null });
    return parseTaskInputReceipt(receipt, scope);
  };
  const read: TaskInputReceiptReader = async (record, scope, key, context) => {
    if (!context.isCurrent() || context.signal?.aborted)
      throw new Error('Demo input owner changed');
    if (record.serverId !== DEMO_PAIRING_SERVER_ID || scope.sessionId !== 'demo')
      throw new Error('Demo input scope mismatch');
    const receipt = requests.get(key)?.receipt;
    return receipt ? parseTaskInputReceipt(receipt, scope) : null;
  };
  function freeze(
    refs: readonly TaskInputRef[],
    project: string,
    taskId: string
  ): WorkFrozenInput[] {
    const seen = new Set<string>();
    const resolved = refs.map((ref) => {
      const input = inputs.get(ref.input_id);
      if (
        !input ||
        input.receipt.repo_path !== project ||
        (input.taskId && input.taskId !== taskId)
      )
        throw new Error('scope_mismatch');
      if (!input.taskId && input.receipt.expires_at_ms <= clock()) throw new Error('input_expired');
      if (seen.has(ref.input_id)) throw new Error('invalid_input');
      seen.add(ref.input_id);
      return { input, ref };
    });
    for (const { input } of resolved) input.taskId = taskId;
    return resolved.map(({ input: { receipt }, ref }) => ({
      ...ref,
      name: receipt.name,
      mime: receipt.mime,
      size_bytes: receipt.size_bytes,
      sha256: receipt.sha256,
    }));
  }
  return { upload, read, freeze };
}
export let demoWorkInputs = createDemoWorkInputs();
export function resetDemoWorkInputs() {
  demoWorkInputs = createDemoWorkInputs();
}
