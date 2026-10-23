// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * shadowToolDispositions — 影子工具（`conditional`）的**处置登记表**（PR-4，2026-10-23）
 *
 * ## 背景
 * 「工具可见性」里的 `conditional` = 声明面（`TOOL_NAME_CONSTANTS`）有、生效面（生成物
 * `TOOL_NAMES`）没有。实测 11 个；其中 6 个「下线类」已于 2026-10-23 按 Q-18 拍板摘除声明
 * ⇒ 本表现只登记 **5 个**（重写 3 + 等前提 2）。
 *
 * ## 口径（逐项来自 `dev_docs/20261016/工具可见性治理-P4a-影子工具评估.md` §2.1/§2.3）
 * - `reason`：为什么还不能接线（`stub` 桩 / `duplicate` 与生效工具重复 / `awaiting-provider`
 *   等外部前提 / `needs-rewrite` 需先重写为真实现）；
 * - `disposition`：打算怎么处置（`retire` 下线 / `rewrite` 重写后接线 /
 *   `awaiting-provider` 等前提 / `wired` 已接线 —— 已接线的**不得**留在本表）。
 *
 * ## 门禁
 * `app/scripts/lint-shadow-tools.ts` 强制：**每个 conditional 必须在此登记**；
 * 标 `wired` 却不在 `TOOL_NAMES`（或反之）⇒ ERROR。
 *
 * ## 边界
 * 本表**只读**：不参与注册/裁剪/执行；仅用于可见性报表的"原因/处置"展示与门禁。
 */

import type {
  SharedShadowToolDisposition,
  SharedShadowToolReason,
} from '@shared/types';

export interface ShadowToolDispositionEntry {
  reason: SharedShadowToolReason;
  disposition: SharedShadowToolDisposition;
  /** 再评估触发条件（人读；也为 PR 跟踪留线索） */
  reevaluateWhen: string;
}

export const SHADOW_TOOL_DISPOSITIONS: Readonly<
  Record<string, ShadowToolDispositionEntry>
> = {
  // ── 下线类（2026-10-23 两步均已执行，条目与实现一并移除）───────────────
  // `nodes` / `session_status` / `sessions_send` / `sessions_spawn` / `update_plan` /
  // `thinking`：第 1 步摘除声明（`TOOL_NAME_CONSTANTS` 与类别/策略/UI 登记同步清理），
  // 第 2 步（CD05 观察期后、独立变更）删除实现文件与专用 UI
  // ⇒ 它们既不在"声明面 − 生效面"差额中，也无实现残留。

  // ── 重写后接线：有真实能力，但当前实现不可用 ────────────────────────────
  // `agents_list`（2026-10-23）与 `kanban`（2026-10-23）已完成 `rewrite` 并接线
  // ⇒ 均已移出本表（前者读 `AgentTool.getActiveAgents()`；后者读写 SQLite `kanban_cards`）。
  mcp_auth: {
    reason: 'needs-rewrite',
    disposition: 'rewrite',
    reevaluateWhen: '改为调用 mcpAuthManager + 受 MCP_OAUTH 门控（安全相邻域）',
  },

  // ── 等待外部前提 ────────────────────────────────────────────────────────
  music_generate: {
    reason: 'awaiting-provider',
    disposition: 'awaiting-provider',
    reevaluateWhen: '接入真实音乐生成 provider',
  },
  tts: {
    reason: 'duplicate',
    disposition: 'awaiting-provider',
    reevaluateWhen: '与 VoiceOutputTool 确定唯一归属后，其中一个下线',
  },
};

/** 查询某影子工具的处置登记（未登记 ⇒ undefined，由门禁报错） */
export function getShadowToolDisposition(
  name: string
): ShadowToolDispositionEntry | undefined {
  return SHADOW_TOOL_DISPOSITIONS[name];
}
