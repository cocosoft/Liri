// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 2026-10-20：编排历史对**蜂群/并行批次**的落盘回归。
 *
 * 修复前的事实：蜂群批次由 `swarmPath` 以 `PARALLEL_START/END` 发布（`SWARM_*` 三兄弟无发布方），
 * 而历史适配器白名单只收 `SWARM_*`、且 `extractItemId` 认不出 `PARALLEL_*` 载荷
 * ⇒ **SSE 时间线有、历史落盘没有**。本测试锁定修复后的两个不变量：
 * ① 带 `sessionId` ⇒ 起止两条都落进该会话的历史；
 * ② 不带 `sessionId` ⇒ 不落盘（无法归因，宁缺不臆造 —— CS06）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { globalEventBus } from '@openliri/kernel/events/EventBus';
import { OrchestrationHistoryAdapter } from '../../src/infrastructure/http/handlers/OrchestrationHistoryAdapter';
import { OrchestrationEventType } from '../../src/types/orchestrationEvents';

const PARALLEL_START_PAYLOAD = {
  agentId: 'agent-1',
  sessionId: 'sess-1',
  totalTasks: 1,
  tasks: [{ description: 't1' }],
};

const PARALLEL_END_PAYLOAD = {
  agentId: 'agent-1',
  sessionId: 'sess-1',
  totalTasks: 1,
  completedTasks: 1,
  failedTasks: 0,
  cancelledTasks: 0,
  cancelledFact: false,
};

describe('编排历史 · 蜂群批次落盘（2026-10-20）', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function startAdapter(): {
    adapter: OrchestrationHistoryAdapter;
    itemDir: string;
  } {
    const root = mkdtempSync(join(tmpdir(), 'orch-hist-'));
    roots.push(root);
    const adapter = new OrchestrationHistoryAdapter();
    adapter.start(root);
    return { adapter, itemDir: join(root, 'workitems') };
  }

  it('带 sessionId ⇒ PARALLEL_START/END 均落进该会话历史', async () => {
    const { adapter, itemDir } = startAdapter();
    try {
      globalEventBus.publish(
        OrchestrationEventType.PARALLEL_START,
        PARALLEL_START_PAYLOAD
      );
      globalEventBus.publish(
        OrchestrationEventType.PARALLEL_END,
        PARALLEL_END_PAYLOAD
      );
      await Promise.resolve();

      const result = adapter.query(itemDir, 'sess-1', undefined, 10);
      expect(result.events.map((e) => e.eventType)).toEqual([
        OrchestrationEventType.PARALLEL_START,
        OrchestrationEventType.PARALLEL_END,
      ]);
    } finally {
      adapter.stop();
    }
  });

  it('缺 sessionId ⇒ 不落盘（无法归因，宁缺不臆造）', async () => {
    const { adapter, itemDir } = startAdapter();
    try {
      globalEventBus.publish(OrchestrationEventType.PARALLEL_START, {
        agentId: 'agent-1',
        totalTasks: 0,
        tasks: [],
      });
      await Promise.resolve();

      const result = adapter.query(itemDir, 'sess-1', undefined, 10);
      expect(result.events).toEqual([]);
    } finally {
      adapter.stop();
    }
  });
});
