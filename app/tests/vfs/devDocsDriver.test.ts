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
 * `DevDocsDriver` 只读驱动守卫（AI-VFS 只读试点）。
 *
 * 覆盖：list / stat / read 正常路径 · 路径穿越（`..` / `~` / 反斜杠）拒绝 ·
 * 只读挂载 `write` ⇒ `VFS_READ_ONLY_MOUNT` · 真实文档树可用性。
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
import { AppError } from '../../src/error';
import { DevDocsDriver } from '../../src/vfs/drivers/DevDocsDriver.js';
import { parseVfsPath } from '../../src/vfs/VfsPath.js';

async function expectVfsReject(
  fn: () => Promise<unknown>,
  code: string
): Promise<void> {
  try {
    await fn();
    throw new Error('未抛出异常');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

const vfs = (suffix: string) => parseVfsPath(`dev_docs://${suffix}`);

let root = '';
let driver: DevDocsDriver;

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'vfs-driver-')));
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'a.md'), '# hello\nworld\n', 'utf-8');
  writeFileSync(join(root, 'sub', 'b.txt'), 'nested', 'utf-8');
  driver = new DevDocsDriver(root);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('DevDocsDriver：list', () => {
  it('列举根目录（非递归）⇒ 文件与目录条目', async () => {
    const entries = await driver.list(vfs(''), { recursive: false, limit: 0 });
    const names = entries.map((e) => `${e.kind}:${e.name}`);
    expect(names).toContain('file:a.md');
    expect(names).toContain('dir:sub');
    expect(names).not.toContain('file:sub/b.txt');
  });

  it('递归列举 ⇒ 含子目录条目', async () => {
    const entries = await driver.list(vfs(''), { recursive: true, limit: 0 });
    expect(entries.map((e) => e.name)).toContain('sub/b.txt');
  });

  it('limit 生效', async () => {
    const entries = await driver.list(vfs(''), { recursive: true, limit: 1 });
    expect(entries.length).toBe(1);
  });

  it('对文件调用 list ⇒ VFS_NOT_DIR', async () => {
    await expectVfsReject(
      () => driver.list(vfs('a.md'), { recursive: false, limit: 0 }),
      'VFS_NOT_DIR'
    );
  });

  it('不存在的路径 ⇒ VFS_NOT_FOUND', async () => {
    await expectVfsReject(
      () => driver.list(vfs('missing'), { recursive: false, limit: 0 }),
      'VFS_NOT_FOUND'
    );
  });
});

describe('DevDocsDriver：stat', () => {
  it('文件 ⇒ kind/size/mtime/mimeType/mount/readOnly', async () => {
    const st = await driver.stat(vfs('a.md'));
    expect(st.kind).toBe('file');
    expect(st.size).toBeGreaterThan(0);
    expect(st.mtime).toBeGreaterThan(0);
    expect(st.mimeType).toBe('text/markdown');
    expect(st.mount).toBe('dev_docs');
    expect(st.readOnly).toBe(true);
  });

  it('目录 ⇒ kind=dir 且无 mimeType', async () => {
    const st = await driver.stat(vfs('sub'));
    expect(st.kind).toBe('dir');
    expect(st.mimeType).toBeUndefined();
  });
});

describe('DevDocsDriver：read', () => {
  it('读取文件内容', async () => {
    const r = await driver.read(vfs('a.md'));
    expect(r.data).toBe('# hello\nworld\n');
    expect(r.mimeType).toBe('text/markdown');
    expect(r.truncated).toBe(false);
  });

  it('offset/limit 按行切片', async () => {
    const r = await driver.read(vfs('a.md'), { offset: 1, limit: 1 });
    expect(r.data).toBe('world');
  });

  it('目标是目录 ⇒ VFS_IS_DIR', async () => {
    await expectVfsReject(() => driver.read(vfs('sub')), 'VFS_IS_DIR');
  });

  it('不存在 ⇒ VFS_NOT_FOUND', async () => {
    await expectVfsReject(() => driver.read(vfs('nope.md')), 'VFS_NOT_FOUND');
  });
});

describe('DevDocsDriver：路径安全（穿越 / 逃逸 ⇒ VFS_DENIED）', () => {
  it('`..` 段被拒绝（含契约示例用例）', async () => {
    await expectVfsReject(
      () => driver.read(parseVfsPath('dev_docs://../../~/.pyapp/config.json')),
      'VFS_DENIED'
    );
  });

  it('`~` 段被拒绝', async () => {
    await expectVfsReject(() => driver.read(vfs('~/secret.md')), 'VFS_DENIED');
  });

  it('反斜杠（UNC / Windows 分隔符注入）被拒绝', async () => {
    await expectVfsReject(
      () => driver.read(parseVfsPath('dev_docs://sub\\b.txt')),
      'VFS_DENIED'
    );
  });
});

describe('DevDocsDriver：只读能力 fail-closed', () => {
  it('capabilities.write === false', () => {
    expect(driver.capabilities).toEqual({
      read: true,
      write: false,
      list: true,
    });
  });

  it('write ⇒ VFS_READ_ONLY_MOUNT（不静默降级）', async () => {
    await expectVfsReject(
      () => driver.write(vfs('new.md'), { content: 'x', mode: 'create' }),
      'VFS_READ_ONLY_MOUNT'
    );
  });
});

describe('DevDocsDriver：真实文档树可用性', () => {
  const realDriver = new DevDocsDriver(join(import.meta.dir, '../../docs'));

  it('列举真实文档树根 ⇒ 命中已知文档', async () => {
    const entries = await realDriver.list(parseVfsPath('dev_docs://'), {
      recursive: false,
      limit: 0,
    });
    expect(entries.map((e) => e.name)).toContain('index.md');
  });

  it('读取真实文档（配置与安全/sandbox.md）', async () => {
    const r = await realDriver.read(
      parseVfsPath('dev_docs://配置与安全/sandbox.md')
    );
    expect(r.data.length).toBeGreaterThan(0);
    expect(r.mimeType).toBe('text/markdown');
  });

  it('stat 真实文档 ⇒ readOnly = true', async () => {
    const st = await realDriver.stat(
      parseVfsPath('dev_docs://配置与安全/sandbox.md')
    );
    expect(st.kind).toBe('file');
    expect(st.readOnly).toBe(true);
  });
});
