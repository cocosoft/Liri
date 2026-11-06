/**
 * N-16（2026-11-07 真机）：`semicolon_chaining` 注入判定必须**跳过引号内文本**。
 *
 * 实证（`session_mw553loec71420aeaa` 15:43:13）：模型执行
 * `cd … && node --check game.js && node -e "const S=require('./game.js'); const g=S.createGame(…)"`
 * 因**双引号内**的 JS 分号被判「检测到注入攻击: semicolon_chaining」⇒ `safety_blocked` 硬拒
 * ⇒ 连续 2 轮后 `turn_blocked (consecutive environment-blocked turn)`，长任务被打断。
 *
 * 语义：引号内的 `;` 是参数内容（整段是一个 argv），不构成 shell 链式执行；
 * 而 `$(...)` / 反引号在双引号内**仍会执行**，因此只能对分号放宽。
 */
import { describe, expect, it, afterEach } from 'bun:test';

import {
  BashSecurityAnalyzer,
  hasUnquotedSemicolon,
  setNativeBashAnalyzerLoader,
} from '@openliri/infra/security/BashSecurityAnalyzer';

/** 忠实模拟原生分析器：按 `"; "` / ";\n" 子串判注入（不看引号） */
function fakeNative(command: string): object {
  const injections: string[] = [];
  if (command.includes('; ') || command.includes(';\n')) {
    injections.push('semicolon_chaining');
  }
  if (command.includes('$(')) injections.push('command_substitution');
  if (command.includes('`')) injections.push('backtick');
  return {
    risk_level: injections.length > 0 ? 'suspicious' : 'safe',
    matches: [],
    injection_types: injections,
  };
}

describe('hasUnquotedSemicolon（纯函数）', () => {
  it('引号内分号 ⇒ false（不构成链式执行）', () => {
    expect(hasUnquotedSemicolon('node -e "const a=1; const b=2"')).toBe(false);
    expect(hasUnquotedSemicolon("node -e 'a; b'")).toBe(false);
  });

  it('引号外分号 ⇒ true', () => {
    expect(hasUnquotedSemicolon('echo a; echo b')).toBe(true);
    expect(hasUnquotedSemicolon('cd x && echo "a;b"; dir')).toBe(true);
  });

  it('双引号内转义引号不提前结束引号', () => {
    expect(hasUnquotedSemicolon('echo "a\\"b; c"')).toBe(false);
  });

  it('无分号 ⇒ false', () => {
    expect(hasUnquotedSemicolon('dir /b')).toBe(false);
  });
});

describe('N-16：引号内分号不再被判注入硬拒', () => {
  afterEach(() => {
    setNativeBashAnalyzerLoader(null);
  });

  it('node -e "…; …" ⇒ 不再 deny，也不产生 injection:semicolon_chaining', () => {
    setNativeBashAnalyzerLoader(() => fakeNative);
    const r = new BashSecurityAnalyzer().analyze(
      'node -e "const S=require(\'./game.js\'); const g=S.createGame({cols:24});"'
    );
    expect(r.behavior).not.toBe('deny');
    expect(r.matchedPatterns ?? []).not.toContain(
      'injection:semicolon_chaining'
    );
  });

  it('引号外分号（非只读命令）⇒ 仍按链式注入拒绝（负向边界）', () => {
    setNativeBashAnalyzerLoader(() => fakeNative);
    const r = new BashSecurityAnalyzer().analyze('bun install; bun test');
    expect(r.behavior).toBe('deny');
    expect(r.matchedPatterns ?? []).toContain('injection:semicolon_chaining');
  });

  it('命令替换在引号内仍执行 ⇒ 保持拒绝（不放宽其它注入类型）', () => {
    setNativeBashAnalyzerLoader(() => fakeNative);
    const r = new BashSecurityAnalyzer().analyze('echo "$(whoami)"');
    expect(r.behavior).toBe('deny');
  });
});
