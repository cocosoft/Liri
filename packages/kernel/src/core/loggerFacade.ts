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
 * core 侧日志门面（**同名** `getLogger`）
 *
 * 2026-09-30（台账 D-70 / spec `monitoring-logger-core-spi.md`）：
 * core / modules 侧原经 `@modules/monitoring` 取 `getLogger`，构成 **96 对**
 * `core -> infra` 倒挂（占 `BULK-010` 实测 120 对的 80%）。
 *
 * 本门面把取值路径改到 core 侧的 Logger SPI（`./spi/LoggerService.ts`，
 * 其设计目的即"让 core 不直接 import monitoring 层"）：
 *   · **同名导出 `getLogger`** ⇒ 96 个消费方**只改 import 路径**，`const logger = getLogger('x')`
 *     与 `logger.info(...)` 等调用点**一字不改**；
 *   · SPI 侧已实现**延迟绑定 + 注册前缓冲回放** ⇒ 顶层取 logger 不会永久绑定 noop，
 *     且注册前的日志不丢（见 `LoggerService.ts` 内 ①② 说明）。
 *
 * 落点在 **core 模块根**（而非 `core/spi/**`）：跨模块引用 core 的**子目录**会被
 * R03-002「模块出口单一」判违规（D-62 实测），模块根相对引用则不触发（D-62/D-69 已验证）。
 */

export {
  resolveLogger as getLogger,
  resolveLogger,
  type ILogger,
} from './spi/LoggerService.js';
