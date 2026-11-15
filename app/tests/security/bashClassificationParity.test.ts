// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * bash 命令分类 parity（P3-2/T2a + T2b，2026-11-16）
 *
 * 背景（计划 `dev_docs/dailys/20261116/今日工作计划-20261116.md` §2.2）：
 * 会话 `session_mwgj38hv0f7434c756` 里 79/90 条消息是「等待审批」——
 * 根因之一是 `git rev-list` / `git shortlog` 未进只读判定链，每次取数都弹卡；
 * 另一条是 `bash -lc "…"` / `cmd /c "…"` 这类壳命令按外层壳判成「未知」。
 *
 * 本文件把「期望判定」固化成 JSON fixture（参考 openclaw 的 parity 用例表）：
 * 任何分类规则改动都必须同步 `tests/fixtures/bash-classification-parity.json`，
 * 否则这里会变红 —— 防止 `readOnlyCommands` 的多份事实源再次悄悄漂移。
 *
 * 判定对象是 TypeScript 路径（生产在 `bootstrap/preflight` 注入原生分析器；
 * 无注入时走同一条 TS 链，见 `BashSecurityAnalyzer.lazyInitNative`）。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BashSecurityAnalyzer } from '@openliri/infra/security/BashSecurityAnalyzer';
import { unwrapShellCommand } from '@openliri/infra/security/shellUnwrap';

interface ParityCase {
  command: string;
  expected: 'allow' | 'ask' | 'deny';
  why?: string;
}

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dir, '..', 'fixtures', 'bash-classification-parity.json'),
    'utf-8'
  )
) as { version: number; cases: ParityCase[] };

describe('bash 分类 parity（fixture 驱动）', () => {
  const analyzer = new BashSecurityAnalyzer();

  for (const c of fixture.cases) {
    it(`${c.expected.toUpperCase()} · ${c.command}`, () => {
      expect(analyzer.analyze(c.command).behavior).toBe(c.expected);
    });
  }
});

describe('unwrapShellCommand：只剥壳、不放大权限', () => {
  it('bash -lc / sh -c ⇒ 解出内层脚本', () => {
    expect(unwrapShellCommand('bash -lc "git log --oneline -3"')).toEqual({
      ok: true,
      command: 'git log --oneline -3',
      wrapper: 'bash',
    });
    expect(unwrapShellCommand("sh -c 'git status --short'")).toMatchObject({
      ok: true,
      command: 'git status --short',
      wrapper: 'sh',
    });
  });

  it('cmd /c ⇒ 原样切出后续命令（保留参数形态）', () => {
    expect(unwrapShellCommand('cmd /c "dir /b"')).toMatchObject({
      ok: true,
      command: 'dir /b',
      wrapper: 'cmd /c',
    });
    expect(unwrapShellCommand('cmd /c dir /b')).toMatchObject({
      ok: true,
      command: 'dir /b',
    });
  });

  it('env ⇒ 仅剥离已登记的无害赋值', () => {
    expect(unwrapShellCommand('env NO_COLOR=1 git log')).toMatchObject({
      ok: true,
      command: 'git log',
      wrapper: 'env',
    });
    // 影响代码加载的变量 ⇒ 不剥壳（fail-closed）
    expect(unwrapShellCommand('env PATH=/tmp/x git log').ok).toBe(false);
    expect(unwrapShellCommand('env LD_PRELOAD=/tmp/x.so git log').ok).toBe(
      false
    );
  });

  it('非壳 / 形态不支持 ⇒ ok:false（调用方保持原判）', () => {
    expect(unwrapShellCommand('git log').ok).toBe(false);
    expect(unwrapShellCommand('bash -c a b').ok).toBe(false);
    expect(unwrapShellCommand('bash -lc "unterminated').ok).toBe(false);
    expect(unwrapShellCommand('cmd /k dir').ok).toBe(false);
    expect(unwrapShellCommand('/bin/bash -lc "git log"').ok).toBe(false);
    expect(unwrapShellCommand('powershell -Command "Get-ChildItem"').ok).toBe(
      false
    );
  });
});
