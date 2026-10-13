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
 * 媒体侧车 **生命周期接线**（S5/T5.1；Tool Sidecar Isolation）。
 *
 * `TOOL_SIDECAR_MEDIA` 为真才拉起常驻媒体侧车；**默认关 ⇒ 完全不动作（零行为变更，不 spawn）**。
 * 复用 **S1/S3 已验证**的 `ToolSidecarSupervisor`（握手/心跳/崩溃结算/有界重启/停止），
 * 仅覆盖脚本路径为 `./mediaSidecar.ts`（**不自造**生命周期）。
 *
 * 参照先例：`toolSidecarLifecycle.ts`（LSP）与 `infrastructure/http/a2a/discoverySidecarLifecycle.ts`
 * （同形态：开关门控 + 单例 + 失败不阻断主流程）。
 */
import { fileURLToPath } from 'node:url';
import { feature } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import {
  ToolSidecarSupervisor,
  type ToolSidecarDeps,
} from './ToolSidecarSupervisor';

const logger = getLogger('tools:sidecar:media-lifecycle');

let mediaSupervisor: ToolSidecarSupervisor | null = null;

/** 双跑开关：媒体侧车是否启用（默认关；关 ⇒ 任何启动入口都不 spawn） */
export function isMediaSidecarEnabled(): boolean {
  return feature('TOOL_SIDECAR_MEDIA');
}

/** 当前媒体侧车监督器（未启动 ⇒ null） */
export function getMediaSidecarSupervisor(): ToolSidecarSupervisor | null {
  return mediaSupervisor;
}

/**
 * 若开关打开 ⇒ 拉起媒体侧车（单例）。**开关关 ⇒ 立即返回 null（不启动任何侧车进程）**。
 * 启动失败**不阻断**主流程（fail-closed：记 warn + 回收 + 返回 null）。
 */
export async function maybeStartMediaSidecar(
  deps: ToolSidecarDeps = {}
): Promise<ToolSidecarSupervisor | null> {
  if (!isMediaSidecarEnabled()) return null;
  if (mediaSupervisor) return mediaSupervisor;
  const sup = new ToolSidecarSupervisor({
    scriptPath: fileURLToPath(new URL('./mediaSidecar.ts', import.meta.url)),
    ...deps,
  });
  try {
    await sup.start();
    mediaSupervisor = sup;
    return sup;
  } catch (err) {
    logger.warn('工具侧车（媒体）启动失败 ⇒ 不启用（fail-closed）', {
      error: String(err),
    });
    sup.stop();
    return null;
  }
}

/** 停止媒体侧车（主进程停止时调用） */
export function stopMediaSidecar(): void {
  mediaSupervisor?.stop();
  mediaSupervisor = null;
}
