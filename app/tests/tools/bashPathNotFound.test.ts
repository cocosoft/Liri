// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F5（2026-11-04，前端会话跟踪）：只读列举类命令的「路径不存在」判定。
 *
 * 真机会话实证：`dir output` / `dir /s /b /ad "…*01_work*"` 等 30 次 `bash: execute_error`，
 * 错误文本均为 `File Not Found` / `The system cannot find the file specified.`（exit 1）。
 * "目标确实没有"是事实查询的答案，不该计为工具失败（否则模型重复同一命令、逼近熔断）。
 */
import { describe, it, expect } from 'bun:test';
import { isPathNotFound } from '../../src/tools/bash/pathNotFound';

describe('isPathNotFound：只读列举的"路径不存在"判定', () => {
  it('cmd 形态（File Not Found / 系统找不到）⇒ true', () => {
    expect(
      isPathNotFound({
        command: 'dir /b output',
        exitCode: 1,
        message: 'Command failed: dir /b output File Not Found',
      })
    ).toBe(true);
    expect(
      isPathNotFound({
        command: 'dir output\\mario-1-1',
        exitCode: 1,
        stderr: 'The system cannot find the file specified.',
      })
    ).toBe(true);
  });

  it('POSIX 形态（No such file or directory）⇒ true', () => {
    expect(
      isPathNotFound({
        command: 'ls -la output/',
        exitCode: 1,
        stderr: "ls: cannot access 'output/': No such file or directory",
      })
    ).toBe(true);
    expect(
      isPathNotFound({
        command: 'cat missing.md',
        exitCode: 1,
        stderr: 'cat: missing.md: No such file or directory',
      })
    ).toBe(true);
  });

  it('退出码非 1 ⇒ false（语法/IO 错误照旧失败）', () => {
    expect(
      isPathNotFound({
        command: 'find /c /n output/PRD.md',
        exitCode: 2,
        stderr: 'FIND: Parameter format not correct',
      })
    ).toBe(false);
  });

  it('非只读列举命令 ⇒ false（写操作/其它命令不得被当成"路径不存在"）', () => {
    expect(
      isPathNotFound({
        command: 'del output\\a.txt',
        exitCode: 1,
        stderr: 'The system cannot find the file specified.',
      })
    ).toBe(false);
    expect(
      isPathNotFound({
        command: 'bun run missing.ts',
        exitCode: 1,
        stderr: 'No such file or directory',
      })
    ).toBe(false);
  });

  it('错误文本不含"缺失"文案 ⇒ false（权限/语法等真失败）', () => {
    expect(
      isPathNotFound({
        command: 'dir output',
        exitCode: 1,
        stderr: 'Access is denied.',
      })
    ).toBe(false);
    expect(
      isPathNotFound({ command: 'dir output', exitCode: 1, message: '' })
    ).toBe(false);
  });

  it('无命令 ⇒ false', () => {
    expect(
      isPathNotFound({
        command: undefined,
        exitCode: 1,
        stderr: 'File Not Found',
      })
    ).toBe(false);
  });
});
