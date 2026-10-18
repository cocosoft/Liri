// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * A-4（2026-10-18）工具名字符串分支 → 能力声明位 / 角色集合 的**守卫测试**。
 *
 * 两件事各自钉死：
 * 1. `utils/toolContract/toolRoles.ts` 的成员域（原散落字面量的**逐字等价**，防止悄悄放宽）；
 * 2. `BashTool` 的 `sandboxLevel = 'execution'` 声明能被 `getCapability()` 派生为
 *    `capability: 'execute'` —— 即 `ToolExecutor.performSecurityCheck` 的判据来源。
 */

import { describe, it, expect } from 'bun:test';

import {
  isFileWriteToolName,
  isMediaOutputToolName,
  isShellToolName,
} from '../../src/utils/toolContract/toolRoles.js';
import { BashTool } from '../../src/tools/bash/BashTool.js';
import { ApprovedCommandRegistry } from '../../src/permission/ApprovedCommandRegistry.js';

describe('A-4 角色集合（名称级判据单一来源）', () => {
  it('shell 组：bash / shell / command 命中（原 PermissionChecker 判据逐字等价）', () => {
    expect(isShellToolName('bash')).toBe(true);
    expect(isShellToolName('shell')).toBe(true);
    expect(isShellToolName('command')).toBe(true);
  });

  it('shell 组不额外纳入 powershell（原判据只覆盖三名，避免行为变更）', () => {
    expect(isShellToolName('powershell')).toBe(false);
  });

  it('文件写组：含两个历史别名 write_to_file / replace_in_file', () => {
    for (const n of [
      'file_write',
      'file_edit',
      'write_to_file',
      'replace_in_file',
    ]) {
      expect(isFileWriteToolName(n)).toBe(true);
    }
    expect(isFileWriteToolName('file_read')).toBe(false);
  });

  it('媒体产物组：4 个交付类工具（image_generate / image_display / video_display / audio_play）', () => {
    for (const n of [
      'image_generate',
      'image_display',
      'video_display',
      'audio_play',
    ]) {
      expect(isMediaOutputToolName(n)).toBe(true);
    }
    // `image` / `canvas` 是编辑类，不是「产物转发」判定对象
    expect(isMediaOutputToolName('image')).toBe(false);
    expect(isMediaOutputToolName('canvas')).toBe(false);
  });

  it('未知 / 空名一律 false（不 fail-open）', () => {
    expect(isShellToolName('')).toBe(false);
    expect(isFileWriteToolName('mcp__x__write')).toBe(false);
    expect(isMediaOutputToolName('Bash')).toBe(false);
  });
});

describe('A-4 能力声明位（sandboxLevel）', () => {
  it('BashTool 声明 execution ⇒ 派生 capability=execute / sandbox=execution', () => {
    const tool = new BashTool(new ApprovedCommandRegistry(60_000, false));
    expect(tool.sandboxLevel).toBe('execution');
    const cap = tool.getCapability();
    expect(cap.capability).toBe('execute');
    expect(cap.sandbox).toBe('execution');
    expect(cap.risk).toBe('high');
  });
});
