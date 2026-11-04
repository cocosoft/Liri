// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3（2026-11-04，前端会话跟踪）：`findstr`/`grep` 的"无匹配"（exit 1 + 双空）判定。
 *
 * 真机会话实证：`dir /b /s /ad 2>nul | findstr /i "mario"` 被判 `bash: execute_error`
 * ⇒ 计入 `all-tools-failed`（3 次触发熔断）。本文件钉住判据的**收窄边界**：
 * 只有「exit 恰为 1 + stdout/stderr 均空 + 末段是检索命令 + 末段无输出重定向」才算无匹配。
 */
import { describe, it, expect } from 'bun:test';
import { isSearchNoMatch } from '../../src/tools/bash/searchNoMatch';

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

  it('POSIX 管道与无管道检索都识别', () => {
    expect(
      isSearchNoMatch({ command: 'ls -R | grep mario', exitCode: 1 })
    ).toBe(true);
    expect(isSearchNoMatch({ command: 'grep foo file.txt', exitCode: 1 })).toBe(
      true
    );
    expect(isSearchNoMatch({ command: 'rg "pattern"', exitCode: 1 })).toBe(
      true
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
      isSearchNoMatch({ command: '"findstr.exe" /i mario *.txt', exitCode: 1 })
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
