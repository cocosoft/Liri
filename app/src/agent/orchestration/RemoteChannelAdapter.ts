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
 * RemoteChannelAdapter —— 协作编排端口 · `remote` 通道（**仅形状搬运**）。
 *
 * 规格：`.trae/specs/collaboration-orchestration-port.md` §3（适配器表）。
 *
 * - 引擎 `RemoteAgentExecutor` 由**构造注入**（adapter **不 `new` 引擎**、**不自动 `connect()`**）；
 * - **可用性门禁**：仅当 `allowRemote === true` **且** 实现侧 `getStatus()` 为 `connected` 时可用；
 *   否则 `dispatch()` 返回 `null`（**不静默降级到本地**，CS03）；
 * - `unit → RemoteAgentTask`：`agentId ← unit.id`、`id ← unit.id`、`description ← unit.instruction`；
 * - **不实现**重试 / 降级 / 裁剪 / 拓扑推演（重连语义由 `RemoteAgentExecutor` 自身承担）。
 */

import type { RemoteAgentExecutor } from '../remote/types';
import type {
  CollaborationDispatchRequestDto,
  CollaborationDispatchResultDto,
  ICollaborationPort,
} from '@modules/core/spi';

/** 通道标识（可观测值） */
const CHANNEL = 'remote';

export interface RemoteChannelDeps {
  /** 远程执行器实例（由装配 / 消费方注入；其连接状态由 `getStatus()` 暴露） */
  readonly executor: Pick<RemoteAgentExecutor, 'execute' | 'getStatus'>;
}

export class RemoteChannelAdapter implements ICollaborationPort {
  constructor(private readonly deps: RemoteChannelDeps) {}

  async listChannels(): Promise<ReadonlyArray<string>> {
    return [CHANNEL];
  }

  async dispatch(
    req: CollaborationDispatchRequestDto
  ): Promise<CollaborationDispatchResultDto | null> {
    // 门禁：显式允许 + 已连接，二者缺一 ⇒ null（不降级到本地）
    if (req.allowRemote !== true) return null;
    if (this.deps.executor.getStatus() !== 'connected') return null;

    const outcomes: Array<{ unitId: string; ok: boolean; summary: string }> =
      [];
    for (const unit of req.units) {
      // unit → RemoteAgentTask（execute 的形参为 Omit<RemoteAgentTask,'agentId'>）
      const r = await this.deps.executor.execute(unit.id, {
        id: unit.id,
        description: unit.instruction,
      });
      outcomes.push({
        unitId: unit.id,
        ok: r.success,
        summary: r.content || r.error || '',
      });
    }

    return {
      channel: CHANNEL,
      outcomes,
      // 实现侧口径：全部单元成功且至少一个单元
      allPassed: outcomes.length > 0 && outcomes.every((o) => o.ok),
    };
  }
}
