/**
 * 错误类型 SPI
 *
 * 错误基座 `AppError` / `ErrorCategory` / `ErrorSeverity` 定义已下沉至 core 侧 `core/errors.ts`
 * （2026-09-30 分层倒挂收口第 2 批），此处改由该 core 侧文件转出。
 * core 层代码使用此模块导出的类型，确保类型统一。
 *
 * ⚠️ 2026-10-09：原 `ERROR_SERVICE_ID`（`'core.spi.IErrorService'`）已**删除** ——
 * 全仓**零消费者**（无 `IErrorService` 接口、无 `register/resolve` 代理），且
 * `error-handler-core-sink.md` §46 已**明确排除**"为 handleError 造 SPI 端口"（会引入
 * 注册前 noop = 静默丢错）。删除依据见 `.trae/specs/dead-code-and-unwired-items-rulings.md`
 * **DC-4**（触发条件「无」）与 `cs03-abuse-forward-assessment.md:77`（「随下一次 core/spi 清理批次删除」）。
 */

export { AppError, ErrorCategory, ErrorSeverity } from '../errors.js';
