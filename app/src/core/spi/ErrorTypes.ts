/**
 * 错误类型 SPI
 *
 * 统一从 @modules/error 导入错误类型。
 * core 层代码使用此模块导出的类型，确保类型统一。
 */

export { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/** SPI 服务标识符 */
export const ERROR_SERVICE_ID = 'core.spi.IErrorService';
