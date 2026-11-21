// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0（2026-11-21）：Computer Use 适配器**输入安全边界**回归锁。
 *
 * 缺陷来源：`.trae/specs/browser-use-and-computer-use-completion.md` §1.4 S1–S3 ——
 * `launchApp`/`activateApp`/`keyPress` 曾把工具入参直接字符串插值进 PowerShell/AppleScript，
 * 路径或窗口名含 `'` / `"` 即可跳出字符串执行任意脚本；坐标/时长/质量等数字位传字符串同样可注入。
 *
 * 契约：
 *   ① 文本一律「编码后注入」（PowerShell base64 表达式 / AppleScript 字面量转义），脚本里不出现原文；
 *   ② 按键名走白名单，未知按键直接拒绝（不再原样进 SendWait）；
 *   ③ 数字入参必须是有限数且在范围内；
 *   ④ 适配器源码**不得再出现**裸插值写法（静态守卫，防回退）。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  UnsafeComputerInputError,
  buildSendKeysCombination,
  escapeAppleScriptString,
  psBase64Expression,
  requireInt,
  requireNumber,
  toSendKeysFragment,
  toSendKeysToken,
} from '@openliri/infra/utils/computerUse/safety';

const INJECTION = `C:\\tmp\\a'; Start-Process calc.exe; '`;

/** 取出 PowerShell 表达式里 base64 字面量并解码（验证「可还原」而非「被改写」） */
function decodePsBase64(expr: string): string {
  const match = /FromBase64String\('([A-Za-z0-9+/=]*)'\)/.exec(expr);
  if (!match) throw new Error(`未找到 base64 字面量: ${expr}`);
  return Buffer.from(match[1], 'base64').toString('utf-8');
}

describe('P0：PowerShell 文本注入改走 base64 表达式', () => {
  it('原文可完整还原（含引号/分号/反引号）', () => {
    const expr = psBase64Expression(INJECTION);
    expect(decodePsBase64(expr)).toBe(INJECTION);
  });

  it('表达式里不含任何原始危险字符（引号只出现在 base64 定界处）', () => {
    const expr = psBase64Expression(`x"; Remove-Item C:\\ -Recurse; "\``);
    expect(expr).not.toContain('Remove-Item');
    expect(expr).not.toContain(';');
    // 仅允许成对包裹 base64 的两个单引号
    expect(expr.split("'").length - 1).toBe(2);
  });
});

describe('P0：SendKeys 按键白名单', () => {
  it('命名键大小写归一', () => {
    expect(toSendKeysToken('enter')).toBe('ENTER');
    expect(toSendKeysToken('Esc')).toBe('ESC');
    expect(toSendKeysToken('f12')).toBe('F12');
    expect(toSendKeysToken('pagedown')).toBe('PGDN');
  });

  it('单字符键保留（字母/数字/安全符号）', () => {
    expect(toSendKeysToken('a')).toBe('A');
    expect(toSendKeysToken('7')).toBe('7');
    expect(toSendKeysFragment('a')).toBe('A');
    expect(toSendKeysFragment('enter')).toBe('{ENTER}');
  });

  it('未知/危险按键直接拒绝（含跳出字符串的尝试）', () => {
    expect(() => toSendKeysToken(`x'} ; Start-Process calc; '`)).toThrow(
      UnsafeComputerInputError
    );
    expect(() => toSendKeysToken('{TAB}')).toThrow(UnsafeComputerInputError);
    expect(() => toSendKeysToken('')).toThrow(UnsafeComputerInputError);
  });

  it('组合键：修饰键与主键都走白名单', () => {
    expect(buildSendKeysCombination('ctrl+c')).toBe('^C');
    expect(buildSendKeysCombination('ctrl+shift+esc')).toBe('^+{ESC}');
    expect(buildSendKeysCombination('alt+tab')).toBe('%{TAB}');
    expect(buildSendKeysCombination('win+r')).toBe('^R');
    expect(() => buildSendKeysCombination('hyper+c')).toThrow(
      UnsafeComputerInputError
    );
    expect(() => buildSendKeysCombination(`ctrl+'; calc; '`)).toThrow(
      UnsafeComputerInputError
    );
  });
});

describe('P0：AppleScript 字符串转义', () => {
  it('引号与反斜杠被转义（无法闭合字面量）', () => {
    expect(escapeAppleScriptString('a"b')).toBe('a\\"b');
    expect(escapeAppleScriptString('a\\b')).toBe('a\\\\b');
    expect(escapeAppleScriptString('tell application "x" to quit')).toBe(
      'tell application \\"x\\" to quit'
    );
  });

  it('换行被拒绝（避免改变脚本结构）', () => {
    expect(() => escapeAppleScriptString('a\nb')).toThrow(
      UnsafeComputerInputError
    );
    expect(() => escapeAppleScriptString('a\rb')).toThrow(
      UnsafeComputerInputError
    );
  });
});

describe('P0：数字入参范围校验', () => {
  it('非数字（含字符串注入）拒绝', () => {
    expect(() => requireInt('100; calc' as unknown, 'x')).toThrow(
      UnsafeComputerInputError
    );
    expect(() => requireInt(Number.NaN, 'x')).toThrow(UnsafeComputerInputError);
    expect(() => requireInt(1.5, 'x')).toThrow(UnsafeComputerInputError);
    expect(() => requireNumber('0.5' as unknown, 'quality')).toThrow(
      UnsafeComputerInputError
    );
  });

  it('范围外拒绝、范围内通过', () => {
    expect(() => requireInt(0, 'displayId', { min: 1 })).toThrow(
      UnsafeComputerInputError
    );
    expect(() => requireNumber(1.5, 'quality', { max: 1 })).toThrow(
      UnsafeComputerInputError
    );
    expect(requireInt(80, 'x', { min: -100, max: 100 })).toBe(80);
    expect(requireNumber(0.75, 'quality', { min: 0.01, max: 1 })).toBe(0.75);
  });
});

describe('P0：适配器源码静态守卫（防回退到裸插值）', () => {
  const root = join(import.meta.dir, '..', '..', '..');
  const read = (p: string): string => readFileSync(join(root, p), 'utf-8');

  it('WindowsAdapter 不再把用户文本/按键裸拼进脚本', () => {
    const src = read('packages/infra/src/utils/computerUse/WindowsAdapter.ts');
    expect(src).not.toContain("Start-Process '${");
    expect(src).not.toContain("FindWindow([nullstring]::value, '${");
    expect(src).not.toContain('${action.key}');
    expect(src).not.toContain('${action.key.toUpperCase()}');
    // 已改为 base64 注入
    expect(src).toContain('psBase64Expression');
  });

  it('MacAdapter 的 keystroke / tell application 已转义', () => {
    const src = read('packages/infra/src/utils/computerUse/MacAdapter.ts');
    expect(src).not.toContain('keystroke "${action.key}"');
    expect(src).not.toContain('tell application "${bundleId}"');
    expect(src).toContain('escapeAppleScriptString');
  });
});
