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
 * SchedulerChannelAdapter —— 协作编排端口 · `local-scheduler` 通道（**仅形状搬运**）。
 *
 * 规格：`.trae/specs/collaboration-orchestration-port.md` §3（适配器表）。
 *
 * - 引擎 `ParallelAgentScheduler` 由**构造注入**（adapter **不 `new` 引擎**）；
 * - `unit → ScheduledAgentTask`（按该类型**真实字段**映射，**不新增字段**）：
 *   `agentId ← unit.id`、`description ← unit.instruction`、`prompt ← unit.instruction`；
 * - 引擎的结果顺序即输入顺序（DTO 不含 `priority` ⇒ 全部默认 0 ⇒ 稳定排序）⇒
 *   `ScheduledTaskResult[] → outcomes` **保序**；
 * - **不实现**重试 / 降级 / 裁剪 / 拓扑推演；引擎的并发（信号量）与超时控制原样保留。
 */

import type { ParallelAgentScheduler } from '../moa/ParallelAgentScheduler';
import type {
  CollaborationDispatchRequestDto,
  CollaborationDispatchResultDto,
  ICollaborationPort,
} from '@modules/core/spi';

/** 通道标识（可观测值） */
const CHANNEL = 'local-scheduler';

export interface SchedulerChannelDeps {
  /** 调度器实例（由装配 / 消费方注入，其 `executor` 由构造方自行持有） */
  readonly scheduler: Pick<ParallelAgentScheduler, 'executeAll'>;
}

export class SchedulerChannelAdapter implements ICollaborationPort {
  constructor(private readonly deps: SchedulerChannelDeps) {}

  async listChannels(): Promise<ReadonlyArray<string>> {
    return [CHANNEL];
  }

  async dispatch(
    req: CollaborationDispatchRequestDto
  ): Promise<CollaborationDispatchResultDto | null> {
    const result = await this.deps.scheduler.executeAll(
      // unit → ScheduledAgentTask（仅填该类型真实字段，不新增）
      req.units.map((u) => ({
        agentId: u.id,
        description: u.instruction,
        prompt: u.instruction,
      }))
    );

    return {
      channel: CHANNEL,
      // ScheduledTaskResult[] → outcomes（保序）
      outcomes: result.results.map((r) => ({
        unitId: r.agentId,
        ok: r.success,
        summary: r.content || r.error || '',
      })),
      // 实现侧口径：空批次不判全通过（同 swarm 基数守卫口径）
      allPassed:
        result.results.length > 0 &&
        result.completedCount === result.results.length,
    };
  }
}
