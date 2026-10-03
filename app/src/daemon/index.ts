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
export { ProcessManager } from './ProcessManager';
export type {
  ProcessConfig,
  ManagedProcess,
  HealthStatus,
  ComponentHealth,
} from './ProcessManager';

export { IPCService } from './IPCService';
export type {
  IPCMessage,
  IPCHandler,
  IPCServiceConfig,
  IPCTransport,
} from './IPCService';

export { AutoUpdater } from './AutoUpdater';
export type { UpdateInfo } from './AutoUpdater';

// T-③05（2026-10-03，台账 D-139）**下线队列/健康链**：
// `TaskQueue` / `CronBridge` / `QueueBackend` / `types` / `HealthServer` 已删除——
// 全仓（含 `src-tauri`/`scripts`/`tests`）无 `new TaskQueue(` / `new CronBridge(`，
// 无任何消费者；DAEMON 模式的定时任务已改由 `tasks/cron/startCronEngine` 承担
//（`main.ts:launchDaemon()`，注释「KB-CRON-DAEMON，2026-08-29」），
// 且 `bridge/ModuleBridgeRuntime` 对 `DaemonService` 命令直接回「未接入」。
// 保留：`ProcessManager` / `IPCService`（+ `ProcessWatchdog`、`service/DaemonService`、
// `diagnostics`、`audit` 子路径——`ProcessWatchdog` 由 `tasks/watchdog/WatchdogBridge` 动态导入）。
