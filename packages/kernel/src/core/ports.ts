/**
 * HTTP 端口统一管理 — 核心基础设施
 *
 * 后端 HTTP 服务端口的单一事实来源（默认值），各模块统一引用本常量，
 * 禁止在 main.ts / LocalHTTPService / MonitorTask 等散落硬编码端口。
 *
 * 运行时实际端口优先级（见 main.ts launchREPL/launchDaemon）：
 *   --http-port 参数 > LIRI_HTTP_PORT 环境变量 > DEFAULT_HTTP_PORT
 * 变更端口只需修改 .env 的 LIRI_HTTP_PORT（或本默认值），
 * client 侧 vite proxy 与 playwright webServer 会跟随 LIRI_HTTP_PORT。
 *
 * 注意：18990 避开 Clash/V2Ray 等代理软件默认端口 7890。
 *
 * **动态端口（2026-10-20，分发前置）**：默认端口被**其他进程**占用时，
 * 未显式指定端口的启动会顺延（见 `HTTP_PORT_SHIFT_ATTEMPTS` 与
 * `core/httpPortFallback.ts`），实际端口写回 `<prefix>HTTP_PORT`（见 `httpPortEnvKey()`）
 * 与实例锁文件（`core/instanceLock.ts`），供客户端发现。**显式指定端口时不得漂移**。
 */

// 零依赖叶子：只依赖同样零 import 的 productIdentity（不拉入 paths 整条求值链）
import { productEnvKey } from './productIdentity.js';

/**
 * HTTP 端口环境变量键名（**契约键**，读/写两端必须同键）
 *
 * 写入端：`app/src/infrastructure/http/http-server.ts`（启动后写回**实际**端口）。
 * 外部引用：`client/vite.config.ts` · `client/playwright.config.ts` · `app/.env.example` ·
 * `app/docker/{Dockerfile,docker-compose.yml}`。
 * ⇒ 改 `envPrefix` 必须**同批**改这些外壳文件，否则「内核读 A、外壳写 B」。
 */
export function httpPortEnvKey(): string {
  return productEnvKey('HTTP_PORT');
}

/** 默认 HTTP 服务端口 */
export const DEFAULT_HTTP_PORT = 18990;

/** 端口合法上界（65535 是最大值，此处用开区间上界） */
const HTTP_PORT_UPPER_BOUND = 65536;

/**
 * 端口顺延的最大尝试次数（含首选端口本身）
 *
 * 仅用于"未显式指定端口"的场景：从默认端口起连续尝试，避免端口被占即启动失败。
 * 20 足够覆盖常见的开发机端口冲突，又不会长时间扫描。
 */
export const HTTP_PORT_SHIFT_ATTEMPTS = 20;

/**
 * 解析**显式指定**的端口（`LIRI_HTTP_PORT`）
 *
 * @returns 合法端口号；未设置 / 非法值 ⇒ `undefined`（调用方回落到默认端口，
 *          并因此**允许**端口顺延）
 */
export function resolveExplicitHttpPort(
  env: NodeJS.ProcessEnv = process.env
): number | undefined {
  const raw = Number.parseInt(env[httpPortEnvKey()] ?? '', 10);
  return isValidPort(raw) ? raw : undefined;
}

/**
 * 解析当前生效端口（`LIRI_HTTP_PORT` 优先，否则默认端口）
 *
 * 用途：进程内需要"我们监听在哪个端口"的消费者（如健康检查），
 * 应在启动后调用本函数 —— `main.ts` 已把**实际**端口写回该环境变量。
 */
export function resolveHttpPort(env: NodeJS.ProcessEnv = process.env): number {
  return resolveExplicitHttpPort(env) ?? DEFAULT_HTTP_PORT;
}

/**
 * 从命令行参数解析 `--http-port`
 *
 * 支持 `--http-port 18990` 与 `--http-port=18990` 两种写法。
 *
 * @returns 合法端口号；未出现 / 取值非法 ⇒ `undefined`（视为"用户未指定"，
 *          ⇒ 允许端口顺延）
 */
export function parseHttpPortFromArgs(
  args?: readonly string[]
): number | undefined {
  if (!args) return undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--http-port') {
      const next = Number.parseInt(args[i + 1] ?? '', 10);
      if (isValidPort(next)) return next;
    }
    if (arg.startsWith('--http-port=')) {
      const inline = Number.parseInt(arg.slice('--http-port='.length), 10);
      if (isValidPort(inline)) return inline;
    }
  }

  return undefined;
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < HTTP_PORT_UPPER_BOUND;
}

/** 端口意图：首选端口 + 是否允许"被占用则顺延" */
export interface HttpPortIntent {
  /** 首选端口 */
  port: number;
  /**
   * 是否允许顺延
   *
   * `true` ⇔ **没有**用户级显式意图（CLI `--http-port`，或 `LIRI_HTTP_PORT`
   * 指定了**非默认**端口）。默认端口本身不算显式意图 —— 它常由自动生成的
   * `.env`（`LIRI_HTTP_PORT=18990`）带进来，若据此禁止顺延，分发场景下
   * "端口被占就永远起不来"（2026-10-20 实测踩中）。
   */
  allowShift: boolean;
}

/**
 * 解析端口意图（CLI > env > 默认）
 *
 * 显式性判定（决定能否顺延）：
 * - `--http-port` 出现且合法 ⇒ **显式**（桌面壳用 `--http-port` 拉起后端，
 *   客户端按该端口连接 ⇒ 必须原样失败而不是漂移）；
 * - `LIRI_HTTP_PORT` 为**非默认**端口（如 Docker `3000`）⇒ **显式**；
 * - `LIRI_HTTP_PORT` 缺省 / 非法 / **等于默认端口** ⇒ 视为**未指定**（允许顺延）。
 */
export function resolveHttpPortIntent(
  args?: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): HttpPortIntent {
  const cliPort = parseHttpPortFromArgs(args);
  const envPort = resolveExplicitHttpPort(env);
  const explicitPort =
    cliPort ?? (envPort === DEFAULT_HTTP_PORT ? undefined : envPort);
  return {
    port: explicitPort ?? DEFAULT_HTTP_PORT,
    allowShift: explicitPort === undefined,
  };
}
