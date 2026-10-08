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
 * GrepTool 重复搜索短路 —— **不得伪造"零命中"**（2026-10-08 真机暴露）。
 *
 * 现象：同一搜索键在 60s 窗口内重复调用时，原实现返回 `matches: [] / matchCount: 0`
 * （**并未真的搜**），而下游（模型 / 审查）把它读作"零命中"这一**否定性证据** ——
 * 长程任务实测（`pdca_muz6lxv4` step_2）：两次 `grep liri` 全被短路 ⇒ 审查判
 * `major: grep 未真正执行、无命中证据` ⇒ 步骤 failed。
 * 现短路时回**上次的真实结果**，并保留 `skipped: true`（表示本次未重新执行）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrepTool } from '../../../src/tools/GrepTool/GrepTool';
import type { ToolUseContext } from '../../../src/tools/types/Tool';

const dir = mkdtempSync(join(tmpdir(), 'grep-dup-short-'));

afterAll(() => {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // @ignore-catch 临时目录清理失败不影响测试结论
  }
});

describe('GrepTool 重复搜索短路：不得伪造空结果', () => {
  it('第二次同键搜索 skipped=true 且沿用上次真实命中（matchCount 不为 0）', async () => {
    writeFileSync(join(dir, 'a.txt'), 'needle_dup_token\n', 'utf-8');
    const tool = new GrepTool();
    const ctx = { options: { cwd: dir } } as unknown as ToolUseContext;
    const input = {
      pattern: 'needle_dup_token',
      searchPath: dir,
      outputMode: 'content',
    };

    const first = (await tool.execute(input, ctx)).data as {
      matchCount: number;
      skipped: boolean;
    };
    expect(first.matchCount).toBeGreaterThan(0);
    expect(first.skipped).toBe(false);

    const second = (await tool.execute(input, ctx)).data as {
      matchCount: number;
      skipped: boolean;
    };
    // 短路语义保留（本次未重新执行）
    expect(second.skipped).toBe(true);
    // 关键：不得把"未搜索"呈现为"零命中"这一否定性证据
    expect(second.matchCount).toBe(first.matchCount);
    expect(second.matchCount).toBeGreaterThan(0);
  });
});
