// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P4（2026-11-12）：**注册表驱动**的命令语料。
 *
 * 立论：手写语料总会滞后于注册表。本文件对 `COMMAND_SPECS` 里的**每一条**声明
 * 生成一条端到端用例，断言"该写法在分类器里确实落在它声明的档位"——
 * 从而把「新增 spec 却忘了接进判定链」「令牌被前面的规则遮蔽」这类缺陷挡在 CI。
 *
 * 期望值来自注册表（单一来源），不是从分类器输出反推；因此它能发现**死令牌**。
 */

import { describe, expect, it } from 'bun:test';
import {
  AUTO_MODE_APPROVAL_TOKENS,
  AUTO_MODE_HARD_DENY_TOKENS,
  AUTO_MODE_READONLY_COMMANDS,
  COMMAND_SPECS,
} from '@openliri/infra/security';
import { AutoModeClassifier } from '@openliri/infra/permission/classifiers/AutoModeClassifier';

const classifier = new AutoModeClassifier();

/** 参数守卫会拒绝的只读命令（带示例参数不一定仍只读），语料里单列 */
const GUARDED_READONLY = new Set([
  'find',
  'date',
  'sort',
  'file',
  'git',
  'kubectl',
  'docker',
  'gh',
]);

/** 令牌表里另有定罪的名字（如 `printenv`：只读白名单与硬拦表并存时以硬拦为准） */
const ALSO_BLOCKED = new Set([
  ...AUTO_MODE_HARD_DENY_TOKENS.map((token) => token.trim().toLowerCase()),
  ...AUTO_MODE_APPROVAL_TOKENS.map((token) => token.trim().toLowerCase()),
]);

/** 用于只读对照的样本（无参数守卫，带一个普通文件名仍只读） */
const readonlySamples = [...AUTO_MODE_READONLY_COMMANDS]
  .filter((name) => !GUARDED_READONLY.has(name) && !ALSO_BLOCKED.has(name))
  .slice(0, 40)
  .map((name) => ({ name, command: `${name} probe.txt` }));

const tierCases = COMMAND_SPECS.filter(
  (spec): spec is typeof spec & { token: string; tier: 'ask' | 'deny' } =>
    typeof spec.token === 'string' &&
    (spec.tier === 'ask' || spec.tier === 'deny')
).map((spec) => ({
  token: spec.token,
  tier: spec.tier,
  command: `${spec.token.trim()} probe-target`,
}));

async function tierOf(command: string): Promise<'deny' | 'ask' | 'allow'> {
  const decision = await classifier.classify('bash', { command }, []);
  if (decision.shouldBlock) return 'deny';
  return decision.requiresApproval ? 'ask' : 'allow';
}

describe('P4：注册表驱动的档位语料', () => {
  it('语料规模 ≥ 300（不足说明注册表被削薄）', () => {
    expect(tierCases.length + readonlySamples.length).toBeGreaterThanOrEqual(
      300
    );
  });

  it('每个 ask / deny 令牌在分类器里落到声明档位（死令牌检测）', async () => {
    const mismatches: string[] = [];
    for (const item of tierCases) {
      const actual = await tierOf(item.command);
      if (actual !== item.tier) {
        mismatches.push(`${item.token} ⇒ ${actual}（期望 ${item.tier}）`);
      }
    }
    expect(mismatches, mismatches.join('; ')).toEqual([]);
  });

  it('只读对照组仍 allow（零新增审批）', async () => {
    for (const sample of readonlySamples) {
      expect(await tierOf(sample.command), sample.command).toBe('allow');
    }
  });
});
