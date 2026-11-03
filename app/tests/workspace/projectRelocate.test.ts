/**
 * §九（2026-11-03）：项目「重新定位」口径
 *
 * 口径来源：`dev_docs/20261103/工具cwd无效根因与修复方案-20261103.md §九`
 * - **只改指向**：不复制 / 不移动 / 不删除文件；目标必须**已存在且是目录**；
 * - 幂等：与当前路径相同 ⇒ `noop`（不写盘）；
 * - 会话跟随：仅 `metadata.projectId === 本项目` 且 `workspacePath === 旧路径` 的会话被改写；
 * - 冲突决议：不改 `updatedAt` 排序语义（会话层已明确），
 *   部分失败不回滚元数据（由调用方以 warnings 上报）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ProjectStore } from '../../src/workspace/ProjectStore';
import { WorkItemStore } from '../../src/workspace/WorkItemStore';
import {
  followSessionsToRelocatedPath,
  type RelocateSessionApi,
} from '../../src/infrastructure/http/handlers/project-handlers';

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响断言 */
    }
  }
});

function makeStore(): {
  store: ProjectStore;
  liriDir: string;
  oldDir: string;
  newDir: string;
} {
  const liriDir = mkdtempSync(join(tmpdir(), 'relocate-liri-'));
  const oldDir = mkdtempSync(join(tmpdir(), 'relocate-old-'));
  const newDir = mkdtempSync(join(tmpdir(), 'relocate-new-'));
  tmpDirs.push(liriDir, oldDir, newDir);
  const store = new ProjectStore(liriDir, new WorkItemStore(liriDir));
  return { store, liriDir, oldDir, newDir };
}

describe('ProjectStore.relocate — 校验（§9.3）', () => {
  it('目标不存在 ⇒ 抛错，且不创建目录、元数据不变', () => {
    const { store, oldDir } = makeStore();
    const project = store.create({
      workspaceId: 'default',
      name: 'p',
      sandboxPath: oldDir,
      delaySandbox: true,
    });
    const missing = join(oldDir, 'not-there');

    expect(() => store.relocate(project.id, missing)).toThrow(/目标目录不存在/);
    expect(existsSync(missing)).toBe(false);
    expect(store.get(project.id)?.sandboxPath).toBe(oldDir);
  });

  it('目标是文件 ⇒ 抛错（存在 ≠ 可作目录）', () => {
    const { store, oldDir, newDir } = makeStore();
    const project = store.create({
      workspaceId: 'default',
      name: 'p',
      sandboxPath: oldDir,
      delaySandbox: true,
    });
    const file = join(newDir, 'a-file.txt');
    writeFileSync(file, 'x', 'utf-8');

    expect(() => store.relocate(project.id, file)).toThrow(/不是目录/);
  });

  it('相对路径 ⇒ 抛错', () => {
    const { store, oldDir } = makeStore();
    const project = store.create({
      workspaceId: 'default',
      name: 'p',
      sandboxPath: oldDir,
      delaySandbox: true,
    });

    expect(() => store.relocate(project.id, 'relative/path')).toThrow(
      /绝对路径/
    );
  });

  it('项目不存在 ⇒ null（调用方转 404）', () => {
    const { store, newDir } = makeStore();
    expect(store.relocate('proj_missing', newDir)).toBeNull();
  });
});

