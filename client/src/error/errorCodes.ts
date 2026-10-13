/**
 * 前端**业务错误码**单一事实源（硬编码统一治理方案 §4.2 **B4** / §7.2 `HD-P0-3`）。
 *
 * **为什么是"契约 + 同值测试"而不是"合成一处"**：后端（`app/`）与前端（`client/`）是
 * **两个部署单元**，物理上无法共享同一模块 ⇒ 治理方式是
 * **①前端收口一处（本文件）+ ②契约测试同值比对两侧取值**
 * （`app/tests/contracts/crossDeploymentContract.test.ts` 的 **B4** 用例：断言本常量
 * ⟷ 后端抛点 `app/src/chat/orchestrator/preSendContextProtection.ts` 的
 * `AppError('DAILY_BUDGET_EXCEEDED')` 取值相同，并断言前端**仅本文件**定义该字面量）。
 *
 * ⚠️ 语义提醒（CS02）：前端**不得**用错误码字符串去"猜"业务语义之外的东西；
 * 这里收口的是**协议标识**本身（两侧必须逐字相等，否则分流失效）。
 */

/** 日预算撞限：后端 SSE/HTTP 结构化错误码（`preSendContextProtection` 抛出）。 */
export const DAILY_BUDGET_EXCEEDED = "DAILY_BUDGET_EXCEEDED";
