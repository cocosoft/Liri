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
 * A7 防泄题：**真实沙箱端到端**（opt-in，默认 skip）。
 *
 * 为什么单独一个 opt-in 用例：它要**真的启动一个 daemon**（独立端口 + DB 快照 + 凭据副本），
 * 耗时与磁盘开销明显，不适合塞进日常全量门禁；但它是唯一能证明"环境变量 → daemon →
 * 工具执行层真的拒绝"这条链**在真实进程里成立**的证据（单元用例只证明判据本身）。
 *
 * 运行方式（**零模型调用**：只打工具执行 HTTP 端点，不触发对话/模型）：
 * ```
 * PERMISSION_SHIELD_E2E=1 bun test tests/evals/pathShieldSandboxE2E.test.ts
 * ```
 * 覆盖的收口是 **HTTP/CoreAPI 路径**（`/v1/tools/:name/execute → CoreAPIImpl.executeTool →
 * ToolManager.executeTool`）；Agent 路径（`ToolRegistry.executeTool`）由
 * `tests/tools/toolRegistryPathShield.test.ts` 覆盖。
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveDbPath, resolvePyappHome } from '@modules/core/paths';
import { createSandbox } from '../../src/evals/sandbox';
import { resolveEvalRepoRoot } from '../../src/evals/sourceTask';

const ENABLED = process.env.PERMISSION_SHIELD_E2E === '1';

/**
 * 取文件开头 60 字的 **JSON 转义**形式（去掉包裹引号）。
 * 工具结果经 `JSON.stringify` 序列化 ⇒ 换行是 `\n` 两字符，直接用原文比对必然假失败。
 */
function jsonEscapedHead(absPath: string): string {
  return JSON.stringify(readFileSync(absPath, 'utf-8').slice(0, 60)).slice(1, -1);
}

interface ToolInfoLike {
  name: string;
  enabled?: boolean;
  parameters?: { properties?: Record<string, unknown> };
}

/**
 * 找到"读文件"类工具及其路径参数名。
 *
 * 不写死工具名：实测本仓注册名是 **`file_read`**（而 `constants/tools.ts` 的
 * `FILE_READ_TOOL_NAME` 是 `'Read'` —— 二者不一致，已在台账记录，故这里以**运行时列表**为准）。
 * 参数名同理：schema 里能取到就用它，取不到回落到 `file_path`（本仓读文件工具的历史参数名）。
 */
function pickReadTool(
  tools: readonly ToolInfoLike[]
): { name: string; argKey: string } | null {
  const candidates = tools.filter(
    (t) => t.enabled !== false && /read/i.test(t.name)
  );
  const chosen =
    candidates.find((t) => t.name === 'file_read') ?? candidates[0];
  if (!chosen) return null;
  const props = chosen.parameters?.properties ?? {};
  const argKey =
    ['file_path', 'path', 'filePath', 'file'].find((k) => k in props) ??
    'file_path';
  return { name: chosen.name, argKey };
}

