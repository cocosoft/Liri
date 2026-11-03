/**
 * ProjectStore 项目上下文文件单测（P2-3）
 *
 * 覆盖方案 P0-1/P0-2 断言：
 * - create() 后 project-context.md 存在且含 sandboxPath（断点 2 根治）
 * - update() 改名后 context 文件同步刷新（P0-1）
 * - save() 幂等补写不破坏已有 content（P0-2）
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../ProjectStore';
import { WorkItemStore } from '../WorkItemStore';
import { setUserDataDirOverride } from '@openliri/infra/environment';

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

/**
 * P0（2026-11-03，cwd 方案 §六.3）：sandboxPath **写入期校验**。
 * 背景：会话/项目元数据一旦指向不可用路径，工具链要到 spawn 期才炸
 *（libuv 把 chdir 失败误报成 cmd.exe 缺失）。校验必须在元数据落盘前拦截。
 */
describe('ProjectStore sandboxPath 写入期校验（P0，2026-11-03）', () => {
  it('拒绝相对路径 sandboxPath', () => {
    const { store } = createIsolatedStore();
    expect(() =>
      store.create({
        workspaceId: 'default',
        name: 'x',
        sandboxPath: 'relative/path',
      })
    ).toThrow(/绝对路径/);
  });

  it('拒绝已存在但不是目录的 sandboxPath', () => {
    const { store, liriDir } = createIsolatedStore();
    const filePath = join(liriDir, 'a-file.txt');
    writeFileSync(filePath, 'x', 'utf-8');
    expect(() =>
      store.create({ workspaceId: 'default', name: 'x', sandboxPath: filePath })
    ).toThrow(/不是目录/);
  });

  it('delaySandbox 允许目录尚不存在（延迟创建契约），但同样拒绝相对路径', () => {
    const { store, liriDir } = createIsolatedStore();
    const missing = join(liriDir, 'not-yet-created');
    const project = store.create({
      workspaceId: 'default',
      name: 'x',
      sandboxPath: missing,
      delaySandbox: true,
    });
    expect(project.sandboxPath).toBe(missing);
    expect(() =>
      store.create({
        workspaceId: 'default',
        name: 'y',
        sandboxPath: 'rel',
        delaySandbox: true,
      })
    ).toThrow(/绝对路径/);
  });

  it('有效绝对路径（不存在⇒自动创建 / 已存在目录）正常创建', () => {
    const { store, liriDir } = createIsolatedStore();
    const fresh = join(liriDir, 'fresh-sandbox');
    const p1 = store.create({
      workspaceId: 'default',
      name: 'a',
      sandboxPath: fresh,
    });
    expect(p1.sandboxPath).toBe(fresh);
    expect(existsSync(fresh)).toBe(true);
    // 已存在的目录作为另一个项目的显式路径同样合法
    const p2 = store.create({
      workspaceId: 'default',
      name: 'b',
      sandboxPath: fresh,
    });
    expect(p2.sandboxPath).toBe(fresh);
  });
});

/**
 * P1（2026-11-03）：默认项目工作区根由路径注册表提供（`LIRI_PROJECTS_DIR` 可覆盖），
 * 不再在 `ProjectStore.create()` 硬编码 `~/Documents/LiriProjects`。
 */
describe('ProjectStore 默认 sandboxPath 走注册表（P1，2026-11-03）', () => {
  const originalProjectsDir = process.env.LIRI_PROJECTS_DIR;

  afterEach(() => {
    if (originalProjectsDir === undefined) delete process.env.LIRI_PROJECTS_DIR;
    else process.env.LIRI_PROJECTS_DIR = originalProjectsDir;
  });

  it('未显式指定 ⇒ <LIRI_PROJECTS_DIR>/<projectId>（且延迟创建不落地）', () => {
    const root = mkdtempSync(join(tmpdir(), 'projects-root-'));
    tmpDirs.push(root);
    process.env.LIRI_PROJECTS_DIR = root;

    const { store } = createIsolatedStore();
    const project = store.create({
      workspaceId: 'default',
      name: '默认路径',
      delaySandbox: true,
    });

    expect(project.sandboxPath).toBe(join(root, project.id));
    // delaySandbox 契约：元数据已落盘，但目录尚未创建
    expect(existsSync(project.sandboxPath)).toBe(false);
  });

  it('显式 sandboxPath 优先于 LIRI_PROJECTS_DIR（用户选择不被覆盖）', () => {
    const root = mkdtempSync(join(tmpdir(), 'projects-root-'));
    tmpDirs.push(root);
    process.env.LIRI_PROJECTS_DIR = root;

    const { store, liriDir } = createIsolatedStore();
    const explicit = join(liriDir, 'explicit-sandbox');
    const project = store.create({
      workspaceId: 'default',
      name: '显式路径',
      sandboxPath: explicit,
      delaySandbox: true,
    });

    expect(project.sandboxPath).toBe(explicit);
  });

  it('用户设置 projectsDirectory 生效（P2：环境变量未设时用它）', () => {
    const home = mkdtempSync(join(tmpdir(), 'projects-home-'));
    tmpDirs.push(home);
    const configured = mkdtempSync(join(tmpdir(), 'projects-configured-'));
    tmpDirs.push(configured);
    writeFileSync(
      join(home, 'settings.json'),
      JSON.stringify({ projectsDirectory: configured }),
      'utf-8'
    );
    delete process.env.LIRI_PROJECTS_DIR;
    setUserDataDirOverride(home);

    try {
      const { store } = createIsolatedStore();
      const project = store.create({
        workspaceId: 'default',
        name: '走设置',
        delaySandbox: true,
      });
      expect(project.sandboxPath).toBe(join(configured, project.id));
    } finally {
      setUserDataDirOverride(null);
    }
  });
});
