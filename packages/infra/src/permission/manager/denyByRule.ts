/**
 * 规则拒绝的**统一出口**（P1 拆分，2026-11-12；逻辑逐字搬自 `PermissionManager#_denyByRule`）
 *
 * 为什么单独抽：此前两处 deny 只回 `Denied by rule from <source>`，而 `<source>` 是
 * `RuleManager.parseRuleString()` 的**硬编码默认值**（`userSettings`），真实来源是
 * `tool_rules.json` ⇒ 用户按提示去 `settings.json` 里找永远找不到（2026-10-26 实测）。
 * 现在把 **ruleId + 解除入口**一并带出（文案 + 决策上下文 + 结构化日志；LRO-07）。
 */
import { getLogger } from '@openliri/infra/monitoring';

import {
  createDenyDecision,
  type PermissionDecision,
} from '../types/PermissionDecision';
import { resolveRuleRemovalHint } from './moduleScope';

const logger = getLogger('permission:manager');

  /**
   * 规则拒绝的**统一出口**（LRO-09 步骤 2，2026-10-26）。
   *
   * 为什么单独抽：此前两处 deny 只回 `Denied by rule from <source>`，而 `<source>` 是
   * `RuleManager.parseRuleString()` 的**硬编码默认值**（`userSettings`），真实来源是
   * `tool_rules.json` ⇒ 用户按提示去 `settings.json` 里找永远找不到（2026-10-26 实测）。
   * 现在把 **ruleId + 解除入口**一并带出（文案 + 决策上下文 + 结构化日志；LRO-07）。
   */
  export function denyByRule(
    toolName: string,
    rule:
      | {
          id?: string;
          source?: string;
          inputFingerprint?: string;
          contentPattern?: string;
        }
      | undefined,
    /**
     * F5（2026-10-27）：**本次调用**的指纹摘要（`hashApprovalFingerprint(...)`）。
     * 与 `rule.inputFingerprint` 并列落日志，才能区分"指纹级命中"与"工具级命中"
     * —— 真机曾出现「一条 deny 笼罩整个 file_write」的误判（Liri 报告 R4）。
     */
    callFingerprint?: string
  ): PermissionDecision {
    const ruleId = rule?.id;
    const source = rule?.source;
    const marker = ruleId ? ` [rule=${ruleId}]` : '';
    const from = source ? ` from ${source}` : '';
    const removableVia = resolveRuleRemovalHint(ruleId, source);
    // 命中维度：指纹规则 ⇒ 指纹级（只管该参数组合）；内容规则 ⇒ 内容级（只管命中的输入）；
    // 其余 ⇒ 工具级（管整个工具）。2026-11-26 补 `content`：此前内容级也被标成 `tool`，
    // 让「这一条 deny 到底封了多大范围」失真。
    const matchScope = rule?.inputFingerprint
      ? 'fingerprint'
      : rule?.contentPattern
        ? 'content'
        : 'tool';
    logger.warn('permission:deny', {
      toolName,
      ruleId,
      ruleSource: source,
      fingerprint: rule?.inputFingerprint,
      callFingerprint,
      matchScope,
      removableVia,
    });
    return createDenyDecision(
      `Denied by rule${from}${marker}（解除：${removableVia}）`,
      rule,
      {
        ruleId,
        toolName,
        inputFingerprint: rule?.inputFingerprint,
        callFingerprint,
        matchScope,
        sourceKind: source,
        removableVia,
      }
    );
  }
