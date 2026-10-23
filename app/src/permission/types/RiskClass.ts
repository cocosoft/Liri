/**
 * 风险分级引擎 — 借鉴 OpenWorker 五级风险模型
 *
 * 用于 PermissionChecker 在决策时进行声明式风险判断，
 * 替代工具名硬编码的分支逻辑。
 *
 * PR-0（2026-10-23）：本文件属 **permission（infra）**，**禁止**反向依赖 `tools/`（R00-001）。
 * 结构化派生（`TOOL_EFFECTS` + `sandboxLevel`）由工具自己经 `Tool.getRiskClass?()` 完成；
 * 本层只做"声明优先 + 兜底"。
 */

import type { ToolRiskClass } from '../../utils/toolContract/Tool';

/**
 * 参与风险判定的最小工具形状（结构性；**不依赖** `tools/` 的类型）。
 */
export interface RiskDeclaringTool {
  name: string;
  riskClass?: ToolRiskClass;
  riskClassFor?(input: Record<string, unknown>): ToolRiskClass;
  /** 由工具实现侧派生（`BaseTool` 已实现；可结合 `TOOL_EFFECTS` / `sandboxLevel`） */
  getRiskClass?(input?: Record<string, unknown>): ToolRiskClass;
  isReadOnly?(input?: Record<string, unknown>): boolean;
}

export enum RiskClass {
  /** 只读查询 — 读文件、搜索 → 自动放行，不进 Inbox */
  READ = 'read',
  /** 写本地 — 写文件、编辑 → 无人值守时进 Inbox，否则弹窗确认 */
  WRITE_LOCAL = 'write',
  /** 命令执行 — 运行脚本 → 始终进 Inbox（无人值守也不自动放行） */
  SHELL = 'shell',
  /** 外部写入 — 发消息、发邮件 → 进 Inbox + 可设 standing rule */
  EXTERNAL = 'external',
  /** 纯对话 — 普通聊天 → 完全放行 */
  DISCUSS = 'discuss',
  /**
   * PR-0（2026-10-23）：**未声明**风险类别。
   *
   * 语义：不降低安全性 —— 决策仍为 `ask`（与 SHELL 同等保守），但文案与 UI 明确标注
   * "该工具未声明风险类别"，并给出"加入黑/白名单"入口；**禁止**把它当作可自动放行的档位。
   */
  UNDECLARED = 'undeclared',
}

/**
 * 风险覆盖规则
 * 允许用户配置特定路径/命令前缀的自动放行策略
 */
export interface RiskOverrides {
  /** 自动放行的文件路径前缀 */
  allowReadPatterns: string[];
  /** 自动放行的命令前缀 */
  allowCommandPrefixes: string[];
}

/**
 * 默认风险覆盖规则（空策略）
 */
export const DEFAULT_RISK_OVERRIDES: RiskOverrides = {
  allowReadPatterns: [],
  allowCommandPrefixes: [],
};

/**
 * 根据工具名推断风险等级（**仅过渡兜底**）。
 *
 * @deprecated PR-0（2026-10-23）：**禁止新增调用**。风险必须来自工具声明
 *   （`riskClass` / `riskClassFor`）或结构化派生（`TOOL_EFFECTS` + `sandboxLevel`），
 *   见 `tools/toolRiskClass.ts` 与 `resolveRiskClass()`。
 *   本函数仅保留给"只拿得到工具名"的过渡调用点（如 Inbox 卡片的风险文案），
 *   待这些调用点改传工具对象后删除。
 *
 * 已知缺陷（实证）：`pdf` 不匹配任何关键词 ⇒ 落 `SHELL` ⇒ 只读工具每次都要审批。
 */
