import { agentRequestErrorDetail } from './agent-request-error';

export const TRANSIENT_TOAST_DURATION_MS = 3000;

type Notice = { variant: 'danger'; title: string; message: string };
type Show = (notice: Notice) => string;
type Dismiss = (id: string) => void;

/** Only this exact parked-history refusal is expected while an explicit prepare is in flight. */
export function isPreparingSessionHistory(error: unknown, preparing: boolean): boolean {
  if (!preparing) return false;
  const detail = agentRequestErrorDetail(error);
  return (
    detail.status === 502 &&
    detail.code === 'agent_error' &&
    (detail.message === 'Explicitly open this conversation to load its native history' ||
      detail.message ===
        'Agent not available: Explicitly open this conversation to load its native history')
  );
}

/** Coalesce concurrent read failures, not future retries or unrelated operations. */
export class SessionReadFeedback {
  private notices = new Map<string, { id: string; message: string; expires: number }>();
  private reader: { scope: string } | null = null;

  constructor(
    private show: Show,
    private dismiss: Dismiss,
    private now: () => number = Date.now
  ) {}

  /** A foreground change replaces the previous reader's notice, not unrelated toasts. */
  activate(scope: string): () => void {
    if (this.reader && this.reader.scope !== scope) this.clear(this.reader.scope);
    const reader = { scope };
    this.reader = reader;
    return () => {
      // A retained screen can clean up after its replacement has already mounted.
      if (this.reader !== reader) return;
      this.reader = null;
      this.clear(scope);
    };
  }

  clear(scope: string): void {
    const previous = this.notices.get(scope);
    if (previous) this.dismiss(previous.id);
    this.notices.delete(scope);
  }

  failed(scope: string, notice: Notice): void {
    const now = this.now();
    for (const [key, entry] of this.notices) {
      if (entry.expires <= now) this.notices.delete(key);
    }
    const previous = this.notices.get(scope);
    if (previous?.message === notice.message) return;
    this.clear(scope);
    this.notices.set(scope, {
      id: this.show(notice),
      message: notice.message,
      expires: now + TRANSIENT_TOAST_DURATION_MS,
    });
    // The provider can outlive many readers; retain only a bounded active window.
    if (this.notices.size > 32) this.notices.delete(this.notices.keys().next().value!);
  }
}

const providers = new WeakMap<Show, SessionReadFeedback>();

/** Retained workbenches sharing a provider also share its active error notices. */
export function sessionReadFeedback(show: Show, dismiss: Dismiss): SessionReadFeedback {
  let feedback = providers.get(show);
  if (!feedback) {
    feedback = new SessionReadFeedback(show, dismiss);
    providers.set(show, feedback);
  }
  return feedback;
}
