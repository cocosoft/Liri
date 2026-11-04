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
 * 会话**工作区根列表**的合并口径（纯函数，唯一实现）。
 *
 * 沿革：2026-11-04（方案 §3.6）落在 `chat/services/toolCwdScope`；同日 P0-2 发现
 * `entrypoints/alwaysOnEntry` 也要用同一口径（预置任务真实目标根），而 eslint
 * `module-registry/no-direct-module-import` 禁止入口直连 `chat` 模块 ⇒ 按
 * `pathBoundary` 的同一先例**下沉**到 `utils/toolContract`（infra），避免再写第二份。
 *
 * 口径：`primary`（主工作区，恒在首） + `extra`（`metadata.workspaceRoots`：用户批准
 * 越界申请时追加，见 `runtime/inboxApproval.ts`，写入时已做父子折叠）。去重按
 * "去尾斜杠 + 小写"归一（Windows 大小写不敏感）。
 *
 * 消费方：权限层 `auto-local` 边界（`findWorkspaceEscapeInRoots`）、执行前严格边界
 * （`ToolExecutionService`）、AlwaysOn 会话根预置（`entrypoints/alwaysOnEntry`）。
 * **不得**再各写一份拼接/去重逻辑。
 */
export function mergeWorkspaceRoots(
  primary: string | undefined,
  extra: unknown
): string[] {
  const normalize = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
  const roots: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: unknown): void => {
    if (typeof candidate !== 'string' || !candidate.trim()) return;
    const key = normalize(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(candidate);
  };
  push(primary);
  if (Array.isArray(extra)) for (const root of extra) push(root);
  return roots;
}
