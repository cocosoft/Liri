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
 * 可观测性模块门面 — 一行声明获得全套可观测能力
 *
 * 统一封装 Logger / HandleError / OTel Span，消除新模块的手动样板接线。
 * 底层全部复用现有唯一入口（getLogger / handleError / getOTelTracing），不重复造轮子。
 */

import { Span, SpanStatusCode } from '@opentelemetry/api';
import { getLogger } from './logs/Logger.js';
import { getOTelTracing } from './otel/OTelTracing.js';
import type { Logger } from './logs/Logger.js';

/**
 * 模块可观测性作用域
 */
export interface ModuleScope {
  /** 模块 Logger（按模块名缓存实例） */
  logger: Logger;
  /** 统一错误处理：自动携带 module 上下文，调用方只需给 action */
  error: (e: unknown, action: string) => Promise<void>;
  /** OTel span 包裹：自动 start/end，异常时标记 SpanStatus.ERROR 并重新抛出 */
  trace: <T>(
    op: string,
    fn: () => Promise<T>,
    attributes?: Record<string, string | number | boolean>
  ) => Promise<T>;
}

/**
 * 创建可观测模块作用域
 *
 * 新模块使用示例：
 *   const m = createModule('chat:lifecycle');
 *   m.logger.info('...');                  → Logger（模块缓存 + JSON）
 *   await m.error(e, 'send');             → handleError（自动填 module）
 *   const r = await m.trace('send', fn);  → OTel span（自动追踪）
 *
 * @param name 模块名（Logger module 字段 + handleError module 上下文）
 */
export function createModule(name: string): ModuleScope {
  const logger = getLogger(name);

  return {
    logger,

    async error(e: unknown, action: string): Promise<void> {
      // 惰性加载：避免 monitoring → error 静态循环依赖（monitoring/index → module → error/handleError → @modules/monitoring）
      const { handleError } = require('@modules/error/handleError') as typeof import('@modules/error/handleError');
      await handleError(e, { module: name, action });
    },

    async trace<T>(
      op: string,
      fn: () => Promise<T>,
      attributes?: Record<string, string | number | boolean>
    ): Promise<T> {
      const tracing = getOTelTracing();
      const span: Span = tracing.startSpan(op, attributes);
      try {
        const result = await fn();
        tracing.endSpan(span, SpanStatusCode.OK);
        return result;
      } catch (e) {
        tracing.endSpan(
          span,
          SpanStatusCode.ERROR,
          e instanceof Error ? e.message : String(e)
        );
        throw e;
      }
    },
  };
}