async function callTool(
  baseUrl: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<{
  success?: boolean;
  error?: string | null;
  result?: unknown;
  data?: unknown;
}> {
  const res = await fetch(`${baseUrl}/v1/tools/${encodeURIComponent(toolName)}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'shield-e2e', arguments: args }),
    signal: AbortSignal.timeout(30_000),
  });
  return (await res.json()) as {
    success?: boolean;
    error?: string | null;
    result?: unknown;
    data?: unknown;
  };
}

describe('A7 防泄题：真实沙箱端到端（HTTP 工具执行路径）', () => {
  test.skipIf(!ENABLED)(
    '真实 daemon：被屏蔽路径的读取被拒（工具未执行）；无关路径正常',
    async () => {
      const repoRoot = resolveEvalRepoRoot();
      const shieldedAbs = resolve(
        repoRoot,
        'app/src/chat/services/bareExplorationStripper.ts'
      );
      const harmless = resolve(repoRoot, 'app/package.json');
      // 前置：两个路径都必须真实存在，否则"拒绝"可能只是因为文件不存在（假绿）
      expect(existsSync(shieldedAbs)).toBe(true);
      expect(existsSync(harmless)).toBe(true);

      const sandbox = await createSandbox({
        repoRoot,
        realDbPath: resolveDbPath(),
        realHome: resolvePyappHome(),
        shieldedPaths: [shieldedAbs],
      });
      try {
        // 沙箱确实接受了屏蔽清单（对应 cli 的 fail-closed 校验）
        expect(sandbox.shieldedPaths).toEqual([shieldedAbs]);

        const tools = (await (
          await fetch(`${sandbox.baseUrl}/v1/tools`, {
            signal: AbortSignal.timeout(15_000),
          })
        ).json()) as ToolInfoLike[];
        // 诊断信息（本用例是 opt-in 手工验证，输出直接可见；不做"发现失败即失败"的强断言——
        // 工具可能**懒加载**未列出，故回落到本仓注册常量名，随后用**对照组**证明工具确实可用）
        console.log(
          `[e2e] /v1/tools 返回 ${tools.length} 个：${tools
            .slice(0, 30)
            .map((t) => t.name)
            .join(',')}`
        );
        // 运行时列表为空（工具懒加载）时的保底名：实测注册名就是 `file_read`
        // （`constants/tools.ts` 的 `FILE_READ_TOOL_NAME='Read'` 与之不一致 ⇒ 已记台账）
        const readTool = pickReadTool(tools) ?? {
          name: 'file_read',
          argKey: 'file_path',
        };
        console.log(`[e2e] 使用工具=${readTool.name} 参数名=${readTool.argKey}`);

        // ① 命中屏蔽 ⇒ 拒绝，且原因指明被屏蔽路径
        const blocked = await callTool(sandbox.baseUrl, readTool.name, {
          [readTool.argKey]: shieldedAbs,
        });
        expect(blocked.success).toBe(false);
        expect(String(blocked.error)).toContain(shieldedAbs);
        // 拒绝结果里**不得**出现该文件的真实内容（防"拒绝了却仍回带内容"）。
        // 注意比对**转义后**的形式：ToolResult 序列化成 JSON，换行是 `\n` 两字符。
        const escapedHead = jsonEscapedHead(shieldedAbs);
        expect(escapedHead.length).toBeGreaterThan(0);
        expect(JSON.stringify(blocked)).not.toContain(escapedHead);

        // ② 对照组：无关路径照常可读 —— 它**同时证明"该工具确实存在且可用"**，
        //    从而排除"① 的失败只是因为工具名不存在"这一假绿来源。
        const allowed = await callTool(sandbox.baseUrl, readTool.name, {
          [readTool.argKey]: harmless,
        });
        if (!allowed.success) {
          console.log(
            `[e2e] 对照失败响应：${JSON.stringify(allowed).slice(0, 400)}`
          );
        }
        expect(allowed.success).toBe(true);
      } finally {
        await sandbox.stop();
        // 沙箱内含**真实凭据副本** ⇒ 必须物理删除，不能只停进程
        try {
          rmSync(sandbox.root, { recursive: true, force: true });
        } catch {
          // @ignore-catch: 清理失败不影响本用例结论（路径已打印在断言失败信息里）
        }
      }
    },
    180_000
  );

  test.skipIf(!ENABLED)(
    '因果对照：**不带**屏蔽清单的真实 daemon ⇒ 同一路径可读（证明拒绝确由屏蔽引起）',
    async () => {
      const repoRoot = resolveEvalRepoRoot();
      const shieldedAbs = resolve(
        repoRoot,
        'app/src/chat/services/bareExplorationStripper.ts'
      );
      expect(existsSync(shieldedAbs)).toBe(true);

      // 关键差异只有一处：不给 shieldedPaths
      const sandbox = await createSandbox({
        repoRoot,
        realDbPath: resolveDbPath(),
        realHome: resolvePyappHome(),
      });
      try {
        expect(sandbox.shieldedPaths).toEqual([]);
        const tools = (await (
          await fetch(`${sandbox.baseUrl}/v1/tools`, {
            signal: AbortSignal.timeout(15_000),
          })
        ).json()) as ToolInfoLike[];
        const readTool = pickReadTool(tools);
        expect(readTool).not.toBeNull();
        if (!readTool) return;

        const read = await callTool(sandbox.baseUrl, readTool.name, {
          [readTool.argKey]: shieldedAbs,
        });
        if (!read.success) {
          console.log(`[e2e] 对照组失败响应：${JSON.stringify(read).slice(0, 400)}`);
        }
        // 读到原文件内容 ⇒ 证明"前一个用例的拒绝"确实来自屏蔽，而非工具/路径本身不可用
        expect(read.success).toBe(true);
        expect(JSON.stringify(read)).toContain(jsonEscapedHead(shieldedAbs));
      } finally {
        await sandbox.stop();
        try {
          rmSync(sandbox.root, { recursive: true, force: true });
        } catch {
          // @ignore-catch: 清理失败不影响本用例结论
        }
      }
    },
    180_000
  );
});
