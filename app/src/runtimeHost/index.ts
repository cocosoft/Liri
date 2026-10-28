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
 * runtimeHost — **运行时宿主**（infra · zone: runtime-host，v3 方案 §6.1 P1）
 *
 * 本模块是内核 `packages/kernel/src/core` 去 I/O 的落点：凡「跨请求存活 / 触碰磁盘或子进程」
 * 的实现都从 core 迁到这里（判据见 `.trae/rules/architecture-compliance.md` AC-01/AC-02）：
 *
 * | 文件 | 迁入前 | 为什么必须出内核 |
 * |---|---|---|
 * | `instanceLock` | `core/instanceLock.ts` | `node:fs`（启动路径同步读写锁文件） |
 * | `seedSync` | `core/seedSync.ts` | `fs`（首启种子数据复制） |
 * | `estop` | `core/estop/estop.ts` | `fs`（紧急停机落盘标记） |
 * | `ExitRecorder` | `core/exit/ExitRecorder.ts` | `fs`（退出原因记录） |
 * | `IdleScaleMonitor` | `core/idle/IdleScaleMonitor.ts` | `fs/promises`（空转扫描/清理） |
 * | `delivery/**` | `core/delivery/**` | `fs` / `fs/promises` / `child_process`（投递·归档·磁盘监视） |
 * | `health/DependencyHealthChecker` | `core/health/DependencyHealthChecker.ts` | `fs`（标记文件读写） |
 *
 * 契约（留在内核的部分）不在这里：`HealthStatus` / `HEALTH_SEVERITY` 等仍由
 * `@openliri/kernel`（`core/health/types.ts`）提供，本模块只消费。
 *
 * ⚠️ 本 barrel 会被 `main.ts` 等启动面静态加载 ⇒ 新增导出前请先跑 `lint:startup-graph`
 * （eager 预算只减不增，AC-28）。
 */

export * from './instanceLock';
export * from './seedSync';
export * from './estop';
export * from './ExitRecorder';
export * from './IdleScaleMonitor';
export * from './delivery/index';
export * from './health/DependencyHealthChecker';
