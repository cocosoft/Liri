/**
 * 网络常量（**B 类：可调运行参数**）
 *
 * 集中存放出站网络层的运行参数，避免在 `utils/` 内写裸数字
 *（`lint:consts` D-2 禁止 `const X_MS = <数字>` 出现在非 constants 目录）。
 */

/**
 * 通配绑定地址（对外暴露部署，如 Docker 的 `LIRI_HTTP_HOST=0.0.0.0`）。
 *
 * 与 `kernel/core/endpoints.ts#LOCAL_HTTP_HOST` 的语义边界一致：通配绑定 ≠ 本机自连，
 * 故按域分立，不复用回环常量。
 *
 * @kind A
 */
export const WILDCARD_BIND_HOST = '0.0.0.0';

/**
 * 系统代理设置（Windows 注册表）的缓存失效时间。
 *
 * 代理设置不会秒级变化；缓存可避免每个出站请求都起一次 `reg query` 子进程。
 *
 * @kind B
 */
export const SYSTEM_PROXY_CACHE_TTL_MS = 60_000;
