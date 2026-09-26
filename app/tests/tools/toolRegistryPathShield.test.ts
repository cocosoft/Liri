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
 * A7 防泄题：**工具分派点的路径屏蔽**（`ToolRegistry.executeTool`）。
 *
 * 核心断言不是"返回了错误"，而是 **工具根本没被执行**（`calls === 0`）—— 拒绝要让"抄答案"
 * 这一步真的不发生，而不仅是事后报错。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ToolRegistry } from '../../src/tools/ToolRegistry';
import type { Tool } from '../../src/tools/types/Tool';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext';
import {
  ENV_SHIELDED_PATHS,
  resetShieldPlanCache,
} from '../../src/tools/pathShield';

const REPO = 'E:\\repo';
const SHIELDED_ABS = `${REPO}\\app\\src\\chat\\services\\bareExplorationStripper.ts`;
const SHIELDED_REL = 'app/src/chat/services/bareExplorationStripper.ts';
/**
 * 对照组用**另一个目录**的文件：屏蔽项会连带其**直接父目录**（有意为之，挡 `grep`/`glob`
 * 按目录批量读）⇒ 同目录文件本就在屏蔽范围内，不能当"无关路径"。
 */
const UNRELATED = `${REPO}\\app\\src\\query\\otherThing.ts`;

const originalEnv = process.env[ENV_SHIELDED_PATHS];

/** 造一个"被执行过几次"可观测的假工具 */
function mkRegistry(counter: { calls: number }): ToolRegistry {
  const registry = new ToolRegistry();
  const fake = {
    name: 'file_read',
    description: 'test double',
    execute: async () => {
      counter.calls += 1;
      return { data: 'read-ok', success: true };
    },
  } as unknown as Tool;
  registry.registerTool(fake);
  return registry;
}

function callRead(
  registry: ToolRegistry,
  filePath: string
): ReturnType<ToolRegistry['executeTool']> {
  return registry.executeTool(
    { toolName: 'file_read', input: { file_path: filePath } },
    { sessionId: 'pathshield-test' } as unknown as ToolUseContext
  );
}

beforeEach(() => {
  process.env.LIRI_PROJECT_DIR = REPO;
  process.env[ENV_SHIELDED_PATHS] = JSON.stringify([SHIELDED_ABS]);
  resetShieldPlanCache();
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_SHIELDED_PATHS];
  else process.env[ENV_SHIELDED_PATHS] = originalEnv;
  resetShieldPlanCache();
});

describe('ToolRegistry 路径屏蔽：命中即拒绝且**不执行工具**', () => {
  test('绝对路径命中 ⇒ success:false + error 指明屏蔽路径 + 工具未执行', async () => {
    const counter = { calls: 0 };
    const result = await callRead(mkRegistry(counter), SHIELDED_ABS);

    expect(result.success).toBe(false);
    expect(result.error).toContain(SHIELDED_ABS);
    expect(counter.calls).toBe(0);
  });

  test('换写法（相对仓库根）同样被拒 —— 挡的是路径而非某种拼法', async () => {
    const counter = { calls: 0 };
    const result = await callRead(mkRegistry(counter), SHIELDED_REL);

    expect(result.success).toBe(false);
    expect(counter.calls).toBe(0);
  });

  test('只读直接父目录（grep/glob 按目录批量读）同样被拒', async () => {
    const counter = { calls: 0 };
    const result = await callRead(
      mkRegistry(counter),
      `${REPO}\\app\\src\\chat\\services`
    );

    expect(result.success).toBe(false);
    expect(counter.calls).toBe(0);
  });

  test('对照组：无关路径不受影响（屏蔽不误伤）', async () => {
    const counter = { calls: 0 };
    const result = await callRead(mkRegistry(counter), UNRELATED);

    expect(counter.calls).toBe(1);
    expect(result.data).toBe('read-ok');
  });

  test('对照组：未设置屏蔽清单 ⇒ **零行为**（普通运行完全不受影响）', async () => {
    delete process.env[ENV_SHIELDED_PATHS];
    resetShieldPlanCache();
    const counter = { calls: 0 };
    const result = await callRead(mkRegistry(counter), SHIELDED_ABS);

    expect(counter.calls).toBe(1);
    expect(result.data).toBe('read-ok');
  });
});
