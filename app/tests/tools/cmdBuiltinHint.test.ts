// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-2（2026-11-04，《运行态问题排查与修复方案》）：Windows 上把 cmd 内置命令（`dir` / `type` …）
 * 当 shell 命令用时的**等价写法提示**。
 *
 * 关键约束（决定用例形态）：**只有"命令未找到"证据成立时才提示**。实测同类命令也存在
 * exit 1（路径不存在）的形态，那种情况提示"这是 cmd 内置命令"会把模型带偏 ⇒ 必须断言不触发。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildCmdBuiltinHint,
  isCommandNotFoundError,
} from '../../src/tools/bash/cmdBuiltinHint.js';

describe('P2-2：cmd 内置命令 → 等价命令提示', () => {
  it('win32 + cmd 内置命令 + 命令未找到 ⇒ 给出等价写法', () => {
    const hint = buildCmdBuiltinHint('dir /b docs', {
      platform: 'win32',
      commandNotFound: true,
    });
    expect(hint).toContain('「dir」');
    expect(hint).toContain('cmd 内置命令');
    expect(hint).toContain('ls');
    expect(hint).toContain('glob');
  });

  it('win32 + cmd 内置命令 + **非**"命令未找到" ⇒ 空串（exit 1 路径不存在不提示）', () => {
    expect(
      buildCmdBuiltinHint('dir /b docs', {
        platform: 'win32',
        commandNotFound: false,
      })
    ).toBe('');
  });

  it('win32 + 非内置命令 ⇒ 空串（不误伤真实外部命令）', () => {
    expect(
      buildCmdBuiltinHint('git status', {
        platform: 'win32',
        commandNotFound: true,
      })
    ).toBe('');
  });

  it('非 win32 ⇒ 空串（Unix 下这些词与"cmd 内置"无关）', () => {
    expect(
      buildCmdBuiltinHint('dir /b docs', {
        platform: 'linux',
        commandNotFound: true,
      })
    ).toBe('');
  });

  it('取首个 token 判内置（带引号/前置空白也能识别）', () => {
    const hint = buildCmdBuiltinHint('  "findstr" /i foo bar.txt', {
      platform: 'win32',
      commandNotFound: true,
    });
    expect(hint).toContain('「findstr」');
    expect(hint).toContain('grep');
  });
});

describe('P2-2：命令未找到证据判定（提示的误报边界）', () => {
  it('exit 127 ⇒ 是', () => {
    expect(isCommandNotFoundError(127, '')).toBe(true);
  });

  it.each([
    'dir: command not found',
    "'dir' is not recognized as an internal or external command",
    "'dir' 不是内部或外部命令，也不是可运行的程序",
    '无法将“dir”项识别为 cmdlet',
  ])('文案命中「%s」⇒ 是', (rawMsg: string) => {
    expect(isCommandNotFoundError(1, rawMsg)).toBe(true);
  });

  it('exit 1 + 无"未找到"文案（路径不存在）⇒ **否**（不误报）', () => {
    expect(isCommandNotFoundError(1, 'Command failed: dir /b docs')).toBe(
      false
    );
    expect(isCommandNotFoundError(undefined, '')).toBe(false);
  });
});
