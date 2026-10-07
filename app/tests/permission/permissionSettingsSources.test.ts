// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * settings 文件的权限来源**接线**（2026-10-07）
 *
 * 背景：`loadAllPermissionSettings` 此前**零消费者** ⇒ settings 文件里的
 * `permissions.allow|deny|ask` 整体未接线（用户写进 settings 的权限规则不生效）。
 * 本批把装载点接入 `PermissionManager` 的决策上下文。
 *
 * 覆盖：
 * - 用户 settings（`~/.pyapp/settings.json`）的 allow / deny / ask 按**来源桶**进入上下文；
 * - `additionalDirectories` 汇总进上下文（该字段当前无消费者，仅锁定不丢）；
 * - 装载点已接入 `PermissionManager`（`new` 后即可见）；
 * - 无 settings 文件 ⇒ 空上下文、不抛错（失败安全）。
 *
 * 隔离：用 `setUserDataDirOverride()` 而非仅设 `LIRI_HOME`（后者会被 override 盖过，
 * 导致读写真实数据目录 —— 见 `pdcaCheckpointRetention.test.ts` 注释的教训）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadAllPermissionSettings } from '../../src/permission/permissionsLoader';
import { PermissionManager } from '../../src/permission/PermissionManager';
import { PermissionRuleSource } from '../../src/permission/types/PermissionRule';
import {
  setUserDataDirOverride,
  getUserDataDirOverride,
} from '../../src/core/paths';

const USER = PermissionRuleSource.USER_SETTINGS;

function writeUserSettings(
  baseDir: string,
  body: Record<string, unknown>
): void {
  writeFileSync(
    join(baseDir, 'settings.json'),
    JSON.stringify(body, null, 2),
    'utf-8'
  );
}

describe('settings 权限来源接线', () => {
  let baseDir: string;
  let prevOverride: string | null;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'liri-perm-settings-'));
    prevOverride = getUserDataDirOverride();
    setUserDataDirOverride(baseDir);
  });

  afterEach(() => {
    setUserDataDirOverride(prevOverride);
    rmSync(baseDir, { recursive: true, force: true });
  });

  test('用户 settings 的 allow/deny/ask 按来源进入上下文', () => {
    writeUserSettings(baseDir, {
      permissions: {
        allow: ['file_read'],
        deny: ['bash(rm -rf *)'],
        ask: ['file_write'],
      },
      additionalDirectories: ['/tmp/extra-dir'],
    });

    const ctx = loadAllPermissionSettings();

    expect(ctx.alwaysAllowRules[USER]).toEqual(['file_read']);
    expect(ctx.alwaysDenyRules[USER]).toEqual(['bash(rm -rf *)']);
    expect(ctx.alwaysAskRules[USER]).toEqual(['file_write']);
    expect(ctx.additionalWorkingDirectories).toEqual(['/tmp/extra-dir']);
  });

  test('装载点已接入 PermissionManager 决策上下文（此前零消费者）', () => {
    writeUserSettings(baseDir, {
      permissions: { deny: ['bash(rm -rf *)'] },
    });

    const ctx = new PermissionManager().getToolPermissionContext();

    expect(ctx.alwaysDenyRules[USER]).toEqual(['bash(rm -rf *)']);
  });

  test('无 settings 文件 ⇒ 空上下文，不抛错（失败安全）', () => {
    const ctx = loadAllPermissionSettings();

    expect(ctx.alwaysAllowRules[USER]).toEqual([]);
    expect(ctx.alwaysDenyRules[USER]).toEqual([]);
    expect(ctx.alwaysAskRules[USER]).toEqual([]);
    expect(ctx.additionalWorkingDirectories).toEqual([]);
  });

  test('allow/deny/ask 三表互不串写（共享对象缺陷回归）', () => {
    writeUserSettings(baseDir, {
      permissions: { allow: ['file_read'] },
    });

    const ctx = loadAllPermissionSettings();

    expect(ctx.alwaysAllowRules[USER]).toEqual(['file_read']);
    expect(ctx.alwaysDenyRules[USER]).toEqual([]);
    expect(ctx.alwaysAskRules[USER]).toEqual([]);
  });
});
