// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * toolCapability — 工具**能力 / 风险**派生（D5，2026-10-11 用户裁定「采纳 · 渐进棘轮」）
 *
 * 背景：外部主张 Tool 增 `capability/risk/permissions/sandbox`（O 0808 §八/§24）。本仓已有
 * **三份**分散元数据：`TOOL_EFFECTS`（idempotent/sideEffect）+ `tags` + `isReadOnly/isDestructive`
 * ⇒ 本文件**复用**它们派生出**单一**能力/风险描述符（CS01：不新建子系统、不重复造轮子）。
 *
 * 设计（对齐方案 §4.5.4 修正 3 / N2「无侵入能力棘轮」）：
 * - **纯函数** `deriveFromLegacyEffects()`：**未显式声明** ⇒ 由既有元数据**默认派生**（可单测）；
 * - 落点：`BaseTool`（实现，见 `BaseTool.getCapability()`）—— `Tool` 是 interface，无方法体；
 * - **渐进**：不改 81 个存量工具的 Schema；`scripts/lint-tool-schema.ts` **初期仅 WARN**，
 *   基线（`.trae/architecture/tool-capability-baseline.json`）内的存量工具缺声明**只告警**，
 *   **新增**工具缺声明 ⇒ **ERROR**（棘轮）。
 */

import type { ToolTag } from '../utils/toolContract/Tool';
import type {
  ToolCapabilityDescriptor,
  ToolCapabilityLevel,
  ToolRiskLevel,
  ToolSandboxLevel,
} from '../utils/toolContract/Tool';
import type { ToolEffect } from './toolEffects';

/** 派生输入：**全部来自既有元数据**（无新字段强制） */
export interface LegacyEffectInput {
  /** 副作用/幂等声明（`tools/toolEffects.ts`；未声明 = MCP/插件） */
  readonly effect?: ToolEffect;
  /** 工具标签（`Tool.tags`） */
  readonly tags?: readonly ToolTag[];
  /** `isReadOnly()` 的真实返回值 */
  readonly isReadOnly: boolean;
  /** `isDestructive()` 的真实返回值（缺省视为 false） */
  readonly isDestructive?: boolean;
  /** 显式沙箱级别（`BaseTool.sandboxLevel`；优先于派生值） */
  readonly sandboxLevel?: ToolSandboxLevel;
  /**
   * 是否**执行任意代码/命令**（如 `bash`/`code_run`）。未提供 ⇒ 仅凭 effect/tags 推断，
   * 不臆造（CS06）。
   */
  readonly executesCode?: boolean;
}

/**
 * 由**既有元数据**派生能力/风险描述符（**纯函数**，无副作用、可单测）。
 *
 * 派生口径：
 * - `capability`：`execute`（显式）> `effect.sideEffect`（none→read／local→write-local／
 *   external→write-external）；**未声明**（MCP/插件）⇒ 只读则 `read`，否则 `write-external`（保守）；
 * - `risk`：`isDestructive` 或 `execute`/`write-external` ⇒ `high`；`write-local`/含 `WRITE` 标签
 *   ⇒ `medium`；其余 ⇒ `low`；
 * - `sandbox`：显式 `sandboxLevel` 优先；否则 `execute`→`execution`、`read`→`readonly`、其余 `none`。
 */
export function deriveFromLegacyEffects(
  input: LegacyEffectInput
): ToolCapabilityDescriptor {
  const {
    effect,
    tags = [],
    isReadOnly,
    isDestructive = false,
    sandboxLevel,
    executesCode,
  } = input;

  const hasWriteTag = tags.includes('write' as ToolTag);

  let capability: ToolCapabilityLevel;
  if (executesCode) {
    capability = 'execute';
  } else if (effect) {
    if (effect.sideEffect === 'none') {
      capability = 'read';
    } else if (effect.sideEffect === 'local') {
      capability = 'write-local';
    } else {
      capability = 'write-external';
    }
  } else {
    // 未声明（MCP / 插件）：无法证明只读 ⇒ 保守视为对外写
    capability = isReadOnly ? 'read' : 'write-external';
  }

  let risk: ToolRiskLevel;
  if (
    isDestructive ||
    capability === 'execute' ||
    capability === 'write-external'
  ) {
    risk = 'high';
  } else if (capability === 'write-local' || hasWriteTag) {
    risk = 'medium';
  } else {
    risk = 'low';
  }

  const sandbox: ToolSandboxLevel =
    sandboxLevel ??
    (capability === 'execute'
      ? 'execution'
      : capability === 'read'
        ? 'readonly'
        : 'none');

  return { capability, risk, sandbox };
}
