/**
 * P1-1（2026-11-22，G1）：`computer_use` 按 `action` 分档 + `launchApp` 参数守卫。
 *
 * 背景：该包此前零 `riskClass` / `sandboxLevel` / `checkPermissions` 覆盖 ⇒ 整工具被
 * `TOOL_EFFECTS=external` 判为 ask；且 `launchApp` 可启动任意程序（含命令解释器），
 * 等价于绕过 bash / powershell 安全链。
 */
import { describe, expect, it } from 'bun:test';

import {
  ComputerUseTool,
  isDeniedLaunchTarget,
  normalizeLaunchTarget,
} from '@openliri/tool-desktop';
import { deriveToolRiskClass } from '@modules/tools/toolRiskClass';

describe('computer_use：按 action 分档风险（G1）', () => {
  const tool = new ComputerUseTool(() => {
    throw new Error('本用例不触达适配器');
  });

  const readonlyActions = [
    'screenshot',
    'getMousePos',
    'getClipboard',
    'getWindows',
    'getFrontmostWindow',
    'getDisplaySize',
    'getAllDisplays',
  ];
  for (const action of readonlyActions) {
    it(`只读动作 ⇒ read：${action}`, () => {
      expect(tool.riskClassFor({ action })).toBe('read');
      expect(deriveToolRiskClass(tool, { action })).toBe('read');
    });
  }

  const externalActions = [
    'mouseClick',
    'keyboardType',
    'keyPress',
    'setClipboard',
    'launchApp',
    'drag',
  ];
  for (const action of externalActions) {
    it(`变更/对外动作 ⇒ external：${action}`, () => {
      expect(tool.riskClassFor({ action })).toBe('external');
      expect(deriveToolRiskClass(tool, { action })).toBe('external');
    });
  }

  it('screenshot + analyze 会把画面发给视觉模型 ⇒ external', () => {
    expect(tool.riskClassFor({ action: 'screenshot', analyze: true })).toBe(
      'external'
    );
    expect(
      deriveToolRiskClass(tool, { action: 'screenshot', analyze: true })
    ).toBe('external');
  });
});

describe('computer_use：launchApp 参数守卫（G1）', () => {
  const tool = new ComputerUseTool(() => {
    throw new Error('本用例不触达适配器');
  });

  const denied = [
    'cmd',
    'C:\\Windows\\System32\\cmd.exe',
    'powershell',
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'wscript.exe',
    'mshta',
    'C:\\Windows\\System32\\rundll32.exe',
    'curl',
    'C:\\temp\\evil.bat',
    'C:\\temp\\evil.ps1',
    'C:\\temp\\setup.msi',
    '/bin/sh',
  ];
  for (const target of denied) {
    it(`拒绝：${target}`, () => {
      const v = tool.validateInput({ action: 'launchApp', text: target });
      expect(v.result).toBe(false);
      if (v.result === false) {
        expect(v.message).toContain('禁止通过 computer_use 启动');
        expect(v.message).toContain('bash / powershell');
      }
    });
  }

  const allowed = [
    'notepad',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'Calculator',
  ];
  for (const target of allowed) {
    it(`放行：${target}`, () => {
      expect(
        tool.validateInput({ action: 'launchApp', text: target }).result
      ).toBe(true);
    });
  }

  it('launchApp 缺 text ⇒ 拒绝（可执行提示）', () => {
    const v = tool.validateInput({ action: 'launchApp' });
    expect(v.result).toBe(false);
    if (v.result === false) expect(v.message).toContain('需要 text');
  });

  it('非 launchApp 动作不受该守卫影响', () => {
    expect(tool.validateInput({ action: 'screenshot' }).result).toBe(true);
    expect(
      tool.validateInput({ action: 'mouseClick', x: 1, y: 2 }).result
    ).toBe(true);
  });

  it('归一化：去目录 / 去 .exe / 小写', () => {
    expect(normalizeLaunchTarget('C:\\Windows\\System32\\CMD.EXE')).toBe('cmd');
    expect(normalizeLaunchTarget('/usr/bin/Bash')).toBe('bash');
    expect(isDeniedLaunchTarget('  "C:\\Windows\\notepad.exe" ')).toBe(false);
  });
});
