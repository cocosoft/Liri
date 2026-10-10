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
 * A2A 发现面 sidecar **生命周期接线**（① P2，2026-10-10）。
 *
 * 由 `LocalHTTPService` 调用：`A2A_DISCOVERY_SIDECAR==='true'` 时拉起独立进程并推送卡片快照；
 * 关闭开关 ⇒ 完全不动作（**默认零行为变更**，发现面仍由主进程路由提供）。
 */
import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import {
  hasA2ADelegator,
  runA2ADelegation,
} from '../handlers/routes/a2a-routes';
import {
  DiscoverySidecarSupervisor,
  isDiscoverySidecarEnabled,
} from './DiscoverySidecarSupervisor';
import type { A2ADiscoverySnapshot } from './discoverySurface';

const logger = getLogger('infra:http:a2a:discoveryLifecycle');

let supervisor: DiscoverySidecarSupervisor | null = null;

/** 卡片对外基址：显式 `A2A_PUBLIC_URL` 优先，否则本机主服务地址（**不硬编码域名**） */
function resolveCardBaseUrl(fallbackPort: number): string {
  const explicit = configManager.env('A2A_PUBLIC_URL')?.trim();
  return explicit || `http://127.0.0.1:${fallbackPort}`;
}

/** 构建只读快照（卡片 + ETag + delegatorReady）；失败 ⇒ null（不启动/不推送假数据） */
async function buildSnapshot(
  baseUrl: string
): Promise<A2ADiscoverySnapshot | null> {
  try {
    const { card, etag } = (await getCoreAPI().getA2APort()).buildCard(baseUrl);
    return { card, etag, delegatorReady: hasA2ADelegator() };
  } catch (err) {
    logger.warn('A2A 发现面快照构建失败 ⇒ 不推送', { error: String(err) });
    return null;
  }
}

/**
 * 若开关打开 ⇒ 拉起发现面 sidecar 并推送快照。失败**不阻断**主流程（回退主进程路由）。
 */
export async function maybeStartDiscoverySidecar(
  fallbackPort: number
): Promise<void> {
  if (!isDiscoverySidecarEnabled()) return;
  if (supervisor) return;
  const sup = new DiscoverySidecarSupervisor({
    // ① P3：委派执行器 —— 在**主进程内核**跑（sidecar 不自建 CoreAPI），经 P1 契约回调用
    delegate: (message, agentId, waitMs) =>
      runA2ADelegation(message, agentId, waitMs),
  });
  try {
    const port = await sup.start();
    supervisor = sup;
    const snapshot = await buildSnapshot(resolveCardBaseUrl(fallbackPort));
    if (snapshot) sup.pushSnapshot(snapshot);
    logger.info('A2A 发现面 sidecar 已接入', { port });
  } catch (err) {
    logger.warn('A2A 发现面 sidecar 启动失败 ⇒ 回退主进程路由', {
      error: String(err),
    });
    sup.stop();
    supervisor = null;
  }
}

/** 停止发现面 sidecar（主进程停止时调用） */
export function stopDiscoverySidecar(): void {
  supervisor?.stop();
  supervisor = null;
}
