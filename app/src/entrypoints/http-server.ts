/**
 * http-server.ts — 独立 HTTP 服务启动器
 *
 * 与 repl.ts 完全解耦，零项目模块静态依赖，避免循环依赖导致 TDZ。
 * 仅在需要时通过动态 import() 加载 LocalHTTPService。
 */

import type { LocalHTTPService } from '@modules/infrastructure';
// 静态依赖仅限 core 的**零依赖**模块（ports / httpPortFallback 自身不 import 任何项目模块），
// 不破坏本文件"不与 repl.ts 形成循环依赖"的初衷。
import {
  HTTP_PORT_SHIFT_ATTEMPTS,
  resolveHttpPortIntent,
} from '@modules/core/ports.js';
import { startWithPortFallback } from '@modules/core/httpPortFallback.js';

/**
 * 启动 LocalHTTPService
 *
 * 通过纯动态 import 加载，不依赖任何项目模块的静态导入，
 * 避免与 CoreAPIImpl / ChatManager / configManager 等模块的循环依赖。
 */
export async function startHTTPServer(
  port: number,
  host: string = '127.0.0.1'
): Promise<LocalHTTPService> {
  // 使用相对路径动态导入，避免 @modules 别名在 Bun 动态 import 下的潜在问题
  const { LocalHTTPService: LocalHTTPServiceImpl } =
    await import('@modules/infrastructure');

  const service = new LocalHTTPServiceImpl({ host, port });
  await service.start();

  return service;
}

/**
 * 获取 LocalHTTPService 类型（用于类型推断，不触发模块加载）
 */
export type { LocalHTTPService };

/** `startHTTPServerWithPortFallback` 的入参 */
export interface StartHTTPServerOptions {
  /** 首选端口 */
  port: number;
  /** 监听地址，默认 127.0.0.1 */
  host?: string;
  /**
   * 端口被占用时是否顺延
   *
   * ⚠️ **仅**在"用户未显式指定端口"时为 true（见 `core/ports.ts`）；
   * 桌面壳（Tauri）用 `--http-port` 显式指定 ⇒ 必须传 false，否则客户端连错端口。
   */
  allowPortShift?: boolean;
  /** 顺延尝试次数（含首选），默认 `HTTP_PORT_SHIFT_ATTEMPTS` */
  maxAttempts?: number;
}

/** `startHTTPServerWithPortFallback` 的结果 */
export interface StartedHTTPServer {
  service: LocalHTTPService;
  /** 实际生效端口（可能因顺延而不同于首选端口） */
  port: number;
  /** 是否发生顺延 */
  shifted: boolean;
}

/**
 * 启动 LocalHTTPService，按需处理端口占用
 *
 * 语义：
 * - `allowPortShift` 非 true ⇒ 与 `startHTTPServer` **逐字等价**（失败即抛出）；
 * - `allowPortShift === true` ⇒ 遇到 `EADDRINUSE` 从首选端口起连续顺延，
 *   其余错误（EACCES / 端口越界等）**立即抛出**，不被顺延逻辑吞掉。
 */
export async function startHTTPServerWithPortFallback(
  opts: StartHTTPServerOptions
): Promise<StartedHTTPServer> {
  const host = opts.host;
  const result = await startWithPortFallback<LocalHTTPService>({
    port: opts.port,
    allowShift: opts.allowPortShift === true,
    maxAttempts: opts.maxAttempts ?? HTTP_PORT_SHIFT_ATTEMPTS,
    // host 缺省时由 `startHTTPServer` 的默认参数兜底（避免此处再写一份字面量）
    start: (port) => startHTTPServer(port, host),
  });
  return { service: result.value, port: result.port, shifted: result.shifted };
}

/**
 * 启动登记（launch）用的 HTTP 入口：解析端口 → 按需顺延 → 实际端口写回环境变量
 *
 * 为什么抽出来：`launchREPL` 与 `launchDaemon` 原本各抄一份"端口解析 + 启动"，
 * 加入动态端口后这段从两行变成"解析 / 顺延 / 写回"，再抄两份必然漂移（CS01）。
 *
 * 实例锁的端口发布（`publishInstanceEndpoint`）仍由调用方负责 —— 本函数不碰磁盘，
 * 保持 http-server 对项目模块的静态依赖只在 core 的零依赖模块上。
 */
export async function startLaunchHTTPServer(
  args: readonly string[] | undefined,
  host: string
): Promise<StartedHTTPServer> {
  const intent = resolveHttpPortIntent(args);
  const started = await startHTTPServerWithPortFallback({
    port: intent.port,
    host,
    // CLI --http-port / env 非默认端口 ⇒ 不漂移，否则客户端连的端口会错
    allowPortShift: intent.allowShift,
  });
  // 实际端口是后续所有进程内消费者（健康检查 / 日志 / SSE 地址）的事实来源
  process.env['LIRI_HTTP_PORT'] = String(started.port);

  // 主包瘦身 R4：被编译期裁掉的能力必须**显式告知**（否则用户会以为开关还能开）。
  // 用动态 import：本文件刻意不静态依赖项目模块（见文件头注），且完整构建下这段几乎零成本。
  try {
    const { logBuildVariantBanner } =
      await import('../bootstrap/buildVariantBanner.js');
    logBuildVariantBanner();
  } catch {
    // @ignore-catch — 横幅失败不影响服务启动
  }

  return started;
}
