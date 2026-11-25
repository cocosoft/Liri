// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具规则播种（2026-11-25）：换机/重装后恢复"安全窄口"白名单。
 *
 * 口径：只补缺失项、不覆盖用户规则、不复活手动删除的旧规则（版本标记）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_TOOL_RULE_SEED,
  applyToolRuleSeed,
} from '@openliri/infra/permission/ruleSeed';
import {
  PermissionBehavior,
  createPermissionRule,
  type PermissionRule,
} from '@openliri/infra/permission/types/PermissionRule';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

/** 内存规则库桩 + 临时标记路径 */
function makeHarness(initial: PermissionRule[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'rule-seed-'));
  dirs.push(dir);
  const rules: PermissionRule[] = [...initial];
  return {
    rules,
    deps: {
      markerPath: join(dir, 'seed-state.json'),
      loadRules: () => rules,
      addRule: (rule: PermissionRule) => {
        rules.push(rule);
      },
    },
  };
}

describe('applyToolRuleSeed', () => {
  it('首次播种：7 条全部补入，并写版本标记', () => {
    const h = makeHarness();
    const result = applyToolRuleSeed(h.deps);
    expect(result).toEqual({ applied: 7, skipped: false });
    expect(h.rules).toHaveLength(7);
    // 二次调用（同版本）⇒ 整体跳过，不重复写
    expect(applyToolRuleSeed(h.deps)).toEqual({ applied: 0, skipped: true });
    expect(h.rules).toHaveLength(7);
  });

  it('已有同键规则（含 deny）⇒ 跳过，绝不覆盖用户规则', () => {
    const h = makeHarness([
      createPermissionRule({
        behavior: PermissionBehavior.DENY,
        toolName: 'bash',
        contentPattern: DEFAULT_TOOL_RULE_SEED.rules[0]!.contentPattern,
      }),
    ]);
    const result = applyToolRuleSeed(h.deps);
    expect(result.applied).toBe(6);
    // 用户那条 deny 原样保留
    expect(h.rules[0]!.behavior).toBe(PermissionBehavior.DENY);
    // 该键只存在一条
    const key = `${h.rules[0]!.toolName}|${h.rules[0]!.contentPattern}`;
    const sameKey = h.rules.filter(
      (r) => `${r.toolName}|${r.contentPattern}` === key
    );
    expect(sameKey).toHaveLength(1);
  });

  it('用户删掉某条种子规则后重启 ⇒ 不复活（已应用版本）', () => {
    const h = makeHarness();
    applyToolRuleSeed(h.deps);
    // 用户删掉第一条
    h.rules.splice(0, 1);
    expect(applyToolRuleSeed(h.deps)).toEqual({ applied: 0, skipped: true });
    expect(h.rules).toHaveLength(6);
  });

  it('版本提升 ⇒ 只补缺失项（已存在的保持原样）', () => {
    const h = makeHarness();
    applyToolRuleSeed(h.deps);
    h.rules.splice(0, 1); // 删掉一条
    const bumped = { ...DEFAULT_TOOL_RULE_SEED, version: 2 };
    expect(applyToolRuleSeed(h.deps, bumped)).toEqual({
      applied: 1,
      skipped: false,
    });
    expect(h.rules).toHaveLength(7);
  });
});
