// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 子代理工具集契约（O7）
 *
 * **契约**（调用方 docstring 同口径）：子代理可用工具 =
 * `父级可继承工具（父级全量 − 阻断清单）` ∩ `模型白名单（若有）` − `模型黑名单`。
 *
 * **两段校验（O7②，顺序不可调换）**：
 * 1. **未知工具集**：名字在**已知工具表**（父级全量 ∪ 阻断清单）中不存在（拼错）⇒ 拒绝 ——
 *    只做子集校验会把拼错的名字当成"越权/不存在"而给出误导性错误，甚至静默忽略；
 * 2. **父级子集（禁止扩权）**：名字存在但**不在父级可继承集合**中（父级没有，或属阻断清单）
 *    ⇒ 拒绝。子代理永远不能拿到父级不具备的能力。
 *
 * **fail-closed（O7③）**：显式传入但**归一后为空**的 `allowedTools` ⇒ **拒绝**。
 * 原实现以 `allowedTools.length > 0` 才过滤 ⇒ `""` / `" , "` 会**放开全部工具**（fail-open）。
 *
 * 依赖仅"工具名清单"，不 import 工具实现 / 注册表 ⇒ 可独立单测。
 */

import { AGENT_TOOL_NAME, LEGACY_AGENT_TOOL_NAME } from './constants';
import { YIELD_TOOL_NAME } from '../../session/yield';

/**
 * 委派入口工具（T9：**可由角色策略授权放行**）—— `Agent` 及其历史别名 `Task`。
 *
 * 默认对子代理阻断（递归防护）；仅当"该子代理所属角色的策略位 `canDelegate = true`
 * **且** 父侧深度未达 `MAX_SUBAGENT_DEPTH`"时，才重新放回子代理工具池。
 */
export const DELEGATION_ENTRY_TOOLS: readonly string[] = [
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
];

/**
 * 恒不可继承的工具（**与委派授权无关**）。
 *
 * `sessions_yield`：**语义防护** —— yield 绑定的是"父会话的 turn"，子链路没有对应的
 * 恢复通路；子代理调用它只会得到"成功但无副作用"的假象，并可能在提示词层面
 * 诱导模型提前收尾（当前子链路不登记等待，故此项属纵深防御）。
 */
export const ALWAYS_BLOCKED_TOOLS: readonly string[] = [YIELD_TOOL_NAME];

/**
 * 阻断清单（O7①）：**即使父级持有，也不继承给子代理**的工具。
 *
 * - `Agent` / `Task`（{@link DELEGATION_ENTRY_TOOLS}）：递归防护 —— 子代理默认不得再持有
 *   委派入口（T9 的角色授权位可放行）；与 `MAX_SUBAGENT_DEPTH` 正交：前者控"能不能再委派"，
 *   后者控"嵌套多深"。
 * - `sessions_yield`（{@link ALWAYS_BLOCKED_TOOLS}）：语义防护（见上）。
 *
 * 值顺序与拆分前保持一致（`['Agent','Task','sessions_yield']`）—— O7 用例断言其内容。
 */
export const DELEGATE_BLOCKED_TOOLS: readonly string[] = [
  ...DELEGATION_ENTRY_TOOLS,
  ...ALWAYS_BLOCKED_TOOLS,
];

export interface ToolsetContract {
  /** 父级当前可见的**全部**工具名 */
  parentToolNames: readonly string[];
  /** 阻断清单（缺省用 {@link DELEGATE_BLOCKED_TOOLS}） */
  blockedToolNames?: readonly string[];
}

export type ToolsetValidationResult =
  | {
      ok: true;
      /** 归一后的白名单（未提供时为 undefined = 继承全部可继承工具） */
      allowed?: string[];
      /** 归一后的黑名单（未提供时为空数组） */
      denied: string[];
    }
  | { ok: false; error: string };

/**
 * 校验模型传入的 `allowedTools` / `deniedTools`（两段校验 + fail-closed）。
 *
 * 不抛错：一切拒绝路径返回 `{ ok: false, error }`，由调用方转成工具失败结果。
 */
export function validateToolsetRequest(params: {
  allowedTools?: string[];
  deniedTools?: string[];
  contract: ToolsetContract;
}): ToolsetValidationResult {
  const blocked = new Set(
    (params.contract.blockedToolNames ?? DELEGATE_BLOCKED_TOOLS).map((n) =>
      n.toLowerCase()
    )
  );
  const parentNames = params.contract.parentToolNames.map((n) =>
    n.toLowerCase()
  );
  const parentSet = new Set(parentNames);
  /** 父级可继承集合 = 父级全量 − 阻断清单 */
  const inheritable = new Set(parentNames.filter((name) => !blocked.has(name)));
  /** 已知工具表 = 父级全量 ∪ 阻断清单（阻断清单里的工具对子代理"存在但不可授予"） */
  const known = new Set([...parentSet, ...blocked]);

  const allowed = params.allowedTools;
  const denied = params.deniedTools;

  // fail-closed（O7③）：显式给出空清单 ⇒ 拒绝（原语义会放开全部工具）
  if (allowed !== undefined && allowed.length === 0) {
    return {
      ok: false,
      error:
        'allowedTools 为空清单：请**省略**该参数以继承全部可继承工具，' +
        '或显式列出至少一个工具名。',
    };
  }

  if (allowed !== undefined) {
    // 第①段：未知工具（拼写错误）
    const unknown = allowed.filter((n) => !known.has(n.toLowerCase()));
    if (unknown.length > 0) {
      return {
        ok: false,
        error:
          `未知工具名（拼写错误？）：${unknown.join(', ')}。` +
          `请使用注册表中的工具名。`,
      };
    }
    // 第②段：父级子集（禁止扩权）
    const notInheritable = allowed.filter(
      (n) => !inheritable.has(n.toLowerCase())
    );
    if (notInheritable.length > 0) {
      return {
        ok: false,
        error:
          `禁止扩权：以下工具父级不具备或已被阻断，不可授予子代理：` +
          `${notInheritable.join(', ')}。`,
      };
    }
  }

  if (denied !== undefined) {
    const unknownDenied = denied.filter((n) => !known.has(n.toLowerCase()));
    if (unknownDenied.length > 0) {
      return {
        ok: false,
        error: `deniedTools 含未知工具名（拼写错误？）：${unknownDenied.join(', ')}。`,
      };
    }
  }

  return {
    ok: true,
    allowed: allowed?.map((n) => n.toLowerCase()),
    denied: (denied ?? []).map((n) => n.toLowerCase()),
  };
}
