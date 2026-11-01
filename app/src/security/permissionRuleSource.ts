/**
 * 主权限模块规则来源端口（2026-11-01 B7 解环）
 *
 * 背景：`security/PermissionManager.ts`（`SecurityPermissionView`）需要读取主权限模块
 * （`permission_rules.json`）的 deny 规则，此前直接 `new RuleManager().loadRules()`；
 * 而 `permission` 又反向依赖 `security`（审计日志 / 统一规则表）⇒
 * `security ↔ permission` 是 infra 内最后的两元环。
 *
 * 解环做法与 `daemon/metricsSink` 一致：security 只声明端口，实现由 app 启动期注入
 * （`bootstrap/preflight.wireSecurityDeps`）。
 *
 * ⚠️ **安全姿态**：未注入时**不是静默放行** —— `readMainPermissionRules()` 返回 `null`，
 * 由调用方显式告警一次（`rulesSyncAttempted` 幂等），使"规则源缺失"在日志里可见。
 * 这与历史实现"异常被 catch 吞掉、静默退回默认放行"相比只增不减披露。
 */
export interface MainPermissionRuleLike {
  /** 行为（`PermissionBehavior` 的字符串值；此处不 import 枚举，避免多一层耦合） */
  behavior: string;
  /** 规则作用的工具名（全局规则可为空） */
  toolName?: string;
  /** 内容匹配模式（可空） */
  contentPattern?: string;
}

/** 规则来源实现：返回主权限模块的全部规则（同步、只读） */
export type MainPermissionRuleSource = () => MainPermissionRuleLike[];

let source: MainPermissionRuleSource | null = null;

/** 注入规则来源（返回 disposer） */
export function setMainPermissionRuleSource(
  next: MainPermissionRuleSource | null
): () => void {
  const previous = source;
  source = next;
  return () => {
    source = previous;
  };
}

/**
 * 读取主权限模块规则。
 *
 * @returns 规则数组；**未注入 ⇒ `null`**（调用方据此告警并保持默认行为）
 */
export function readMainPermissionRules(): MainPermissionRuleLike[] | null {
  return source ? source() : null;
}
