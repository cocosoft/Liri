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
 * `McpResourcesDriver` 只读驱动守卫（AI-VFS `mcp://` 并存面）。
 *
 * 覆盖：扁平列举（name = uri 原文 / limit）· 读取文本拼接 · 只读 `write` 拒绝 ·
 * `stat` 命中/未命中 · 未知 / 未连接服务器 ⇒ `VFS_UNKNOWN_MOUNT` · SDK 抛错 ⇒ `VFS_DENIED`。
 *
 * **不连真实 MCP**：全程注入 `getClient` 桩（`tests/` 内允许构造测试替身，CS04 只约束 `src/`）。
 */

import { describe, expect, it } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { AppError } from '../../src/error';
import { McpResourcesDriver } from '../../src/vfs/drivers/McpResourcesDriver.js';
import { parseVfsPath } from '../../src/vfs/VfsPath.js';

/** 桩资源条目（只需驱动实际读取的字段） */
interface StubResource {
  uri: string;
  name: string;
  mimeType?: string;
}

/** 桩 `readResource` 返回的 contents 条目 */
type StubContent =
  | { uri: string; text: string; mimeType?: string }
  | { uri: string; blob: string; mimeType?: string };

interface StubOptions {
  resources?: StubResource[];
  read?: (uri: string) => { contents: StubContent[] };
  listError?: Error;
  readError?: Error;
}

/** 构造只含被测方法的最小 SDK `Client` 桩（结构断言成 `Client`，不走真实传输） */
function stubClient(opts: StubOptions = {}): Client {
  const stub = {
    listResources: async () => {
      if (opts.listError) throw opts.listError;
      return { resources: opts.resources ?? [] };
    },
    readResource: async ({ uri }: { uri: string }) => {
      if (opts.readError) throw opts.readError;
      if (!opts.read) throw new Error(`未桩化 readResource: ${uri}`);
      return opts.read(uri);
    },
  };
  return stub as unknown as Client;
}

/** 恒定返回同一桩的取客户端 seam */
function clientSeam(client: Client | undefined) {
  return () => client;
}

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

const mcp = (suffix: string) => parseVfsPath(`mcp://${suffix}`);

describe('McpResourcesDriver：list', () => {
  it('扁平列举：name = uri 原文，kind = file', async () => {
    const driver = new McpResourcesDriver(
      clientSeam(
        stubClient({
          resources: [
            { uri: 'file:///tmp/a.txt', name: 'a.txt' },
            { uri: 'file:///tmp/b.txt', name: 'b.txt' },
          ],
        })
      )
    );
    const entries = await driver.list(mcp('server-filesystem'), {
      recursive: false,
      limit: 0,
    });
    expect(entries).toEqual([
      { name: 'file:///tmp/a.txt', kind: 'file' },
      { name: 'file:///tmp/b.txt', kind: 'file' },
    ]);
  });

  it('limit 生效', async () => {
    const driver = new McpResourcesDriver(
      clientSeam(
        stubClient({
          resources: [
            { uri: 'file:///tmp/a.txt', name: 'a.txt' },
            { uri: 'file:///tmp/b.txt', name: 'b.txt' },
          ],
        })
      )
    );
    const entries = await driver.list(mcp('server-filesystem'), {
      recursive: false,
      limit: 1,
    });
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe('file:///tmp/a.txt');
  });

  it('SDK 列举抛错 ⇒ VFS_DENIED', async () => {
    const driver = new McpResourcesDriver(
      clientSeam(stubClient({ listError: new Error('boom') }))
    );
    await expectVfsReject(
      () =>
        driver.list(mcp('server-filesystem'), { recursive: false, limit: 0 }),
      'VFS_DENIED'
    );
  });
});

