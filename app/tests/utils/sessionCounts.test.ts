/**
 * P1-5 / P0-4（2026-11-05）：用户面计数口径（infra 单一事实源）。
 *
 * 口径：`messageCount` = user + assistant（不含 tool/system）；`roundCount` = user；
 * 两者都排除任务分区消息（PDCA 步骤，`metadata.isTaskMessage === true`）。
 */
import { describe, expect, it } from 'bun:test';

import {
  computeConversationCounts,
  isTaskPartitionMessage,
} from '@openliri/infra/utils/sessionCounts';

describe('P1-5 用户面计数口径', () => {
  it('只数 user / assistant，排除 tool 与 system', () => {
    const counts = computeConversationCounts([
      { role: 'user' },
      { role: 'assistant' },
      { role: 'tool' },
      { role: 'system' },
      { role: 'user' },
    ]);
    expect(counts).toEqual({ messageCount: 3, roundCount: 2 });
  });

  it('任务分区消息（PDCA 步骤）不计入用户面计数', () => {
    const task = { role: 'assistant', metadata: { isTaskMessage: true } };
    const counts = computeConversationCounts([
      { role: 'user' },
      { role: 'assistant' },
      task,
    ]);
    expect(counts).toEqual({ messageCount: 2, roundCount: 1 });
    expect(isTaskPartitionMessage(task)).toBe(true);
  });

  it('空 / 缺省 ⇒ 0；脏值不当标记', () => {
    expect(computeConversationCounts(undefined)).toEqual({
      messageCount: 0,
      roundCount: 0,
    });
    expect(computeConversationCounts([])).toEqual({
      messageCount: 0,
      roundCount: 0,
    });
    expect(
      isTaskPartitionMessage({ metadata: { isTaskMessage: 'true' } })
    ).toBe(false);
    expect(isTaskPartitionMessage({ metadata: null })).toBe(false);
  });
});
