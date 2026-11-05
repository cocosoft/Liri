// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1-2（2026-11-05）：`cd /d "C:\..."` 是 Windows 切盘符的**合法写法**，
 * 不得被判成「cd 到 Unix 根路径」。
 *
 * 现场：旧判据 `/\bcd\s+\/[a-z]/` 命中 `/d` ⇒ 阻断；而同一函数给出的提示语恰恰
 * 建议用户写 `cd /d "E:\真实目录"`（提示与判据自相矛盾）。真机导出里 4 条
 * `❌ 终端命令 — cd /d "C:\Users\csdnc\Documents\LiriProj..."` 即此形态。
 */
import { describe, it, expect } from 'bun:test';
import { preprocessWindowsCommand } from '../../src/tools/bash/commandNormalization.js';

const hasUnixRootWarning = (cmd: string): boolean =>
  preprocessWindowsCommand(cmd).warnings.some((w) =>
    w.includes('禁止: cd 到 Unix 根路径')
  );

describe('P1-2：cd 开关不被误判为 Unix 根路径', () => {
  it('`cd /d "C:\\..."` ⇒ 不产生 Unix 根路径阻断', () => {
    expect(
      hasUnixRootWarning('cd /d "C:\\Users\\csdnc\\Documents\\LiriProjects"')
    ).toBe(false);
    expect(hasUnixRootWarning('cd /D "C:\\Users\\csdnc"')).toBe(false);
  });

  it('`cd /usr/local` 等真正的 Unix 根路径 ⇒ 仍然阻断', () => {
    expect(hasUnixRootWarning('cd /usr/local')).toBe(true);
    expect(hasUnixRootWarning('cd /etc && dir')).toBe(true);
  });

  it('`cd /dxyz` 不是开关（多字母）⇒ 仍按 Unix 根路径处理', () => {
    expect(hasUnixRootWarning('cd /dxyz')).toBe(true);
  });

  // P1-2 ②（2026-11-05）：提示语与判据**同源自证** —— 拒绝文案里的建议必须自己能过判据。
  // 本用例从警告文案里抽出反引号建议，再喂回同一函数：一旦有人改了建议却没同步判据，立即红。
  it('拒绝文案里给出的 `cd /d "…"` 建议自身不被拦截（提示语自证）', () => {
    const { warnings } = preprocessWindowsCommand('cd /usr/local');
    const warning = warnings.find((w) => w.includes('禁止: cd 到 Unix 根路径'));
    expect(warning).toBeDefined();
    const suggested = /`([^`]+)`/.exec(warning ?? '')?.[1];
    expect(suggested).toBeDefined();
    expect(hasUnixRootWarning(suggested!)).toBe(false);
  });
});
