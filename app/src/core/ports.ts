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
 */

/** 默认 HTTP 服务端口 */
export const DEFAULT_HTTP_PORT = 18990;
