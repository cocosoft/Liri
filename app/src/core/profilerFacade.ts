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
 * core 侧启动剖析门面（**同名**导出）
 *
 * 2026-09-30（台账 D-76 / spec `layer-inversion-a-class-inventory.md` §3.5.5「A3」）：
 * core 层 3 个文件（`core/StartupPrefetcher.ts`、`modules/ModuleInitializer.ts`、
 * `core/LazyModuleStrategy.ts`）原直接取 `performance` 层的启动剖析函数
 * （`@modules/performance` 别名 / `../performance/StartupProfiler` 相对路径），
 * 构成 `core -> infra` 倒挂。
 *
 * 本门面把取值路径改到 core 侧 SPI（`./spi/ProfilerService.ts`），并保持**导出名与调用形态
 * 与 performance 一致** ⇒ 消费方**只改 import 路径**：
 *   · `profileCheckpoint` / `profilePhaseStart` / `profilePhaseEnd` ← SPI 延迟解析
 *     （注册前为 noop，注册后为实际实现）。其实现在 performance 侧持有**模块级状态**
 *     （`memorySnapshots` / `phaseTimes`）⇒ 不可下沉 core（会分裂状态），故经 SPI 暴露。
 *
 * 落点在 **core 模块根**（与既有 `core/loggerFacade.ts` / `core/tracingFacade.ts` 同构），
 * 跨模块消费方按相对 2 段路径引用（`../core/profilerFacade.js`）—— 模块根相对引用不触发
 * R03-002「模块出口单一」（D-70/D-75 已验证）。
 */

import { resolveStartupProfiler } from './spi/ProfilerService.js';

/** 记录启动阶段检查点 */
export function profileCheckpoint(name: string): void {
  resolveStartupProfiler().profileCheckpoint(name);
}

/** 记录启动阶段开始 */
export function profilePhaseStart(phase: string): void {
  resolveStartupProfiler().profilePhaseStart(phase);
}

/** 记录启动阶段结束，返回该阶段耗时（毫秒；起始标记缺失时为 0） */
export function profilePhaseEnd(phase: string): number {
  return resolveStartupProfiler().profilePhaseEnd(phase);
}
