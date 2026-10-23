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
 * OTel Tracing SPI 接口
 *
 * 与 `./LoggerService.ts` **同构**：core 层只声明所需的最小抽象，不引用 monitoring 层实现；
 * 实现在 `registerOTelSpi()`（组合根缝）内**动态导入**后注册，故不产生静态跨层依赖。
 *
 * 存在理由（台账 D-69 / spec `error-handler-core-sink.md`）：`handleError` 需在 core 侧
 * 记录 OTel span 异常，而其原实现直接 import monitoring 层 ⇒ 构成 `core -> infra` 倒挂。
 * 经本 SPI 取值后，core 侧只依赖本文件（core），倒挂消除。
 *
 * 使用方式（core 侧）：
 *   const tracing = resolveOTelTracing();
 *   const span = tracing.getActiveSpan();
 */

import { context, trace, SpanStatusCode, type Span } from '@opentelemetry/api';

/**
 * Span 最小契约
 *
 * 直接复用 OTel 官方 `Span` 类型（**外部库**，非项目分层 —— core 侧已有先例：
 * `core/events/EventBusOTelBridge.ts` 即从 `@opentelemetry/api` 取 `Span`）。
 *
 * 为什么不另造结构接口：`Span.addEvent` 在官方类型里是**函数属性**，受 `strictFunctionTypes`
 * 逆变校验约束，自造的宽签名（`Record<string, unknown>`）会导致上层 `OTelTracing`
 * **无法结构化满足**（实测 `TS2322`）⇒ 直接用官方类型既准确又免去断言。
 */

/** Tracing 最小契约（core 侧实际使用的能力） */
export interface IOTelTracing {
  /** 当前活跃 span（无则 undefined） */
  getActiveSpan(): Span | undefined;
  /** 在指定 span 上记录异常 */
  recordError(span: Span, error: Error): void;
  /**
   * 该父 span 下是否已创建过同名子 span（防同一父下重复建 span）
   *
   * 2026-09-30（台账 D-70 Phase 2）：`core/events/EventBusOTelBridge.ts` 需要
   * monitoring 侧 `SpanCoverageRegistry` 的这两个判据；其实现在 monitoring 内持有
   * **模块级状态**（`spanCoverageMap`）⇒ 不可下沉 core（会分裂状态）⇒ 经本 SPI 暴露。
   */
  isSpanCovered(parentSpan: Span, name: string): boolean;
  /** 标记该父 span 下已创建同名子 span */
  markSpanCovered(parentSpan: Span, name: string): void;
  /** 新建 span（`parentSpan` 非空时建立父子关系） */
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parentSpan?: Span
  ): Span;
  /** 结束 span（可带状态与说明） */
  endSpan(span: Span, status?: SpanStatusCode, message?: string): void;
}

/**
 * OTel SPI 服务接口
 *
 * 由 DI 容器注册具体实现，core 层代码通过此接口获取 tracing 实例。
 */
export interface IOTelService {
  getTracing(): IOTelTracing;
}

/** SPI 服务标识符常量 */
export const OTEL_SERVICE_ID = 'core.spi.IOTelService';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerOTelSpi 在启动时设置
// ---------------------------------------------------------------------------

let _otelService: IOTelService | null = null;

/**
 * 空操作 Tracing：在 SPI 服务注册完成前提供安全降级。
 *
 * **为什么这里允许降级**：`handleError` 的 OTel 段本身是 best-effort
 * （原实现即写明"OTel 不可用时不中断主流程"），且 **日志 / 内存统计 / 事件发布
 * 三条主链路均不经过 OTel** ⇒ 降级只损失 span 标注，**不会丢错**。
 */
function createNoopTracing(): IOTelTracing {
  return {
    getActiveSpan(): Span | undefined {
      return undefined;
    },
    recordError(): void {
      /* noop */
    },
    isSpanCovered(): boolean {
      return false;
    },
    markSpanCovered(): void {
      /* noop */
    },
    // 返回 **OTel API 自身的 no-op Span**（未注册 SDK 时 `trace.getTracer()` 即 NoopTracer
    // ⇒ `startSpan()` 得 NonRecordingSpan）：与既有行为（monitoring 的 tracing 在无 SDK 时
    // 亦产生非录制 span）一致，调用方后续 `setStatus`/`end` 等操作安全无副作用。
    startSpan(name, attributes, parentSpan): Span {
      const ctx = parentSpan
        ? trace.setSpan(context.active(), parentSpan)
        : context.active();
      return trace
        .getTracer('core:spi:otel-noop')
        .startSpan(name, { attributes }, ctx);
    },
    endSpan(span, status = SpanStatusCode.OK, message): void {
      if (status === SpanStatusCode.ERROR && message) {
        span.setStatus({ code: status, message });
      } else {
        span.setStatus({ code: status });
      }
      span.end();
    },
  };
}

/**
 * 获取 core 层 Tracing 实例
 *
 * 在 registerOTelSpi() 完成后返回 monitoring 层实际实现；
 * 在此之前返回 noop，保证启动阶段不会因空指针崩溃。
 */
export function resolveOTelTracing(): IOTelTracing {
  if (!_otelService) {
    return createNoopTracing();
  }
  return _otelService.getTracing();
}

/**
 * 注册 OTel SPI 实现到 DI 容器
 *
 * 动态导入 monitoring 层的 tracing 实现并注册为 SPI 服务。
 * 此函数不产生静态跨层依赖，符合架构分层约束。
 *
 * @param container - DI 容器实例
 */
export async function registerOTelSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IOTelService
): Promise<void> {
  // 2026-09-30（台账 D-129，`R00-003` ② 改造）：实现体改由 **entry** 侧装配模块构建后传入
  // 设置内部引用，使 resolveOTelTracing() 可正常工作
  _otelService = service;

  container.registerDescriptor<IOTelService>({
    id: OTEL_SERVICE_ID,
    factory: () => service,
    scope: 'singleton',
  });
}
