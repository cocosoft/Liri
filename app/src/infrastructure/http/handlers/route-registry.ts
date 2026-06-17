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
 * route-registry.ts — 路由注册表
 *
 * 将 handleRequest 中的 if-else 路由匹配统一为注册表模式，
 * 支持精确匹配和正则匹配，消除巨型 switch/if-else 链。
 */

import type http from 'node:http';
import type { HandlerCtx } from './handler-utils';

/**
 * 路由处理器函数签名
 */
export type RouteHandler = (
  ctx: HandlerCtx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params?: Record<string, string>
) => Promise<void>;

/**
 * 路由条目：匹配规则 + 处理器
 */
interface RouteEntry {
  /** HTTP 方法 */
  method: string;
  /** 匹配模式：精确路径或正则 */
  pattern: string | RegExp;
  /** 处理器 */
  handler: RouteHandler;
}

/**
 * 路由注册表
 * 按注册顺序匹配（先注册先匹配），适合有明确优先级的路由场景
 */
export class RouteRegistry {
  private routes: RouteEntry[] = [];

  /**
   * 注册一个精确路径路由
   */
  register(method: string, path: string, handler: RouteHandler): this {
    this.routes.push({ method, pattern: path, handler });
    return this;
  }

  /**
   * 注册一个正则匹配路由（支持路径参数提取）
   */
  registerPattern(
    method: string,
    pattern: RegExp,
    handler: RouteHandler
  ): this {
    this.routes.push({ method, pattern, handler });
    return this;
  }

  /**
   * 批量注册路由（{method, path, handler}[] 形式）
   */
  registerAll(
    routes: Array<{
      method: string;
      path: string | RegExp;
      handler: RouteHandler;
    }>
  ): this {
    for (const r of routes) {
      this.routes.push({
        method: r.method,
        pattern: r.path,
        handler: r.handler,
      });
    }
    return this;
  }

  /**
   * 匹配并处理请求
   * @returns true 表示已匹配并处理，false 表示未匹配
   */
  async handle(
    ctx: HandlerCtx,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<boolean> {
    const url = req.url?.split('?')[0] || '';
    const method = req.method || 'GET';

    for (const route of this.routes) {
      if (route.method !== method && route.method !== 'ANY') continue;

      if (typeof route.pattern === 'string') {
        if (url === route.pattern) {
          await route.handler(ctx, req, res);
          return true;
        }
      } else {
        const match = url.match(route.pattern);
        if (match) {
          const params: Record<string, string> = {};
          if (match.groups) {
            Object.assign(params, match.groups);
          }
          // 同时填充按索引的捕获组
          for (let i = 1; i < match.length; i++) {
            params[`$${i}`] = match[i];
          }
          await route.handler(ctx, req, res, params);
          return true;
        }
      }
    }

    return false;
  }
}
