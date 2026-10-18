import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import {
  appendQuestionComposerDraft,
  editQuestionComposerDraft,
  questionComposerText,
  type QuestionComposerDraft,
} from '@/lib/agent-question-drafts';

export function useQuestionComposerDraft(owner: string) {
  const [draft, setDraft] = useState<QuestionComposerDraft>({ text: '', original: '' });
  const text = questionComposerText(draft, owner);
  useEffect(() => {
    setDraft((previous) =>
      previous.owner && previous.owner !== owner
        ? { text: previous.original, original: previous.original }
        : previous
    );
  }, [owner]);
  const setText = useCallback(
    (update: SetStateAction<string>) => {
      setDraft((previous) =>
        editQuestionComposerDraft(
          previous,
          owner,
          typeof update === 'function' ? update(questionComposerText(previous, owner)) : update
        )
      );
    },
    [owner]
  );
  const appendAnswer = useCallback(
    (answer: string) => {
      setDraft((previous) => appendQuestionComposerDraft(previous, owner, answer));
    },
    [owner]
  );
  return { text, setText, appendAnswer };
}
