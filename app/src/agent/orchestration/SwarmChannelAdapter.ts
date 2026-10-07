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
 * SwarmChannelAdapter —— 协作编排端口 · `local-swarm` 通道（**仅形状搬运**）。
 *
 * 规格：`.trae/specs/collaboration-orchestration-port.md` §3（适配器表）。
 *
 * - 引擎 `AgentSwarm` 与 `SwarmExecutor` 均由**构造注入**（adapter **不 `new` 任何引擎**）；
 * - **不实现**重试 / 降级 / 裁剪 / 拓扑推演；
 * - 引擎既有语义护栏 —— **O4 门禁 fail-closed + 正向合取**、**M-13 结果按 task 顺序落位**、
 *   **M-8 worker 用量汇总**、取消短路 —— **原样透传**，不在本适配器内重写或放松。
 * - `goal` / `maxConcurrency` / `signal` 直传 `AgentSwarm.run`。
 */

import type { AgentSwarm, SwarmExecutor } from '@modules/tasks';
import type {
  CollaborationDispatchRequestDto,
  CollaborationDispatchResultDto,
  ICollaborationPort,
} from '@modules/core/spi';

/** 通道标识（可观测值） */
const CHANNEL = 'local-swarm';

export interface SwarmChannelDeps {
  /** swarm 引擎实例（由装配 / 消费方注入） */
  readonly swarm: Pick<AgentSwarm, 'run'>;
  /** worker / verifier / synthesizer 的底层执行器（由装配 / 消费方注入；adapter 不构造） */
  readonly executor: SwarmExecutor;
}

export class SwarmChannelAdapter implements ICollaborationPort {
  constructor(private readonly deps: SwarmChannelDeps) {}

  async listChannels(): Promise<ReadonlyArray<string>> {
    return [CHANNEL];
  }

  async dispatch(
    req: CollaborationDispatchRequestDto
  ): Promise<CollaborationDispatchResultDto | null> {
    const result = await this.deps.swarm.run({
      // unit → SwarmWorkerTask{ id, description: instruction }
      tasks: req.units.map((u) => ({ id: u.id, description: u.instruction })),
      goal: req.goal,
      executor: this.deps.executor,
      // 透传（不裁剪、不改写引擎语义）
      maxConcurrency: req.maxConcurrency,
      signal: req.signal,
    });

    return {
      channel: CHANNEL,
      // workers → outcomes（保序：引擎 M-13 保证顺序 = task 顺序）
      outcomes: result.workers.map((w) => ({
        unitId: w.id,
        ok: w.ok,
        summary: w.output || w.feedback || '',
      })),
      // 通道级整体结论直取引擎的 O4 正向合取结果
      allPassed: result.allPassed,
    };
  }
}
