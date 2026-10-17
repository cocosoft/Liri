// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-23（2026-10-17）：`read_project_file` 的单段交付类名 → `output/` 回读归一化。
 *
 * 背景：写侧把无目录前缀的交付文件落到 `output/`（`WriteProjectFileTool`），读侧此前
 * 只查项目根 ⇒ 裸名回读恒 not-found（T-④02 遗留）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const dataDir = join(tmpdir(), `u23-data-${randomUUID()}`);
const sandboxDir = join(tmpdir(), `u23-sandbox-${randomUUID()}`);
const projectId = 'proj_u23_read_output';
const prevLiriDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_DATA_DIR = dataDir;

const { ReadProjectFileTool, resetReadProjectFileStoresForTest } =
  await import('../../src/tools/ReadProjectFileTool/ReadProjectFileTool.js');

const tool = ReadProjectFileTool.create();
const ctx = {} as never;

describe('read_project_file：output/ 回读归一化（U-23）', () => {
  beforeAll(() => {
    // 清空单例：批量运行时本文件可能不是首个初始化 store 的测试文件
    resetReadProjectFileStoresForTest();
    mkdirSync(join(dataDir, 'projects', projectId), { recursive: true });
    mkdirSync(join(sandboxDir, 'output'), { recursive: true });
    writeFileSync(
      join(dataDir, 'projects', projectId, 'project.json'),
      JSON.stringify({
        id: projectId,
        workspaceId: 'default',
        name: 'U-23 read output',
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
    writeFileSync(
      join(sandboxDir, 'output', '01_清单.md'),
      '# 来自 output',
      'utf-8'
    );
    writeFileSync(join(sandboxDir, 'a.md'), '# 根目录版本', 'utf-8');
    writeFileSync(join(sandboxDir, 'output', 'a.md'), '# output 版本', 'utf-8');
  });

  afterAll(() => {
    // 还原环境后再清空单例，避免把临时数据目录带给后续测试文件
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

  it('单段名在根缺失 ⇒ 回退 output/ 命中', async () => {
    const r = await tool.execute(
      { projectId, relativePath: '01_清单.md' },
      ctx
    );
    expect(r.error).toBeUndefined();
    expect(String(r.data)).toContain('# 来自 output');
  });

  it('显式 output/ 路径照常可读', async () => {
    const r = await tool.execute(
      { projectId, relativePath: 'output/01_清单.md' },
      ctx
    );
    expect(String(r.data)).toContain('# 来自 output');
  });

  it('根目录同名文件优先（不改变既有解析语义）', async () => {
    const r = await tool.execute({ projectId, relativePath: 'a.md' }, ctx);
    expect(String(r.data)).toContain('# 根目录版本');
  });

  it('两处都不存在 ⇒ 仍返回不可读错误（不臆造）', async () => {
    const r = await tool.execute(
      { projectId, relativePath: 'missing.md' },
      ctx
    );
    expect(String(r.data)).toContain('文件不存在');
  });
});
