// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * shadowToolDispositions — 影子工具（`conditional`）的**处置登记表**（PR-4，2026-10-23）
 *
 * ## 背景
 * 「工具可见性」里的 `conditional` = 声明面（`TOOL_NAME_CONSTANTS`）有、生效面（生成物
 * `TOOL_NAMES`）没有。实测 11 个，全部是**刻意保持条件化**的影子实现（桩/空壳/双轨）。
 * 此前面板只显示"未进生效工具面"，既不说原因、也没有处置期限 ⇒ 永久挂着。
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
  // ── 下线类：纯桩/空壳，或与生效工具 100% 重复 ──────────────────────────
  nodes: {
    reason: 'stub',
    disposition: 'retire',
    reevaluateWhen: '出现真实分布式节点/worker 运行时',
  },
  session_status: {
    reason: 'duplicate',
    disposition: 'retire',
    reevaluateWhen: '无（真能力由 sessions.status 覆盖）',
  },
  sessions_send: {
    reason: 'duplicate',
    disposition: 'retire',
    reevaluateWhen: '无（真能力由 sessions.send 覆盖）',
  },
  sessions_spawn: {
    reason: 'duplicate',
    disposition: 'retire',
    reevaluateWhen: '无（真能力由 sessions.spawn / agent 覆盖）',
  },
  update_plan: {
    reason: 'duplicate',
    disposition: 'retire',
    reevaluateWhen: '无（真能力由 plan.update 覆盖）',
  },
  thinking: {
    reason: 'duplicate',
    disposition: 'retire',
    reevaluateWhen: '出现"推理步骤需落盘审计"的真实需求',
  },

  // ── 重写后接线：有真实能力，但当前实现不可用 ────────────────────────────
  agents_list: {
    reason: 'needs-rewrite',
    disposition: 'rewrite',
    reevaluateWhen: '把 HTTP /v1/agents/control 的只读投影接进工具面',
  },
  kanban: {
    reason: 'needs-rewrite',
    disposition: 'rewrite',
    reevaluateWhen: '改为读写 SQLite kanban_cards 真源，消除内存 Map 双轨',
  },
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
