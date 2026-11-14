// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 应用退出链的钩子清单（2026-11-14，P0-2 外移）。
 *
 * 从 `main.ts` 迁出 4 个 `graceful*` 清理实现 + 其清单组装：`main.ts` 已触顶 R04-001
 * 的 2000 行上限，而「退出时该清理什么」本身就是独立职责，与启动编排无关。
 *
 * 口径不变：全部走 **dynamic import**（退出链不得为了清理而把 channels / MCP / llama /
 * proactive 静态拉进启动图），单条失败不阻塞退出，超时与失败由
 * `runShutdownHooks`（`./shutdownHooks.ts`）统一有界化。
 */
import type { ShutdownHook } from './shutdownHooks.js';

/**
 * T3.4: 通道级 scope 释放（注销 bootstrap 注册的通道）。
 * dynamic import 避免与 channels 模块静态耦合。
 */
async function gracefulChannelShutdown(): Promise<void> {
  // 先停渠道实时监控（清探测循环与退避定时器），再释放通道 scope
  const { getChannelRealtimeMonitor } =
    await import('@modules/channels/monitoring/ChannelRealtimeMonitor');
  getChannelRealtimeMonitor().stop();
  const { channelBootstrapper } =
    await import('@modules/channels/bootstrap/ChannelBootstrapper');
  await channelBootstrapper.disposeAll();
  // 多租户 P3：租户通道实例不在 bootstrapper 里 ⇒ 单独断开（失败不影响退出）
  try {
    const { stopTenantChannels } =
      await import('@modules/channels/setupChannels');
    await stopTenantChannels();
  } catch {
    // @ignore-catch — 租户通道断开失败不阻塞退出
  }
}

/**
 * T1.25.4: 退出时停止 llama-server（与 Liri 生命周期同步）。
 * 防止应用退出后 llama-server 进程残留（占内存、后台继续生成导致下次请求 busy 误判）。
 * dynamic import 避免与 llama 模块静态耦合；失败不阻塞退出。
 */
async function gracefulLlamaShutdown(): Promise<void> {
  try {
    const { llamaCppServerManager } =
      await import('@modules/ai/local/llama/LlamaCppServerManager.js');
    await llamaCppServerManager.stop();
  } catch {
    // @ignore-catch — llama 模块加载/停止失败不阻塞应用退出
  }
}

/**
 * ① P0（2026-10-10）：退出时回收 MCP stdio 子进程。
 *
 * 此前通道/llama 有优雅退出，**MCP 无**（`mcpSystem.cleanup()` 仅由模块 `destroy()` 触发，
 * 信号路径不经过）⇒ `killOrphanedProcesses` 全仓零调用点 ⇒ stdio 子进程可残留。
 * 见 `dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md` §8.1（P0）。
 *
 * dynamic import 避免与 MCP 模块静态耦合；失败不阻塞退出。
 */
async function gracefulMcpShutdown(): Promise<void> {
  try {
    const { mcpSystem } = await import('@openliri/service/services/mcp');
    await mcpSystem.cleanup();
  } catch {
    // @ignore-catch — MCP 清理失败不阻塞应用退出
  }
}

/**
 * G-10（2026-10-19）：退出时停止主动消息扫描器并关闭队列数据库。
 *
 * 扫描器定时器已 `unref`（不阻止退出），这里负责释放 DB 句柄；
 * dynamic import 避免与 proactive 模块静态耦合；失败不阻塞退出。
 */
async function gracefulProactiveShutdown(): Promise<void> {
  try {
    const { stopProactiveRuntime } =
      await import('@modules/proactive/ProactiveRuntime');
    await stopProactiveRuntime();
  } catch {
    // @ignore-catch — 主动消息运行时停止失败不阻塞应用退出
  }
}

/**
 * 退出链清单（并行执行，顺序无关）。
 *
 * 后两条是会话侧钩子：
 * - `flush-event-buffers`（2026-09-02 排查「会话中断」）：先 flush 全会话事件缓冲
 *   （text-batch 落盘），避免 watch 重启 / Ctrl+C 中断在途会话留下 torn/open-turn；
 * - `mark-clean-shutdown`（M4，2026-09-17）：为可中断会话写 cleanShutdown 标记，
 *   下次启动跳过崩溃恢复。
 */
export const APP_SHUTDOWN_HOOKS: readonly ShutdownHook[] = [
  { name: 'channels', run: gracefulChannelShutdown },
  { name: 'llama', run: gracefulLlamaShutdown },
  { name: 'mcp', run: gracefulMcpShutdown },
  { name: 'proactive', run: gracefulProactiveShutdown },
  {
    name: 'flush-event-buffers',
    run: () =>
      import('../chat/lifecycle/shutdownHooks.js').then((m) =>
        m.flushAllEventBuffers()
      ),
  },
  {
    name: 'mark-clean-shutdown',
    run: () =>
      import('../chat/lifecycle/shutdownHooks.js').then((m) =>
        m.markSessionsCleanShutdown()
      ),
  },
];
