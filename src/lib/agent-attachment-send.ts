export interface AgentAttachmentSendRequest {
  isCurrent: () => boolean;
  send: (
    text: string,
    attachments: string[],
    delivery?: 'steer' | 'queue'
  ) => Promise<boolean | void>;
}

/** Keep the draft until submission settles, without treating ACK as a canonical message. */
export async function deliverAgentAttachmentPrompt(
  request: AgentAttachmentSendRequest,
  text: string,
  awaitUploads: () => Promise<string[] | null>,
  onAcknowledged: () => void,
  delivery?: 'steer' | 'queue'
): Promise<'accepted' | 'rejected' | 'upload-failed' | 'obsolete'> {
  if (!request.isCurrent()) return 'obsolete';
  const paths = await awaitUploads();
  if (!request.isCurrent()) return 'obsolete';
  if (!paths?.length) return 'upload-failed';
  const accepted = await request.send(text, paths, delivery);
  if (!request.isCurrent()) return 'obsolete';
  if (accepted === false) return 'rejected';
  onAcknowledged();
  return 'accepted';
}
