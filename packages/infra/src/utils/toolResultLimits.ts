// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具结果长度上限（**单一事实源**）。
 *
 * 2026-10-02（戊 / D-234）：原定义在 `chat/services/ChatHelper.ts`。抽出到 `utils/`（infra）的原因：
 * 1. **请求侧**（`truncateToolResult`，即发给模型的内容）与**估算侧**（`ai/tokenizer/TokenEstimator`
 *    的 token 估算口径）必须使用**同一个上限**，否则估算输入 ≠ 请求输入（实测导致成本放大 70s、
 *    水位虚高至 7559%）；
 * 2. 若估算侧直接 import `chat`，会与既有的 `chat → ai`（`ChatHelper.ts:25`）**构成环** —— 放 infra
 *    层可被双方安全共用（app 层可依赖 infra）。
 *
 * ⚠️ 变更此值会同时影响「发给模型的截断程度」与「token 估算口径」，请一并评估。
 */
export const TOOL_RESULT_MAX_LENGTH = 8000;
