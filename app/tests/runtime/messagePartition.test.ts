/**
 * P0-4（2026-11-05）：任务分区消息（PDCA / 后台任务步骤）的判定与过滤。
 *
 * 真机背景：用户会话 `session_mw375o4312e5f31d38` 的 698 条消息里混入 8 条 PRD/FR 步骤消息
 * （`metadata = { taskId: 'pdca_…', isTaskMessage: true }`）⇒ 用户看到"答非所问"，
 * 消息数/轮数/导出一并被污染。本用例锁住**用户面视图**（默认不含任务消息）与
 * **审计视图**（`includeTaskMessages: true` 全量）两种口径。
 */
import { describe, expect, it } from 'bun:test';

import {
  filterTaskPartitionMessages,
  isTaskPartitionMessage,
} from '@openliri/service/runtime/api/messagePartition';

const taskMsg = (id: string) => ({
  id,
  content: 'PRD 步骤',
  metadata: { taskId: 'pdca_demo', isTaskMessage: true },
});
const userMsg = (id: string) => ({
  id,
  content: '帮我做超级玛丽',
  metadata: { model: 'x' },
});
const plainMsg = (id: string) => ({ id, content: '无 metadata' });

describe('P0-4 任务分区消息', () => {
  it('只认结构化标记 isTaskMessage === true', () => {
    expect(isTaskPartitionMessage(taskMsg('a'))).toBe(true);
    expect(isTaskPartitionMessage(userMsg('b'))).toBe(false);
    expect(isTaskPartitionMessage(plainMsg('c'))).toBe(false);
    // 脏值 / 字符串 "true" 不得当标记（CS02：不做字符串匹配）
    expect(
      isTaskPartitionMessage({ metadata: { isTaskMessage: 'true' } })
    ).toBe(false);
    expect(isTaskPartitionMessage({ metadata: { isTaskMessage: false } })).toBe(
      false
    );
    expect(isTaskPartitionMessage({ metadata: null })).toBe(false);
  });

  it('用户面视图（缺省）⇒ 过滤掉任务消息，保留顺序且不改原数组', () => {
    const input = [userMsg('u1'), taskMsg('t1'), plainMsg('p1'), taskMsg('t2')];
    const out = filterTaskPartitionMessages(input);
    expect(out.map((m) => m.id)).toEqual(['u1', 'p1']);
    // 入参不被就地修改（读路径可能复用缓存副本）
    expect(input).toHaveLength(4);
  });

  it('审计视图（includeTaskMessages: true）⇒ 全量返回', () => {
    const input = [userMsg('u1'), taskMsg('t1'), taskMsg('t2')];
    expect(filterTaskPartitionMessages(input, true)).toHaveLength(3);
  });
});
