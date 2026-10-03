/**
 * 快速路径判据配置化测试（T-②05，2026-10-03）
 *
 * 覆盖：默认值、配置覆盖、非法值回退（fail-closed）、非法正则容错、编译标志、记忆化。
 * 纯函数在 `src/types/fastPath.ts`；运行时解析在 `src/tasks/fastPathPolicy.ts`。
 */
import { describe, it, expect } from 'bun:test';
import {
  DEFAULT_DANGEROUS_INTENT_PATTERNS,
  DEFAULT_FAST_PATH_MAX_LENGTH,
  MAX_INTENT_PATTERN_LENGTH,
  buildFastPathPolicy,
  compileIntentPatterns,
  type FastPathConfig,
} from '../../src/types/fastPath';
import { resolveFastPathPolicy } from '../../src/tasks/fastPathPolicy';

/** 构造「非法配置」用（模拟用户手写 JSON 的类型越界） */
function asConfig(value: unknown): FastPathConfig {
  return value as FastPathConfig;
}

describe('buildFastPathPolicy — 配置 → 判据（纯函数）', () => {
  it('无配置（null/undefined）⇒ 默认阈值 + 默认清单', () => {
    for (const input of [null, undefined]) {
      const { policy, invalidPatterns } = buildFastPathPolicy(input);
      expect(policy.maxSimpleTaskLength).toBe(DEFAULT_FAST_PATH_MAX_LENGTH);
      expect(policy.dangerousIntentPatterns).toHaveLength(
        DEFAULT_DANGEROUS_INTENT_PATTERNS.length
      );
      expect(invalidPatterns).toEqual([]);
    }
  });

  it('阈值配置生效；小数向下取整', () => {
    expect(
      buildFastPathPolicy(asConfig({ maxSimpleTaskLength: 120 })).policy
        .maxSimpleTaskLength
    ).toBe(120);
    expect(
      buildFastPathPolicy(asConfig({ maxSimpleTaskLength: 99.9 })).policy
        .maxSimpleTaskLength
    ).toBe(99);
  });

  it('阈值非法（0/负/NaN/Infinity/非数）⇒ 回退默认（fail-closed）', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '80']) {
      expect(
        buildFastPathPolicy(asConfig({ maxSimpleTaskLength: bad })).policy
          .maxSimpleTaskLength
      ).toBe(DEFAULT_FAST_PATH_MAX_LENGTH);
    }
  });

  it('正则清单配置生效，且大小写不敏感（统一 i 标志）', () => {
    const { policy, invalidPatterns } = buildFastPathPolicy(
      asConfig({ dangerousIntentPatterns: ['foo'] })
    );
    expect(policy.dangerousIntentPatterns).toHaveLength(1);
    expect(policy.dangerousIntentPatterns[0].test('FOO')).toBe(true);
    expect(policy.dangerousIntentPatterns[0].source).toBe('foo');
    expect(invalidPatterns).toEqual([]);
  });

  it('正则清单为空数组 ⇒ 回退默认清单（不留空，避免放开危险意图筛除）', () => {
    const { policy } = buildFastPathPolicy(
      asConfig({ dangerousIntentPatterns: [] })
    );
    expect(policy.dangerousIntentPatterns).toHaveLength(
      DEFAULT_DANGEROUS_INTENT_PATTERNS.length
    );
  });

  it('非数组正则清单 ⇒ 回退默认清单', () => {
    const { policy } = buildFastPathPolicy(
      asConfig({ dangerousIntentPatterns: 'not-an-array' })
    );
    expect(policy.dangerousIntentPatterns).toHaveLength(
      DEFAULT_DANGEROUS_INTENT_PATTERNS.length
    );
  });

  it('单条非法正则 ⇒ 只作废该条，其余生效，并如实回报 invalid', () => {
    const { policy, invalidPatterns } = buildFastPathPolicy(
      asConfig({ dangerousIntentPatterns: ['foo', '(', 'bar'] })
    );
    expect(policy.dangerousIntentPatterns).toHaveLength(2);
    expect(invalidPatterns).toEqual(['(']);
  });

  it('全部非法 ⇒ 回退默认清单（fail-closed），invalid 仍如实回报', () => {
    const { policy, invalidPatterns } = buildFastPathPolicy(
      asConfig({ dangerousIntentPatterns: ['(', '['] })
    );
    expect(policy.dangerousIntentPatterns).toHaveLength(
      DEFAULT_DANGEROUS_INTENT_PATTERNS.length
    );
    expect(invalidPatterns).toEqual(['(', '[']);
  });
});

describe('compileIntentPatterns — 编译容错（纯函数）', () => {
  it('空输入 ⇒ 空结果', () => {
    expect(compileIntentPatterns([])).toEqual({ patterns: [], invalid: [] });
  });

  it('非字符串 / 空串 / 超长 ⇒ 计入 invalid，不抛错', () => {
    const tooLong = 'a'.repeat(MAX_INTENT_PATTERN_LENGTH + 1);
    const { patterns, invalid } = compileIntentPatterns([
      123,
      '',
      tooLong,
      'ok',
    ]);
    expect(patterns).toHaveLength(1);
    expect(patterns[0].source).toBe('ok');
    expect(invalid).toEqual(['123', '', tooLong]);
  });
});

describe('resolveFastPathPolicy — 运行时解析（读配置 + 记忆化）', () => {
  it('解析结果恒为合法判据（不返回 null，不留空清单）', () => {
    const policy = resolveFastPathPolicy();
    expect(Number.isFinite(policy.maxSimpleTaskLength)).toBe(true);
    expect(policy.maxSimpleTaskLength).toBeGreaterThan(0);
    expect(policy.dangerousIntentPatterns.length).toBeGreaterThan(0);
  });

  it('同一配置 ⇒ 记忆化命中（返回同一对象，不重复编译）', () => {
    expect(resolveFastPathPolicy()).toBe(resolveFastPathPolicy());
  });
});
