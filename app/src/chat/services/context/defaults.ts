// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 上下文截断的数值常量（2026-11-18，拆分批 4）
//
// 单独成文件的原因：`lint:consts` 有两条约束 ——
// ① D-2 B 类裸字面量：`*_THRESHOLD` / `*_MS` 这类阈值常量不得以裸数字写在业务文件里，
//    **允许位置**为 `constants/` 或任意 `defaults.ts`；
// ② D-1 @kind 分类：常量必须带 `@kind B` 标注，否则该门禁**硬失败**（不进基线棘轮）。

/**
 * 「短用户消息」长度阈值（字符数）。
 *
 * 截断退化时，长度低于该值的 user 消息优先被丢弃 —— 这类消息多为"继续 / 按计划执行"，
 * 丢弃后由跨轮摘要（`contextSummary`）承担目标回溯，避免长任务里碎片指令挤占窗口。
 *
 * @kind B
 */
export const SHORT_USER_MSG_THRESHOLD = 200;
