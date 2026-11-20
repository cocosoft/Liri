// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 复合工具「按 op 的副作用/幂等覆盖」回归（2026-11-20，第 ② 步）
 *
 * 背景：`TOOL_EFFECTS` 原为**工具级**（`cron/vfs/worktree/skill/task_list` 整体 `LOCAL`）
 * ⇒ 只读子操作（`vfs read` / `cron list` / `task_list get` / `skill view`）也被判
 * "非幂等 ⇒ 禁止盲目重试"。本批给这些族加 `discriminator + byOperation` 覆盖：
 * - 只读子操作 ⇒ `NONE`（幂等、无副作用）；
 * - 写/执行子操作 ⇒ 保持工具级声明；
 * - **不传 input / 判别值未登记 ⇒ 回退工具级**（保守，与既有调用点零行为变更）。
 */

import { describe, expect, it } from 'bun:test';
import {
  resolveToolEffect,
  shouldBlindRetryTool,
  resolveToolRetryBudget,
  isNonIdempotentRetry,
  isBlockedForUntrustedOrigin,
  TOOL_EFFECTS,
} from '../../src/tools/toolEffects.js';
import { createCronFamilyTool } from '../../src/tools/families/CronFamilyTool.js';
import { createTaskListFamilyTool } from '../../src/tools/families/TaskListFamilyTool.js';
import { createVfsFamilyTool } from '../../src/tools/families/VfsFamilyTool.js';
import { createSkillFamilyTool } from '../../src/tools/families/SkillFamilyTool.js';
import type { FamilyTool } from '../../src/tools/families/familyTool.js';

const families: Array<[string, FamilyTool]> = [
  ['cron', createCronFamilyTool()],
  ['task_list', createTaskListFamilyTool()],
  ['vfs', createVfsFamilyTool()],
  ['skill', createSkillFamilyTool()],
];

describe('按 op 的 effects 覆盖（2026-11-20，第 ② 步）', () => {
  it('vfs：只读三个 op ⇒ 幂等无副作用；write ⇒ 保持工具级 LOCAL', () => {
    for (const op of ['read', 'list', 'stat']) {
      const effect = resolveToolEffect('vfs', { op });
      expect(effect?.idempotent).toBe(true);
      expect(effect?.sideEffect).toBe('none');
    }
    const write = resolveToolEffect('vfs', { op: 'write' });
    expect(write?.idempotent).toBe(false);
    expect(write?.sideEffect).toBe('local');
  });

  it('cron / task_list / skill：只读子操作覆盖为 NONE', () => {
    expect(resolveToolEffect('cron', { op: 'list' })?.sideEffect).toBe('none');
    expect(resolveToolEffect('task_list', { op: 'get' })?.sideEffect).toBe(
      'none'
    );
    expect(resolveToolEffect('skill', { op: 'view' })?.sideEffect).toBe('none');
    expect(resolveToolEffect('skill', { op: 'list' })?.sideEffect).toBe('none');
    // 写/执行分支保持工具级（保守）
    expect(resolveToolEffect('cron', { op: 'create' })?.sideEffect).toBe(
      'local'
    );
    expect(resolveToolEffect('skill', { op: 'run' })?.sideEffect).toBe('local');
  });

  it('不传 input 或判别值未登记 ⇒ 回退工具级（零行为变更）', () => {
    for (const [name] of families) {
      const base = TOOL_EFFECTS[name as keyof typeof TOOL_EFFECTS];
      const withoutInput = resolveToolEffect(name);
      const unknownOp = resolveToolEffect(name, { op: 'not-registered' });
      expect(withoutInput?.sideEffect).toBe(base.sideEffect);
      expect(unknownOp?.idempotent).toBe(base.idempotent);
      expect(unknownOp?.sideEffect).toBe(base.sideEffect);
    }
  });

  it('重试闸门按 op 生效：只读可重试，写分支不可', () => {
    expect(shouldBlindRetryTool('vfs', { op: 'read' })).toBe(true);
    expect(shouldBlindRetryTool('vfs', { op: 'write' })).toBe(false);
    expect(shouldBlindRetryTool('vfs')).toBe(false); // 保守回退

    expect(resolveToolRetryBudget('vfs', { op: 'read' }).maxRetries).toBe(2);
    expect(resolveToolRetryBudget('vfs', { op: 'write' }).maxRetries).toBe(0);
  });

  it('isNonIdempotentRetry：只读 op 的同参重放不算"非幂等重试"', () => {
    const args = { op: 'read', path: 'dev_docs://x' };
    const history = [{ toolName: 'vfs', arguments: args, error: 'boom' }];
    expect(isNonIdempotentRetry('vfs', args, history)).toBe(false);
    // 负向对照：写分支同参重放仍被判非幂等重试
    const writeArgs = { op: 'write', path: 'dev_docs://x' };
    expect(
      isNonIdempotentRetry('vfs', writeArgs, [
        { toolName: 'vfs', arguments: writeArgs, error: 'boom' },
      ])
    ).toBe(true);
  });

  it('不可信来源：只读 op 放行，写 op 仍拒绝', () => {
    expect(isBlockedForUntrustedOrigin('vfs', { op: 'read' })).toBe(false);
    expect(isBlockedForUntrustedOrigin('vfs', { op: 'write' })).toBe(true);
  });

  it('一致性：族内「只读成员」必须覆盖为 NONE（防止成员表与 effects 漂移）', () => {
    for (const [name, tool] of families) {
      const decl = tool.memberDeclarations;
      expect(decl.length).toBeGreaterThan(0);
      for (const member of decl) {
        const effect = resolveToolEffect(name, { op: member.key });
        if (member.readOnly) {
          expect(`${name}/${member.key}:${effect?.sideEffect}`).toBe(
            `${name}/${member.key}:none`
          );
          expect(effect?.idempotent).toBe(true);
        }
      }
    }
  });
});
