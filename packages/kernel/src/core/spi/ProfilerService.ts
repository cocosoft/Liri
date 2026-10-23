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
 * 启动性能剖析 SPI 接口
 *
 * 与 `./OTelService.ts` / `./LoggerService.ts` **同构**：core 层只声明所需的最小抽象，
 * 不引用 performance 层实现；实现在 `registerStartupProfilerSpi()`（组合根缝）内
 * **动态导入**后注册，故不产生静态跨层依赖。
 *
 * 存在理由（台账 D-76 / spec `layer-inversion-a-class-inventory.md` §3.5.5「A3」）：
 * `core/StartupPrefetcher.ts`、`modules/ModuleInitializer.ts`、`core/LazyModuleStrategy.ts`
 * 直接取 `performance`（infra）的启动剖析函数（前者经 `@modules/performance` 别名，
 * 后两者经 `../performance/StartupProfiler` 相对路径）⇒ 构成 `core -> infra` 倒挂。
 *
 * **为什么该实现不可下沉 core**：`performance/StartupProfiler.ts` 持有**模块级状态**
 * （`memorySnapshots` / `phaseTimes` / `DETAILED_PROFILING` 缓存）—— 下沉会让状态分裂成两份
 * ⇒ 只能按 **G3（core 定义接口 + 上层实现 + 注入）** 经本 SPI 取值。
 *
 * 使用方式（core 侧推荐经门面 `core/profilerFacade.ts`，调用形态与原 `@modules/performance` 一致）：
 *   import { profileCheckpoint } from './profilerFacade.js';
 *   profileCheckpoint('xxx');
 */

/** 启动剖析最小契约（core 侧实际使用的能力） */
export interface IStartupProfilerPort {
  /** 记录启动阶段检查点（`performance.mark` + 详细模式下的内存快照） */
  profileCheckpoint(name: string): void;
  /** 记录启动阶段开始 */
  profilePhaseStart(phase: string): void;
  /** 记录启动阶段结束，返回该阶段耗时（毫秒；起始标记缺失时为 0） */
  profilePhaseEnd(phase: string): number;
}

/** SPI 服务标识符常量 */
export const STARTUP_PROFILER_SERVICE_ID = 'core.spi.IStartupProfilerPort';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerStartupProfilerSpi 在启动时设置
// ---------------------------------------------------------------------------

let _service: IStartupProfilerPort | null = null;

/**
 * 空操作剖析器：在 SPI 服务注册完成前提供安全降级。
 *
 * **为什么这里允许降级**：启动剖析是 **best-effort 观测**（仅 `performance.mark/measure`
 * 与详细模式下的内存快照），**不参与任何业务判定**；未注册时只损失检查点数据，
 * 不影响启动正确性与功能可用性（与 OTel SPI 的 noop 降级同理）。
 */
function createNoopProfiler(): IStartupProfilerPort {
  return {
    profileCheckpoint(): void {
      /* noop */
    },
    profilePhaseStart(): void {
      /* noop */
    },
    profilePhaseEnd(): number {
      return 0;
    },
  };
}

/**
 * 获取 core 层启动剖析实例
 *
 * 在 `registerStartupProfilerSpi()` 完成后返回 performance 层实际实现；
 * 在此之前返回 noop，保证启动阶段不会因空引用崩溃。
 */
export function resolveStartupProfiler(): IStartupProfilerPort {
  return _service ?? createNoopProfiler();
}

/**
 * 注册启动剖析 SPI 实现到 DI 容器
 *
 * 动态导入 performance 层实现并注册为 SPI 服务。
 * 此函数不产生静态跨层依赖，符合架构分层约束。
 *
 * @param container - DI 容器实例
 */
export async function registerStartupProfilerSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IStartupProfilerPort
): Promise<void> {
  // 2026-09-30（台账 D-129，`R00-003` ② 改造）：实现体改由 **entry** 侧装配模块构建后传入
  // 设置内部引用，使 resolveStartupProfiler() 可正常工作
  _service = service;

  container.registerDescriptor<IStartupProfilerPort>({
    id: STARTUP_PROFILER_SERVICE_ID,
    factory: () => service,
    scope: 'singleton',
  });
}
