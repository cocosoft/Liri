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
 * 统一错误处理入口（**纯转出**）
 *
 * 2026-09-30（台账 D-69 / spec `error-handler-core-sink.md`）：实现已**整体下沉**至
 * `core/errorHandler.ts`。迁因：core 层 27 处源文件需要本入口，而原实现直接依赖
 * monitoring 层（日志 + OTel）⇒ 构成 core 到 infra 的倒挂；实现先经 core 侧两条 SPI
 * （`resolveLogger` / `resolveOTelTracing`）去掉 infra 依赖，再下沉 core。
 *
 * 本文件仅**转出**：对外导出名、签名与行为**逐字不变**，故 `error/index.ts`、
 * HTTP handler 与单测等既有消费方**无需改动**。
 */

export {
  handleError,
  resolveErrorLogLevel,
  getErrorStats,
  type HandleErrorOptions,
} from '../core/errorHandler.js';
