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
 * AI-VFS 4 系统调用工具守卫（read_vfs / list_vfs / stat_vfs / write_vfs）。
 *
 * 覆盖：正常调用 · 未知 scheme ⇒ `VFS_UNKNOWN_MOUNT` · 穿越 ⇒ `VFS_DENIED` ·
 * 只读挂载 `write_vfs` ⇒ `VFS_READ_ONLY_MOUNT`（fail-closed）。
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReadVfsTool } from '../../src/tools/ReadVfsTool/ReadVfsTool.js';
import { ListVfsTool } from '../../src/tools/ListVfsTool/ListVfsTool.js';
import { StatVfsTool } from '../../src/tools/StatVfsTool/StatVfsTool.js';
import { WriteVfsTool } from '../../src/tools/WriteVfsTool/WriteVfsTool.js';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext.js';
import { DevDocsDriver } from '../../src/vfs/drivers/DevDocsDriver.js';
import { vfsMountRegistry } from '../../src/vfs/VfsMountRegistry.js';

/** 测试专用挂载 scheme（避免与生产 `dev_docs` 装配冲突） */
const SCHEME = 'vfs_pilot_test';

const readTool = ReadVfsTool.create();
const listTool = ListVfsTool.create();
const statTool = StatVfsTool.create();
const writeTool = WriteVfsTool.create();
const ctx = {} as ToolUseContext;

let root = '';

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'vfs-tools-')));
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'a.md'), '# hello\n', 'utf-8');
  writeFileSync(join(root, 'sub', 'b.md'), '# b\n', 'utf-8');
  if (!vfsMountRegistry.has(SCHEME)) {
    // 第三个实参 = 回显 scheme（与注册键一致，使 stat.mount 如实）
    vfsMountRegistry.registerMount(
      SCHEME,
      new DevDocsDriver(root, undefined, SCHEME)
    );
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('read_vfs', () => {
  it('成功读取并返回结构化结果', async () => {
    const r = await readTool.execute({ path: `${SCHEME}://a.md` }, ctx);
    expect(r.error).toBeUndefined();
    const payload = JSON.parse(r.data as string) as {
      data: string;
      mimeType: string;
    };
    expect(payload.data).toBe('# hello\n');
    expect(payload.mimeType).toBe('text/markdown');
  });

  it('未知 scheme ⇒ VFS_UNKNOWN_MOUNT', async () => {
    const r = await readTool.execute({ path: 'no_such_mount://a.md' }, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toContain('VFS_UNKNOWN_MOUNT');
    expect(r.metadata?.errorCode).toBe('VFS_UNKNOWN_MOUNT');
  });

  it('非法路径（缺 scheme://）⇒ VFS_UNKNOWN_MOUNT', async () => {
    const r = await readTool.execute({ path: 'a.md' }, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toContain('VFS_UNKNOWN_MOUNT');
  });

  it('穿越 ⇒ VFS_DENIED', async () => {
    const r = await readTool.execute(
      { path: `${SCHEME}://../../~/.pyapp/config.json` },
      ctx
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('VFS_DENIED');
  });

  it('不存在 ⇒ VFS_NOT_FOUND', async () => {
    const r = await readTool.execute({ path: `${SCHEME}://missing.md` }, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toContain('VFS_NOT_FOUND');
  });
});

describe('list_vfs', () => {
  it('scheme-only（`<scheme>://`）⇒ 列举挂载点（驱动未实现 ⇒ 兜底为 scheme 本身）', async () => {
    const r = await listTool.execute({ path: `${SCHEME}://` }, ctx);
    expect(r.error).toBeUndefined();
    const payload = JSON.parse(r.data as string) as {
      entries: Array<{ name: string; kind: string }>;
      count: number;
    };
    expect(payload.entries).toEqual([{ name: `${SCHEME}://`, kind: 'dir' }]);
    expect(payload.count).toBe(1);
  });

  it('带 authority 的路径 ⇒ 列举该目录条目', async () => {
    const r = await listTool.execute({ path: `${SCHEME}://sub` }, ctx);
    expect(r.error).toBeUndefined();
    const payload = JSON.parse(r.data as string) as {
      entries: Array<{ name: string }>;
      count: number;
    };
    expect(payload.entries.map((e) => e.name)).toContain('b.md');
    expect(payload.count).toBe(payload.entries.length);
  });

  it('未知 scheme ⇒ VFS_UNKNOWN_MOUNT', async () => {
    const r = await listTool.execute({ path: 'no_such_mount://' }, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toContain('VFS_UNKNOWN_MOUNT');
  });
});

describe('stat_vfs', () => {
  it('成功返回元数据（readOnly = true）', async () => {
    const r = await statTool.execute({ path: `${SCHEME}://a.md` }, ctx);
    expect(r.error).toBeUndefined();
    const payload = JSON.parse(r.data as string) as {
      kind: string;
      mount: string;
      readOnly: boolean;
    };
    expect(payload.kind).toBe('file');
    expect(payload.mount).toBe(SCHEME);
    expect(payload.readOnly).toBe(true);
  });

  it('未知 scheme ⇒ VFS_UNKNOWN_MOUNT', async () => {
    const r = await statTool.execute({ path: 'no_such_mount://a.md' }, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toContain('VFS_UNKNOWN_MOUNT');
  });
});

describe('write_vfs', () => {
  it('只读挂载 ⇒ VFS_READ_ONLY_MOUNT（fail-closed，不静默降级）', async () => {
    const r = await writeTool.execute(
      { path: `${SCHEME}://new.md`, content: 'x', mode: 'create' },
      ctx
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('VFS_READ_ONLY_MOUNT');
    expect(r.metadata?.errorCode).toBe('VFS_READ_ONLY_MOUNT');
  });

  it('未知 scheme ⇒ VFS_UNKNOWN_MOUNT（先于只读判定）', async () => {
    const r = await writeTool.execute(
      { path: 'no_such_mount://new.md', content: 'x' },
      ctx
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('VFS_UNKNOWN_MOUNT');
  });

  it('工具元数据：write_vfs 非只读且破坏性；read/list/stat 只读', () => {
    expect(writeTool.isReadOnly()).toBe(false);
    expect(writeTool.isDestructive?.()).toBe(true);
    expect(readTool.isReadOnly()).toBe(true);
    expect(listTool.isReadOnly()).toBe(true);
    expect(statTool.isReadOnly()).toBe(true);
  });
});
