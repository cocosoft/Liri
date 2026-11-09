// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3（2026-11-04，前端会话跟踪）：`findstr`/`grep` 的"无匹配"（exit 1 + 双空）判定。
 *
 * 真机会话实证：`dir /b /s /ad 2>nul | findstr /i "mario"` 被判 `bash: execute_error`
 * ⇒ 计入 `all-tools-failed`（3 次触发熔断）。本文件钉住判据的**收窄边界**：
 * 只有「exit 恰为 1 + stdout/stderr 均空 + 末段是检索命令 + 末段无输出重定向」才算无匹配。
 */
import { afterAll, describe, it, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hasExistingSearchFileTarget,
  isSearchNoMatch,
} from '../../src/tools/bash/searchNoMatch';

describe('isSearchNoMatch：检索无匹配判定', () => {
  it('真机形态（cmd 管道 + findstr 无匹配）⇒ true', () => {
    expect(
      isSearchNoMatch({
        command: 'dir /b /s /ad 2>nul | findstr /i "mario" ',
        exitCode: 1,
        stdout: '',
        stderr: '',
      })
    ).toBe(true);
  });

  it('管道识别；**无管道时不判无匹配**（无法区分缺文件）', () => {
    expect(
      isSearchNoMatch({ command: 'ls -R | grep mario', exitCode: 1 })
    ).toBe(true);
    expect(isSearchNoMatch({ command: 'grep foo file.txt', exitCode: 1 })).toBe(
      false
    );
    expect(isSearchNoMatch({ command: 'rg "pattern"', exitCode: 1 })).toBe(
      false
    );
  });

  it('多级管道只看最后一段（末段是检索命令 ⇒ true）', () => {
    expect(
      isSearchNoMatch({
        command: 'git status --short | awk "{print $2}" | select-string x',
        exitCode: 1,
      })
    ).toBe(true);
  });

  it('.exe 后缀与前导引号不影响识别', () => {
    expect(
      isSearchNoMatch({
        command: 'type a.txt | "findstr.exe" /i mario',
        exitCode: 1,
      })
    ).toBe(true);
  });

  it('有 stdout / stderr ⇒ 不是"无匹配"（false）', () => {
    expect(
      isSearchNoMatch({
        command: 'ls | grep foo',
        exitCode: 1,
        stdout: 'foo.txt',
      })
    ).toBe(false);
    expect(
      isSearchNoMatch({
        command: 'ls | grep foo',
        exitCode: 1,
        stderr: 'grep: error',
      })
    ).toBe(false);
  });

  it('退出码非 1（2+ 是语法/IO 错误）⇒ false', () => {
    expect(isSearchNoMatch({ command: 'ls | grep foo', exitCode: 2 })).toBe(
      false
    );
    expect(isSearchNoMatch({ command: 'ls | grep foo', exitCode: 0 })).toBe(
      false
    );
    expect(isSearchNoMatch({ command: 'ls | grep foo' })).toBe(false);
  });

  it('末段不是检索命令 ⇒ false（普通命令的 exit 1 仍是失败）', () => {
    expect(isSearchNoMatch({ command: 'dir /b /s', exitCode: 1 })).toBe(false);
    expect(
      isSearchNoMatch({ command: 'bun test && echo ok', exitCode: 1 })
    ).toBe(false);
    expect(isSearchNoMatch({ command: '', exitCode: 1 })).toBe(false);
  });

  it('末段带输出重定向 ⇒ false（"无匹配"与"写进文件"不可区分）', () => {
    expect(
      isSearchNoMatch({
        command: 'findstr /i mario *.txt > out.txt',
        exitCode: 1,
      })
    ).toBe(false);
  });
});

// ─── 2026-11-09（会话 `session_mw8fwx3a48ba9e07f9`）：无管道 + 目标文件存在 ───
describe('无管道 + 目标文件存在 ⇒ 同样判「无匹配」', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bash-no-match-'));
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'tests', 'run-tests.mjs'), '// fixture\n', 'utf-8');
  const sep = process.platform === 'win32' ? '\\' : '/';
  const existing = `cd /d "${dir}" && findstr /n /c:"相机只向右推进" tests${sep}run-tests.mjs`;
  const missing = `cd /d "${dir}" && findstr /n /c:"x" tests${sep}missing.mjs`;

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('文件存在 ⇒ 有"存在"证据 + exit 1 双空 ⇒ 无匹配', () => {
    const exists = hasExistingSearchFileTarget(existing, dir);
    expect(exists).toBe(true);
    expect(
      isSearchNoMatch({
        command: existing,
        exitCode: 1,
        stdout: '',
        stderr: '',
        hasExistingFileTarget: exists,
      })
    ).toBe(true);
  });

  it('不带"文件存在"证据 ⇒ 维持旧口径（false）', () => {
    expect(isSearchNoMatch({ command: existing, exitCode: 1 })).toBe(false);
  });

  it('文件不存在 ⇒ 不判无匹配（缺文件仍是失败）', () => {
    expect(hasExistingSearchFileTarget(missing, dir)).toBe(false);
    expect(
      isSearchNoMatch({
        command: missing,
        exitCode: 1,
        stdout: '',
        stderr: '',
        hasExistingFileTarget: false,
      })
    ).toBe(false);
  });

  it('非检索命令 ⇒ false（普通命令 exit 1 仍是失败）', () => {
    expect(
      hasExistingSearchFileTarget(
        `cd /d "${dir}" && node tests${sep}run-tests.mjs`,
        dir
      )
    ).toBe(false);
  });
});
