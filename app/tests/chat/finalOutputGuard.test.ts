// MIT License
// Copyright (c) 2026 190615273@qq.com
// 终稿守卫契约用例（P0-1② 覆盖面补齐，.trae/specs/final-output-guard-no-tool-turns.md）
//
// 覆盖：干净放行 / 命中先落盘再修复 / 修复失败如实放行 / 修复抛错不向上抛。

import { describe, expect, it } from 'bun:test';
import { guardFinalOutput } from '../../src/chat/finalOutputGuard';
import type { MermaidLintIssue } from '@modules/types/mermaid';
import type { OutputGuard } from '@modules/core';

const ISSUE: MermaidLintIssue = {
  blockIndex: 0,
  line: 1,
  reason: '无法识别的图类型「flowmap」',
};

/** 记录调用顺序，用于验证「先落盘再修复」不可颠倒 */
function makeDeps(opts: {
  issues?: MermaidLintIssue[];
  repaired?: string | null;
  repairThrows?: boolean;
  order?: string[];
}) {
  const order = opts.order ?? [];
  return {
    lint: () => opts.issues ?? [],
    renderInstruction: (issues: MermaidLintIssue[]) =>
      `REPAIR:${issues.length}`,
    emitValidationInjected: async () => {
      order.push('emit');
    },
    repair: async (instruction: string) => {
      order.push(`repair:${instruction}`);
      if (opts.repairThrows) throw new Error('boom');
      return opts.repaired ?? null;
    },
  };
}

describe('finalOutputGuard：终稿 mermaid 校验 + 有界修复', () => {
  it('无问题 ⇒ 原样返回，且不落事件、不修复', async () => {
    const order: string[] = [];
    const r = await guardFinalOutput(
      '```mermaid\ngraph TD\nA-->B\n```',
      makeDeps({ issues: [], order })
    );
    expect(r.repaired).toBe(false);
    expect(r.issues).toEqual([]);
    expect(order).toEqual([]);
  });

  it('命中 ⇒ **先落 validation/injected 再修复**，返回修正后正文', async () => {
    const order: string[] = [];
    const r = await guardFinalOutput(
      'bad',
      makeDeps({ issues: [ISSUE], repaired: 'FIXED', order })
    );
    expect(r.repaired).toBe(true);
    expect(r.text).toBe('FIXED');
    // 顺序不可颠倒（§1.6）
    expect(order).toEqual(['emit', 'repair:REPAIR:1']);
  });

  it('修复无产出（null）⇒ 如实原样放行（repaired=false，不静默）', async () => {
    const r = await guardFinalOutput(
      'bad',
      makeDeps({ issues: [ISSUE], repaired: null })
    );
    expect(r.repaired).toBe(false);
    expect(r.text).toBe('bad');
  });

  it('修复抛错 ⇒ 不向上抛，原样放行（CS03）', async () => {
    const r = await guardFinalOutput(
      'bad',
      makeDeps({ issues: [ISSUE], repairThrows: true })
    );
    expect(r.repaired).toBe(false);
    expect(r.text).toBe('bad');
  });

  it('修复产出仅空白 ⇒ 视为无产出', async () => {
    const r = await guardFinalOutput(
      'bad',
      makeDeps({ issues: [ISSUE], repaired: '   ' })
    );
    expect(r.repaired).toBe(false);
    expect(r.text).toBe('bad');
  });
});

// 13-P2-1（2026-10-05）：统一输出护栏接入终稿守卫（打码 / 阻断 / 修复产物复检）
const MASK_GUARD: OutputGuard = {
  name: 'test_mask',
  priority: 1,
  check: (t) => ({
    action: 'redact',
    text: t.replace('SECRET', '***'),
    issues: [{ guard: 'test_mask', severity: 'warn', message: 'masked' }],
  }),
};

describe('finalOutputGuard：接入统一输出护栏（13-P2-1）', () => {
  it('打码护栏 ⇒ redacted=true 且正文被改写（无 mermaid 问题时也生效）', async () => {
    const r = await guardFinalOutput('has SECRET here', {
      ...makeDeps({ issues: [] }),
      outputGuards: [MASK_GUARD],
    });
    expect(r.redacted).toBe(true);
    expect(r.text).toBe('has *** here');
    expect(r.repaired).toBe(false);
    expect(r.guardIssues?.[0]?.guard).toBe('test_mask');
  });

  it('阻断护栏 ⇒ blocked=true + 替代文本，且**不再**落盘/修复', async () => {
    const order: string[] = [];
    const blocker: OutputGuard = {
      name: 'test_block',
      priority: 1,
      check: () => ({
        action: 'block',
        text: 'SAFE',
        issues: [
          { guard: 'test_block', severity: 'block', message: 'high risk' },
        ],
      }),
    };
    const r = await guardFinalOutput('bad', {
      ...makeDeps({ issues: [ISSUE], order }),
      outputGuards: [blocker],
    });
    expect(r.blocked).toBe(true);
    expect(r.text).toBe('SAFE');
    expect(r.blockReason).toBe('high risk');
    expect(order).toEqual([]);
  });

  it('修复产物**再过一次**护栏 ⇒ 修复轮带回的敏感内容被打码', async () => {
    const r = await guardFinalOutput('clean', {
      ...makeDeps({ issues: [ISSUE], repaired: 'FIXED SECRET' }),
      outputGuards: [MASK_GUARD],
    });
    expect(r.repaired).toBe(true);
    expect(r.text).toBe('FIXED ***');
    expect(r.redacted).toBe(true);
  });

  it('未注入护栏 ⇒ 行为与 13-P2-1 前完全一致（blocked/redacted 均为 false）', async () => {
    const r = await guardFinalOutput(
      'clean',
      makeDeps({ issues: [ISSUE], repaired: 'FIXED' })
    );
    expect(r.repaired).toBe(true);
    expect(r.text).toBe('FIXED');
    expect(r.redacted).toBe(false);
    expect(r.blocked).toBe(false);
  });
});
