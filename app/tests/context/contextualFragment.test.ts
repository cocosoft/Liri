// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B3-2（2026-09-23）：注入片段统一类型 —— **前缀契约与逐字不变**锁定。
 *
 * 契约见 `.trae/specs/context-contract.md` CC-06：前缀由类型按 `kind` 给出，
 * 渲染唯一走 `renderFragment()`。本文件把"迁移前后**逐字一致**"钉死：
 * 每例都把迁移前调用方的**原始拼装写法**写在断言右侧（legacy），左侧走新类型渲染。
 */
import { describe, test, expect } from 'bun:test';
import {
  createFragment,
  renderFragment,
  type FragmentKind,
} from '../../src/context/fragments/ContextualFragment';

describe('B3-2 前缀契约：kind → 通道前缀（唯一来源）', () => {
  test('四个 kind 的前缀与既有协议标记逐字一致', () => {
    const prefixOf = (kind: FragmentKind): string =>
      renderFragment(createFragment({ kind, text: '' }));
    expect(prefixOf('system')).toBe('[SYSTEM] ');
    expect(prefixOf('steering')).toBe('[STEERING] ');
    expect(prefixOf('goal_instruction')).toBe('[SYSTEM] ');
    expect(prefixOf('goal_continuation')).toBe('');
  });

  test('渲染 = prefix + text，不插入分隔符（与 codex render() 同语义）', () => {
    expect(
      renderFragment(
        createFragment({ kind: 'steering', text: '来自用户的干预' })
      )
    ).toBe('[STEERING] 来自用户的干预');
  });
});

describe('B3-2 逐字不变：迁移前调用方写法 == 迁移后类型渲染', () => {
  test('ReActToolLoop.onSteering：`[STEERING] ${sm}`', () => {
    const sm = '请停止探索并总结当前进度';
    const legacy = `[STEERING] ${sm}`; // 迁移前：调用方手写前缀
    const now = renderFragment(createFragment({ kind: 'steering', text: sm }));
    expect(now).toBe(legacy);
  });

  test('AgentTool 批次 tool result：`${out}\n\n[SYSTEM] ${instruction}`', () => {
    const aggregatedOutput = '## Worker 结果';
    const body =
      'This task has exhausted its token budget (150/100). Stop starting new work now.';
    const legacy = `${aggregatedOutput}\n\n[SYSTEM] ${body}`; // 迁移前：调用方手写前缀
    const now = `${aggregatedOutput}\n\n${renderFragment(
      createFragment({
        kind: 'goal_instruction',
        text: body,
        source: 'goal',
        goalId: 'g1',
      })
    )}`;
    expect(now).toBe(legacy);
  });

  test('user_message / steering 正文通道：目标续接正文**不含前缀**', () => {
    const body = 'The unfinished goal is still open (objective: "跑通"); ...';
    // 迁移前：`takeIdleContinuationInstruction` / `takeMainSessionBudgetWrapUp` 直接返回正文
    const now = renderFragment(
      createFragment({
        kind: 'goal_continuation',
        text: body,
        source: 'goal',
        goalId: 'g2',
      })
    );
    expect(now).toBe(body);
    expect(now.startsWith('[STEERING]')).toBe(false);
    expect(now.startsWith('[SYSTEM]')).toBe(false);
  });
});
