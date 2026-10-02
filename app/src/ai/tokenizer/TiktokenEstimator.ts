/**
 * Tiktoken 估算器 —— **转出层**（H5-⑥ 收口，台账 D-212）
 *
 * 实现已**改归 infra**（`utils/TiktokenEstimator.ts`）：该文件仅依赖 `@modules/monitoring`
 * + `@modules/error`（**infra**）、零 app 依赖 ⇒ 原置 app 层 `ai/tokenizer/` 时，
 * `services/prompt/DiagnosticsReport.ts` 取用 `getCachedTiktokenEncoder` 构成
 * `services -> ai` 倒挂。本文件仅**原址转出**（对外导出名与签名逐字不变
 * ⇒ `ai/tokenizer/index.ts` · `ai/index.ts` 等既有消费方零改动）。
 *
 * ⚠️ 未下沉 core：置 core 会因 `monitoring`/`error` 依赖新增 `core -> infra` 边（净变差，同 D-207 判据）。
 *
 * @see ../../utils/TiktokenEstimator.ts 规范定义
 */
export * from '../../utils/TiktokenEstimator.js';