describe('McpResourcesDriver：read', () => {
  it('文本内容拼接 + mimeType/size', async () => {
    const driver = new McpResourcesDriver(
      clientSeam(
        stubClient({
          read: () => ({
            contents: [
              { uri: 'file:///tmp/a.txt', mimeType: 'text/plain', text: 'hi' },
            ],
          }),
        })
      )
    );
    const r = await driver.read(mcp('server-filesystem/file:///tmp/a.txt'));
    expect(r.data).toBe('hi');
    expect(r.mimeType).toBe('text/plain');
    expect(r.size).toBe(2);
    expect(r.truncated).toBe(false);
  });

  it('blob 内容按 base64 字符串返回', async () => {
    const driver = new McpResourcesDriver(
      clientSeam(
        stubClient({
          read: () => ({
            contents: [{ uri: 'db://rows', blob: 'QUJD' }],
          }),
        })
      )
    );
    const r = await driver.read(mcp('server-db/db://rows'));
    expect(r.data).toBe('QUJD');
    expect(r.mimeType).toBe('application/octet-stream');
  });

  it('SDK 读取抛错 ⇒ VFS_DENIED', async () => {
    const driver = new McpResourcesDriver(
      clientSeam(stubClient({ readError: new Error('nope') }))
    );
    await expectVfsReject(
      () => driver.read(mcp('server-filesystem/file:///tmp/a.txt')),
      'VFS_DENIED'
    );
  });

  it('write ⇒ VFS_READ_ONLY_MOUNT', async () => {
    const driver = new McpResourcesDriver(clientSeam(stubClient()));
    await expectVfsReject(
      () =>
        driver.write(mcp('server-filesystem/file:///tmp/a.txt'), {
          content: 'x',
          mode: 'overwrite',
        }),
      'VFS_READ_ONLY_MOUNT'
    );
  });

  it('capabilities：只读 + 可列举', () => {
    const driver = new McpResourcesDriver(clientSeam(stubClient()));
    expect(driver.capabilities).toEqual({
      read: true,
      write: false,
      list: true,
    });
  });
});

describe('McpResourcesDriver：stat', () => {
  it('命中 uri ⇒ kind=file / readOnly=true / mimeType 取自条目', async () => {
    const driver = new McpResourcesDriver(
      clientSeam(
        stubClient({
          resources: [
            {
              uri: 'file:///tmp/a.txt',
              name: 'a.txt',
              mimeType: 'text/plain',
            },
          ],
        })
      )
    );
    const st = await driver.stat(mcp('server-filesystem/file:///tmp/a.txt'));
    expect(st.kind).toBe('file');
    expect(st.readOnly).toBe(true);
    expect(st.mount).toBe('mcp');
    expect(st.mimeType).toBe('text/plain');
    // MCP 资源模型不提供大小/修改时间 ⇒ 未知置 0
    expect(st.size).toBe(0);
    expect(st.mtime).toBe(0);
  });

  it('未命中 uri ⇒ VFS_NOT_FOUND', async () => {
    const driver = new McpResourcesDriver(
      clientSeam(stubClient({ resources: [] }))
    );
    await expectVfsReject(
      () => driver.stat(mcp('server-filesystem/file:///tmp/missing.txt')),
      'VFS_NOT_FOUND'
    );
  });
});

describe('McpResourcesDriver：未知 / 未连接服务器', () => {
  it('authority 缺失 ⇒ VFS_UNKNOWN_MOUNT', async () => {
    const driver = new McpResourcesDriver(clientSeam(stubClient()));
    await expectVfsReject(
      () => driver.list(parseVfsPath('mcp://'), { recursive: false, limit: 0 }),
      'VFS_UNKNOWN_MOUNT'
    );
  });

  it('服务器未连接（桩返回 undefined）⇒ VFS_UNKNOWN_MOUNT', async () => {
    const driver = new McpResourcesDriver(clientSeam(undefined));
    await expectVfsReject(
      () => driver.list(mcp('ghost-server'), { recursive: false, limit: 0 }),
      'VFS_UNKNOWN_MOUNT'
    );
  });
});
