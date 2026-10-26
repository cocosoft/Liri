/**
 * LRO-09 步骤 2（2026-10-26）：规则拒绝必须**可定位**（带 ruleId + 结构化日志）
 *
 * 背景（实测）：`tool_rules.json` 里同工具同指纹同时存在 allow 与 deny；
 * 而旧文案只写 `Denied by rule from userSettings` —— `userSettings` 是
 * `RuleManager.parseRuleString()` 的硬编码默认值，磁盘上根本没有 settings.json，
 * 用户/模型都无法据此定位或放行。
 *
 * 为什么用源码级断言：`_denyByRule` 是私有方法，行为测试需要构造完整
 * `PermissionManager` + 规则文件 + 工具对象；这里钉住三条**结构性契约**，
 * 防止后续被"顺手改回"只有 source 的文案。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(
  new URL('../PermissionManager.ts', import.meta.url),
  'utf8'
);

describe('PermissionManager 规则拒绝（LRO-09 步骤 2）', () => {
  it('所有 deny 出口统一走 `_denyByRule`（不允许再各自拼文案）', () => {
    expect(SRC).toContain('private _denyByRule(');
    const calls = SRC.match(/_denyByRule\(/g) ?? [];
    // 1 处定义 + 3 处调用（默认档 2 处 + 另一档 1 处）
    expect(calls.length).toBe(4);
    // 不允许再出现旧的裸构造（只带 source、不带 ruleId）
    expect(SRC).not.toContain(
      'createDenyDecision(`Denied by rule from ${denyRule.source}`);'
    );
  });

  it('拒绝文案带 ruleId 标记（`[rule=…]`），用户可据此定位到具体规则', () => {
    expect(SRC).toContain('[rule=');
    expect(SRC).toContain('`Denied by rule${from}${marker}`');
  });

  it('落结构化事件 `permission:deny`（含 ruleId/fingerprint）', () => {
    expect(SRC).toContain("logger.warn('permission:deny'");
    expect(SRC).toContain('ruleId');
    expect(SRC).toContain('fingerprint');
  });

  it('决策上下文透出定位字段（供上游工具结果/审计消费）', () => {
    expect(SRC).toContain('sourceKind');
    expect(SRC).toContain('inputFingerprint');
  });
});
