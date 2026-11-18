// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 上下文截断的数值常量（2026-11-18，拆分批 4）
//
// 单独成文件的原因：`lint:consts`（D-2 B 类裸字面量）要求 `*_THRESHOLD` / `*_MS` 这类阈值常量
// 不得以裸数字形式写在业务文件里，**允许位置**为 `constants/` 或任意 `defaults.ts`。

/**
 * 「短用户消息」长度阈值（字符数）。
 *
 * 截断退化时，长度低于该值的 user 消息优先被丢弃 —— 这类消息多为"继续 / 按计划执行"，
 * 丢弃后由跨轮摘要（`contextSummary`）承担目标回溯，避免长任务里碎片指令挤占窗口。
 */
export const SHORT_USER_MSG_THRESHOLD = 200;
