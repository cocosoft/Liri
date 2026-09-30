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
 * core 侧 OTel tracing 门面（**同名**导出）
 *
 * 2026-09-30（台账 D-70 Phase 2 / spec `monitoring-logger-core-spi.md`）：
 * `core` 侧 3 个文件（`core/loop/PlanDrivenLoop.ts`、`core/session/SessionSupervisor.ts`、
 * `core/events/EventBusOTelBridge.ts`）原经 `@modules/monitoring` 取 OTel 能力，
 * 构成 `core -> infra` 倒挂。
 *
 * 本门面把取值路径改到 D-69 已就绪的 core 侧 OTel SPI（`./spi/OTelService.ts`），
 * 并保持**导出名与调用形态与 monitoring 一致** ⇒ 消费方**只改 import 路径**：
 *   · `getOTelTracing` ← `resolveOTelTracing`（延迟解析：SPI 注册前为 noop，注册后为实际实现）
 *   · `isSpanCovered` / `markSpanCovered` ← 转发到 SPI 解析出的 tracing
 *     （其实现在 monitoring 侧持有**模块级状态**，不可下沉 core ⇒ 只能经 SPI 暴露）
 *
 * 落点在 **core 模块根**（而非 `core/spi/**`）：跨模块或 core 内相对引用子目录会被
 * R03-002「模块出口单一」判违规（D-62 实测），模块根相对引用则不触发（D-62/D-69 已验证）。
 */

import type { Span } from '@opentelemetry/api';
import { resolveOTelTracing } from './spi/OTelService.js';

export { resolveOTelTracing as getOTelTracing };

/** 该父 span 下是否已创建过同名子 span（防同一父下重复建 span） */
export function isSpanCovered(parentSpan: Span, name: string): boolean {
  return resolveOTelTracing().isSpanCovered(parentSpan, name);
}

/** 标记该父 span 下已创建同名子 span */
export function markSpanCovered(parentSpan: Span, name: string): void {
  resolveOTelTracing().markSpanCovered(parentSpan, name);
}
