/**
 * http-only / headless 常驻守卫（P3，2026-10-20）
 *
 * 从 `main.ts#launchREPL` 抽出（R04-001：main.ts 已达 2000 行上限）：
 * 该分支**永久挂起**等 SIGINT/SIGTERM，因此 `launch()` 末尾的
 * `LocalHTTPService._appReady = true` 不会执行 ⇒ 必须在此手动标记就绪，
 * 否则所有业务请求会持续返回 503 "Service starting"。
 *
 * 两种调用方共用：
 * - 显式 `--http-only`；
 * - `DROP_UI` 构建（headless）：编译期强制走该分支，REPL/ink 已被裁剪。
 */

/**
 * 标记 HTTP 服务就绪（幂等；失败不影响进程存活）。
 */
export async function markHttpReady(): Promise<void> {
  try {
    const { LocalHTTPService } =
      await import('../infrastructure/http/LocalHTTPService.js');
    LocalHTTPService._appReady = true;
  } catch {
    // @ignore-catch — 就绪标记失败不影响进程存活
  }
}

/**
 * 保持进程存活，直到收到 SIGINT / SIGTERM。
 */
export async function holdUntilShutdownSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    const onSignal = () => {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      resolve();
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });
}
