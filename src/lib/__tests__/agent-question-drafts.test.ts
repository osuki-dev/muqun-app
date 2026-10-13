import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import {
  declaration,
  productionSource,
  transpile,
  walk,
} from '../../test-support/production-source';
import {
  appendQuestionComposerDraft,
  createQuestionDrafts,
  editQuestionComposerDraft,
  questionComposerText,
  type QuestionComposerDraft,
} from '../agent-question-drafts';
import { parseAgentDomainEvent, type FormRequest } from '../agent-protocol';

const question: FormRequest = {
  id: 'question',
  asid: 'session',
  title: 'Which approach?\nAny constraints?',
  nonblocking: true,
  fields: [{ key: 'answer', title: 'Answer', type: 'string', when: [] }],
};
const owner = 'server/session/connection';

test('composer expiry injector appends only for its owner and never focuses or sends', () => {
  const source = productionSource('src/components/agent-composer.tsx');
  let code = '';
  walk(source.program, (node) => {
    if (node.type === 'AssignmentExpression' && source.code(node.left) === 'injectDraftRef.current')
      code = source.code(node.right);
  });
  expect(code).not.toBe('');
  const appended: string[] = [];
  const inject = runInNewContext(transpile(code), {
    draftOwnerKey: owner,
    appendAnswer: (text: string) => appended.push(text),
  });
  expect(inject('Preserved', { expiredQuestionOwner: owner })).toBe(true);
  expect(inject('Wrong owner', { expiredQuestionOwner: 'another-owner' })).toBe(false);
  expect(appended).toEqual(['Preserved']);
});

test('composer hook hides recovery immediately on navigation and cannot revive it when returning', () => {
  let state: QuestionComposerDraft = { text: '', original: '' };
  const hook = runInNewContext(
    transpile(
      `(${declaration('src/hooks/use-question-composer-draft.ts', 'useQuestionComposerDraft')})`
    ),
    {
      useState: () => [
        state,
        (update: (previous: QuestionComposerDraft) => QuestionComposerDraft) => {
          state = update(state);
        },
      ],
      useEffect: (effect: () => void) => effect(),
      useCallback: (callback: unknown) => callback,
      questionComposerText,
      editQuestionComposerDraft,
      appendQuestionComposerDraft,
    }
  );
  hook(owner).setText('Existing draft');
  hook(owner).appendAnswer('> Question\n\nAnswer');
  expect(hook(owner).text).toBe('Existing draft\n\n> Question\n\nAnswer');
  expect(hook('another-owner').text).toBe('Existing draft');
  expect(hook(owner).text).toBe('Existing draft');
});

test('live expiration event removes callback and hands draft to composer without a send or viewport mutation', () => {
  for (const scenario of ['expired', 'answered', 'legacy', 'other-session', 'navigated'] as const) {
    const drafts = createQuestionDrafts();
    drafts.edit(owner, question, 'answer', 'Unsent answer');
    let forms = [question];
    const injections: unknown[] = [];
    const resolutions: unknown[] = [];
    const environment: Record<string, unknown> = {
      useCallback: (fn: unknown) => fn,
      activeAsid: 'session',
      serverId: 'server',
      gatewayGeneration: 'run-1',
      useInAppNotifications: {
        getState: () => ({ resolveQuestion: (question: unknown) => resolutions.push(question) }),
      },
      activeAsidRef: { current: scenario === 'navigated' ? 'another' : 'session' },
      syncRef: { current: {} },
      advanceSeq: () => ({}),
      questionDrafts: drafts,
      questionDraftOwner: owner,
      injectDraftRef: { current: (...args: unknown[]) => injections.push(args) },
      setForms: (update: (previous: FormRequest[]) => FormRequest[]) => {
        forms = update(forms);
      },
    };
    const source = productionSource('src/components/agent-workbench.tsx');
    let code = '';
    walk(source.program, (node) => {
      if (
        node.type !== 'VariableDeclarator' ||
        node.id.type !== 'Identifier' ||
        node.id.name !== 'handleStreamEvent' ||
        node.init?.type !== 'CallExpression'
      )
        return;
      code = source.code(node.init);
      const dependencies = node.init.arguments[1];
      if (dependencies?.type === 'ArrayExpression')
        for (const dependency of dependencies.elements) {
          if (dependency?.type === 'Identifier' && !(dependency.name in environment))
            environment[dependency.name] = undefined;
        }
    });
    expect(code).not.toBe('');
    const handle = runInNewContext(transpile(code), environment);
    const reason =
      scenario === 'legacy' ? undefined : scenario === 'answered' ? 'answered' : 'expired';
    const event = parseAgentDomainEvent('agent.form.resolved', {
      asid: scenario === 'other-session' ? 'child' : 'session',
      seq: 3,
      form_id: question.id,
      reason,
    });
    handle(event);
    expect(resolutions).toEqual([
      {
        serverId: 'server',
        asid: scenario === 'other-session' ? 'child' : 'session',
        formId: question.id,
        generation: 'run-1',
      },
    ]);
    expect(forms).toEqual(
      scenario === 'other-session' || scenario === 'navigated' ? [question] : []
    );
    expect(injections).toEqual(
      scenario === 'expired'
        ? [
            [
              '> Which approach?\n> Any constraints?\n\nUnsent answer',
              { expiredQuestionOwner: owner },
            ],
          ]
        : []
    );
  }
});

