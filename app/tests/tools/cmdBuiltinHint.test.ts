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
  buildPosixOnCmdHint,
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

describe('反向：POSIX 命令写在 cmd.exe 上（2026-11-24 会话复盘）', () => {
  const CMD_MSG =
    "'pwd' is not recognized as an internal or external command,\noperable program or batch file.";

  it('win32 + cmd 专属文案 + pwd ⇒ 给 cd', () => {
    const hint = buildPosixOnCmdHint('pwd', {
      platform: 'win32',
      message: CMD_MSG,
    });
    expect(hint).toContain('「pwd」');
    expect(hint).toContain('cd');
    expect(hint).toContain('cmd.exe');
  });

  it('管道末段的 head 也能识别（真机 seq=143 形态：首 token 是 cd/dir）', () => {
    const hint = buildPosixOnCmdHint(
      'cd /d E:\\proj && dir /b docs 2>nul | head -3',
      {
        platform: 'win32',
        message:
          "'head' is not recognized as an internal or external command, operable program or batch file.",
      }
    );
    expect(hint).toContain('「head」');
    expect(hint).toContain('Get-Content');
  });

  it('命令里带引号路径时，仍取紧邻报错文案的词（不误取路径片段）', () => {
    const hint = buildPosixOnCmdHint('cd /d "E:\\proj\\app" && pwd', {
      platform: 'win32',
      message:
        'Command failed: cd /d "E:\\proj\\app" && pwd\n' +
        "'pwd' is not recognized as an internal or external command",
    });
    expect(hint).toContain('「pwd」');
  });

  it('POSIX shell 的 command not found ⇒ 空串（方向判断不误伤）', () => {
    expect(
      buildPosixOnCmdHint('pwd', {
        platform: 'win32',
        message: 'sh: pwd: command not found',
      })
    ).toBe('');
  });

  it('非 win32 ⇒ 空串', () => {
    expect(
      buildPosixOnCmdHint('pwd', { platform: 'linux', message: CMD_MSG })
    ).toBe('');
  });

  it('不在表内的命令 ⇒ 空串（不编造等价写法）', () => {
    expect(
      buildPosixOnCmdHint('foo --bar', {
        platform: 'win32',
        message: "'foo' is not recognized as an internal or external command",
      })
    ).toBe('');
  });

  it('中文 cmd 文案（不是内部或外部命令）同样命中', () => {
    expect(
      buildPosixOnCmdHint('ls', {
        platform: 'win32',
        message: "'ls' 不是内部或外部命令，也不是可运行的程序或批处理文件。",
      })
    ).toContain('dir');
  });
});
