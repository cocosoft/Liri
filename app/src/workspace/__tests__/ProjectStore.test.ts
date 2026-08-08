/**
 * ProjectStore 项目上下文文件单测（P2-3）
 *
 * 覆盖方案 P0-1/P0-2 断言：
 * - create() 后 project-context.md 存在且含 sandboxPath（断点 2 根治）
 * - update() 改名后 context 文件同步刷新（P0-1）
 * - save() 幂等补写不破坏已有 content（P0-2）
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../ProjectStore';
import { WorkItemStore } from '../WorkItemStore';

/** 临时目录（afterAll 清理） */
let tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 忽略清理失败 */
    }
  }
});

/** 创建使用独立临时目录的 ProjectStore */
function createIsolatedStore(): {
  store: ProjectStore;
  liriDir: string;
  sandboxPath: string;
} {
  const liriDir = mkdtempSync(join(tmpdir(), 'projstore-test-'));
  tmpDirs.push(liriDir);
  const workItemStore = new WorkItemStore(liriDir);
  const store = new ProjectStore(liriDir, workItemStore);
  const sandboxPath = join(liriDir, 'sandbox');
  return { store, liriDir, sandboxPath };
}

describe('ProjectStore project-context.md（P2-3）', () => {
  it('create() 后生成 project-context.md 且含 sandboxPath（断点 2 根治）', () => {
    const { store, liriDir, sandboxPath } = createIsolatedStore();

    const project = store.create({
      workspaceId: 'default',
      name: '测试项目',
      description: '用于验证上下文文件',
      sandboxPath,
    });

    const contextPath = join(
      liriDir,
      'projects',
      project.id,
      'project-context.md'
    );
    expect(existsSync(contextPath)).toBe(true);

    const content = readFileSync(contextPath, 'utf-8');
    expect(content).toContain('## 项目上下文');
    expect(content).toContain(`**名称**: 测试项目`);
    expect(content).toContain(`**文件夹**: ${sandboxPath}`);
  });

  it('update() 改名后 context 文件同步刷新（P0-1）', () => {
    const { store, liriDir, sandboxPath } = createIsolatedStore();

    const project = store.create({
      workspaceId: 'default',
      name: '原名',
      sandboxPath,
    });

    const contextPath = join(
      liriDir,
      'projects',
      project.id,
      'project-context.md'
    );
    const before = readFileSync(contextPath, 'utf-8');
    expect(before).toContain('**名称**: 原名');

    store.update(project.id, { name: '新名' });

    const after = readFileSync(contextPath, 'utf-8');
    expect(after).toContain('**名称**: 新名');
    expect(after).toContain(`**文件夹**: ${sandboxPath}`);
  });

  it('惰性迁移（旧路径 <id>.json）后 context 文件生成（P0-2）', () => {
    const { store, liriDir, sandboxPath } = createIsolatedStore();

    // 手工构造旧路径 <id>.json（模拟存量数据），不调 create()
    const legacyId = 'legacy-proj-1';
    const legacyPath = join(liriDir, 'projects', `${legacyId}.json`);
    const { mkdirSync, writeFileSync } =
      require('node:fs') as typeof import('node:fs');
    mkdirSync(join(liriDir, 'projects'), { recursive: true });
    writeFileSync(
      legacyPath,
      JSON.stringify({
        id: legacyId,
        workspaceId: 'default',
        name: '存量项目',
        description: '',
        status: 'active',
        phase: 'active',
        workItemIds: [],
        pdcaIds: [],
        tags: [],
        sandboxPath,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      'utf-8'
    );

    // list() 触发惰性迁移 → save() → 幂等补写 context
    const projects = store.list('default');
    const migrated = projects.find((p) => p.id === legacyId);
    expect(migrated).toBeDefined();

    const contextPath = join(
      liriDir,
      'projects',
      legacyId,
      'project-context.md'
    );
    expect(existsSync(contextPath)).toBe(true);
    const content = readFileSync(contextPath, 'utf-8');
    expect(content).toContain(`**名称**: 存量项目`);
    expect(content).toContain(`**文件夹**: ${sandboxPath}`);
  });
});
