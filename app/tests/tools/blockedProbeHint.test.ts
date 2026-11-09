// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-2（2026-11-04，《运行态问题排查与修复方案》）：**只读探测**命令被安全门拦截时给出路。
 *
 * 实测 `bash: security_gate_blocked` 21 次，形态是 `if exist …` 一类"判断路径/文件是否存在"；
 * 拦截照旧 fail-closed（CD07：不改安全判定），只把"可改用 glob / list / read 工具"这条出路
 * 附在拦截结果上，避免模型反复换写法重试。
 */
import { describe, expect, it } from 'bun:test';
import {
  appendReadOnlyProbeHint,
  buildReadOnlyProbeHint,
} from '../../src/tools/bash/blockedProbeHint.js';

describe('P2-2：只读探测的识别与提示', () => {
  it.each([
    'if exist C:\\docs\\a.md echo yes',
    'IF NOT EXIST "C:\\a b\\c.txt" ( echo missing )',
    'test -f ./a.txt && echo ok',
    'test -d /tmp/x',
    '[ -e /tmp/x ] && echo ok',
  ])('「%s」⇒ 有提示（含 glob / list 出路）', (command: string) => {
    const hint = buildReadOnlyProbeHint(command);
    expect(hint).toContain('只读探测');
    expect(hint).toContain('glob');
    expect(hint).toContain('list');
  });

  it.each(['git status', 'if exists x', 'ls -la', ''])(
    '「%s」不属只读探测 ⇒ 空串（不误伤）',
    (command: string) => {
      expect(buildReadOnlyProbeHint(command)).toBe('');
    }
  );

  // P4（2026-11-04，前端会话跟踪）：遍历文件列表的只读循环
  it.each([
    'for %f in (index.html package.json src\\game.js) do @(for %s in ("%f") do @echo %~zs)',
    'for /f %x in (list.txt) do @echo %x',
  ])('「%s」⇒ 只读循环提示（含 glob / list 出路）', (command: string) => {
    const hint = buildReadOnlyProbeHint(command);
    expect(hint).toContain('只读循环');
    expect(hint).toContain('glob');
    expect(hint).toContain('list');
    // 2026-11-09（`session_mw8fwx3a48ba9e07f9`）：glob/list 不返回文件大小，
    // 模型会为拿大小反复套 for 循环 ⇒ 提示必须给出真正可行的单条命令与工具。
    expect(hint).toContain('dir <文件>');
    expect(hint).toContain('file_read');
  });

  it.each([
    'for %f in (*.tmp) do @del %f',
    'for %f in (a.txt) do @(copy %f b.txt)',
    'for %f in (a.txt) do @echo %f > out.txt',
  ])('循环体含破坏性动作 ⇒ 空串（不当作只读）', (command: string) => {
    expect(buildReadOnlyProbeHint(command)).toBe('');
  });
});

describe('P2-2：拦截结果的追加语义', () => {
  const block = {
    success: false,
    data: '安全检查失败: 命中安全规则',
    error: '安全检查失败: 命中安全规则',
    failureKind: 'safety_blocked' as const,
    metadata: { securityIntercepted: true },
    newMessages: [{ role: 'system' as const, content: 'Error: 命中安全规则' }],
  };

  it('只读探测 ⇒ error / data / 回给模型的消息三处同步追加，其余字段原样保留', () => {
    const out = appendReadOnlyProbeHint(block, 'if exist C:\\a echo 1');
    expect(out).not.toBe(block);
    expect(String(out.error)).toContain('glob');
    expect(String(out.data)).toContain('glob');
    expect(String(out.newMessages?.[0].content)).toContain('glob');
    // 安全拦截的分类/元数据不得被改写（否则会改变上层熔断/恢复语义）
    expect(out.failureKind).toBe('safety_blocked');
    expect(out.metadata).toEqual({ securityIntercepted: true });
  });

  it('非只读探测 ⇒ **原对象**原样返回（零改动）', () => {
    const out = appendReadOnlyProbeHint(block, 'git status');
    expect(out).toBe(block);
  });

  it('无 error / data 的形态也不炸（只补存在的字段）', () => {
    const out = appendReadOnlyProbeHint(
      { newMessages: [{ role: 'system' as const, content: 'x' }] },
      'test -e /tmp'
    );
    expect(out.error).toBeUndefined();
    expect(out.data).toBeUndefined();
    expect(String(out.newMessages?.[0].content)).toContain('glob');
  });
});
