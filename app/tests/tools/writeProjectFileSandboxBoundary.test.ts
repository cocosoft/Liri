// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2（复杂度清理）：`write_project_file.execute` **沙箱边界围栏**的特征化锁（外移前先测）。
 *
 * 现有用例覆盖"缺参 / 缺内容 / 项目不存在 / 写后回读 / 隔离适配器"，但**越界拒绝**
 * 与"单段交付物自动落 output/"这两条路径没有回归锁 —— 前者是安全兜底（路径穿越），
 * 外移时必须先钉住"拒绝文案 + 拒绝时 sandbox 外不产生任何文件"。
 *
 * 锁三条：① `../` 逃逸 ⇒ 安全拒绝（error 落字段）；② 单段交付物 ⇒ 自动落 output/；
 * ③ 已存在文件在 sandbox 内 ⇒ 允许覆盖（走 realpath 校验分支）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = join(tmpdir(), `wpf-boundary-data-${randomUUID()}`);
const sandboxDir = join(tmpdir(), `wpf-boundary-sandbox-${randomUUID()}`);
const projectId = 'proj_wpf_boundary';

// ProjectStore 经 `resolveDataDir()` 取数据目录 ⇒ 覆盖 `LIRI_DATA_DIR`（必须在首次创建工具前）
const prevDataDir = process.env.LIRI_DATA_DIR;
process.env.LIRI_DATA_DIR = dataDir;

const { WriteProjectFileTool } = await import('@openliri/tool-workspace');

const tool = WriteProjectFileTool.create();
const ctx = {} as never;

beforeAll(() => {
  mkdirSync(join(dataDir, 'projects', projectId), { recursive: true });
  mkdirSync(sandboxDir, { recursive: true });
  writeFileSync(
    join(dataDir, 'projects', projectId, 'project.json'),
    JSON.stringify({
      id: projectId,
      workspaceId: 'default',
      name: 'WPF boundary',
      description: '',
      status: 'active',
      phase: 'active',
      workItemIds: [],
      pdcaIds: [],
      tags: [],
      sandboxPath: sandboxDir,
      createdAt: new Date().toISOString(),
    })
  );
});

afterAll(() => {
  if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevDataDir;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(sandboxDir, { recursive: true, force: true });
});

describe('write_project_file 沙箱边界（P3-2 外移前特征化）', () => {
  it('../ 逃逸（新文件）⇒ 安全拒绝，且 sandbox 外不产生文件', async () => {
    const result = await tool.execute(
      { projectId, relativePath: '../escaped.txt', content: 'x' },
      ctx
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('安全拒绝：文件路径超出项目文件夹范围');
    // 越界文件不得落在 sandbox 的上一层（含 mkdir 先行创建目录的形态）
    expect(existsSync(join(sandboxDir, '..', 'escaped.txt'))).toBe(false);
    expect(existsSync(join(sandboxDir, '..'))).toBe(true);
  });

  it('多级 ../ 逃逸（新文件）⇒ 同样拒绝', async () => {
    const result = await tool.execute(
      {
        projectId,
        relativePath: 'sub/../../../escaped-deep.txt',
        content: 'x',
      },
      ctx
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('安全拒绝');
  });

  it('单段交付物 ⇒ 自动落 output/（回执路径与落点一致）', async () => {
    const result = await tool.execute(
      { projectId, relativePath: 'report.md', content: '# hi' },
      ctx
    );

    expect(result.error).toBeUndefined();
    const payload = JSON.parse(String(result.data)) as { path: string };
    expect(payload.path).toBe(join('output', 'report.md'));
    expect(readFileSync(join(sandboxDir, 'output', 'report.md'), 'utf8')).toBe(
      '# hi'
    );
  });

  it('已存在文件在 sandbox 内 ⇒ 允许覆盖（realpath 校验分支）', async () => {
    writeFileSync(join(sandboxDir, 'note.txt'), 'old', 'utf8');

    const result = await tool.execute(
      { projectId, relativePath: 'note.txt', content: 'new' },
      ctx
    );

    expect(result.error).toBeUndefined();
    expect(readFileSync(join(sandboxDir, 'note.txt'), 'utf8')).toBe('new');
  });

  it('多级新路径 ⇒ 父目录递归创建后写入', async () => {
    const result = await tool.execute(
      { projectId, relativePath: 'sub/deep/a.md', content: 'y' },
      ctx
    );

    expect(result.error).toBeUndefined();
    expect(readFileSync(join(sandboxDir, 'sub', 'deep', 'a.md'), 'utf8')).toBe(
      'y'
    );
  });
});
