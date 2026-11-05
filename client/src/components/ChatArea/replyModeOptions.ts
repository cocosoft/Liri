/**
 * 「回答模式」档位表（前端控制面简化 A′，2026-11-05）
 *
 * 把原先并列的「模式 + 详略 + 快速模式」三个旋钮合并为**一个**选择器
 * （对标 Copilot 的响应模式 / ChatGPT 把 effort 放进模型选择器）。
 *
 * ⚠️ 唯一实现：档位 → 后端字段的映射只在这里写一份（方案 §11.3），
 * 组件与 `ChatInput` 都从这里取，禁止在别处再写一份 if/switch。
 *
 * 映射口径：
 * - `chat_mode` 随消息下发（后端落到会话 `metadata.chatMode`）；
 *   快速档在协议上就是 `auto`，区别由全局 `fastMode` 承担。
 * - `effortLevel` 统一为 `auto`：思考预算交给模式本身（`deep` 的 thinkingFloor），
 *   避免「详略 high」与「深度思考」争同一个预算（方案 §3 P1）。
 */

export type ReplyMode =
  "auto" | "quick" | "deep" | "code" | "creative" | "research";

/** 后端 `chat_mode` 的取值（不含 UI 专属的 `quick`） */
export type ReplyChatMode = "auto" | "deep" | "code" | "creative" | "research";

interface ReplyModeOption {
  key: ReplyMode;
  labelKey: string;
  /** 后端 `chat_mode`（快速档 = auto） */
  chatMode: ReplyChatMode;
}

/**
 * 6 档顺序即菜单顺序。
 * `creative` 必须保留：它是唯一会裁掉终端工具的模式（`chatModePolicy#EXEC_TOOL_NAMES`）；
 * `research` 走独立链路（`researchService`），UI 上单独标注。
 */
export const REPLY_MODES: readonly ReplyModeOption[] = [
  { key: "auto", labelKey: "chat.modeAuto", chatMode: "auto" },
  { key: "quick", labelKey: "chat.modeQuick", chatMode: "auto" },
  { key: "deep", labelKey: "chat.modeDeep", chatMode: "deep" },
  { key: "code", labelKey: "chat.modeCode", chatMode: "code" },
  { key: "creative", labelKey: "chat.modeCreative", chatMode: "creative" },
  { key: "research", labelKey: "chat.modeResearch", chatMode: "research" },
];

/** UI 档位 → 后端 `chat_mode`（快速档在协议上等同 auto） */
export function toChatMode(mode: ReplyMode): ReplyChatMode {
  return REPLY_MODES.find((item) => item.key === mode)?.chatMode ?? "auto";
}
