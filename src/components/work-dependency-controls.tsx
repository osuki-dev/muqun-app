import { useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { WorkTaskRow } from '@/lib/work-summaries';
import { Text } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Button } from './themed-button';
import { LADDER } from './settings-chrome';
import type {
  WorkDependency,
  WorkDependencyIntent,
  WorkDetail,
  WorkRecordPage,
  WorkTask,
} from '@/lib/work-api';
import { relatedDependencyTask, selectWorkDependencyVersion } from '@/lib/work-dependencies';

/** Separate committed dependencies and draft versions. Inspection never changes current task/output. */
export function WorkDependencyControls(props: {
  serverId: string;
  task: WorkTask;
  tasks: readonly WorkTaskRow[];
  connected: boolean;
  capable: boolean;
  pending: boolean;
  onInspect: (taskId: string) => Promise<WorkDetail | null>;
  onMoreResults: (
    taskId: string,
    revision: number,
    afterId: string
  ) => Promise<WorkRecordPage<'result'> | null>;
  onSave: (intent: WorkDependencyIntent) => Promise<void>;
}) {
  const { t } = useLingui();
  const [draft, setDraft] = useState<WorkDependency[]>(() =>
    (props.task.dependencies ?? []).map((item) => ({ ...item }))
  );
  const [inspected, setInspected] = useState<WorkDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  const taskIdentity = useRef(props.task.id);
  useLayoutEffect(() => {
    taskIdentity.current = props.task.id;
    const requests = sequence;
    return () => {
      requests.current++;
    };
  }, [props.task.id]);
  const locked = !props.connected || !props.capable || props.pending || loading;
  async function inspect(id: string) {
    if (locked) return;
    const generation = ++sequence.current;
    const taskId = props.task.id;
    setLoading(true);
    setFailed(false);
    try {
      const value = await props.onInspect(id);
      if (generation === sequence.current && taskIdentity.current === taskId) {
        setInspected(value);
        if (!value) setFailed(true);
      }
    } catch {
      if (generation === sequence.current && taskIdentity.current === taskId) setFailed(true);
    } finally {
      if (generation === sequence.current && taskIdentity.current === taskId) setLoading(false);
    }
  }
  async function more() {
    const page = inspected?.pages?.results;
    if (!inspected || !page?.has_more || !page.next_after_id || locked) return;
    const original = inspected;
    const generation = ++sequence.current;
    const taskId = props.task.id;
    setLoading(true);
    setFailed(false);
    try {
      const result = await props.onMoreResults(
        original.task.id,
        page.snapshot_revision,
        page.next_after_id
      );
      if (generation !== sequence.current || taskIdentity.current !== taskId) return;
      if (!result) {
        setFailed(true);
        return;
      }
      setInspected({
        ...original,
        results: [
          ...original.results,
          ...result.items.filter(
            (item) => !original.results.some((existing) => existing.id === item.id)
          ),
        ],
        pages: { ...original.pages!, results: result.page },
      });
    } catch {
      if (generation === sequence.current && taskIdentity.current === taskId) setFailed(true);
    } finally {
      if (generation === sequence.current && taskIdentity.current === taskId) setLoading(false);
    }
  }
  async function save() {
    if (locked) return;
    setLoading(true);
    setFailed(false);
    const intent = {
      serverId: props.serverId,
      sessionId: props.task.session_id,
      taskId: props.task.id,
      expected_revision: props.task.revision,
      dependencies: draft.map((item) => ({ ...item })),
    };
    try {
      await props.onSave(intent);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }
  if (props.task.parent_task_id === null) return null;
  return (
    <View testID="task-dependency-controls" style={{ gap: LADDER.gap }}>
      <Text>{t`Task dependencies`}</Text>
      <Text variant="caption">{t`Saved dependencies`}</Text>
      {(props.task.dependencies ?? []).map((item) => (
        <View key={item.prerequisite_task_id}>
          <Text selectable variant="caption">
            {item.prerequisite_task_id}
          </Text>
          <Text
            testID={`task-dependency-saved-${item.prerequisite_task_id}`}
            selectable
            variant="caption">
            {item.submission_id ?? t`No result version selected · blocked`}
          </Text>
        </View>
      ))}
      <Text variant="caption">{t`Choose an exact result version. A missing version stays blocked. Saving dependencies never starts an assistant or sends an instruction.`}</Text>
      {!props.capable ? (
        <Text variant="caption">{t`Update this Gateway to edit task dependencies.`}</Text>
      ) : null}
      <Text>{t`Dependency draft`}</Text>
      {draft.map((item) => (
        <View key={item.prerequisite_task_id}>
          <Text selectable variant="caption">
            {item.prerequisite_task_id} ·{' '}
            {item.submission_id ?? t`No result version selected · blocked`}
          </Text>
          <Button
            testID={`task-dependency-remove-${item.prerequisite_task_id}`}
            variant="ghost"
            disabled={locked}
            onPress={() =>
              setDraft(
                draft.filter((entry) => entry.prerequisite_task_id !== item.prerequisite_task_id)
              )
            }>{t`Remove dependency from draft`}</Button>
        </View>
      ))}
      {props.tasks
        .filter((task) => relatedDependencyTask(props.task, task))
        .map((task) => (
          <Button
            key={task.id}
            testID={`task-dependency-inspect-${task.id}`}
            variant="ghost"
            disabled={locked}
            onPress={() => void inspect(task.id)}>
            {`${t`Inspect prerequisite`}: ${task.title}`}
          </Button>
        ))}
      {inspected ? (
        <View testID="task-dependency-inspected" style={{ gap: LADDER.gap }}>
          <Text>{inspected.task.title}</Text>
          <Text selectable variant="caption">
            {inspected.task.id}
          </Text>
          <Button
            testID="task-dependency-without-result"
            variant="ghost"
            disabled={
              locked ||
              (draft.length >= 16 &&
                !draft.some((item) => item.prerequisite_task_id === inspected.task.id))
            }
            onPress={() =>
              setDraft(selectWorkDependencyVersion(props.task, inspected, null, draft))
            }>{t`Add prerequisite without a result version`}</Button>
          {inspected.results.map((result) => (
            <View key={result.id} style={{ gap: LADDER.tight }}>
              <Text selectable variant="caption">
                {result.id}
              </Text>
              <Text>{result.summary}</Text>
              {result.evidence.map((evidence, index) => (
                <Text key={index} variant="caption">
                  {evidence}
                </Text>
              ))}
              <Button
                testID={`task-dependency-result-${result.id}`}
                variant="ghost"
                disabled={
                  locked ||
                  (draft.length >= 16 &&
                    !draft.some((item) => item.prerequisite_task_id === inspected.task.id))
                }
                onPress={() =>
                  setDraft(selectWorkDependencyVersion(props.task, inspected, result.id, draft))
                }>{t`Use this exact result version`}</Button>
            </View>
          ))}
          {inspected.pages?.results.has_more ? (
            <Button
              testID="task-dependency-more-results"
              variant="ghost"
              disabled={locked}
              onPress={() => void more()}>{t`Load more results`}</Button>
          ) : null}
        </View>
      ) : null}
      <Button
        testID="task-dependency-save"
        disabled={locked}
        onPress={() => void save()}>{t`Save dependency versions`}</Button>
      {failed ? (
        <Text
          variant="caption"
          colorKey="danger">{t`Dependency details changed or could not be saved. Inspect the task again before continuing.`}</Text>
      ) : null}
    </View>
  );
}
