// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * bash 安全门**登记表**（P2 待办 1/2 的前半程，2026-11-05）。
 *
 * ## 为什么要这张表
 *
 * 改造前"有哪些门、按什么顺序、拦截后归哪类、能否被已批准豁免"只存在于
 * `BashTool.execute` 的注释与调用顺序里，审计要读 200 行控制流；新加一道门也没有
 * 任何机制要求登记。本表把这几件事实**声明化**，并由
 * `app/tests/tools/bashCommandGateRegistry.test.ts` 与源码对账（顺序 / reason 码 / 调用点）。
 *
 * ## 边界（如实记录，不夸大）
 *
 * **控制流没有改**：`BashTool` 仍按原顺序逐个调用判据函数（每道门的参数与短路语义不同，
 * 强行塞进一个统一 runner 只会把差异藏进闭包）。本表是**登记 + 防漂移**，
 * 不是"用表执行判定"。等表稳定后再谈执行侧收敛。
 *
 * ## 与 `bashCommandPolicy` 的分工
 *
 * - `bashCommandPolicy.ts` = **判据数据**（危险命令、危险模式、白名单、高能力解释器）；
 * - 本文件 = **门的编排元数据**（顺序、reason 码、失败分类、是否可被已批准豁免）。
 */

/** 硬拦截 / 升级确认门的 id（顺序见 {@link COMMAND_GATE_ORDER}） */
export type CommandGateId =
  | 'path_safety'
  | 'dangerous_command'
  | 'powershell_wrapper'
  | 'ast_analyzer'
  | 'whitelist_sandbox'
  | 'interpreter_guard';

export interface CommandGateSpec {
  id: CommandGateId;
  /** 在 `BashTool.execute` 硬拦截层里的执行次序（1 起） */
  order: number;
  /** 该门拦截时 `result.metadata.reason` 可能取的值（排障/审计按此对账） */
  reasons: readonly string[];
  /**
   * "本会话已批准"能否豁免该门的 **ask**（硬拦截一律不可豁免）。
   * `false` = 该门的调用点**没有**传审批上下文（已批准也照拦）。
   */
  askExemptable: boolean;
  /** 拦截后的失败分类（LRO-09：安全门拦截属环境阻塞，不计入"模型无效输出"） */
  failureKind: 'safety_blocked';
  /** 一句话职责 */
  summary: string;
}

export const COMMAND_GATES: Readonly<Record<CommandGateId, CommandGateSpec>> = {
  path_safety: {
    id: 'path_safety',
    order: 1,
    reasons: ['path_safety'],
    askExemptable: false,
    failureKind: 'safety_blocked',
    summary: '统一口径 std.paths 逐个过 isPathSafe（Windows fail-closed）',
  },
  dangerous_command: {
    id: 'dangerous_command',
    order: 2,
    reasons: ['dangerous_command', 'dangerous_pattern'],
    askExemptable: false,
    failureKind: 'safety_blocked',
    summary: '危险命令列表 + 危险模式（对标 CC 安全策略）',
  },
  powershell_wrapper: {
    id: 'powershell_wrapper',
    order: 3,
    reasons: ['powershell_wrapper_ask'],
    askExemptable: false,
    failureKind: 'safety_blocked',
    summary:
      'pwsh -Command 内层脚本复用 PowerShell 安全链（不可检查形态 fail-closed）',
  },
  ast_analyzer: {
    id: 'ast_analyzer',
    order: 4,
    reasons: [
      'ast_analysis',
      'ast_inconclusive',
      'security_analyzer_deny',
      'security_analyzer_ask',
    ],
    askExemptable: true,
    failureKind: 'safety_blocked',
    summary:
      '安全分析器 + AST + 自定义规则 deny/ask（AST 不确定 ⇒ fail-closed 转人工）',
  },
  whitelist_sandbox: {
    id: 'whitelist_sandbox',
    order: 5,
    reasons: ['command_whitelist', 'sandbox_checker'],
    askExemptable: false,
    failureKind: 'safety_blocked',
    summary: '基命令白名单 + 沙箱二次校验',
  },
  interpreter_guard: {
    id: 'interpreter_guard',
    order: 6,
    reasons: ['interpreter_guard'],
    askExemptable: true,
    failureKind: 'safety_blocked',
    summary: '高能力解释器（node/bun/python/pwsh -c 等）升级人工确认',
  },
};

/** 执行顺序（由 `order` 派生，避免再维护一份手写序列） */
export const COMMAND_GATE_ORDER: readonly CommandGateId[] = (
  Object.values(COMMAND_GATES) as CommandGateSpec[]
)
  .slice()
  .sort((a, b) => a.order - b.order)
  .map((gate) => gate.id);

/** 表内登记的全部 reason 码（审计：任何新码必须先登记） */
export function listCommandGateReasons(): string[] {
  return COMMAND_GATE_ORDER.flatMap((id) => [...COMMAND_GATES[id].reasons]);
}
