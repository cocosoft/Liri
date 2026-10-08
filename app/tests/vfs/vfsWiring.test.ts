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
 * AI-VFS 用户可配置挂载面 —— `buildMountPlan` 纯函数守卫（配置 → 挂载计划）。
 *
 * 覆盖：未配置（保持现状）· `dev_docs` 停用 · 未知 scheme（跳过 + WARN）·
 * `mcp` 缺 `server`（跳过 + WARN）· `mcp` 允许清单（仅注册清单内 server）。
 */

import { describe, expect, it } from 'bun:test';
import { buildMountPlan } from '../../src/entrypoints/vfsWiring.js';
import type { VfsMountConfigEntry } from '../../src/config/types.js';

/** 构造"运行时非法 scheme"条目（配置来自用户 JSON ⇒ 类型联合不阻止非法值） */
function looseEntry(entry: {
  scheme: string;
  server?: string;
  enabled?: boolean;
}): VfsMountConfigEntry {
  return entry as unknown as VfsMountConfigEntry;
}

describe('buildMountPlan', () => {
  it('未配置（undefined）⇒ dev_docs + mcp（不限 server，行为零变更）', () => {
    const plan = buildMountPlan(undefined);
    expect(plan.registerDevDocs).toBe(true);
    expect(plan.mcpAllowedServers).toBeUndefined();
    expect(plan.warnings).toEqual([]);
  });

  it('有 vfs 段但 mounts 缺省 ⇒ 同未配置（保持现状）', () => {
    const plan = buildMountPlan({});
    expect(plan.registerDevDocs).toBe(true);
    expect(plan.mcpAllowedServers).toBeUndefined();
    expect(plan.warnings).toEqual([]);
  });

  it('dev_docs 条目（enabled 缺省）⇒ 注册 dev_docs', () => {
    const plan = buildMountPlan({ mounts: [{ scheme: 'dev_docs' }] });
    expect(plan.registerDevDocs).toBe(true);
    // 仅有 dev_docs ⇒ 无有效 mcp 条目 ⇒ 不注册 mcp
    expect(plan.mcpAllowedServers).toBeNull();
  });

  it('dev_docs enabled:false ⇒ 不注册 dev_docs', () => {
    const plan = buildMountPlan({
      mounts: [{ scheme: 'dev_docs', enabled: false }],
    });
    expect(plan.registerDevDocs).toBe(false);
    expect(plan.mcpAllowedServers).toBeNull();
  });

  it('未知 scheme ⇒ 跳过该条 + WARN（不静默当「可读」）', () => {
    const plan = buildMountPlan({ mounts: [looseEntry({ scheme: 'file' })] });
    expect(plan.registerDevDocs).toBe(false);
    expect(plan.mcpAllowedServers).toBeNull();
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0]).toContain('file');
  });

  it('mcp 条目缺 server ⇒ 跳过 + WARN ⇒ 不注册 mcp', () => {
    const plan = buildMountPlan({ mounts: [{ scheme: 'mcp' }] });
    expect(plan.mcpAllowedServers).toBeNull();
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0]).toContain('server');
  });

  it('mcp server 为空白串 ⇒ 跳过 + WARN', () => {
    const plan = buildMountPlan({ mounts: [{ scheme: 'mcp', server: '   ' }] });
    expect(plan.mcpAllowedServers).toBeNull();
    expect(plan.warnings.length).toBe(1);
  });

  it('mcp 有 server ⇒ 只注册允许清单（去空白；重复亦可）', () => {
    const plan = buildMountPlan({
      mounts: [
        { scheme: 'dev_docs', enabled: true },
        { scheme: 'mcp', server: ' server-a ' },
        { scheme: 'mcp', server: 'server-b' },
      ],
    });
    expect(plan.registerDevDocs).toBe(true);
    expect(plan.mcpAllowedServers).toEqual(['server-a', 'server-b']);
    expect(plan.warnings).toEqual([]);
  });

  it('mcp enabled:false ⇒ 静默跳过（用户主动停用，非异常）', () => {
    const plan = buildMountPlan({
      mounts: [{ scheme: 'mcp', server: 'server-a', enabled: false }],
    });
    expect(plan.mcpAllowedServers).toBeNull();
    expect(plan.warnings).toEqual([]);
  });
});
