import type { FormRequest } from './agent-protocol';

const MAX_DRAFTS = 16;
const MAX_TEXT = 16_384;

/** Only edited, nonblocking answers are retained, within one runtime owner. */
export function createQuestionDrafts() {
  let owner: string | undefined;
  const drafts = new Map<string, { title: string; answers: Map<string, string> }>();
  const resolved = new Set<string>();
  const enter = (next: string) => {
    if (owner !== next) {
      drafts.clear();
      resolved.clear();
      owner = next;
    }
  };
  return {
    enter,
    edit(nextOwner: string, request: FormRequest, field: string, value: unknown) {
      enter(nextOwner);
      if (
        resolved.has(request.id) ||
        !request.nonblocking ||
        !request.fields.some((item) => item.key === field)
      )
        return;
      let draft = drafts.get(request.id);
      if (!draft) {
        if (drafts.size >= MAX_DRAFTS) return;
        draft = { title: request.title.slice(0, MAX_TEXT), answers: new Map() };
        drafts.set(request.id, draft);
      }
      if (typeof value === 'string' && value.trim()) {
        if (draft.answers.has(field) || draft.answers.size < MAX_DRAFTS)
          draft.answers.set(field, value.slice(0, MAX_TEXT));
      } else draft.answers.delete(field);
    },
    resolve(nextOwner: string, id: string, reason?: string): string | undefined {
      enter(nextOwner);
      const draft = drafts.get(id);
      drafts.delete(id);
      resolved.add(id);
      if (resolved.size > 128) {
        const oldest = resolved.values().next().value;
        if (oldest) resolved.delete(oldest);
      }
      if (reason !== 'expired' || !draft?.answers.size) return undefined;
      const quote = draft.title
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      return `${quote}\n\n${[...draft.answers.values()].join('\n\n')}`;
    },
  };
}

export interface QuestionComposerDraft {
  text: string;
  /** Existing ordinary text must survive leaving the recovered answer's owner. */
  original: string;
  owner?: string;
}

export function questionComposerText(draft: QuestionComposerDraft, owner: string): string {
  return draft.owner && draft.owner !== owner ? draft.original : draft.text;
}

export function editQuestionComposerDraft(
  draft: QuestionComposerDraft,
  owner: string,
  text: string
): QuestionComposerDraft {
  if (draft.owner === owner && text) return { ...draft, text };
  return { text, original: text };
}

/** Append without replacing ordinary text, focusing the input, or submitting. */
export function appendQuestionComposerDraft(
  draft: QuestionComposerDraft,
  owner: string,
  answer: string
): QuestionComposerDraft {
  const text = questionComposerText(draft, owner);
  return {
    owner,
    original: draft.owner === owner ? draft.original : text,
    text: text ? `${text}\n\n${answer}` : answer,
  };
}
