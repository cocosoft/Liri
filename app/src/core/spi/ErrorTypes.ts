/**
 * 错误类型 SPI
 *
 * 错误基座 `AppError` / `ErrorCategory` / `ErrorSeverity` 定义已下沉至 core 侧 `core/errors.ts`
 * （2026-09-30 分层倒挂收口第 2 批），此处改由该 core 侧文件转出。
 * core 层代码使用此模块导出的类型，确保类型统一。
 */

export { AppError, ErrorCategory, ErrorSeverity } from '../errors.js';

/** SPI 服务标识符 */
export const ERROR_SERVICE_ID = 'core.spi.IErrorService';