export function inferRiskClass(toolName: string): RiskClass {
  const lower = toolName.toLowerCase();

  // 只读工具
  if (
    lower.includes('read') ||
    lower.includes('search') ||
    lower.includes('grep') ||
    lower.includes('glob') ||
    lower.includes('list') ||
    lower.includes('get') ||
    lower.includes('fetch') ||
    lower.includes('view') ||
    lower.includes('preview')
  ) {
    return RiskClass.READ;
  }

  // 写本地工具
  if (
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('create') ||
    lower.includes('save') ||
    lower.includes('delete') ||
    lower.includes('remove') ||
    lower.includes('replace') ||
    lower.includes('update')
  ) {
    return RiskClass.WRITE_LOCAL;
  }

  // Shell 工具
  if (
    lower.includes('bash') ||
    lower.includes('shell') ||
    lower.includes('exec') ||
    lower.includes('run') ||
    lower.includes('command') ||
    lower.includes('powershell')
  ) {
    return RiskClass.SHELL;
  }

  // 外部发送工具
  if (
    lower.includes('send') ||
    lower.includes('message') ||
    lower.includes('notify') ||
    lower.includes('email') ||
    lower.includes('publish') ||
    lower.includes('post')
  ) {
    return RiskClass.EXTERNAL;
  }

  // 默认：最保守（SHELL）
  return RiskClass.SHELL;
}

/** `ToolRiskClass`（utils 层字符串联合）→ `RiskClass`（权限枚举）的同值映射 */
const RISK_CLASS_BY_DECLARATION: Record<ToolRiskClass, RiskClass> = {
  read: RiskClass.READ,
  write: RiskClass.WRITE_LOCAL,
  shell: RiskClass.SHELL,
  external: RiskClass.EXTERNAL,
  discuss: RiskClass.DISCUSS,
  undeclared: RiskClass.UNDECLARED,
};

/**
 * 解析本次调用的风险类别（PR-0，**统一入口**）。
 *
 * 优先级：`riskClassFor(input)` > `riskClass` > `tool.getRiskClass(input)`
 * （由工具侧结合 `TOOL_EFFECTS`/`sandboxLevel` 派生）> `isReadOnly` > `UNDECLARED`。
 *
 * - 传**工具对象**：走声明/派生 —— 这是正确口径，`pdf` 等只读工具由此免审批；
 * - 只传**工具名**（过渡）：沿用已弃用的 `inferRiskClass`，保证未改造调用点**行为零变更**。
 *
 * @param toolOrName 工具对象或工具名
 * @param input 本次调用入参
 */
export function resolveRiskClass(
  toolOrName: RiskDeclaringTool | string,
  input: Record<string, unknown> = {}
): RiskClass {
  if (typeof toolOrName === 'string') {
    return inferRiskClass(toolOrName);
  }
  const tool = toolOrName;

  // 1) 动态声明
  if (typeof tool.riskClassFor === 'function') {
    try {
      const dynamic = tool.riskClassFor(input);
      if (dynamic) return RISK_CLASS_BY_DECLARATION[dynamic];
    } catch {
      // @ignore-catch — 声明实现异常 ⇒ 继续降级
    }
  }

  // 2) 静态声明
  if (tool.riskClass) return RISK_CLASS_BY_DECLARATION[tool.riskClass];

  // 3) 工具侧结构化派生（BaseTool 实现；infra 不感知 TOOL_EFFECTS）
  if (typeof tool.getRiskClass === 'function') {
    try {
      const derived = tool.getRiskClass(input);
      if (derived) return RISK_CLASS_BY_DECLARATION[derived];
    } catch {
      // @ignore-catch — 派生异常 ⇒ 继续降级
    }
  }

  // 4) 自报只读
  if (typeof tool.isReadOnly === 'function') {
    try {
      if (tool.isReadOnly(input)) return RiskClass.READ;
    } catch {
      // @ignore-catch — 自报异常 ⇒ 视为未声明
    }
  }

  // 5) 不猜
  return RiskClass.UNDECLARED;
}

/**
 * 检测 Shell 命令是否包含链式操作
 * 如 `;` `|` `&&` `||` 等
 */
export function detectChainedCommand(command: string): boolean {
  const chainedPatterns = [/;/, /\|/, /&&/, /\|\|/, />{1,2}/, /`/];
  return chainedPatterns.some((p) => p.test(command));
}
