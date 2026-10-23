// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * toolRiskClass — 工具**风险类别**的结构化派生（PR-0，2026-10-23）
 *
 * ## 为什么需要
 * 原实现 `permission/types/RiskClass.inferRiskClass(name)` **按工具名字符串猜风险**，
 * 未匹配任何关键词一律兜底 `SHELL`（最保守）⇒ 只读工具（实测 `pdf`）每次调用都被当成
 * 命令执行、每次都要人工审批。这违反 `coding-standards.md` **CS02**（属性判定禁止字符串匹配）。
 *
 * ## 派生口径（**全部来自既有结构化元数据**，不新增手写清单）
 * 优先级（高 → 低）：
 *   1. 工具**动态声明** `riskClassFor(input)` —— 混合工具（同一工具不同 action 风险不同）
 *   2. 工具**静态声明** `riskClass`
 *   3. `sandboxLevel === 'execution'` ⇒ `shell`（能力声明位，见 `ToolContract` A-4）
 *   4. `TOOL_EFFECTS[name].sideEffect`：`none` ⇒ read / `local` ⇒ write / `external` ⇒ external
 *   5. 工具自报 `isReadOnly(input) === true` ⇒ read
 *   6. 其余 ⇒ `undeclared`（**不猜**；由裁决方按"未声明"处理，仍询问）
 *
 * ## 边界
 * - 本模块**只读**：不参与注册、不改变执行，纯派生；
 * - 未注册/第三方工具（无 `TOOL_EFFECTS` 条目）⇒ 只能靠 `riskClass*` 或 `isReadOnly`；
 * - 本模块位于 `tools/`，`permission/` 反向引用它属**同层工具域**（`toolEffects` 是叶子模块，
 *   不引 permission），不构成循环依赖。
 */

import type {
  ToolRiskClass,
  ToolSandboxLevel,
} from '../utils/toolContract/Tool';
import { resolveToolEffect } from './toolEffects';

/** 参与风险派生的最小工具形状（避免依赖完整 `Tool` 接口） */
export interface RiskDeclaringTool {
  name: string;
  riskClass?: ToolRiskClass;
  riskClassFor?(input: Record<string, unknown>): ToolRiskClass;
  sandboxLevel?: ToolSandboxLevel;
  isReadOnly?(input?: Record<string, unknown>): boolean;
}

/**
 * 解析工具的风险类别（结构化派生）。
 *
 * @param tool 工具（对象字面量实现亦可，只要字段齐备）
 * @param input 本次调用入参（供 `riskClassFor` / `isReadOnly` 做动态判定）
 * @returns 风险类别；无法判定时返回 `'undeclared'`
 */
export function deriveToolRiskClass(
  tool: RiskDeclaringTool,
  input: Record<string, unknown> = {}
): ToolRiskClass {
  // 1. 动态声明（混合工具）
  if (typeof tool.riskClassFor === 'function') {
    try {
      const dynamic = tool.riskClassFor(input);
      if (dynamic) return dynamic;
    } catch {
      // @ignore-catch — 声明实现异常 ⇒ 降级到静态声明（不阻断判定）
    }
  }

  // 2. 静态声明
  if (tool.riskClass) return tool.riskClass;

  // 3. 执行类能力位（bash/powershell/code_run 等）
  if (tool.sandboxLevel === 'execution') return 'shell';

  // 4. 副作用声明（唯一事实源：toolEffects）
  const effect = resolveToolEffect(tool.name);
  if (effect) {
    if (effect.sideEffect === 'none') {
      // 声明与自报冲突（声明只读、却自称非只读）⇒ **保守判未声明**（仍询问），
      // 不因声明笔误把写工具静默放行（实证：`file_convert` 的 effects 声明为 none，
      // 但它会写转换产物 ⇒ 若直接按声明放行即为权限漏洞）。
      const readOnly = readOnlySelfReport(tool, input);
      return readOnly === false ? 'undeclared' : 'read';
    }
    if (effect.sideEffect === 'local') return 'write';
    return 'external';
  }

  // 5. 工具自报只读
  if (readOnlySelfReport(tool, input) === true) return 'read';

  // 6. 不猜
  return 'undeclared';
}

/** 读取工具自报的只读属性（异常/缺失 ⇒ undefined） */
function readOnlySelfReport(
  tool: RiskDeclaringTool,
  input: Record<string, unknown>
): boolean | undefined {
  if (typeof tool.isReadOnly !== 'function') return undefined;
  try {
    return tool.isReadOnly(input);
  } catch {
    // @ignore-catch — 自报异常 ⇒ 视为未声明
    return undefined;
  }
}
