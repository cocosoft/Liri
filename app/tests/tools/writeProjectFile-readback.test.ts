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
 * T-⑥14 / T-④02（2026-10-03）：`write_project_file` 的**写后回读校验（read-after-write）**。
 *
 * 背景：该工具原实现 `writeFileSync` 后**不校验实际落地**即报成功；实测会话中
 * `output/01..17` 的 17 份建议文件确实未落盘，而结果又不可判定 ⇒ 出现
 * "宣称已写 → 自查不存在"。本组用例锁定「成功必须自证（verified + 真实字节数）」。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// 数据目录与沙箱均指向临时目录（避免污染真实数据）
const dataDir = join(tmpdir(), `t614-data-${randomUUID()}`);
const sandboxDir = join(tmpdir(), `t614-sandbox-${randomUUID()}`);
const projectId = 'proj_t614_readback';

// ProjectStore 经 `resolveDataDir()` 取第二层数据目录 ⇒ 覆盖 `LIRI_DATA_DIR`
// （必须在首次调用工具前设置：工具的 projectStore 为惰性单例）
process.env.LIRI_DATA_DIR = dataDir;

const { WriteProjectFileTool } =
  await import('../../src/tools/WriteProjectFileTool/WriteProjectFileTool.js');

const tool = WriteProjectFileTool.create();
const ctx = {} as never;

describe('write_project_file 写后回读校验（T-⑥14）', () => {
  beforeAll(() => {
    mkdirSync(join(dataDir, 'projects', projectId), { recursive: true });
    mkdirSync(sandboxDir, { recursive: true });
    writeFileSync(
      join(dataDir, 'projects', projectId, 'project.json'),
      JSON.stringify({
        id: projectId,
        workspaceId: 'default',
        name: 'T-⑥14 readback',
        description: '',
        status: 'active',
        phase: 'active',
        workItemIds: [],
        pdcaIds: [],
        tags: [],
        sandboxPath: sandboxDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      'utf-8'
    );
  });

  afterAll(() => {
    for (const d of [dataDir, sandboxDir]) {
      try {
        if (existsSync(d)) rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  it('写入成功 ⇒ 文件真实落地，且结果自证（verified + 真实字节数）', async () => {
    const content = '# 终版复核\n\n本行用于回读校验。\n';
    const r = await tool.execute(
      { projectId, relativePath: 'output/r.md', content },
      ctx
    );

    expect(r.error).toBeUndefined();
    const abs = join(sandboxDir, 'output', 'r.md');
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs, 'utf-8')).toBe(content);

    const data = JSON.parse(String(r.data)) as {
      path: string;
      sandboxPath: string;
      size: number;
      verified: boolean;
      readBackBytes: number;
    };
    const expected = Buffer.byteLength(content, 'utf-8');
    expect(data.verified).toBe(true);
    expect(data.size).toBe(expected);
    expect(data.readBackBytes).toBe(expected);
    expect(data.path).toBe('output/r.md');
    expect(data.sandboxPath).toBe(sandboxDir);
  });

  it('单段交付类文件名 ⇒ 自动落入 output/（与提示词目录约定一致）且校验通过', async () => {
    const r = await tool.execute(
      { projectId, relativePath: '00_清单.md', content: 'x' },
      ctx
    );

    expect(r.error).toBeUndefined();
    const data = JSON.parse(String(r.data)) as {
      path: string;
      verified: boolean;
    };
    expect(data.path).toBe(join('output', '00_清单.md'));
    expect(data.verified).toBe(true);
    expect(existsSync(join(sandboxDir, 'output', '00_清单.md'))).toBe(true);
  });

  it('越界路径（../）⇒ 安全拒绝且落 error，且不在 sandbox 外创建文件', async () => {
    const outside = join(sandboxDir, '..', 't614-escape.md');
    const r = await tool.execute(
      { projectId, relativePath: '../t614-escape.md', content: 'x' },
      ctx
    );

    expect(r.error).toBeTruthy();
    expect(r.error).toContain('安全拒绝');
    expect(existsSync(outside)).toBe(false);
  });

  it('source_file 拷贝路径同样落盘并自证', async () => {
    const src = join(sandboxDir, '_src.md');
    const content = '# 源文件\n\n来自 source_file。\n';
    writeFileSync(src, content, 'utf-8');

    const r = await tool.execute(
      {
        projectId,
        relativePath: 'output/from-source.md',
        source_file: src,
      },
      ctx
    );

    expect(r.error).toBeUndefined();
    const data = JSON.parse(String(r.data)) as {
      size: number;
      verified: boolean;
    };
    expect(data.verified).toBe(true);
    expect(data.size).toBe(Buffer.byteLength(content, 'utf-8'));
  });
});
