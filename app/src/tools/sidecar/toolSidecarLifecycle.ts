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
 * 工具侧车 **生命周期接线**（S1 骨架，Tool Sidecar Isolation）。
 *
 * 由门控点（`tools/utils/ToolManagerUtils.ts` 的侧车 loader 分支）调用：
 * `TOOL_SIDECAR_LSP` 为真才拉起常驻 LSP 侧车；**默认关 ⇒ 完全不动作（零行为变更，不 spawn）**。
 *
 * 参照先例：`infrastructure/http/a2a/discoverySidecarLifecycle.ts`（同形态：开关门控 + 单例 +
 * 失败不阻断主流程）。差异（如实）：本开关用 **feature flag 三级解析**（`feature('TOOL_SIDECAR_LSP')`，
 * 对齐 spec §3-D4），而非 A2A 的裸 env 读取。
 */
import { feature } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import {
  ToolSidecarSupervisor,
  type ToolSidecarDeps,
} from './ToolSidecarSupervisor';

const logger = getLogger('tools:sidecar:lifecycle');

let lspSupervisor: ToolSidecarSupervisor | null = null;

/** 双跑开关：LSP 侧车是否启用（默认关；关 ⇒ 任何启动入口都不 spawn） */
export function isLspSidecarEnabled(): boolean {
  return feature('TOOL_SIDECAR_LSP');
}

/** 当前 LSP 侧车监督器（未启动 ⇒ null） */
export function getLspSidecarSupervisor(): ToolSidecarSupervisor | null {
  return lspSupervisor;
}

/**
 * 若开关打开 ⇒ 拉起 LSP 侧车（单例）。**开关关 ⇒ 立即返回 null（不启动任何侧车进程）**。
 * 启动失败**不阻断**主流程（fail-closed：记 warn + 回收 + 返回 null）。
 */
export async function maybeStartLspSidecar(
  deps: ToolSidecarDeps = {}
): Promise<ToolSidecarSupervisor | null> {
  if (!isLspSidecarEnabled()) return null;
  if (lspSupervisor) return lspSupervisor;
  const sup = new ToolSidecarSupervisor(deps);
  try {
    await sup.start();
    lspSupervisor = sup;
    return sup;
  } catch (err) {
    logger.warn('工具侧车（LSP）启动失败 ⇒ 不启用（fail-closed）', {
      error: String(err),
    });
    sup.stop();
    return null;
  }
}

/** 停止 LSP 侧车（主进程停止时调用） */
export function stopLspSidecar(): void {
  lspSupervisor?.stop();
  lspSupervisor = null;
}
