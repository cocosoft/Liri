// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 长任务信号 ⇒ 自动升级闸门（D3，2026-09-25，`.trae/specs/long-task-routing.md` §3.6）
 *
 * 背景：自动升级到 PDCA 的通道**本仓早已存在**（裸会话执行意图 / 项目会话 goal / 研究型分流），
 * 但判据只有"**消息文本** + 轮次闸"——**运行中**才展开成长任务（多 todo / 多轮）时不会被接管。
 * 本模块只提供该通道的**闸门判定**（纯函数，可单测）；真正的动作（建项目 + `_maybeLaunchPdca`）
 * 仍由 `ChatManager` 用**既有**实现完成（不新建第二套升级链路 —— CS01）。
 *
 * 闸门口径与既有"裸会话 + 执行意图"分支保持一致：裸会话 + 轮次闸 ≥2 + 非 Code Mode。
 */

/** 输入（全部为**事实**，判定方不自行取数 —— 便于单测与复用） */
export interface LongTaskEscalationInput {
  /** 运行中长任务信号（`ReActToolLoop.getLongTaskSignal().isLongTask`） */
  longTask: boolean;
  /** 是否已有项目/工作区归属（有 ⇒ 该会话走既有 goal 通道，本闸门不接管） */
  hasProjectContext: boolean;
  /** 命中 Code Mode（互斥：Code Mode 任务由沙箱链路负责，见既有 CM-6 口径） */
  codeMode: boolean;
  /** 会话内用户消息数（轮次闸） */
  userMessageCount: number;
}

/** 轮次闸：≥2 轮才允许按"运行中信号"自动升级（防"首条消息即被自动建项目 + 起编排"） */
export const LONG_TASK_ESCALATION_MIN_USER_TURNS = 2;

/**
 * 是否应按运行中长任务信号升级到 PDCA 编排。
 *
 * 四个条件**同时**成立才为真（任一不满足即不动 —— 保守取向：误升级的代价高于漏升级）：
 * ① 长任务信号；② 裸会话（无项目/工作区）；③ 非 Code Mode；④ 用户消息数 ≥ 轮次闸。
 */
export function shouldEscalateLongTask(
  input: LongTaskEscalationInput
): boolean {
  return (
    input.longTask &&
    !input.hasProjectContext &&
    !input.codeMode &&
    input.userMessageCount >= LONG_TASK_ESCALATION_MIN_USER_TURNS
  );
}
