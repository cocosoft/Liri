// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-11（P5 第二步）：auto 模式硬拦令牌表的**收敛守卫**。
 *
 * 背景：该表已从 `permission/classifiers` 迁入 `security/patterns`，并由
 * `dangerousCommands` 统一导出。后续若按方案收敛「普通命令」，本用例保证
 * 真危险令牌与复合命令分隔符**不会被顺手删掉**。
 */
import { describe, expect, it } from 'bun:test';
import { AUTO_MODE_HARD_DENY_TOKENS } from '@openliri/infra/security/patterns/dangerousCommands';

/** 破坏性 / 提权令牌：删除它们等于削弱 auto 档兜底 */
const MUST_DENY = [
  'rm -rf',
  'mkfs',
  'format',
  'chmod 777',
  'dd if=',
  'shutdown',
  'remove-item',
  'sudo',
];

describe('AUTO_MODE_HARD_DENY_TOKENS：真危险令牌必须保留', () => {
  it('破坏性 / 提权令牌全部在表内', () => {
    for (const token of MUST_DENY) {
      expect(AUTO_MODE_HARD_DENY_TOKENS).toContain(token);
    }
  });

  it('管道 / 逻辑与仍按硬拦处理（复合命令不得放行）', () => {
    expect(AUTO_MODE_HARD_DENY_TOKENS).toContain(' | ');
    expect(AUTO_MODE_HARD_DENY_TOKENS).toContain(' && ');
  });
});
