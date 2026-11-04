// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * resolvePolicy — 权限判定的**唯一出口**（P1，2026-11-04）。
 *
 * 定位：**只做归一，不复制判定**。判定顺序仍然只有一份实现
 * （`PermissionManager.checkPermission` → `PermissionChecker`）：
 *
 * ```
 * ① 硬安全（BashTool 四门 / AST / 危险命令）—— 恒执行，不可被 ask 豁免
 * ② 路径边界（roots 任一命中；越界 ⇒ 可恢复的 ask 工作区授权）
 * ③ 显式 deny 规则（settings / tool_rules / roles）
 * ④ 审批放行缓存（once / session / always）
 * ⑤ 沙箱豁免（sandboxLevel + 信号 + 路径全在根内）
 * ⑥ 模式默认档（`context.permissionMode` 覆盖进程默认档）
 * ⑦ 工具风险默认档（riskClass → allow / ask）
 * ```
 *
 * 本模块负责把链的产出压平成**跨层 DTO**（`PolicyDecision`），让调用方不再各写一套
 * "ask 算不算放行""deny 要不要看 standing rule"的判断（P0 修的两处即此）。
 *
 * 与 `authorizeToolCall` 的分工（**不是双轨**，职责不同）：
 * - `resolvePolicy`：**纯判定归一** —— 不建卡、不写库，给 CLI / 优化器 / 单测这类
 *   "只想知道能不能做"的调用方；
 * - `authorizeToolCall`：判定 **+** `ask` 时提交 Inbox 审批卡 —— 供真正的执行入口使用。
 * 两者共用同一套效果词汇（allow / ask / deny）与同一条底层判定链。
 *
 * 已知局限（如实记录，不伪造来源）：链目前只在**命中规则**时回传结构化依据
 * （`context.ruleId`），因此 `evidence.source` 只能区分 `deny-rule` / `ask-rule` / `allow-rule`
 * 与兜底 `mode`；`risk-default` / `cache` / `sandbox` / `path` 这四类来源需要链侧补报
 * （见方案 §2.2，属 P2）。
 */

import type { PermissionDecision } from './types/PermissionDecision';
import { PermissionDecisionType } from './types/PermissionDecision';
import type { PermissionContext } from './types/PermissionContext';
import type { PermissionMode } from './PermissionMode';

/**
 * 判定的三种效果（唯一取值域）。
 *
 * 命名刻意避开 `PolicyEffect`（`types/PolicyStrength` 已占用，语义是"配置变更对在途授权的
 * 影响"）—— 两者无关，同名会被模块出口合并成重复标识符。
 */
export type PolicyVerdict = 'allow' | 'ask' | 'deny';

/** 判定依据的来源（缺省 `mode` = 仅能归因到生效模式，见文件头"已知局限"） */
export type PolicyEvidenceSource =
  | 'deny-rule'
  | 'ask-rule'
  | 'allow-rule'
  | 'risk-default'
  | 'sandbox'
  | 'path'
  | 'cache'
  | 'mode';

/** 给人看 / 给前端解释"为什么"的依据 */
export interface PolicyEvidence {
  source: PolicyEvidenceSource;
  /** 命中的规则 id（用户可据此定位并解除） */
  ruleId?: string;
  /** 规则来源（`ruleStore` / `userSettings` 等，链侧有则如实带出） */
  sourceKind?: string;
  /** 本轮生效的权限模式（会话覆盖后的值） */
  mode?: PermissionMode;
}

/** 唯一出口：一次工具调用的策略判定 */
export interface PolicyDecision {
  effect: PolicyVerdict;
  /** 结构化原因码（**禁止**靠 reason 文案判断，CS02） */
  reasonCode: string;
  /** 面向模型/用户的可读原因（仅展示，不参与判定） */
  reason?: string;
  evidence: PolicyEvidence;
  /** 审批维度（调用方已知指纹时带回；`checkPermission` 本身不产生指纹） */
  approval?: { scope: 'once' | 'session' | 'always'; fingerprint: string };
}

/** 判定端口：只依赖主链实际调用的一个方法（便于注入/测试） */
export interface PolicyDecisionPort {
  checkPermission(
    toolOrName: unknown,
    input: Record<string, unknown>,
    context?: PermissionContext
  ): Promise<PermissionDecision>;
  /** 当前生效的进程默认档（可选；仅用于 evidence.mode） */
  getMode?(): PermissionMode;
}

export interface ResolvePolicyRequest {
  /** 工具对象或工具名（传对象 ⇒ 风险按工具声明派生） */
  toolOrName: unknown;
  input: Record<string, unknown>;
  /** 会话级上下文（`permissionMode` 在此优先于进程默认档） */
  context?: PermissionContext;
  /** 调用方已知的审批指纹（如执行端已算好；缺省则不填 `approval`） */
  approvalFingerprint?: string;
}

/**
 * 归一化一次权限判定。
 *
 * @param port 判定端口（通常是 `PermissionManager`，构造时注入，便于测试替身）
 */
export async function resolvePolicy(
  port: PolicyDecisionPort,
  request: ResolvePolicyRequest
): Promise<PolicyDecision> {
  const decision = await port.checkPermission(
    request.toolOrName,
    request.input,
    request.context
  );

  const ruleId = readString(decision.context, 'ruleId');
  const sourceKind = readString(decision.context, 'sourceKind');
  const mode = request.context?.permissionMode ?? port.getMode?.();

  const effect: PolicyVerdict =
    decision.type === PermissionDecisionType.ALLOW
      ? 'allow'
      : decision.type === PermissionDecisionType.DENY
        ? 'deny'
        : 'ask';

  const source: PolicyEvidenceSource = ruleId
    ? effect === 'deny'
      ? 'deny-rule'
      : effect === 'ask'
        ? 'ask-rule'
        : 'allow-rule'
    : 'mode';

  const reasonCode = `${effect}-by-${source === 'mode' ? 'mode' : 'rule'}`;

  return {
    effect,
    reasonCode,
    reason: decision.reason || undefined,
    evidence: {
      source,
      ...(ruleId ? { ruleId } : {}),
      ...(sourceKind ? { sourceKind } : {}),
      ...(mode ? { mode } : {}),
    },
    ...(request.approvalFingerprint
      ? {
          approval: {
            scope: 'once' as const,
            fingerprint: request.approvalFingerprint,
          },
        }
      : {}),
  };
}

/** 从决策上下文中安全取字符串字段（缺失/类型不符 ⇒ undefined，不臆造） */
function readString(
  context: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = context?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
