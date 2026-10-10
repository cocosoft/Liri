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
 * A2A **只读发现面**（① P2，2026-10-10）。
 *
 * 方案：`dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md` §8.1（P2）——
 * 把 `/.well-known/agent-card.json` + 健康探针的**只读**响应从主进程 HTTP 路由中抽出，
 * 使发现面可**独立于主进程**存活。
 *
 * 边界（如实 · 关键）：
 * - 本模块只定义**纯响应**（无 `http` 依赖、无副作用）⇒ 供 sidecar 与测试共用（CS01）。
 * - **不**并入委派/任务端点（那需要 CoreAPI 句柄，属 P3）。
 * - 快照由主进程经 IPC 推送（卡在哪、谁授权仍由主进程决定）。
 */
import type { A2AAgentCard } from '@modules/types/a2a';

/** A2A 规范发现路径（与 `a2a-routes.ts` 同一口径） */
export const DISCOVERY_AGENT_CARD_PATH = '/.well-known/agent-card.json';
/** 独立就绪探针路径（本仓自定，与 `a2a-routes.ts` 同一口径） */
export const DISCOVERY_HEALTH_PATH = '/v1/a2a/health';

/** 主进程推送的只读快照 */
export interface A2ADiscoverySnapshot {
  card: A2AAgentCard;
  etag: string;
  delegatorReady: boolean;
}

/** 纯响应（调用方负责写成 HTTP） */
export interface A2ADiscoveryResult {
  /** `false` ⇒ 非发现面路径（调用方按 404 处理） */
  handled: boolean;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/**
 * 处理一次发现面请求（**纯函数**）。
 *
 * - 非发现面路径 ⇒ `{handled:false, status:404}`
 * - 非 GET ⇒ 405
 * - 快照未就绪（`null`）⇒ 503（**不伪造**卡片）
 * - 卡片：`If-None-Match` 命中 ETag ⇒ 304；否则 200 + `ETag` + 卡片
 * - 健康：200 `{status:'ok', delegatorReady}`
 */
export function handleDiscoveryRequest(input: {
  method: string;
  url: string;
  ifNoneMatch?: string | undefined;
  snapshot: A2ADiscoverySnapshot | null;
}): A2ADiscoveryResult {
  const { method, url, ifNoneMatch, snapshot } = input;
  const isCard = url === DISCOVERY_AGENT_CARD_PATH;
  const isHealth = url === DISCOVERY_HEALTH_PATH;
  if (!isCard && !isHealth) return { handled: false, status: 404 };

  if (method !== 'GET') {
    return {
      handled: true,
      status: 405,
      headers: JSON_HEADERS,
      body: { error: { message: '仅支持 GET' } },
    };
  }

  if (!snapshot) {
    return {
      handled: true,
      status: 503,
      headers: JSON_HEADERS,
      body: { error: { message: '发现面尚未就绪（等待主进程推送快照）' } },
    };
  }

  if (isCard) {
    if (typeof ifNoneMatch === 'string' && ifNoneMatch === snapshot.etag) {
      return { handled: true, status: 304, headers: { ETag: snapshot.etag } };
    }
    return {
      handled: true,
      status: 200,
      headers: { ...JSON_HEADERS, ETag: snapshot.etag },
      body: snapshot.card,
    };
  }

  // health
  return {
    handled: true,
    status: 200,
    headers: JSON_HEADERS,
    body: { status: 'ok', delegatorReady: snapshot.delegatorReady },
  };
}
