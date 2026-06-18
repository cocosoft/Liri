/**
 * 日志工具（统一导出）
 *
 * 所有日志功能统一使用 monitoring/logs/Logger。
 * 导出全局 logger 单例实例，供旧导入路径兼容使用。
 * 新代码应直接从 @modules/monitoring/logs/Logger 导入。
 */

import { getLogger, LogLevel } from '../monitoring/logs/Logger';

export { LogLevel };

/**
 * 全局日志记录器单例
 */
export const logger = getLogger('utils');