describe('ProjectStore.relocate — 生效（§9.4）', () => {
  it('幂等：同一路径 ⇒ noop，且 updatedAt 不变', () => {
    const { store, oldDir } = makeStore();
    const project = store.create({
      workspaceId: 'default',
      name: 'p',
      sandboxPath: oldDir,
      delaySandbox: true,
    });

    const result = store.relocate(project.id, oldDir);
    expect(result?.noop).toBe(true);
    expect(result?.previousPath).toBe(oldDir);
    expect(result?.project.updatedAt).toBe(project.updatedAt);
  });

  it('有效目标 ⇒ 改指向 + 重写 project-context.md，且**不动**旧/新目录内容', () => {
    const { store, liriDir, oldDir, newDir } = makeStore();
    writeFileSync(join(oldDir, 'keep.txt'), 'old', 'utf-8');
    const project = store.create({
      workspaceId: 'default',
      name: 'p',
      sandboxPath: oldDir,
      delaySandbox: true,
    });

    const result = store.relocate(project.id, newDir);

    expect(result?.noop).toBe(false);
    expect(result?.previousPath).toBe(oldDir);
    expect(result?.project.sandboxPath).toBe(newDir);
    expect(store.get(project.id)?.sandboxPath).toBe(newDir);

    const context = readFileSync(
      join(liriDir, 'projects', project.id, 'project-context.md'),
      'utf-8'
    );
    expect(context).toContain(`**文件夹**: ${newDir}`);

    // 只改指向：旧目录内容原样保留，新目录不凭空产生文件
    expect(existsSync(join(oldDir, 'keep.txt'))).toBe(true);
    expect(readFileSync(join(oldDir, 'keep.txt'), 'utf-8')).toBe('old');
  });
});

describe('followSessionsToRelocatedPath — 会话跟随（§9.4-3）', () => {
  const OLD = resolve(tmpdir(), 'proj-old');
  const NEW = resolve(tmpdir(), 'proj-new');

  function fakeApi(
    sessions: Array<{ id: string; metadata?: Record<string, unknown> }>,
    failOn: string[] = []
  ): { api: RelocateSessionApi; calls: Array<[string, string]> } {
    const calls: Array<[string, string]> = [];
    return {
      calls,
      api: {
        listSessions: async () => sessions,
        updateSessionMeta: async (sessionId, meta) => {
          if (failOn.includes(sessionId)) throw new Error('boom');
          calls.push([sessionId, String(meta.workspacePath)]);
        },
      },
    };
  }

  it('只改写「本项目 + 旧路径」的会话（其他项目 / 其他路径 / 无 workspacePath 不动）', async () => {
    const { api, calls } = fakeApi([
      { id: 's-hit', metadata: { projectId: 'p1', workspacePath: OLD } },
      {
        id: 's-other-project',
        metadata: { projectId: 'p2', workspacePath: OLD },
      },
      {
        id: 's-other-path',
        metadata: { projectId: 'p1', workspacePath: join(OLD, 'sub') },
      },
      { id: 's-empty', metadata: { projectId: 'p1' } },
      {
        id: 's-non-abs',
        metadata: { projectId: 'p1', workspacePath: 'rel/path' },
      },
    ]);

    const result = await followSessionsToRelocatedPath('p1', OLD, NEW, api);

    expect(result.updated).toBe(1);
    expect(result.failed).toBe(0);
    expect(calls).toEqual([['s-hit', NEW]]);
  });

  it('单条失败计入 warnings/failed，不影响其他会话继续', async () => {
    const { api, calls } = fakeApi(
      [
        { id: 's-a', metadata: { projectId: 'p1', workspacePath: OLD } },
        { id: 's-b', metadata: { projectId: 'p1', workspacePath: OLD } },
      ],
      ['s-a']
    );

    const result = await followSessionsToRelocatedPath('p1', OLD, NEW, api);

    expect(result.updated).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.warnings[0]).toContain('s-a');
    expect(calls).toEqual([['s-b', NEW]]);
  });

  it('Windows 大小写差异视为同一路径（避免漏改）', async () => {
    if (process.platform !== 'win32') return; // 仅 Windows 语义
    const { api } = fakeApi([
      {
        id: 's-case',
        metadata: { projectId: 'p1', workspacePath: OLD.toUpperCase() },
      },
    ]);
    const result = await followSessionsToRelocatedPath('p1', OLD, NEW, api);
    expect(result.updated).toBe(1);
  });
});
