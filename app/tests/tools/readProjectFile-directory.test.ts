// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-2（2026-11-04，《运行态问题排查与修复方案》）：`read_project_file` 对目录的调用
 * 必须给出**可执行出路**，而不是裸 `EISDIR`。
 *
 * 实测（窗口内 2 次）：模型把目录当文件读 ⇒ `EISDIR: illegal operation on a directory, read`，
 * 该文案既不说"这是目录"，也不说"该用什么工具"，模型只能重复同一调用。
 *
 * 用例来自真机形态：项目 sandbox 下有一个目录 `docs/`，模型传入 `relativePath: 'docs'`。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const dataDir = join(tmpdir(), `p22-data-${randomUUID()}`);
const sandboxDir = join(tmpdir(), `p22-sandbox-${randomUUID()}`);
const projectId = 'proj_p22_read_dir';
const prevLiriDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_DATA_DIR = dataDir;

const { ReadProjectFileTool, resetReadProjectFileStoresForTest } =
  await import('../../src/tools/ReadProjectFileTool/ReadProjectFileTool.js');

const tool = ReadProjectFileTool.create();
const ctx = {} as never;

describe('P2-2：read_project_file 读目录 ⇒ 可执行出路', () => {
  beforeAll(() => {
    resetReadProjectFileStoresForTest();
    mkdirSync(join(dataDir, 'projects', projectId), { recursive: true });
    mkdirSync(join(sandboxDir, 'docs'), { recursive: true });
    writeFileSync(
      join(dataDir, 'projects', projectId, 'project.json'),
      JSON.stringify({
        id: projectId,
        workspaceId: 'default',
        name: 'P2-2 read directory',
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
    writeFileSync(join(sandboxDir, 'docs', 'a.md'), '# 目录内的文件', 'utf-8');
    writeFileSync(join(sandboxDir, 'root.md'), '# 根文件', 'utf-8');
  });

  afterAll(() => {
    if (prevLiriDataDir === undefined) delete process.env.LIRI_DATA_DIR;
    else process.env.LIRI_DATA_DIR = prevLiriDataDir;
    resetReadProjectFileStoresForTest();
    for (const d of [dataDir, sandboxDir]) {
      try {
        if (existsSync(d)) rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  it('读目录 ⇒ 明确说明"这是目录"+ 指向 glob/list（不再是裸 EISDIR）', async () => {
    const r = await tool.execute({ projectId, relativePath: 'docs' }, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
    expect(r.error).toContain('这是一个目录');
    expect(r.error).toContain('glob');
    expect(r.error).not.toContain('EISDIR');
  });

  it('读目录内的具体文件仍正常（回归：前置判定不误伤）', async () => {
    const r = await tool.execute({ projectId, relativePath: 'docs/a.md' }, ctx);
    expect(r.error).toBeUndefined();
    expect(String(r.data)).toContain('# 目录内的文件');
  });
});