test('turn-end expiry preserves only edited nonblocking answer text, once', () => {
  const drafts = createQuestionDrafts();
  expect(drafts.resolve(owner, 'untouched', 'expired')).toBeUndefined();
  drafts.edit(owner, question, 'answer', 'Keep the current layout');
  expect(drafts.resolve(owner, question.id, 'expired')).toBe(
    '> Which approach?\n> Any constraints?\n\nKeep the current layout'
  );
  expect(drafts.resolve(owner, question.id, 'expired')).toBeUndefined();
  drafts.edit(
    owner,
    { ...question, id: 'blocking', nonblocking: false },
    'answer',
    'Blocking reply'
  );
  expect(drafts.resolve(owner, 'blocking', 'expired')).toBeUndefined();
});

test('accepted answers and uncertain or future resolutions never become ordinary drafts', () => {
  const drafts = createQuestionDrafts();
  for (const reason of ['answered', undefined, 'unknown']) {
    const request = { ...question, id: String(reason) };
    drafts.edit(owner, request, 'answer', 'Already submitted');
    expect(drafts.resolve(owner, request.id, reason)).toBeUndefined();
    drafts.edit(owner, request, 'answer', 'Late input before unmount');
    expect(drafts.resolve(owner, request.id, 'expired')).toBeUndefined();
  }
});

test('route, server, and connection changes cannot recover another owner’s answer', () => {
  for (const next of [
    'server/other-session/connection',
    'other-server/session/connection',
    'server/session/new-connection',
  ]) {
    const drafts = createQuestionDrafts();
    drafts.edit(owner, question, 'answer', 'Private to this question');
    expect(drafts.resolve(next, question.id, 'expired')).toBeUndefined();
    expect(drafts.resolve(owner, question.id, 'expired')).toBeUndefined();
  }
});

test('empty edits erase earlier partial answers and retained form count is bounded', () => {
  const drafts = createQuestionDrafts();
  drafts.edit(owner, question, 'answer', 'partial');
  drafts.edit(owner, question, 'answer', '');
  expect(drafts.resolve(owner, question.id, 'expired')).toBeUndefined();
  for (let i = 0; i < 17; i++) drafts.edit(owner, { ...question, id: String(i) }, 'answer', 'text');
  expect(drafts.resolve(owner, '16', 'expired')).toBeUndefined();
  expect(drafts.resolve(owner, '0', 'expired')).toContain('text');
});

test('existing composer text survives appends and owner changes without receiving expired answers', () => {
  const original = 'My existing draft';
  let draft = { text: original, original };
  draft = appendQuestionComposerDraft(draft, owner, '> First question\n\nPartial answer');
  draft = appendQuestionComposerDraft(draft, owner, '> Second question\n\nAnother answer');
  expect(questionComposerText(draft, owner)).toBe(
    'My existing draft\n\n> First question\n\nPartial answer\n\n> Second question\n\nAnother answer'
  );
  expect(questionComposerText(draft, 'another-owner')).toBe(original);
  draft = editQuestionComposerDraft(draft, 'another-owner', 'New route draft');
  expect(questionComposerText(draft, owner)).toBe('New route draft');
});

test('accepted ordinary send clears the whole recovered draft, while further edits stay scoped', () => {
  const recovered = appendQuestionComposerDraft(
    { text: 'Existing', original: 'Existing' },
    owner,
    '> Question\n\nAnswer'
  );
  const edited = editQuestionComposerDraft(recovered, owner, 'Edited answer');
  expect(questionComposerText(edited, owner)).toBe('Edited answer');
  expect(questionComposerText(edited, 'other-owner')).toBe('Existing');
  const cleared = editQuestionComposerDraft(edited, owner, '');
  expect(questionComposerText(cleared, owner)).toBe('');
  expect(questionComposerText(cleared, 'other-owner')).toBe('');
});
