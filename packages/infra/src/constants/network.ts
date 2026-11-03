/**
 * 网络常量（**B 类：可调运行参数**）
 *
 * 集中存放出站网络层的运行参数，避免在 `utils/` 内写裸数字
 *（`lint:consts` D-2 禁止 `const X_MS = <数字>` 出现在非 constants 目录）。
 */

/**
 * 系统代理设置（Windows 注册表）的缓存失效时间。
 *
 * 代理设置不会秒级变化；缓存可避免每个出站请求都起一次 `reg query` 子进程。
 *
 * @kind B
 */
export const SYSTEM_PROXY_CACHE_TTL_MS = 60_000;
