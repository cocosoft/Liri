// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Q-16（2026-10-23）：命令自定义规则的匹配语义单测。
 *
 * 断言的是**不可绕过**：`prefix` 只认命令开头（`echo rm` 不再命中 `rm`），
 * `regex` 走正则，非法正则一律**不匹配**（既不放大白名单，也不误拦黑名单）。
 */

import { describe, expect, it } from 'bun:test';

import {
  matchesAnyCommandRule,
  matchesCommandRule,
} from '../../src/utils/commandRuleMatch.js';

describe('Q-16 命令规则匹配：prefix（默认）', () => {
  it('命令以规则开头 ⇒ 命中', () => {
    expect(matchesCommandRule('rm -rf /tmp/x', { pattern: 'rm' })).toBe(true);
  });

  it('规则出现在命令中后段 ⇒ 不命中（旧 includes 会被构造绕过）', () => {
    expect(matchesCommandRule('echo rm', { pattern: 'rm' })).toBe(false);
    expect(matchesCommandRule('npm rm lodash', { pattern: 'rm' })).toBe(false);
  });

  it('大小写不敏感 + 两端空白归一', () => {
    expect(matchesCommandRule('  NPM install ', { pattern: ' npm ' })).toBe(
      true
    );
  });

  it('空规则 / 空命令 ⇒ 不命中', () => {
    expect(matchesCommandRule('rm x', { pattern: '   ' })).toBe(false);
    expect(matchesCommandRule('   ', { pattern: 'rm' })).toBe(false);
  });
});

describe('Q-16 命令规则匹配：regex', () => {
  it('按正则匹配（可表达词边界）', () => {
    const rule = {
      pattern: '^npm (install|ci)\\b',
      matchType: 'regex' as const,
    };
    expect(matchesCommandRule('npm install lodash', rule)).toBe(true);
    expect(matchesCommandRule('npm installfoo', rule)).toBe(false);
    expect(matchesCommandRule('echo npm install lodash', rule)).toBe(false);
  });

  it('非法正则 ⇒ 不匹配（不抛错、不当作命中）', () => {
    expect(
      matchesCommandRule('rm -rf /', { pattern: '([', matchType: 'regex' })
    ).toBe(false);
  });
});

describe('Q-16 matchesAnyCommandRule', () => {
  it('缺省/空列表 ⇒ false', () => {
    expect(matchesAnyCommandRule('rm -rf /', undefined)).toBe(false);
    expect(matchesAnyCommandRule('rm -rf /', [])).toBe(false);
  });

  it('任一条命中即 true（prefix 与 regex 可混用）', () => {
    expect(
      matchesAnyCommandRule('git push', [
        { pattern: 'rm' },
        { pattern: '^git push', matchType: 'regex' },
      ])
    ).toBe(true);
  });
});
