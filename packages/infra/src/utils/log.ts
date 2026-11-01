/**
 * 日志工具（**旧导入路径兼容层**）
 *
 * B8（2026-11-01）：改为经 **core 日志门面**（`@openliri/kernel/loggerFacade`）取 logger，
 * 不再 `import '../monitoring/logs/Logger'` —— 去掉 `utils → monitoring` 边。
 * 该边与 `monitoring → utils`（19 处）构成 R7 的 infra 内环（utils/config/monitoring/
 * analytics/performance/cost 六元 SCC），且此前因 utils 内部用相对导入而**不可见**。
 *
 * 取值语义不变：门面 `resolveLogger` 走 monitoring 注册的 Logger SPI（含注册前缓冲回放），
 * 模块名仍是 `app`（日志输出字段不变）。新代码请直接用门面或 `@modules/monitoring/logs/Logger`。
 */
import { resolveLogger } from '@openliri/kernel/loggerFacade';

/** 全局日志记录器单例（模块名保持 `app`） */
export const logger = resolveLogger('app');
