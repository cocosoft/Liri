/**
 * `localStorage` 键名（硬编码治理 `HD-P2-3`）。
 *
 * **当前只收口「跨文件复用」的键**：`liri-auth-token` 原有 **3 处**字面量
 * （`services/authService.ts` 定义、`services/chatService.ts` 与 `services/httpUtils.ts` 各读一次）
 * ⇒ 收敛为**单点定义**。其余键（`liri-sessions` / `liri-tier` / `liri-config` /
 * `liri-sidebar-expanded` / `liri-settings-view-mode` / `liri-root-store`）目前**仅单文件内使用**，
 * 按 CS03（回退/抽象最小化）与「简洁优先」**暂不上收** —— 出现跨文件复用再迁入此处。
 *
 * ⚠️ **值不得改动**：改名会让**既有用户**的本地数据"丢失"（读到空 ⇒ 被视为未登录 / 无历史）。
 */
export const STORAGE_KEYS = {
  /** 鉴权令牌（登录后写入；`httpUtils` 据此加 `Authorization` 头、`chatService` 走 SSE 时读） */
  authToken: "liri-auth-token",
} as const;
