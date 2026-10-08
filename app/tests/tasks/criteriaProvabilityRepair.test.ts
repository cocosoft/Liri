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
 * 验收标准**可证性纠偏**的接线守卫（2026-10-08，方案1 全面修复）。
 *
 * 断言 `executePlanPhase` 的**实际行为**（不只是纯函数）：
 * ① planner 首轮给出**不可证**条目 ⇒ **重问一次**（executor 被调 2 次）并采用纠正后的可证版本；
 * ② planner 首轮即全部可证 ⇒ **不重问**（executor 仅 1 次，零额外开销）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LongRunningTaskOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';

// 隔离落盘目录：计划 + PDCA checkpoint 均写临时目录，避免污染用户数据
taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-criteria-')));
const dataDir = mkdtempSync(join(tmpdir(), 'pdca-criteria-'));
process.env.LIRI_DATA_DIR = dataDir;

afterAll(async () => {
  const { closePdcaCheckpointStore } =
    await import('../../src/tasks/PdcaWorkItemBridge');
  closePdcaCheckpointStore();
  delete process.env.LIRI_DATA_DIR;
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // @ignore-catch 临时目录清理失败不影响测试结论
  }
});

const UNPROVABLE_PLAN = JSON.stringify({
  steps: ['在目标目录创建文件 a.txt 并写入 prov1'],
  acceptanceCriteria: ['文件严格 6 字节且 UTF-8 无 BOM'],
});
const PROVABLE_PLAN = JSON.stringify({
  steps: ['在目标目录创建文件 a.txt 并写入 prov1'],
  acceptanceCriteria: ['file_read 读取 a.txt 返回内容等于 prov1'],
});

describe('验收标准可证性：命中即纠正一次（executePlanPhase 接线）', () => {
  it('首轮含不可证条目 ⇒ 重问一次并采用可证版本', async () => {
    const prompts: string[] = [];
    const orchestrator = new LongRunningTaskOrchestrator(
      'criteria-repair-test',
      async (params) => {
        prompts.push(params.userPrompt);
        return prompts.length === 1 ? UNPROVABLE_PLAN : PROVABLE_PLAN;
      }
    );

    const plan = await orchestrator.executePlanPhase(
      '创建文件 a.txt',
      'session-criteria-repair'
    );

    expect(prompts.length).toBe(2);
    expect(plan.steps[0].acceptanceCriteria).toBe(
      'file_read 读取 a.txt 返回内容等于 prov1'
    );
    // 纠正提示词必须**点名**不合格条目（不静默丢弃）
    expect(prompts[1]).toContain('严格 6 字节');
  });

  it('首轮即可证 ⇒ 不重问（零额外模型调用）', async () => {
    const prompts: string[] = [];
    const orchestrator = new LongRunningTaskOrchestrator(
      'criteria-nofix-test',
      async (params) => {
        prompts.push(params.userPrompt);
        return PROVABLE_PLAN;
      }
    );

    const plan = await orchestrator.executePlanPhase(
      '创建文件 a.txt',
      'session-criteria-nofix'
    );

    expect(prompts.length).toBe(1);
    expect(plan.steps[0].acceptanceCriteria).toBe(
      'file_read 读取 a.txt 返回内容等于 prov1'
    );
  });
});
