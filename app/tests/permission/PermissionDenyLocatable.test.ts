/**
 * LRO-09 步骤 2（2026-10-26）：规则拒绝必须**可定位**（带 ruleId + 结构化日志）
 *
 * 背景（实测）：`tool_rules.json` 里同工具同指纹同时存在 allow 与 deny；
 * 而旧文案只写 `Denied by rule from userSettings` —— `userSettings` 是
 * `RuleManager.parseRuleString()` 的硬编码默认值，磁盘上根本没有 settings.json，
 * 用户/模型都无法据此定位或放行。
 *
 * 为什么用源码级断言：`denyByRule` 是内部实现，行为测试需要构造完整
 * `PermissionManager` + 规则文件 + 工具对象；这里钉住三条**结构性契约**，
 * 防止后续被"顺手改回"只有 source 的文案。
 *
 * 2026-11-12（P1 拆分）：实现已从 `PermissionManager.ts` 搬到
 * `permission/manager/{denyByRule,modeHandlers,moduleScope}.ts` ⇒ 断言改为按"职责文件"读取，
 * 契约（统一出口 + 7 处调用 + 定位字段）**逐条保留**，未放宽。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (rel: string) =>
  readFileSync(
    new URL(`../../../packages/infra/src/permission/${rel}`, import.meta.url),
    'utf8'
  );

/** 规则拒绝的统一出口（含文案 / 结构化日志 / 决策上下文） */
const DENY = read('manager/denyByRule.ts');
/** 五档模式处理器（7 处 `denyByRule(...)` 调用点） */
const HANDLERS = read('manager/modeHandlers.ts');
/** 模块级共享面（`resolveRuleRemovalHint` 的解除路径文案） */
const SCOPE = read('manager/moduleScope.ts');
/** 管理器本体（不得再出现裸构造） */
const MANAGER = read('PermissionManager.ts');

describe('PermissionManager 规则拒绝（LRO-09 步骤 2）', () => {
  it('所有 deny 出口统一走 `denyByRule`（不允许再各自拼文案）', () => {
    expect(DENY).toContain('export function denyByRule(');
    const calls = HANDLERS.match(/denyByRule\(/g) ?? [];
    // 7 处调用（default 2 + auto 1 + dontAsk 2 + plan 2，2026-11-11 补齐档位等价性）
    expect(calls.length).toBe(7);
    // 不允许再出现旧的裸构造（只带 source、不带 ruleId）—— 三个实现文件与本体逐一检查
    for (const src of [DENY, HANDLERS, SCOPE, MANAGER]) {
      expect(src).not.toContain(
        'createDenyDecision(`Denied by rule from ${denyRule.source}`);'
      );
    }
  });

  it('拒绝文案带 ruleId 标记（`[rule=…]`），用户可据此定位到具体规则', () => {
    expect(DENY).toContain('[rule=');
    expect(DENY).toContain('`Denied by rule${from}${marker}');
  });

  it('落结构化事件 `permission:deny`（含 ruleId/fingerprint/removableVia）', () => {
    expect(DENY).toContain("logger.warn('permission:deny'");
    expect(DENY).toContain('ruleId');
    expect(DENY).toContain('fingerprint');
    expect(DENY).toContain('removableVia');
  });

  it('决策上下文透出定位字段（供上游工具结果/审计消费）', () => {
    expect(DENY).toContain('sourceKind');
    expect(DENY).toContain('inputFingerprint');
  });

  it('拒绝文案带「怎么解除」（LRO-07：面板 + 精确 API，字段不能只进日志）', () => {
    expect(DENY).toContain('resolveRuleRemovalHint(');
    expect(SCOPE).toContain('/v1/permissions/rules/${ruleId}');
    expect(DENY).toContain('（解除：${removableVia}）');
  });
});
