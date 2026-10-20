/**
 * httpPortFallback.ts — 端口被占用时的**顺延重试**（2026-10-20，分发前置）
 *
 * 为什么需要：默认端口写死（18990）在分发场景下不可靠 —— 用户机器上任何
 * 进程先占住该端口，Liri 就再也起不来（exe 冒烟已实测到这一点）。
 * 但"动态漂移"必须是**有条件**的：
 *   - 用户/宿主**显式指定**端口（`--http-port` / `LIRI_HTTP_PORT`，如 Tauri 桌面壳）
 *     ⇒ **不得**漂移，否则客户端按原端口连接必然失败 ⇒ 原样抛错；
 *   - 未显式指定 ⇒ 从默认端口起连续顺延，实际端口由调用方写回环境变量与实例锁。
 *
 * 为什么抽成纯函数（可注入 `start`）：真正 `listen` 会拉入整个 LocalHTTPService
 * （含知识库播种 / 编译调度器），单测不能真起服务；此处的判定逻辑与端口推进
 * 才是要钉住的部分。
 */

/** 端口顺延的最终结果 */
export interface PortFallbackResult<T> {
  /** 成功启动的实例 */
  value: T;
  /** 实际生效端口 */
  port: number;
  /** 是否发生了顺延（`port !== 首选端口`） */
  shifted: boolean;
}

export interface PortFallbackOptions<T> {
  /** 首选端口 */
  port: number;
  /** 是否允许顺延（**仅**"未显式指定端口"时为 true） */
  allowShift: boolean;
  /** 最大尝试次数（含首选端口），须 ≥ 1 */
  maxAttempts: number;
  /** 用指定端口启动；失败应 reject */
  start: (port: number) => Promise<T>;
  /** 错误是否为"端口被占用"（默认实现见 `isAddressInUseError`） */
  isAddressInUse?: (err: unknown) => boolean;
}

/**
 * 判断错误是否为 `EADDRINUSE`
 *
 * Node/Bun 的 listen 失败会带 `code` 字段；非对象 / 无 code 一律返回 false
 * （不让顺延逻辑吞掉真正的启动错误，如 EACCES / 端口越界）。
 */
export function isAddressInUseError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'EADDRINUSE';
}

/**
 * 按"允许顺延"策略启动
 *
 * - `allowShift=false`：只尝试首选端口，失败直接抛出（**语义不变**）；
 * - `allowShift=true`：遇到 EADDRINUSE 依次尝试 `port + 1 …`，直到
 *   `maxAttempts` 用尽；**非** EADDRINUSE 的错误立即抛出（不掩盖真实故障）。
 */
export async function startWithPortFallback<T>(
  opts: PortFallbackOptions<T>
): Promise<PortFallbackResult<T>> {
  const isInUse = opts.isAddressInUse ?? isAddressInUseError;
  const attempts = Math.max(1, Math.floor(opts.maxAttempts));
  const lastAttempt = opts.allowShift ? attempts : 1;

  let lastError: unknown;
  for (let i = 0; i < lastAttempt; i++) {
    const candidate = opts.port + i;
    try {
      return {
        value: await opts.start(candidate),
        port: candidate,
        shifted: i > 0,
      };
    } catch (err) {
      if (!isInUse(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}
