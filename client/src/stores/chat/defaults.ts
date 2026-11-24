/**
 * chat/defaults.ts — 聊天 store 的**时长阈值**单一事实源。
 *
 * 为什么单独成文件：`lint:consts` 的 B 类（裸字面量）只豁免
 * `packages/infra/src/constants/` 与任意 `defaults.ts` —— 带 `_MS` / `_LIMIT` /
 * `_TIMEOUT` / `_THRESHOLD` 后缀的阈值必须集中在此（棘轮：白名单只减不增）。
 */

/**
 * 2026-11-24（批次 3 / B1）：挂起流的**最长存活时间**（30 分钟）。
 *
 * `pausedStreams` 此前无 TTL、切会话也不清理 ⇒ 后端重启 / 会话已结束的挂起项会永久
 * 留在内存里（并持续触发 /health 轮询）。超过该时长仍未恢复 ⇒ 切会话时按"已失效"清掉
 * （中止 controller 并解除挂起等待者，避免幽灵流泄漏）。
 */
export const PAUSED_STREAM_TTL_MS = 30 * 60_000;
