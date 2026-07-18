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
 * 端点测速服务
 * 对标 CC 源码 cc-switch/src-tauri/src/services/speedtest.rs 实现
 *
 * 测试一组 API 端点的响应延迟，含热身请求以避免首包惩罚。
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'ai:providers:speedTestService',
  level: LogLevel.INFO,
});

const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 2000;
const MAX_TIMEOUT_MS = 30000;

/** 端点延迟测试结果 */
export interface EndpointLatency {
  url: string;
  latency?: number;
  status?: number;
  error?: string;
}

/**
 * 测试一组端点的响应延迟
 * 每个端点先发一次热身请求（忽略结果），再发第二次并计时
 */
export async function testEndpoints(
  urls: string[],
  timeoutMs?: number
): Promise<EndpointLatency[]> {
  if (urls.length === 0) {
    return [];
  }

  const timeout = sanitizeTimeout(timeoutMs);
  const results: EndpointLatency[] = [];

  // 并发测试所有端点
  const tasks = urls.map(async (url) => {
    const trimmed = url.trim();
    if (!trimmed) {
      return {
        url,
        latency: undefined,
        status: undefined,
        error: 'URL 不能为空',
      };
    }

    // 验证 URL 格式
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch (err) {
      return {
        url: trimmed,
        latency: undefined,
        status: undefined,
        error: 'URL 无效',
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // 热身请求（不计结果）
      try {
        await fetch(parsedUrl.toString(), {
          method: 'GET',
          signal: AbortSignal.timeout(timeout),
        });
      } catch (err) {
        // 热身请求失败忽略
      }

      // 正式测速请求
      const start = performance.now();
      const resp = await fetch(parsedUrl.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(timeout),
      });
      const latency = Math.round(performance.now() - start);

      return {
        url: trimmed,
        latency,
        status: resp.status,
        error: undefined,
      };
    } catch (err) {
      clearTimeout(timeoutId);

      const msg = err instanceof Error ? err.message : String(err);
      let error: string;

      if (msg.includes('abort') || msg.includes('timeout')) {
        error = '请求超时';
      } else if (msg.includes('fetch')) {
        error = '连接失败';
      } else {
        error = msg;
      }

      return { url: trimmed, latency: undefined, status: undefined, error };
    }
  });

  const taskResults = await Promise.all(tasks);
  results.push(...taskResults);

  // 按延迟排序
  results.sort((a, b) => {
    if (a.latency === undefined && b.latency === undefined) return 0;
    if (a.latency === undefined) return 1;
    if (b.latency === undefined) return -1;
    return a.latency - b.latency;
  });

  return results;
}

/** 规范化超时参数 */
function sanitizeTimeout(ms?: number): number {
  if (ms === undefined) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, ms));
}

/** 格式化测速结果为可读文本 */
export function formatSpeedResults(results: EndpointLatency[]): string {
  if (results.length === 0) {
    return '无端点需要测试';
  }

  const lines = ['端点测速结果', '─'.repeat(60)];

  for (const r of results) {
    let displayUrl = r.url;
    try {
      const u = new URL(r.url);
      displayUrl = `${u.host}${u.pathname}`;
      if (displayUrl.length > 45) {
        displayUrl = displayUrl.substring(0, 42) + '...';
      }
    } catch (err) {
      void handleError(err, { module: 'ai:providers', action: 'catch_error' });
    }

    if (r.error) {
      lines.push(`  ${displayUrl.padEnd(45)} ❌ ${r.error}`);
    } else {
      const latencyStr = r.latency !== undefined ? `${r.latency}ms` : 'N/A';
      const statusStr = r.status ? `HTTP ${r.status}` : '';
      lines.push(
        `  ${displayUrl.padEnd(45)} ✅ ${latencyStr.padStart(8)} ${statusStr}`
      );
    }
  }

  return lines.join('\n');
}

export const SpeedTestService = { testEndpoints, formatSpeedResults };
