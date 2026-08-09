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
 * 模型管理 REST API 共享辅助函数
 *
 * 由各子域 API（ProviderAPI / PricingAPI / ModelAPI / ModelRuntimeAPI /
 * ConfigAPI / CapabilitiesAPI / TranslateAPI）共用，避免重复实现。
 */

import type http from 'http';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('ai:model-api');

/** 解析请求 body */
export async function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        // @ignore-catch: 请求 body JSON 解析失败，非关键操作
        logger.warning('请求 body JSON 解析失败', {
          error: (err as Error).message,
        });
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

/** 发送 JSON 响应 */
export function sendJson(
  res: http.ServerResponse,
  data: unknown,
  status = 200
): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** 发送错误响应 */
export function sendError(
  res: http.ServerResponse,
  message: string,
  status = 400
): void {
  sendJson(res, { error: { message } }, status);
}

/** 路由处理器签名 */
export type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  match: RegExpMatchArray | null
) => Promise<void>;

/**
 * 解析秒级时间参数：前端 getDateRange 产生毫秒，model_usage_logs.timestamp 为秒。
 * 统一在 HTTP 边界转秒，避免时间过滤失效（与 usagestats 命令的秒级约定一致）。
 */
export function parseSecondsParam(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const v = parseInt(raw, 10);
  return Number.isNaN(v) ? undefined : Math.floor(v / 1000);
}
